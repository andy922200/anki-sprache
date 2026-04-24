import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Queue } from 'bullmq'
import { z } from 'zod'
import { QUEUE_NAMES } from '@/shared/plugins/bullmq.plugin.js'
import { isDev } from '@/config/env.js'

/**
 * True if the user has a user-generation job currently queued, active, or
 * sitting in a retry backoff window. Used by the status endpoint to avoid
 * reporting a failed LLM call while BullMQ may still succeed on retry.
 *
 * Pass `mode` to restrict to a specific job mode (e.g. `UPGRADE_EXAMPLES`).
 * Omit it to match any daily/additional/upgrade job for the user.
 */
async function isUserGenerationJobInFlight(
  queue: Queue,
  userId: string,
  mode?: 'DAILY' | 'ADDITIONAL' | 'UPGRADE_EXAMPLES',
): Promise<boolean> {
  const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized'], 0, 50, false)
  return jobs.some((j) => {
    const data = j.data as { userId?: string; mode?: string } | undefined
    if (data?.userId !== userId) return false
    if (!mode) return true
    // Daily jobs have no explicit mode field; treat undefined as 'DAILY'.
    return (data?.mode ?? 'DAILY') === mode
  })
}

const LlmProvider = z.enum(['OPENAI', 'ANTHROPIC', 'GOOGLE'])

