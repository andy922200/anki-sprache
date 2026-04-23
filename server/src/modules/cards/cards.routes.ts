import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'

const CEFR = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
const FsrsState = z.enum(['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'])
const PartOfSpeech = z.enum([
  'NOUN',
  'VERB',
  'ADJECTIVE',
  'ADVERB',
  'PRONOUN',
  'PREPOSITION',
  'CONJUNCTION',
  'ARTICLE',
  'INTERJECTION',
  'NUMERAL',
])
const Gender = z.enum(['DER', 'DIE', 'DAS'])

const exampleDto = z.object({
  id: z.string(),
  text: z.string(),
  translation: z.string(),
  audioUrl: z.string().nullable(),
  orderIndex: z.number(),
})

const cardDto = z.object({
  id: z.string(),
  languageCode: z.string(),
  lemma: z.string(),
  surfaceForm: z.string().nullable(),
  partOfSpeech: PartOfSpeech.nullable(),
  gender: Gender.nullable(),
  ipa: z.string().nullable(),
  translation: z.string(),
  cefrLevel: CEFR,
  examples: z.array(exampleDto),
  state: z
    .object({
      due: z.string(),
      state: FsrsState,
      reps: z.number(),
      lapses: z.number(),
    })
    .nullable(),
})

const DUE_CACHE_TTL = 60

