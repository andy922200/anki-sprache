import type { PrismaClient } from '@prisma/client'
import type { Redis } from 'ioredis'
import type { Queue } from 'bullmq'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
    redis: Redis
    queues: {
      userGeneration: Queue
      dailyFanout: Queue
    }
    authenticate: (
      req: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>
  }

  interface FastifyRequest {
    user?: {
      userId: string
      email: string
    }
  }
}

export {}