export const generationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  app.post(
    '/today',
    {
      config: {
        rateLimit: isDev
          ? { max: 60, timeWindow: '1 hour' }
          : { max: 5, timeWindow: '1 hour' },
      },
      schema: {
        querystring: z.object({
          force: z
            .string()
            .optional()
            .transform((v) => v === 'true'),
        }),
        response: {
          202: z.object({ jobId: z.string(), status: z.literal('queued') }),
          200: z.object({
            jobId: z.null(),
            status: z.literal('already-done'),
            cardIds: z.array(z.string()),
            provider: LlmProvider.nullable(),
          }),
        },
      },
    },
    async (req, reply) => {
      const userId = req.user!.userId
      const force = req.query.force === true
      const today = new Date()
      const dateOnly = new Date(
        `${today.toISOString().slice(0, 10)}T00:00:00.000Z`,
      )

      const settings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
      })
      const existing = await app.prisma.dailyGenerationLog.findUnique({
        where: {
          userId_generationDate_languageCode: {
            userId,
            generationDate: dateOnly,
            languageCode: settings.targetLanguageCode,
          },
        },
      })
      if (existing && !force) {
        reply.code(200)
        return {
          jobId: null as null,
          status: 'already-done' as const,
          cardIds: existing.cardIds,
          provider: existing.provider,
        }
      }

      if (existing && force) {
        // Regenerate: drop today's log and any NEW (unreviewed) user-card
        // states for those cards. Reviewed cards (LEARNING/REVIEW/...) stay
        // so we don't blow away progress.
        await app.prisma.$transaction([
          app.prisma.userCardState.deleteMany({
            where: {
              userId,
              cardId: { in: existing.cardIds },
              state: 'NEW',
            },
          }),
          app.prisma.dailyGenerationLog.delete({
            where: { id: existing.id },
          }),
        ])
        const cacheKeys = await app.redis.keys(`cards:due:${userId}:*`)
        if (cacheKeys.length) await app.redis.del(...cacheKeys)
      }

      // Preflight: we can only generate if user has a preferred LLM provider
      // AND has uploaded an API key for that provider. Surface the reason
      // synchronously so the UI can guide the user.
      if (!settings.preferredLlmProvider) {
        throw app.httpErrors.badRequest('LLM_PROVIDER_NOT_SET')
      }
      const key = await app.prisma.llmApiKey.findUnique({
        where: {
          userId_provider: { userId, provider: settings.preferredLlmProvider },
        },
      })
      if (!key) {
        throw app.httpErrors.badRequest(
          `LLM_API_KEY_MISSING:${settings.preferredLlmProvider}`,
        )
      }

      // No deterministic jobId — BullMQ treats existing jobIds as no-op,
      // which would silently swallow retries after a previous failure.
      // Idempotency is enforced in generation.service.ts via the
      // DailyGenerationLog unique constraint + Redis lock.
      const job = await app.queues.userGeneration.add('generateForUser', {
        userId,
        generationDate: today.toISOString(),
      })
      reply.code(202)
      return { jobId: job.id!, status: 'queued' as const }
    },
  )

  app.get(
    '/status',
    {
      schema: {
        response: {
          200: z.object({
            done: z.boolean(),
            cardIds: z.array(z.string()),
            provider: LlmProvider.nullable(),
            lastError: z.string().nullable(),
            upgradeInFlight: z.boolean(),
            lastUpgradeError: z.string().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.user!.userId
      const settings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
      })
      const today = new Date().toISOString().slice(0, 10)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

      const [log, upgradeInFlight, recentUpgradeFail] = await Promise.all([
        app.prisma.dailyGenerationLog.findUnique({
          where: {
            userId_generationDate_languageCode: {
              userId,
              generationDate: new Date(`${today}T00:00:00.000Z`),
              languageCode: settings.targetLanguageCode,
            },
          },
        }),
        isUserGenerationJobInFlight(app.queues.userGeneration, userId, 'UPGRADE_EXAMPLES'),
        app.prisma.llmUsageLog.findFirst({
          where: {
            userId,
            purpose: 'EXAMPLE_REGEN',
            success: false,
            createdAt: { gte: oneHourAgo },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ])

      // Only surface a stale upgrade error once no upgrade job is still in
      // flight — otherwise BullMQ may still succeed on retry.
      const lastUpgradeError = upgradeInFlight ? null : recentUpgradeFail?.errorCode ?? null

      if (log) {
        return {
          done: true,
          cardIds: log.cardIds,
          provider: log.provider,
          lastError: null,
          upgradeInFlight,
          lastUpgradeError,
        }
      }

      // If there's still a daily/additional job in flight (active,
      // delayed/retrying, or waiting) for this user, don't surface transient
      // LLM errors — BullMQ may still succeed on a subsequent attempt.
      const dailyInFlight = await isUserGenerationJobInFlight(app.queues.userGeneration, userId)
      if (dailyInFlight) {
        return {
          done: false,
          cardIds: [],
          provider: null,
          lastError: null,
          upgradeInFlight,
          lastUpgradeError,
        }
      }

      // Not yet done AND no job in flight — surface the most recent failed
      // LLM call so the UI can show the real error instead of silently
      // spinning forever.
      const recentFail = await app.prisma.llmUsageLog.findFirst({
        where: {
          userId,
          purpose: 'DAILY_GEN',
          success: false,
          createdAt: { gte: oneHourAgo },
        },
        orderBy: { createdAt: 'desc' },
      })
      return {
        done: false,
        cardIds: [],
        provider: null,
        lastError: recentFail?.errorCode ?? null,
        upgradeInFlight,
        lastUpgradeError,
      }
    },
  )

  app.post(
    '/more',
    {
      config: {
        rateLimit: isDev
          ? { max: 60, timeWindow: '1 hour' }
          : { max: 10, timeWindow: '1 hour' },
      },
      schema: {
        body: z.object({ count: z.number().int().min(1).max(20).default(5) }),
        response: { 202: z.object({ jobId: z.string(), status: z.literal('queued') }) },
      },
    },
    async (req, reply) => {
      const userId = req.user!.userId
      const settings = await app.prisma.userSettings.findUniqueOrThrow({ where: { userId } })
      if (!settings.preferredLlmProvider) {
        throw app.httpErrors.badRequest('LLM_PROVIDER_NOT_SET')
      }
      const key = await app.prisma.llmApiKey.findUnique({
        where: { userId_provider: { userId, provider: settings.preferredLlmProvider } },
      })
      if (!key) {
        throw app.httpErrors.badRequest(`LLM_API_KEY_MISSING:${settings.preferredLlmProvider}`)
      }

      // Must have a daily deck already so we know what to extend
      const today = new Date()
      const existing = await app.prisma.dailyGenerationLog.findUnique({
        where: {
          userId_generationDate_languageCode: {
            userId,
            generationDate: new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`),
            languageCode: settings.targetLanguageCode,
          },
        },
      })
      if (!existing) {
        throw app.httpErrors.badRequest('NO_DAILY_DECK')
      }

      const job = await app.queues.userGeneration.add('generateMoreForUser', {
        userId,
        generationDate: today.toISOString(),
        mode: 'ADDITIONAL',
        count: req.body.count,
      })
      reply.code(202)
      return { jobId: job.id!, status: 'queued' as const }
    },
  )

  app.post(
    '/examples/upgrade',
    {
      config: {
        rateLimit: isDev
          ? { max: 60, timeWindow: '1 hour' }
          : { max: 5, timeWindow: '1 hour' },
      },
      schema: {
        response: {
          202: z.object({ jobId: z.string(), status: z.literal('queued') }),
          200: z.object({ jobId: z.null(), status: z.literal('already-running') }),
        },
      },
    },
    async (req, reply) => {
      const userId = req.user!.userId
      const settings = await app.prisma.userSettings.findUniqueOrThrow({ where: { userId } })
      if (!settings.preferredLlmProvider) {
        throw app.httpErrors.badRequest('LLM_PROVIDER_NOT_SET')
      }
      const key = await app.prisma.llmApiKey.findUnique({
        where: { userId_provider: { userId, provider: settings.preferredLlmProvider } },
      })
      if (!key) {
        throw app.httpErrors.badRequest(`LLM_API_KEY_MISSING:${settings.preferredLlmProvider}`)
      }

      const inFlight = await isUserGenerationJobInFlight(
        app.queues.userGeneration,
        userId,
        'UPGRADE_EXAMPLES',
      )
      if (inFlight) {
        reply.code(200)
        return { jobId: null as null, status: 'already-running' as const }
      }

      const job = await app.queues.userGeneration.add('upgradeExamplesForUser', {
        userId,
        generationDate: new Date().toISOString(),
        mode: 'UPGRADE_EXAMPLES',
      })
      reply.code(202)
      return { jobId: job.id!, status: 'queued' as const }
    },
  )

  // mark unused import as referenced to silence linters if any
  void QUEUE_NAMES
}
