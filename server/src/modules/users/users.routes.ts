import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'

const userDto = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  timezone: z.string(),
})

const patchUserSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  timezone: z.string().min(1).max(50).optional(),
})

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  app.get('/', { schema: { response: { 200: userDto } } }, async (req) => {
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } })
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
    }
  })

  app.patch(
    '/',
    { schema: { body: patchUserSchema, response: { 200: userDto } } },
    async (req) => {
      const user = await app.prisma.user.update({
        where: { id: req.user!.userId },
        data: req.body,
      })
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        timezone: user.timezone,
      }
    },
  )
}
