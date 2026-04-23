import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { encryptSecret } from '@/shared/crypto/aesGcm.js'

const LlmProvider = z.enum(['OPENAI', 'ANTHROPIC', 'GOOGLE'])

const maskedKeyDto = z.object({
  provider: LlmProvider,
  keyFingerprint: z.string(),
  updatedAt: z.string(),
})

export const llmKeysRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate)

  app.get(
    '/',
    { schema: { response: { 200: z.array(maskedKeyDto) } } },
    async (req) => {
      const rows = await app.prisma.llmApiKey.findMany({
        where: { userId: req.user!.userId },
        orderBy: { provider: 'asc' },
      })
      return rows.map((r) => ({
        provider: r.provider,
        keyFingerprint: r.keyFingerprint,
        updatedAt: r.updatedAt.toISOString(),
      }))
    },
  )

  app.put(
    '/:provider',
    {
      schema: {
        params: z.object({ provider: LlmProvider }),
        body: z.object({ apiKey: z.string().min(10).max(500) }),
        response: { 200: maskedKeyDto },
      },
    },
    async (req) => {
      const blob = encryptSecret(req.body.apiKey)
      const saved = await app.prisma.llmApiKey.upsert({
        where: { userId_provider: { userId: req.user!.userId, provider: req.params.provider } },
        update: {
          encryptedKey: blob.encryptedKey,
          iv: blob.iv,
          authTag: blob.authTag,
          keyFingerprint: blob.keyFingerprint,
        },
        create: {
          userId: req.user!.userId,
          provider: req.params.provider,
          encryptedKey: blob.encryptedKey,
          iv: blob.iv,
          authTag: blob.authTag,
          keyFingerprint: blob.keyFingerprint,
        },
      })
      return {
        provider: saved.provider,
        keyFingerprint: saved.keyFingerprint,
        updatedAt: saved.updatedAt.toISOString(),
      }
    },
  )

  app.delete(
    '/:provider',
    {
      schema: {
        params: z.object({ provider: LlmProvider }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await app.prisma.llmApiKey
        .delete({
          where: {
            userId_provider: { userId: req.user!.userId, provider: req.params.provider },
          },
        })
        .catch(() => {
          /* idempotent */
        })
      return { ok: true }
    },
  )
}
