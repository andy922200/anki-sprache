import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { env } from '@/config/env.js'

export default fp(async (app) => {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  })

  redis.on('error', (err) => {
    app.log.error({ err }, 'Redis error')
  })

  await new Promise<void>((resolve, reject) => {
    redis.once('ready', resolve)
    redis.once('error', reject)
  })

  app.decorate('redis', redis)

  app.addHook('onClose', async () => {
    await redis.quit()
  })
})
