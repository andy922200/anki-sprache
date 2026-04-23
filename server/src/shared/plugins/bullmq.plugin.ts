import fp from 'fastify-plugin'
import { Queue } from 'bullmq'
import { env } from '@/config/env.js'

export const QUEUE_NAMES = {
  userGeneration: 'user-generation',
  dailyFanout: 'daily-fanout',
} as const

export default fp(async (app) => {
  const connection = { url: env.REDIS_URL }

  const userGeneration = new Queue(QUEUE_NAMES.userGeneration, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  })

  const dailyFanout = new Queue(QUEUE_NAMES.dailyFanout, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  })

  app.decorate('queues', { userGeneration, dailyFanout })

  app.addHook('onClose', async () => {
    await Promise.all([userGeneration.close(), dailyFanout.close()])
  })
})
