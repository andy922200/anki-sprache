import type { Redis } from 'ioredis'
import { EXAMPLES_PER_LEVEL_TARGET } from '@/config/limits.config.js'
import type { CEFR, PrismaClient } from '@/generated/prisma/client.js'
import { pruneExamples } from '@/shared/audio/pruneExamples.js'
import { LlmRequestError, toLlmRequestError } from '@/shared/llm/errors.js'
import { extractJson } from '@/shared/llm/json.js'
import { getAdapterForUser } from '@/shared/llm/llmClient.js'
import {
  buildCardAdjustmentPrompt,
  type CardAdjustmentResponse,
  cardAdjustmentResponseSchema,
} from '@/shared/llm/prompts/cardExamples.js'

const LOCK_TTL_SECONDS = 60
const LOCK_WAIT_TIMEOUT_MS = 20_000
const LOCK_POLL_INTERVAL_MS = 500

interface CardGaps {
  needCardTranslation: boolean
  needNewExamples: boolean
  existingNeedTranslation: { id: string; text: string }[]
  lemma: string
  partOfSpeech: string | null
  meaningAnchor: string | null
  referenceSentence: string | null
}

async function loadGaps(
  prisma: PrismaClient,
  cardId: string,
  cefrLevel: CEFR,
  native: string,
): Promise<CardGaps> {
  const card = await prisma.vocabularyCard.findUniqueOrThrow({
    where: { id: cardId },
    select: {
      lemma: true,
      partOfSpeech: true,
      translations: { select: { translation: true, nativeLanguageCode: true } },
      examples: {
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          text: true,
          cefrLevel: true,
          translations: { where: { nativeLanguageCode: native }, select: { id: true } },
        },
      },
    },
  })
  const atLevel = card.examples.filter((e) => e.cefrLevel === cefrLevel)
  const nativeTranslation = card.translations.find((t) => t.nativeLanguageCode === native)
  return {
    needCardTranslation: !nativeTranslation,
    needNewExamples: atLevel.length === 0,
    existingNeedTranslation: atLevel.filter((e) => e.translations.length === 0),
    lemma: card.lemma,
    partOfSpeech: card.partOfSpeech,
    // Any other language's translation still anchors the word's meaning for the LLM.
    meaningAnchor: nativeTranslation?.translation ?? card.translations[0]?.translation ?? null,
    referenceSentence: card.examples[0]?.text ?? null,
  }
}

const isComplete = (g: CardGaps) =>
  !g.needCardTranslation && !g.needNewExamples && g.existingNeedTranslation.length === 0

/**
 * Fills whatever the requester's (CEFR level, native language) view of a card is
 * missing, using the requester's own LLM key. Examples are shared by all users, so
 * a given (card, level) is generated at most once.
 */
