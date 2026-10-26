import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { MAX_DAILY_NEW_COUNT, MAX_DUE_CARDS } from '@/config/limits.config.js'
import type { UserSettings } from '@/generated/prisma/client.js'
import { cefrSchema, llmProviderSchema, themeSchema, uiLanguageSchema } from '@/shared/schemas/enums.js'


const settingsDto = z.object({
  targetLanguageCode: z.string(),
  nativeLanguageCode: z.string(),
  cefrLevel: cefrSchema,
  dailyNewCount: z.number().int().min(1).max(MAX_DAILY_NEW_COUNT),
  maxDueCards: z.number().int().min(1).max(MAX_DUE_CARDS),
  preferredLlmProvider: llmProviderSchema.nullable(),
  preferredLlmModel: z.string().nullable(),
  theme: themeSchema,
  uiLanguage: uiLanguageSchema,
})

const patchSettingsSchema = z.object({
  targetLanguageCode: z.string().length(2).optional(),
  nativeLanguageCode: z.string().length(2).optional(),
  cefrLevel: cefrSchema.optional(),
  dailyNewCount: z.number().int().min(1).max(MAX_DAILY_NEW_COUNT).optional(),
  maxDueCards: z.number().int().min(1).max(MAX_DUE_CARDS).optional(),
  preferredLlmProvider: llmProviderSchema.nullable().optional(),
  preferredLlmModel: z.string().max(100).nullable().optional(),
  theme: themeSchema.optional(),
  uiLanguage: uiLanguageSchema.optional(),
})

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  app.get('/', { schema: { response: { 200: settingsDto } } }, async (req) => {
    const s = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId: req.user!.userId },
    })
    return toDto(s)
  })

  app.patch(
    '/',
    { schema: { body: patchSettingsSchema, response: { 200: settingsDto } } },
    async (req) => {
      const userId = req.user!.userId
      if (req.body.targetLanguageCode) {
        const lang = await app.prisma.language.findUnique({
          where: { code: req.body.targetLanguageCode },
        })
        if (!lang || !lang.enabled) throw app.httpErrors.badRequest('Language not available')
      }
      const prev = await app.prisma.userSettings.findUniqueOrThrow({ where: { userId } })
      // Normalize empty strings to null so adapter defaults apply.
      const data = { ...req.body }
      if (typeof data.preferredLlmModel === 'string' && data.preferredLlmModel.trim() === '') {
        data.preferredLlmModel = null
      }
      const s = await app.prisma.userSettings.update({
        where: { userId },
        data,
      })
      // Invalidate per-user card caches when the language pair or due cap changes — both
      // `/cards/due` keys and any other cards:* entries we've scoped by user.
      const dueCacheStale =
        (req.body.targetLanguageCode && req.body.targetLanguageCode !== prev.targetLanguageCode) ||
        (req.body.nativeLanguageCode && req.body.nativeLanguageCode !== prev.nativeLanguageCode) ||
        (req.body.maxDueCards !== undefined && req.body.maxDueCards !== prev.maxDueCards)
      if (dueCacheStale) {
        const keys = await app.redis.keys(`cards:due:${userId}:*`)
        if (keys.length) await app.redis.del(...keys)
      }
      return toDto(s)
    },
  )
}

function toDto(s: UserSettings) {
  return {
    targetLanguageCode: s.targetLanguageCode,
    nativeLanguageCode: s.nativeLanguageCode,
    cefrLevel: s.cefrLevel,
    dailyNewCount: s.dailyNewCount,
    maxDueCards: s.maxDueCards,
    preferredLlmProvider: s.preferredLlmProvider,
    preferredLlmModel: s.preferredLlmModel,
    theme: s.theme,
    uiLanguage: s.uiLanguage,
  }
}
