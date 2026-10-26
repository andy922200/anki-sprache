import sensible from '@fastify/sensible'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config/env.config.js', () => ({ isDev: true, env: {} }))
vi.mock('@/shared/plugins/bullmq.plugin.js', () => ({ QUEUE_NAMES: {} }))

const { generationRoutes } = await import('./generation.routes.js')

const EXISTING_LOG = { id: 'log1', cardIds: ['c1', 'c2'], provider: 'GOOGLE' }

async function setup(opts: { provider: string | null; hasKey: boolean }) {
  const prisma = {
    userSettings: {
      findUnique: vi.fn(async () => ({
        preferredLlmProvider: opts.provider,
        preferredLlmModel: null,
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        targetLanguageCode: 'pt',
        preferredLlmProvider: opts.provider,
      })),
    },
    dailyGenerationLog: {
      findUnique: vi.fn(async () => EXISTING_LOG),
      delete: vi.fn(async () => EXISTING_LOG),
    },
    llmApiKey: { findUnique: vi.fn(async () => (opts.hasKey ? { id: 'k1' } : null)) },
    userCardState: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const redis = {
    keys: vi.fn(async () => []),
    get: vi.fn(async (_key: string): Promise<string | null> => null),
    del: vi.fn(),
    incr: vi.fn(async () => 1),
    expire: vi.fn(),
  }
  const queues = { userGeneration: { add: vi.fn(async () => ({ id: 'job1' })) } }

  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  app.decorate('prisma', prisma as never)
  app.decorate('redis', redis as never)
  app.decorate('queues', queues as never)
  app.decorate('authenticate', async (req) => {
    Object.assign(req, { user: { userId: 'u1' } })
  })
  await app.register(generationRoutes, { prefix: '/generate' })
  await app.ready()
  return { app, prisma, redis, queues }
}

describe('POST /generate/today?force=true', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps today’s cards when no provider is set', async () => {
    const { app, prisma, queues } = await setup({ provider: null, hasKey: false })
    const res = await app.inject({ method: 'POST', url: '/generate/today?force=true' })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('LLM_PROVIDER_NOT_SET')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.userCardState.deleteMany).not.toHaveBeenCalled()
    expect(prisma.dailyGenerationLog.delete).not.toHaveBeenCalled()
    expect(queues.userGeneration.add).not.toHaveBeenCalled()
  })

  it('keeps today’s cards when the provider has no key', async () => {
    const { app, prisma, queues } = await setup({ provider: 'GOOGLE', hasKey: false })
    const res = await app.inject({ method: 'POST', url: '/generate/today?force=true' })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('LLM_API_KEY_MISSING:GOOGLE')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.userCardState.deleteMany).not.toHaveBeenCalled()
    expect(prisma.dailyGenerationLog.delete).not.toHaveBeenCalled()
    expect(queues.userGeneration.add).not.toHaveBeenCalled()
  })

  it('drops only unreviewed (NEW) states and the log, then enqueues, once preflight passes', async () => {
    const { app, prisma, queues } = await setup({ provider: 'GOOGLE', hasKey: true })
    const res = await app.inject({ method: 'POST', url: '/generate/today?force=true' })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: 'job1', status: 'queued' })
    expect(prisma.userCardState.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', cardId: { in: ['c1', 'c2'] }, state: 'NEW' },
    })
    expect(prisma.dailyGenerationLog.delete).toHaveBeenCalledWith({ where: { id: 'log1' } })
    expect(queues.userGeneration.add).toHaveBeenCalledWith(
      'generateForUser',
      expect.objectContaining({ userId: 'u1', excludeCardIds: ['c1', 'c2'] }),
    )
  })
})

describe('POST /generate/today without force', () => {
  it('returns already-done and deletes nothing', async () => {
    const { app, prisma, queues } = await setup({ provider: 'GOOGLE', hasKey: true })
    const res = await app.inject({ method: 'POST', url: '/generate/today' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'already-done', cardIds: ['c1', 'c2'] })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(queues.userGeneration.add).not.toHaveBeenCalled()
  })
})

describe('POST /generate/more with fillShortfall', () => {
  beforeEach(() => vi.clearAllMocks())

  const post = (app: Awaited<ReturnType<typeof setup>>['app']) =>
    app.inject({
      method: 'POST',
      url: '/generate/more',
      payload: { count: 2, fillShortfall: true },
    })

  it('queues the top-up and counts it against the day', async () => {
    const { app, redis, queues } = await setup({ provider: 'GOOGLE', hasKey: true })
    const res = await post(app)

    expect(res.statusCode).toBe(202)
    expect(redis.incr).toHaveBeenCalledTimes(1)
    expect(queues.userGeneration.add).toHaveBeenCalledTimes(1)
  })

  it('refuses once the daily top-ups are used up', async () => {
    const { app, redis, queues } = await setup({ provider: 'GOOGLE', hasKey: true })
    redis.get.mockImplementation(async (key: string) =>
      key.startsWith('gen:top-ups:') ? '3' : null,
    )
    const res = await post(app)

    expect(res.statusCode).toBe(409)
    expect(queues.userGeneration.add).not.toHaveBeenCalled()
  })
})