export async function ensureCardExamples(
  prisma: PrismaClient,
  redis: Redis,
  userId: string,
  cardId: string,
): Promise<void> {
  const settings = await prisma.userSettings.findUniqueOrThrow({
    where: { userId },
    include: { targetLanguage: true, nativeLanguage: true },
  })
  const { cefrLevel, nativeLanguageCode: native } = settings

  if (isComplete(await loadGaps(prisma, cardId, cefrLevel, native))) return

  if (!settings.preferredLlmProvider) throw new LlmRequestError(400, 'LLM_PROVIDER_NOT_SET')
  const key = await prisma.llmApiKey.findUnique({
    where: { userId_provider: { userId, provider: settings.preferredLlmProvider } },
    select: { id: true },
  })
  if (!key) {
    throw new LlmRequestError(400, `LLM_API_KEY_MISSING:${settings.preferredLlmProvider}`)
  }

  const lockKey = `lock:ensure-examples:${cardId}:${cefrLevel}:${native}`
  const acquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  if (!acquired) {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS))
      if (isComplete(await loadGaps(prisma, cardId, cefrLevel, native))) return
    }
    throw new LlmRequestError(409, 'EXAMPLES_GENERATION_IN_PROGRESS')
  }

  try {
    // Another request may have finished between our first read and the lock grant.
    const gaps = await loadGaps(prisma, cardId, cefrLevel, native)
    if (isComplete(gaps)) return

    const adapter = await getAdapterForUser(
      prisma,
      userId,
      settings.preferredLlmProvider,
      settings.preferredLlmModel,
    )
    const prompt = buildCardAdjustmentPrompt({
      targetLanguageName: settings.targetLanguage.name,
      nativeLanguageName: settings.nativeLanguage.name,
      cefr: cefrLevel,
      lemma: gaps.lemma,
      partOfSpeech: gaps.partOfSpeech,
      meaningAnchor: gaps.meaningAnchor,
      needCardTranslation: gaps.needCardTranslation,
      needNewExamples: gaps.needNewExamples
        ? { count: EXAMPLES_PER_LEVEL_TARGET, referenceSentence: gaps.referenceSentence }
        : null,
      existingExamplesNeedingTranslation: gaps.existingNeedTranslation.map((e) => e.text),
    })

    const startedAt = Date.now()
    const logUsage = (data: {
      promptTokens?: number
      completionTokens?: number
      errorCode?: string
    }) =>
      prisma.llmUsageLog.create({
        data: {
          userId,
          provider: adapter.provider,
          model: adapter.model,
          purpose: 'EXAMPLE_REGEN',
          latencyMs: Date.now() - startedAt,
          success: !data.errorCode,
          ...data,
        },
      })

    let res: Awaited<ReturnType<typeof adapter.complete>>
    try {
      res = await adapter.complete({ ...prompt, attempts: 1 })
    } catch (err) {
      const llmErr = toLlmRequestError(err)
      await logUsage({ errorCode: llmErr.message })
      throw llmErr
    }

    let data: CardAdjustmentResponse
    try {
      const parsed = cardAdjustmentResponseSchema.safeParse(extractJson(res.content))
      if (!parsed.success) throw new Error('invalid shape')
      data = parsed.data
    } catch {
      await logUsage({ errorCode: 'LLM_INVALID_RESPONSE' })
      throw new LlmRequestError(424, 'LLM_INVALID_RESPONSE')
    }

    const byText = new Map(gaps.existingNeedTranslation.map((e) => [e.text, e.id]))
    const cardTx = gaps.needCardTranslation ? data.cardTranslation : undefined
    const newExamples = gaps.needNewExamples
      ? (data.newExamples ?? []).slice(0, EXAMPLES_PER_LEVEL_TARGET)
      : []
    const existingTranslations = (data.existingExampleTranslations ?? []).filter((row) =>
      byText.has(row.text),
    )

    const missedRequiredField =
      (gaps.needNewExamples && newExamples.length === 0) ||
      (gaps.needCardTranslation && !cardTx) ||
      (gaps.existingNeedTranslation.length > 0 && existingTranslations.length === 0)
    if (missedRequiredField) {
      await logUsage({ errorCode: 'LLM_INVALID_RESPONSE' })
      throw new LlmRequestError(424, 'LLM_INVALID_RESPONSE')
    }

    await prisma.$transaction(async (tx) => {
      if (cardTx) {
        await tx.cardTranslation.upsert({
          where: { cardId_nativeLanguageCode: { cardId, nativeLanguageCode: native } },
          create: { cardId, nativeLanguageCode: native, translation: cardTx },
          update: { translation: cardTx },
        })
      }
      for (const [idx, sentence] of newExamples.entries()) {
        await tx.exampleSentence.create({
          data: {
            cardId,
            text: sentence.text,
            orderIndex: idx,
            cefrLevel,
            translations: {
              create: [{ nativeLanguageCode: native, translation: sentence.translation }],
            },
          },
        })
      }
      for (const row of existingTranslations) {
        const exampleId = byText.get(row.text)!
        await tx.exampleSentenceTranslation.upsert({
          where: { exampleId_nativeLanguageCode: { exampleId, nativeLanguageCode: native } },
          create: { exampleId, nativeLanguageCode: native, translation: row.translation },
          update: { translation: row.translation },
        })
      }
    })
    if (newExamples.length > 0) await pruneExamples(prisma, cardId, cefrLevel)

    await logUsage({ promptTokens: res.promptTokens, completionTokens: res.completionTokens })

    const cacheKeys = await redis.keys(`cards:due:${userId}:*`)
    if (cacheKeys.length) await redis.del(...cacheKeys)
  } finally {
    await redis.del(lockKey)
  }
}
