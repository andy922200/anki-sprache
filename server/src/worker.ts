import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq'
import { PrismaPg } from '@prisma/adapter-pg'
import { Redis } from 'ioredis'
import pino from 'pino'
import { PrismaClient } from './generated/prisma/client.js'
import { env, isDev } from './config/env.config.js'
import { QUEUE_NAMES } from './shared/plugins/bullmq.plugin.js'
import {
  NO_NEW_WORDS_TTL_SECONDS,
  NoNewWordsError,
  generateForUser,
  generateAdditionalForUser,
  noNewWordsKey,
  recordShortStreak,
  type GenerateForUserInput,
} from './modules/generation/generation.service.js'

interface GenerationJobData {
  userId: string
  generationDate: string
  mode?: 'DAILY' | 'ADDITIONAL'
  count?: number
  excludeCardIds?: string[]
}

const log = pino({
  level: env.LOG_LEVEL,
  transport: isDev ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z' } } : undefined,
})

async function main() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })
  await prisma.$connect()
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
  const connection = { url: env.REDIS_URL }

  const userGenerationQueue = new Queue(QUEUE_NAMES.userGeneration, { connection })

  // Stored on a short deck too, so the UI can offer a top-up that skips these lemmas.
  async function rememberRejected(userId: string, lemmas: string[] = []) {
    if (!lemmas.length) return
    await redis.set(noNewWordsKey(userId), JSON.stringify(lemmas), 'EX', NO_NEW_WORDS_TTL_SECONDS)
  }

  async function trackShortStreak(userId: string, short: boolean | undefined) {
    if (short !== undefined) await recordShortStreak(redis, userId, short)
  }

  async function runGenerationJob(job: Job<GenerationJobData>) {
    const date = new Date(job.data.generationDate)
    if (job.data.mode === 'ADDITIONAL') {
      log.info(
        { jobId: job.id, userId: job.data.userId, count: job.data.count },
        'generateAdditionalForUser: start',
      )
      const result = await generateAdditionalForUser(prisma, redis, {
        userId: job.data.userId,
        generationDate: date,
        count: job.data.count ?? 5,
      })
      log.info({ jobId: job.id, ...result }, 'generateAdditionalForUser: done')
      await rememberRejected(job.data.userId, result.rejectedLemmas)
      await trackShortStreak(job.data.userId, result.short)
      return result
    }
    const input: GenerateForUserInput = {
      userId: job.data.userId,
      generationDate: date,
      excludeCardIds: job.data.excludeCardIds,
    }
    log.info({ jobId: job.id, userId: input.userId }, 'generateForUser: start')
    const result = await generateForUser(prisma, redis, input)
    log.info({ jobId: job.id, ...result }, 'generateForUser: done')
    await rememberRejected(input.userId, result.rejectedLemmas)
    await trackShortStreak(input.userId, result.short)
    return result
  }

  const userGenerationWorker = new Worker<GenerationJobData>(
    QUEUE_NAMES.userGeneration,
    async (job: Job<GenerationJobData>) => {
      try {
        return await runGenerationJob(job)
      } catch (err) {
        if (!(err instanceof NoNewWordsError)) throw err
        log.warn(
          { jobId: job.id, userId: job.data.userId, rejectedLemmas: err.rejectedLemmas },
          'generation: LLM returned only words the user already has',
        )
        await recordShortStreak(redis, job.data.userId, true)
        await redis.set(
          noNewWordsKey(job.data.userId),
          JSON.stringify(err.rejectedLemmas),
          'EX',
          NO_NEW_WORDS_TTL_SECONDS,
        )
        // Retrying would just ask the same LLM again; the user decides whether to try once more.
        throw new UnrecoverableError(err.message)
      }
    },
    { connection, concurrency: 4 },
  )

  const fanoutWorker = new Worker(
    QUEUE_NAMES.dailyFanout,
    async () => {
      const now = new Date()
      const users = await prisma.user.findMany({
        where: { deletedAt: null, settings: { isNot: null } },
        include: { settings: true },
      })
      let enqueued = 0
      for (const user of users) {
        if (localHourFor(user.timezone, now) !== 4) continue
        const dateOnly = localDateFor(user.timezone, now)
        const existing = await prisma.dailyGenerationLog.findUnique({
          where: {
            userId_generationDate_languageCode: {
              userId: user.id,
              generationDate: new Date(`${dateOnly}T00:00:00.000Z`),
              languageCode: user.settings!.targetLanguageCode,
            },
          },
        })
        if (existing) continue
        await userGenerationQueue.add(
          'generateForUser',
          { userId: user.id, generationDate: now.toISOString() },
          { delay: Math.floor(Math.random() * 10 * 60 * 1000) },
        )
        enqueued++
      }
      log.info({ enqueued }, 'dailyFanout: done')
      return { enqueued }
    },
    { connection, concurrency: 1 },
  )

  // Register repeatable fanout job (runs every hour)
  const fanoutQueue = new Queue(QUEUE_NAMES.dailyFanout, { connection })
  await fanoutQueue.add(
    'fanOutDaily',
    {},
    { repeat: { pattern: '0 * * * *' }, jobId: 'daily-fanout-cron' },
  )

  userGenerationWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'user-generation job failed')
  })
  fanoutWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'daily-fanout job failed')
  })

  log.info('Workers started')

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      log.info(`Received ${sig}, shutting down workers`)
      await Promise.all([
        userGenerationWorker.close(),
        fanoutWorker.close(),
        userGenerationQueue.close(),
        fanoutQueue.close(),
      ])
      await prisma.$disconnect()
      await redis.quit()
      process.exit(0)
    })
  }
}

function localHourFor(tz: string, d: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: tz,
    })
    return Number(fmt.format(d))
  } catch {
    return d.getUTCHours()
  }
}

function localDateFor(tz: string, d: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: tz,
    })
    return fmt.format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

main().catch((err) => {
  console.error('Worker failed to start', err)
  process.exit(1)
})
