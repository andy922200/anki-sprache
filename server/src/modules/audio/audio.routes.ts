import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { RATE_LIMITS } from '@/config/rate-limit.config.js'
import { ensureAudio } from './audio.service.js'

const audioResponse = z.object({ audioUrl: z.url() })

export const audioRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  app.post(
    '/lemma/:cardId',
    {
      config: { rateLimit: RATE_LIMITS.audio },
      schema: {
        params: z.object({ cardId: z.string() }),
        response: { 200: audioResponse },
      },
    },
    async (req) => {
      const audioUrl = await ensureAudio(app.prisma, app.redis, 'lemma', req.params.cardId)
      return { audioUrl }
    },
  )

  app.post(
    '/examples/:exampleId',
    {
      config: { rateLimit: RATE_LIMITS.audio },
      schema: {
        params: z.object({ exampleId: z.string() }),
        response: { 200: audioResponse },
      },
    },
    async (req) => {
      const audioUrl = await ensureAudio(app.prisma, app.redis, 'example', req.params.exampleId)
      return { audioUrl }
    },
  )
}