export const cardsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  // Today's deck regardless of FSRS due date. Used by "practice again" mode
  // so the learner can drill the same 5 cards without waiting for FSRS to
  // schedule them.
  app.get(
    '/today',
    {
      schema: { response: { 200: z.array(cardDto) } },
    },
    async (req) => {
      const userId = req.user!.userId
      const userSettings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
        select: { cefrLevel: true, nativeLanguageCode: true, targetLanguageCode: true },
      })
      const native = userSettings.nativeLanguageCode

      const today = new Date().toISOString().slice(0, 10)
      const log = await app.prisma.dailyGenerationLog.findUnique({
        where: {
          userId_generationDate_languageCode: {
            userId,
            generationDate: new Date(`${today}T00:00:00.000Z`),
            languageCode: userSettings.targetLanguageCode,
          },
        },
      })
      if (!log) return []

      const states = await app.prisma.userCardState.findMany({
        where: { userId, cardId: { in: log.cardIds } },
        include: {
          card: {
            include: {
              translations: { where: { nativeLanguageCode: native } },
              examples: {
                where: { cefrLevel: userSettings.cefrLevel },
                orderBy: { orderIndex: 'asc' },
                include: { translations: { where: { nativeLanguageCode: native } } },
              },
            },
          },
        },
      })

      return states.map((s) => ({
        id: s.card.id,
        languageCode: s.card.languageCode,
        lemma: s.card.lemma,
        surfaceForm: s.card.surfaceForm,
        partOfSpeech: s.card.partOfSpeech,
        gender: s.card.gender,
        ipa: s.card.ipa,
        translation: s.card.translations[0]?.translation ?? '',
        cefrLevel: s.card.cefrLevel,
        examples: s.card.examples.map((e) => ({
          id: e.id,
          text: e.text,
          translation: e.translations[0]?.translation ?? '',
          audioUrl: e.audioUrl,
          orderIndex: e.orderIndex,
        })),
        state: {
          due: s.due.toISOString(),
          state: s.state,
          reps: s.reps,
          lapses: s.lapses,
        },
      }))
    },
  )

  app.get(
    '/due',
    {
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
        response: { 200: z.array(cardDto) },
      },
    },
    async (req, reply) => {
      const userId = req.user!.userId
      const userSettings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
        select: { cefrLevel: true, nativeLanguageCode: true },
      })
      const native = userSettings.nativeLanguageCode
      const cacheKey = `cards:due:${userId}:${userSettings.cefrLevel}:${native}:${req.query.limit}`
      const cached = await app.redis.get(cacheKey)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const now = new Date()
      const states = await app.prisma.userCardState.findMany({
        where: { userId, due: { lte: now } },
        orderBy: [{ due: 'asc' }],
        take: req.query.limit,
        include: {
          card: {
            include: {
              translations: { where: { nativeLanguageCode: native } },
              examples: {
                where: { cefrLevel: userSettings.cefrLevel },
                orderBy: { orderIndex: 'asc' },
                include: { translations: { where: { nativeLanguageCode: native } } },
              },
            },
          },
        },
      })

      // Fallback: if a card has no examples at the user's current CEFR level
      // (e.g. they changed level after learning it), load any examples.
      const cardsMissingExamples = states.filter((s) => s.card.examples.length === 0).map((s) => s.card.id)
      const fallbackExamples: Record<string, typeof states[number]['card']['examples']> = {}
      if (cardsMissingExamples.length) {
        const rows = await app.prisma.exampleSentence.findMany({
          where: { cardId: { in: cardsMissingExamples } },
          orderBy: { orderIndex: 'asc' },
          include: { translations: { where: { nativeLanguageCode: native } } },
        })
        for (const r of rows) {
          fallbackExamples[r.cardId] ??= []
          fallbackExamples[r.cardId]!.push(r)
        }
      }

      const result = states.map((s) => {
        const exs = s.card.examples.length > 0 ? s.card.examples : fallbackExamples[s.card.id] ?? []
        return {
          id: s.card.id,
          languageCode: s.card.languageCode,
          lemma: s.card.lemma,
          surfaceForm: s.card.surfaceForm,
          partOfSpeech: s.card.partOfSpeech,
          gender: s.card.gender,
          ipa: s.card.ipa,
          translation: s.card.translations[0]?.translation ?? '',
          cefrLevel: s.card.cefrLevel,
          examples: exs.map((e) => ({
            id: e.id,
            text: e.text,
            translation: e.translations[0]?.translation ?? '',
            audioUrl: e.audioUrl,
            orderIndex: e.orderIndex,
          })),
          state: {
            due: s.due.toISOString(),
            state: s.state,
            reps: s.reps,
            lapses: s.lapses,
          },
        }
      })

      await app.redis.setex(cacheKey, DUE_CACHE_TTL, JSON.stringify(result))
      reply.header('X-Cache', 'MISS')
      return result
    },
  )

  app.get(
    '/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: cardDto, 304: z.null() },
      },
    },
    async (req, reply) => {
      const userId = req.user!.userId
      const userSettings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
        select: { cefrLevel: true, nativeLanguageCode: true },
      })
      const native = userSettings.nativeLanguageCode

      const card = await app.prisma.vocabularyCard.findUnique({
        where: { id: req.params.id },
        include: {
          translations: { where: { nativeLanguageCode: native } },
          examples: {
            where: { cefrLevel: userSettings.cefrLevel },
            orderBy: { orderIndex: 'asc' },
            include: { translations: { where: { nativeLanguageCode: native } } },
          },
        },
      })
      if (!card) throw app.httpErrors.notFound('Card not found')

      let examples = card.examples
      if (examples.length === 0) {
        examples = await app.prisma.exampleSentence.findMany({
          where: { cardId: card.id },
          orderBy: { orderIndex: 'asc' },
          include: { translations: { where: { nativeLanguageCode: native } } },
        })
      }

      const state = await app.prisma.userCardState.findUnique({
        where: { userId_cardId: { userId, cardId: card.id } },
      })

      const etag = `"${card.updatedAt.getTime()}-${state?.updatedAt.getTime() ?? 0}-${userSettings.cefrLevel}-${native}"`
      if (req.headers['if-none-match'] === etag) {
        return reply.code(304).send(null)
      }
      reply.header('etag', etag)

      return {
        id: card.id,
        languageCode: card.languageCode,
        lemma: card.lemma,
        surfaceForm: card.surfaceForm,
        partOfSpeech: card.partOfSpeech,
        gender: card.gender,
        ipa: card.ipa,
        translation: card.translations[0]?.translation ?? '',
        cefrLevel: card.cefrLevel,
        examples: examples.map((e) => ({
          id: e.id,
          text: e.text,
          translation: e.translations[0]?.translation ?? '',
          audioUrl: e.audioUrl,
          orderIndex: e.orderIndex,
        })),
        state: state
          ? {
              due: state.due.toISOString(),
              state: state.state,
              reps: state.reps,
              lapses: state.lapses,
            }
          : null,
      }
    },
  )
}
