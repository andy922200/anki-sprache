import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { scheduleReview } from '@/shared/fsrs/scheduler.js'

const FsrsRating = z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY'])
const FsrsState = z.enum(['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'])
const ReviewMode = z.enum(['FLIP', 'MULTIPLE_CHOICE'])

const stateDto = z.object({
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  state: FsrsState,
  reps: z.number().int(),
  lapses: z.number().int(),
  lastReview: z.string(),
})

const reviewResponseDto = z.object({
  state: stateDto,
  nextDueInMinutes: z.number().int(),
})

const logEntryDto = z.object({
  id: z.string(),
  cardId: z.string(),
  lemma: z.string(),
  translation: z.string(),
  rating: FsrsRating,
  mode: ReviewMode,
  durationMs: z.number().int(),
  reviewedAt: z.string(),
  stateBefore: FsrsState,
  stateAfter: FsrsState,
})

export const reviewsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  app.post(
    '/',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          cardId: z.string(),
          rating: FsrsRating,
          mode: ReviewMode,
          durationMs: z.number().int().min(0).max(10 * 60_000),
        }),
        response: { 200: reviewResponseDto },
      },
    },
    async (req) => {
      const userId = req.user!.userId
      const { cardId, rating, mode, durationMs } = req.body

      const card = await app.prisma.vocabularyCard.findUnique({ where: { id: cardId } })
      if (!card) throw app.httpErrors.notFound('Card not found')

      const current = await app.prisma.userCardState.findUnique({
        where: { userId_cardId: { userId, cardId } },
      })

      const { nextState, snapshot } = scheduleReview(current, rating)

      const saved = await app.prisma.$transaction(async (tx) => {
        const state = current
          ? await tx.userCardState.update({
              where: { id: current.id },
              data: { ...nextState },
            })
          : await tx.userCardState.create({
              data: {
                userId,
                cardId,
                ...nextState,
              },
            })
        await tx.reviewLog.create({
          data: {
            userId,
            cardId,
            userCardStateId: state.id,
            rating,
            mode,
            durationMs,
            stabilityBefore: snapshot.stabilityBefore,
            stabilityAfter: snapshot.stabilityAfter,
            difficultyBefore: snapshot.difficultyBefore,
            difficultyAfter: snapshot.difficultyAfter,
            stateBefore: snapshot.stateBefore,
            stateAfter: snapshot.stateAfter,
          },
        })
        return state
      })

      // invalidate due-card cache
      const pattern = `cards:due:${userId}:*`
      const keys = await app.redis.keys(pattern)
      if (keys.length) await app.redis.del(...keys)

      const nextDueInMinutes = Math.max(
        0,
        Math.round((saved.due.getTime() - Date.now()) / 60_000),
      )

      return {
        state: {
          due: saved.due.toISOString(),
          stability: saved.stability,
          difficulty: saved.difficulty,
          state: saved.state,
          reps: saved.reps,
          lapses: saved.lapses,
          lastReview: (saved.lastReview ?? new Date()).toISOString(),
        },
        nextDueInMinutes,
      }
    },
  )

  app.get(
    '/logbook',
    {
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
          rating: FsrsRating.optional(),
          mode: ReviewMode.optional(),
        }),
        response: {
          200: z.object({
            entries: z.array(logEntryDto),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.user!.userId
      const { limit, cursor, rating, mode } = req.query

      const userSettings = await app.prisma.userSettings.findUniqueOrThrow({
        where: { userId },
        select: { nativeLanguageCode: true },
      })
      const logs = await app.prisma.reviewLog.findMany({
        where: {
          userId,
          ...(rating ? { rating } : {}),
          ...(mode ? { mode } : {}),
        },
        orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          card: {
            include: {
              translations: { where: { nativeLanguageCode: userSettings.nativeLanguageCode } },
            },
          },
        },
      })

      const hasMore = logs.length > limit
      const entries = logs.slice(0, limit).map((l) => ({
        id: l.id,
        cardId: l.cardId,
        lemma: l.card.lemma,
        translation: l.card.translations[0]?.translation ?? '',
        rating: l.rating,
        mode: l.mode,
        durationMs: l.durationMs,
        reviewedAt: l.reviewedAt.toISOString(),
        stateBefore: l.stateBefore,
        stateAfter: l.stateAfter,
      }))

      return { entries, nextCursor: hasMore ? entries[entries.length - 1]!.id : null }
    },
  )
}
