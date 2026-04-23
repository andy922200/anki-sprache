import fp from 'fastify-plugin'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client.js'
import { env } from '@/config/env.js'

export default fp(async (app) => {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
  const prisma = new PrismaClient({
    adapter,
    log: app.log.level === 'debug' ? ['query', 'error', 'warn'] : ['error', 'warn'],
  })

  await prisma.$connect()
  app.decorate('prisma', prisma)

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
})
