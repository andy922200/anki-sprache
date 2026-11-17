import sensible from '@fastify/sensible'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config/env.config.js', () => ({ isDev: true, env: {} }))
vi.mock('./cards.service.js', () => ({ ensureCardExamples: vi.fn() }))

const { cardsRoutes } = await import('./cards.routes.js')

// 2026-11-18 04:00 in Taipei (+8), but still 2026-11-17 in UTC.
const NOW = new Date('2026-11-17T20:00:00Z')

const makeState = (cardId: string, languageCode = 'de') => ({
  cardId,
  due: new Date('2026-11-18T00:00:00Z'),
  state: 'REVIEW',
  reps: 3,
  lapses: 0,
  card: {
    id: cardId,
    languageCode,
    lemma: `lemma-${cardId}`,
    surfaceForm: null,
    partOfSpeech: 'NOUN',
    gender: null,
    ipa: null,
    cefrLevel: 'A1',
    audioUrl: null,
    translations: [{ translation: `t-${cardId}` }],
    examples: [],
  },
})

interface SetupOpts {
  logCardIds?: string[] | null
  reviewedCardIds?: string[]
  timezone?: string
}

async function setup(opts: SetupOpts = {}) {
  const prisma = {
    userSettings: {
      findUniqueOrThrow: vi.fn(async () => ({
        cefrLevel: 'A1',
        nativeLanguageCode: 'en',
        targetLanguageCode: 'de',
      })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timezone: opts.timezone ?? 'UTC' })),
    },
    dailyGenerationLog: {
      findUnique: vi.fn(async () =>
        opts.logCardIds == null ? null : { cardIds: opts.logCardIds },
      ),
    },
    reviewLog: {
      findMany: vi.fn(async (_args: unknown) =>
        (opts.reviewedCardIds ?? []).map((cardId) => ({ cardId })),
      ),
    },
    userCardState: {
      // Deliberately unordered: the route must sort by its own card order.
      findMany: vi.fn(async (args: { where: { cardId: { in: string[] } } }) =>
        [...args.where.cardId.in].reverse().map((id) => makeState(id)),
      ),
    },
  }

  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  app.decorate('prisma', prisma as never)
  app.decorate('redis', {} as never)
  app.decorate('authenticate', async (req) => {
    Object.assign(req, { user: { userId: 'u1' } })
  })
  await app.register(cardsRoutes, { prefix: '/cards' })
  await app.ready()
  return { app, prisma }
}

const getToday = (app: Awaited<ReturnType<typeof setup>>['app']) =>
  app.inject({ method: 'GET', url: '/cards/today' })

describe('GET /cards/today', () => {
  beforeEach(() => {
    // Date only: Fastify's inject relies on real timers.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns today's deck followed by cards reviewed today, without duplicates", async () => {
    const { app } = await setup({ logCardIds: ['a', 'b'], reviewedCardIds: ['b', 'c', 'd'] })

    const res = await getToday(app)

    expect(res.statusCode).toBe(200)
    expect(res.json().map((c: { id: string }) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('still returns reviewed cards when no deck was generated today', async () => {
    const { app } = await setup({ logCardIds: null, reviewedCardIds: ['x'] })

    const res = await getToday(app)

    expect(res.json().map((c: { id: string }) => c.id)).toEqual(['x'])
  })

  it('returns an empty list, without a state query, when nothing was touched today', async () => {
    const { app, prisma } = await setup({ logCardIds: null, reviewedCardIds: [] })

    const res = await getToday(app)

    expect(res.json()).toEqual([])
    expect(prisma.userCardState.findMany).not.toHaveBeenCalled()
  })

  it("looks up the deck by UTC date but reviews by the user's local day", async () => {
    const { app, prisma } = await setup({
      logCardIds: ['a'],
      reviewedCardIds: [],
      timezone: 'Asia/Taipei',
    })

    await getToday(app)

    expect(prisma.dailyGenerationLog.findUnique).toHaveBeenCalledWith({
      where: {
        userId_generationDate_languageCode: {
          userId: 'u1',
          generationDate: new Date('2026-11-17T00:00:00.000Z'),
          languageCode: 'de',
        },
      },
    })
    const reviewQuery = prisma.reviewLog.findMany.mock.calls[0]?.[0] as {
      where: { userId: string; reviewedAt: { gte: Date; lt: Date } }
      distinct: string[]
    }
    expect(reviewQuery.where.userId).toBe('u1')
    expect(reviewQuery.where.reviewedAt).toEqual({
      gte: new Date('2026-11-17T16:00:00.000Z'),
      lt: new Date('2026-11-18T16:00:00.000Z'),
    })
    expect(reviewQuery.distinct).toEqual(['cardId'])
  })

  it('only loads cards of the learner’s current target language', async () => {
    const { app, prisma } = await setup({ logCardIds: ['a'], reviewedCardIds: ['b'] })

    await getToday(app)

    expect(prisma.userCardState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', cardId: { in: ['a', 'b'] }, card: { is: { languageCode: 'de' } } },
      }),
    )
  })
})
