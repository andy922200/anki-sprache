import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'

const languageDto = z.object({
  code: z.string(),
  name: z.string(),
  nativeName: z.string(),
  enabled: z.boolean(),
})

export const languagesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  app.get(
    '/',
    { schema: { response: { 200: z.array(languageDto) } } },
    async () => {
      return app.prisma.language.findMany({ orderBy: [{ enabled: 'desc' }, { code: 'asc' }] })
    },
  )
}
