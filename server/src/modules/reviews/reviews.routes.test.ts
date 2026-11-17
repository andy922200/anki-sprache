import sensible from '@fastify/sensible'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_REVIEW_DURATION_MS } from '@/config/limits.config.js'

vi.mock('@/config/env.config.js', () => ({ isDev: true, env: {} }))

const { reviewsRoutes } = await import('./reviews.routes.js')

async function setup() {
  const savedState = {
    id: 's1',
    due: new Date(Date.now() + 10 * 60000),
    stability: 1,
    difficulty: 5,
    state: 'LEARNING',
    reps: 1,
    lapses: 0,
    lastReview: new Date(),
  }
  const tx = {
    userCardState: { create: vi.fn(async () => savedState), update: vi.fn() },
    reviewLog: { create: vi.fn(async () => ({})) },
  }
  const prisma = {
    vocabularyCard: { findUnique: vi.fn(async () => ({ id: 'c1' })) },
    userCardState: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const redis = { keys: vi.fn(async () => []), del: vi.fn() }

  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  app.decorate('prisma', prisma as never)
  app.decorate('redis', redis as never)
  app.decorate('authenticate', async (req) => {
    Object.assign(req, { user: { userId: 'u1' } })
  })
  await app.register(reviewsRoutes, { prefix: '/reviews' })
  await app.ready()
  return { app, tx }
}

const post = (app: Awaited<ReturnType<typeof setup>>['app'], durationMs: unknown) =>
  app.inject({
    method: 'POST',
    url: '/reviews',
    payload: { cardId: 'c1', rating: 'GOOD', mode: 'FLIP', durationMs },
  })

describe('POST /reviews durationMs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores null when the client reports an untrustworthy duration', async () => {
    const { app, tx } = await setup()
    const res = await post(app, null)
    expect(res.statusCode).toBe(200)
    expect(tx.reviewLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ durationMs: null }),
    })
  })

  it('stores a duration at the limit as-is', async () => {
    const { app, tx } = await setup()
    const res = await post(app, MAX_REVIEW_DURATION_MS)
    expect(res.statusCode).toBe(200)
    expect(tx.reviewLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ durationMs: MAX_REVIEW_DURATION_MS }),
    })
  })

  it('rejects a duration over the limit', async () => {
    const { app, tx } = await setup()
    const res = await post(app, MAX_REVIEW_DURATION_MS + 1)
    expect(res.statusCode).toBe(400)
    expect(tx.reviewLog.create).not.toHaveBeenCalled()
  })

  it('rejects a negative duration and a string', async () => {
    const { app } = await setup()
    expect((await post(app, -1)).statusCode).toBe(400)
    expect((await post(app, '1000')).statusCode).toBe(400)
  })
})
