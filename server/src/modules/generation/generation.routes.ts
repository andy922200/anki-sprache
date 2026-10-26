import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import type { Queue } from 'bullmq'
import { z } from 'zod'
import { QUEUE_NAMES } from '@/shared/plugins/bullmq.plugin.js'
import { MAX_DAILY_NEW_COUNT } from '@/config/limits.config.js'
import { RATE_LIMITS } from '@/config/rate-limit.config.js'
import { llmProviderSchema } from '@/shared/schemas/enums.js'
import { noNewWordsKey } from './generation.service.js'

/**
 * True if the user has a user-generation job currently queued, active, or
 * sitting in a retry backoff window. Used by the status endpoint to avoid
 * reporting a failed LLM call while BullMQ may still succeed on retry.
 *
 * Pass `mode` to restrict to a specific job mode (e.g. `ADDITIONAL`).
 * Omit it to match any daily/additional job for the user.
 */
async function isUserGenerationJobInFlight(
  queue: Queue,
  userId: string,
  mode?: 'DAILY' | 'ADDITIONAL',
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


export const generationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.decorateRequest('llmRateKey', '')
  app.addHook('preHandler', app.authenticate)

  // Scope LLM-facing rate limit buckets by the user's currently selected
  // provider+model so switching model gives the user a fresh bucket.
  const attachLlmRateKey = async (req: FastifyRequest) => {
    const s = await app.prisma.userSettings.findUnique({
      where: { userId: req.user!.userId },
      select: { preferredLlmProvider: true, preferredLlmModel: true },
    })
    req.llmRateKey = `${s?.preferredLlmProvider ?? 'NONE'}:${s?.preferredLlmModel ?? 'default'}`
  }
  const llmScopedKey = (req: FastifyRequest) => `${req.user!.userId}:${req.llmRateKey}`

  app.post(
    '/today',
    {
      config: {
        rateLimit: { ...RATE_LIMITS.generateToday, keyGenerator: llmScopedKey },
      },
      preHandler: attachLlmRateKey,
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
            provider: llmProviderSchema.nullable(),
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

      // Preflight: we can only generate if user has a preferred LLM provider
      // AND has uploaded an API key for that provider. Surface the reason
      // synchronously so the UI can guide the user. Runs before the force
      // delete below so a failed preflight never discards today's cards.
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

      // No deterministic jobId — BullMQ treats existing jobIds as no-op,
      // which would silently swallow retries after a previous failure.
      // Idempotency is enforced in generation.service.ts via the
      // DailyGenerationLog unique constraint + Redis lock.
      await app.redis.del(noNewWordsKey(userId))
      const job = await app.queues.userGeneration.add('generateForUser', {
        userId,
        generationDate: today.toISOString(),
        excludeCardIds: force && existing ? existing.cardIds : undefined,
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
            provider: llmProviderSchema.nullable(),
            lastError: z.string().nullable(),
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

      const log = await app.prisma.dailyGenerationLog.findUnique({
        where: {
          userId_generationDate_languageCode: {
            userId,
            generationDate: new Date(`${today}T00:00:00.000Z`),
            languageCode: settings.targetLanguageCode,
          },
        },
      })

      const noNewWords = await app.redis.get(noNewWordsKey(userId))
      const noNewWordsError = noNewWords
        ? `NO_NEW_WORDS:${(JSON.parse(noNewWords) as string[]).join(',')}`
        : null

      if (log) {
        return {
          done: true,
          cardIds: log.cardIds,
          provider: log.provider,
          lastError: noNewWordsError,
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
        }
      }

      if (noNewWordsError) {
        return { done: false, cardIds: [], provider: null, lastError: noNewWordsError }
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
      }
    },
  )

  app.post(
    '/more',
    {
      config: {
        rateLimit: { ...RATE_LIMITS.generateMore, keyGenerator: llmScopedKey },
      },
      preHandler: attachLlmRateKey,
      schema: {
        body: z.object({ count: z.number().int().min(1).max(MAX_DAILY_NEW_COUNT).default(5) }),
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

      await app.redis.del(noNewWordsKey(userId))
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

  // mark unused import as referenced to silence linters if any
  void QUEUE_NAMES
}
