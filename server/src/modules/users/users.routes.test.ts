import sensible from '@fastify/sensible'
import swagger from '@fastify/swagger'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/config/env.config.js', () => ({ isDev: true, env: { PORT: 3000 } }))

const { usersRoutes } = await import('./users.routes.js')
const { default: errorHandlerPlugin } = await import('@/shared/plugins/errorHandler.js')

async function setup() {
  const prisma = {
    user: {
      update: vi.fn(async (args: { data: { displayName?: string; timezone?: string } }) => ({
        id: 'u1',
        email: 'a@example.com',
        displayName: args.data.displayName ?? 'Andy',
        avatarUrl: null,
        timezone: args.data.timezone ?? 'UTC',
      })),
    },
  }

  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(errorHandlerPlugin)
  await app.register(sensible)
  await app.register(swagger, { openapi: { info: { title: 'test', version: '0' } } })
  app.decorate('prisma', prisma as never)
  app.decorate('authenticate', async (req) => {
    Object.assign(req, { user: { userId: 'u1' } })
  })
  await app.register(usersRoutes, { prefix: '/me' })
  await app.ready()
  return { app, prisma }
}

const patch = (app: Awaited<ReturnType<typeof setup>>['app'], payload: unknown) =>
  app.inject({ method: 'PATCH', url: '/me', payload: payload as object })

describe('PATCH /me timezone', () => {
  it.each(['Asia/Taipei', 'America/New_York', 'UTC'])('saves %s', async (timezone) => {
    const { app, prisma } = await setup()

    const res = await patch(app, { timezone })

    expect(res.statusCode).toBe(200)
    expect(res.json().timezone).toBe(timezone)
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { timezone } })
  })

  it.each([
    ['a fixed offset', 'UTC+8'],
    ['an ISO offset', '+08:00'],
    ['an Etc/GMT zone', 'Etc/GMT-8'],
    ['an empty string', ''],
    ['an unknown zone', 'Asia/Nowhere'],
    ['an over-long value', `Asia/${'A'.repeat(50)}`],
  ])('rejects %s with the standard 400 body and does not write', async (_label, timezone) => {
    const { app, prisma } = await setup()

    const res = await patch(app, { timezone })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      error: 'ValidationError',
      message: 'Invalid request payload',
      issues: expect.any(Array),
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('reports which field failed', async () => {
    const { app } = await setup()

    const res = await patch(app, { timezone: 'UTC+8' })

    expect(JSON.stringify(res.json().issues)).toContain('timezone')
    expect(JSON.stringify(res.json().issues)).toContain('IANA')
  })

  it('still allows changing only the display name', async () => {
    const { app, prisma } = await setup()

    const res = await patch(app, { displayName: 'New Name' })

    expect(res.statusCode).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { displayName: 'New Name' },
    })
  })

  it('keeps the OpenAPI document buildable for /docs', async () => {
    const { app } = await setup()

    const doc = app.swagger() as { paths: Record<string, Record<string, unknown>> }

    expect(doc.paths['/me/']?.patch).toBeDefined()
    expect(() => JSON.stringify(doc)).not.toThrow()
  })
})
