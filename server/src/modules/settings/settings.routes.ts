import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { UserSettings } from '@/generated/prisma/client.js'
import { z } from 'zod'

const CEFR = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
const Theme = z.enum(['LIGHT', 'DARK', 'SYSTEM'])
const UiLanguage = z.enum(['EN', 'ZH_TW'])
const LlmProvider = z.enum(['OPENAI', 'ANTHROPIC', 'GOOGLE'])

const settingsDto = z.object({
  targetLanguageCode: z.string(),
  nativeLanguageCode: z.string(),
  cefrLevel: CEFR,
  dailyNewCount: z.number().int().min(1).max(30),
  preferredLlmProvider: LlmProvider.nullable(),
  preferredLlmModel: z.string().nullable(),
  theme: Theme,
  uiLanguage: UiLanguage,
})

const patchSettingsSchema = z.object({
  targetLanguageCode: z.string().length(2).optional(),
  nativeLanguageCode: z.string().length(2).optional(),
  cefrLevel: CEFR.optional(),
  dailyNewCount: z.number().int().min(1).max(30).optional(),
  preferredLlmProvider: LlmProvider.nullable().optional(),
  preferredLlmModel: z.string().max(100).nullable().optional(),
  theme: Theme.optional(),
  uiLanguage: UiLanguage.optional(),
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
      if (req.body.targetLanguageCode) {
        const lang = await app.prisma.language.findUnique({
          where: { code: req.body.targetLanguageCode },
        })
        if (!lang || !lang.enabled) throw app.httpErrors.badRequest('Language not available')
      }
      // Normalize empty strings to null so adapter defaults apply.
      const data = { ...req.body }
      if (typeof data.preferredLlmModel === 'string' && data.preferredLlmModel.trim() === '') {
        data.preferredLlmModel = null
      }
      const s = await app.prisma.userSettings.update({
        where: { userId: req.user!.userId },
        data,
      })
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
    preferredLlmProvider: s.preferredLlmProvider,
    preferredLlmModel: s.preferredLlmModel,
    theme: s.theme,
    uiLanguage: s.uiLanguage,
  }
}
