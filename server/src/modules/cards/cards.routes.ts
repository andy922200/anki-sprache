import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { RATE_LIMITS } from '@/config/rate-limit.config.js'
import type { CEFR as CefrLevel, Prisma } from '@/generated/prisma/client.js'
import { ensureCardExamples } from './cards.service.js'
import {
  cefrSchema,
  fsrsStateSchema,
  genderSchema,
  partOfSpeechSchema,
} from '@/shared/schemas/enums.js'

const exampleDto = z.object({
  id: z.string(),
  text: z.string(),
  translation: z.string(),
  audioUrl: z.url().nullable(),
  orderIndex: z.number(),
})

const cardDto = z.object({
  id: z.string(),
  languageCode: z.string(),
  lemma: z.string(),
  surfaceForm: z.string().nullable(),
  partOfSpeech: partOfSpeechSchema.nullable(),
  gender: genderSchema.nullable(),
  ipa: z.string().nullable(),
  translation: z.string(),
  cefrLevel: cefrSchema,
  audioUrl: z.url().nullable(),
  examples: z.array(exampleDto),
  state: z
    .object({
      due: z.string(),
      state: fsrsStateSchema,
      reps: z.number(),
      lapses: z.number(),
    })
    .nullable(),
})


const DUE_CACHE_TTL = 60

const cardInclude = (native: string, cefrLevel: CefrLevel) =>
  ({
    translations: { where: { nativeLanguageCode: native } },
    examples: {
      where: { cefrLevel },
      orderBy: { orderIndex: 'asc' },
      include: { translations: { where: { nativeLanguageCode: native } } },
    },
  }) satisfies Prisma.VocabularyCardInclude

type CardWithRelations = Prisma.VocabularyCardGetPayload<{
  include: ReturnType<typeof cardInclude>
}>

interface CardStateRow {
  due: Date
  state: z.infer<typeof fsrsStateSchema>
  reps: number
  lapses: number
}

function toCardDto(card: CardWithRelations, state: CardStateRow | null): z.infer<typeof cardDto> {
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
    audioUrl: card.audioUrl,
    examples: card.examples.map((e) => ({
      id: e.id,
      text: e.text,
      translation: e.translations[0]?.translation ?? '',
      audioUrl: e.audioUrl,
      orderIndex: e.orderIndex,
    })),
    state: state
      ? { due: state.due.toISOString(), state: state.state, reps: state.reps, lapses: state.lapses }
      : null,
  }
}

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
        include: { card: { include: cardInclude(native, userSettings.cefrLevel) } },
      })

      return states.map((s) => toCardDto(s.card, s))
    },
  )

  app.get(
    '/due',
    {
      schema: {
        response: { 200: z.array(cardDto) },
      },
    },
    async (req, reply) => {
      const userId = req.user!.userId
      const userSettings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
        select: {
          cefrLevel: true,
          nativeLanguageCode: true,
          targetLanguageCode: true,
          maxDueCards: true,
        },
      })
      const native = userSettings.nativeLanguageCode
      const target = userSettings.targetLanguageCode
      const cacheKey = `cards:due:${userId}:${target}:${userSettings.cefrLevel}:${native}:${userSettings.maxDueCards}`
      const cached = await app.redis.get(cacheKey)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const now = new Date()
      const states = await app.prisma.userCardState.findMany({
        where: { userId, due: { lte: now }, card: { is: { languageCode: target } } },
        orderBy: [{ due: 'asc' }],
        take: userSettings.maxDueCards,
        include: { card: { include: cardInclude(native, userSettings.cefrLevel) } },
      })

      const result = states.map((s) => toCardDto(s.card, s))

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
        include: cardInclude(native, userSettings.cefrLevel),
      })
      if (!card) throw app.httpErrors.notFound('Card not found')

      const state = await app.prisma.userCardState.findUnique({
        where: { userId_cardId: { userId, cardId: card.id } },
      })

      const etag = `"${card.updatedAt.getTime()}-${state?.updatedAt.getTime() ?? 0}-${userSettings.cefrLevel}-${native}"`
      if (req.headers['if-none-match'] === etag) {
        return reply.code(304).send(null)
      }
      reply.header('etag', etag)

      return toCardDto(card, state)
    },
  )

  app.post(
    '/:id/examples/ensure',
    {
      config: { rateLimit: RATE_LIMITS.examplesEnsure },
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: cardDto },
      },
    },
    async (req) => {
      const userId = req.user!.userId
      const settings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
        select: { cefrLevel: true, nativeLanguageCode: true, targetLanguageCode: true },
      })
      const card = await app.prisma.vocabularyCard.findUnique({
        where: { id: req.params.id },
        select: { languageCode: true },
      })
      if (!card) throw app.httpErrors.notFound('Card not found')
      if (card.languageCode !== settings.targetLanguageCode) {
        throw app.httpErrors.badRequest('Card is not in your target language')
      }

      await ensureCardExamples(app.prisma, app.redis, userId, req.params.id)

      const fresh = await app.prisma.vocabularyCard.findUniqueOrThrow({
        where: { id: req.params.id },
        include: cardInclude(settings.nativeLanguageCode, settings.cefrLevel),
      })
      const state = await app.prisma.userCardState.findUnique({
        where: { userId_cardId: { userId, cardId: fresh.id } },
      })
      return toCardDto(fresh, state)
    },
  )
}
