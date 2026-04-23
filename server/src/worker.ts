import { Queue, Worker, type Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { Redis } from 'ioredis'
import pino from 'pino'
import { env, isDev } from './config/env.js'
import { QUEUE_NAMES } from './shared/plugins/bullmq.plugin.js'
import {
  generateForUser,
  generateAdditionalForUser,
  type GenerateForUserInput,
} from './modules/generation/generation.service.js'

interface GenerationJobData {
  userId: string
  generationDate: string
  mode?: 'DAILY' | 'ADDITIONAL'
  count?: number
}

const log = pino({
  level: env.LOG_LEVEL,
  transport: isDev ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z' } } : undefined,
})

async function main() {
  const prisma = new PrismaClient()
  await prisma.$connect()
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
  const connection = { url: env.REDIS_URL }

  const userGenerationQueue = new Queue(QUEUE_NAMES.userGeneration, { connection })

  const userGenerationWorker = new Worker<GenerationJobData>(
    QUEUE_NAMES.userGeneration,
    async (job: Job<GenerationJobData>) => {
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
        return result
      }
      const input: GenerateForUserInput = {
        userId: job.data.userId,
        generationDate: date,
      }
      log.info({ jobId: job.id, userId: input.userId }, 'generateForUser: start')
      const result = await generateForUser(prisma, redis, input)
      log.info({ jobId: job.id, ...result }, 'generateForUser: done')
      return result
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
