import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'
import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'

import { env, isDev } from '@/config/env.js'
import prismaPlugin from '@/shared/plugins/prisma.plugin.js'
import redisPlugin from '@/shared/plugins/redis.plugin.js'
import bullmqPlugin from '@/shared/plugins/bullmq.plugin.js'
import authPlugin from '@/shared/plugins/auth.plugin.js'
import errorHandlerPlugin from '@/shared/plugins/errorHandler.js'

import { authRoutes } from '@/modules/auth/auth.routes.js'
import { usersRoutes } from '@/modules/users/users.routes.js'
import { settingsRoutes } from '@/modules/settings/settings.routes.js'
import { llmKeysRoutes } from '@/modules/llmKeys/llmKeys.routes.js'
import { languagesRoutes } from '@/modules/languages/languages.routes.js'
import { cardsRoutes } from '@/modules/cards/cards.routes.js'
import { reviewsRoutes } from '@/modules/reviews/reviews.routes.js'
import { generationRoutes } from '@/modules/generation/generation.routes.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: isDev ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z' } } : undefined,
    },
    disableRequestLogging: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // Security + core
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(sensible)
  await app.register(cookie)
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  })

  // Infra plugins
  await app.register(prismaPlugin)
  await app.register(redisPlugin)
  await app.register(bullmqPlugin)

  // Global rate limit with Redis store
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    redis: app.redis,
    keyGenerator: (req) => req.user?.userId ?? req.ip,
  })

  await app.register(authPlugin)
  await app.register(errorHandlerPlugin)

  // OpenAPI docs
  await app.register(swagger, {
    openapi: {
      info: { title: 'Anki-Sprache API', version: '0.1.0' },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  })
  await app.register(swaggerUi, { routePrefix: '/docs' })

  // Health
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  // Routes
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(usersRoutes, { prefix: '/me' })
  await app.register(settingsRoutes, { prefix: '/me/settings' })
  await app.register(llmKeysRoutes, { prefix: '/me/llm-keys' })
  await app.register(languagesRoutes, { prefix: '/languages' })
  await app.register(cardsRoutes, { prefix: '/cards' })
  await app.register(reviewsRoutes, { prefix: '/reviews' })
  await app.register(generationRoutes, { prefix: '/generate' })

  return app
}
