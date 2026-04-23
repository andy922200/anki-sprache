import type { LlmProvider, PrismaClient, VocabularyCard } from '@/generated/prisma/client.js'
import type { Redis } from 'ioredis'
import { buildDailyWordsPrompt, wordResponseSchema, type WordItem } from '@/shared/llm/prompts/dailyWords.js'
import { getAdapterForUser } from '@/shared/llm/llmClient.js'

export interface GenerateForUserInput {
  userId: string
  generationDate: Date // midnight in user's timezone
}

export interface GenerateResult {
  cardIds: string[]
  createdNew: number
  reusedExisting: number
  provider: LlmProvider | null
}

const LOCK_TTL_SECONDS = 60

export async function generateForUser(
  prisma: PrismaClient,
  redis: Redis,
  input: GenerateForUserInput,
): Promise<GenerateResult> {
  const { userId } = input
  const dateOnly = toDateOnly(input.generationDate)

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    include: { targetLanguage: true, nativeLanguage: true },
  })
  if (!settings) throw new Error('User settings not found')
  if (!settings.targetLanguage.enabled) throw new Error('Target language disabled')

  // Idempotency: DB unique constraint + short Redis lock
  const lockKey = `lock:daily:${userId}:${dateOnly}:${settings.targetLanguageCode}`
  const acquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  if (!acquired) {
    // Another worker has it — wait for them and return their result
    const existing = await prisma.dailyGenerationLog.findUnique({
      where: {
        userId_generationDate_languageCode: {
          userId,
          generationDate: dateOnlyDate(dateOnly),
          languageCode: settings.targetLanguageCode,
        },
      },
    })
    if (existing) {
      return {
        cardIds: existing.cardIds,
        createdNew: 0,
        reusedExisting: existing.cardIds.length,
        provider: existing.provider,
      }
    }
    throw new Error('Daily generation in progress; try again shortly')
  }

  try {
    const alreadyDone = await prisma.dailyGenerationLog.findUnique({
      where: {
        userId_generationDate_languageCode: {
          userId,
          generationDate: dateOnlyDate(dateOnly),
          languageCode: settings.targetLanguageCode,
        },
      },
    })
    if (alreadyDone) {
      return {
        cardIds: alreadyDone.cardIds,
        createdNew: 0,
        reusedExisting: alreadyDone.cardIds.length,
        provider: alreadyDone.provider,
      }
    }

    const existingStateIds = new Set(
      (
        await prisma.userCardState.findMany({
          where: { userId },
          select: { cardId: true },
        })
      ).map((r) => r.cardId),
    )

    // 1. Pick candidates from existing global cards at target CEFR.
    //    Only reuse cards that ALREADY have content in the user's native
    //    language: a card-level translation AND at least one example at the
    //    user's CEFR level whose translation is in the native language. Cards
    //    without this content are deferred to the LLM path so we never hand
    //    the learner a card they can't understand.
    const nativeCode = settings.nativeLanguageCode
    const candidates = await prisma.vocabularyCard.findMany({
      where: {
        languageCode: settings.targetLanguageCode,
        cefrLevel: settings.cefrLevel,
        id: { notIn: Array.from(existingStateIds) },
        translations: { some: { nativeLanguageCode: nativeCode } },
        examples: {
          some: {
            cefrLevel: settings.cefrLevel,
            translations: { some: { nativeLanguageCode: nativeCode } },
          },
        },
      },
      take: settings.dailyNewCount * 3,
    })

    const selected: VocabularyCard[] = shuffle(candidates).slice(0, settings.dailyNewCount)
    const needed = settings.dailyNewCount - selected.length
    let usedProvider: LlmProvider | null = null

    // 2. If short, ask the LLM for new words
    if (needed > 0) {
      if (!settings.preferredLlmProvider) {
        throw new Error('LLM provider not configured for user')
      }
      usedProvider = settings.preferredLlmProvider

      const existingLemmas = await prisma.vocabularyCard.findMany({
        where: { languageCode: settings.targetLanguageCode },
        select: { lemma: true },
        take: 500,
      })

      const adapter = await getAdapterForUser(
        prisma,
        userId,
        settings.preferredLlmProvider,
        settings.preferredLlmModel,
      )
      const prompt = buildDailyWordsPrompt({
        targetLanguageName: settings.targetLanguage.name,
        nativeLanguageName: settings.nativeLanguage.name,
        cefr: settings.cefrLevel,
        count: needed,
        excludeLemmas: existingLemmas.map((l) => l.lemma),
      })

      const startedAt = Date.now()
      let newItems: WordItem[] = []
      let success = false
      let errorCode: string | null = null
      try {
        const res = await adapter.complete(prompt)
        const parsed = wordResponseSchema.safeParse(extractJson(res.content))
        if (!parsed.success) throw new Error('LLM returned invalid JSON shape')
        newItems = parsed.data.words.slice(0, needed)
        success = true
        await prisma.llmUsageLog.create({
          data: {
            userId,
            provider: adapter.provider,
            model: adapter.model,
            purpose: 'DAILY_GEN',
            promptTokens: res.promptTokens,
            completionTokens: res.completionTokens,
            latencyMs: Date.now() - startedAt,
            success: true,
          },
        })
      } catch (err) {
        errorCode = err instanceof Error ? err.message : 'unknown'
        await prisma.llmUsageLog.create({
          data: {
            userId,
            provider: adapter.provider,
            model: adapter.model,
            purpose: 'DAILY_GEN',
            latencyMs: Date.now() - startedAt,
            success: false,
            errorCode,
          },
        })
        throw err
      }

      const nativeLang = settings.nativeLanguageCode

      for (const item of newItems) {
        const existing = await prisma.vocabularyCard.findFirst({
          where: {
            languageCode: settings.targetLanguageCode,
            lemma: item.lemma,
            partOfSpeech: item.pos ?? null,
          },
        })
        let card = existing
        if (!card) {
          // Brand-new card: create card + CardTranslation + examples + their
          // translations, all tied to the user's native language.
          card = await prisma.vocabularyCard.create({
            data: {
              languageCode: settings.targetLanguageCode,
              lemma: item.lemma,
              partOfSpeech: item.pos ?? null,
              gender: item.gender ?? null,
              ipa: item.ipa ?? null,
              cefrLevel: settings.cefrLevel,
              sourceProvider: adapter.provider,
              translations: {
                create: [{ nativeLanguageCode: nativeLang, translation: item.translation }],
              },
              examples: {
                create: item.sentences.map((s, idx) => ({
                  text: s.text,
                  orderIndex: idx,
                  cefrLevel: settings.cefrLevel,
                  translations: {
                    create: [{ nativeLanguageCode: nativeLang, translation: s.translation }],
                  },
                })),
              },
            },
          })
        } else {
          // Card exists globally. Make sure this user's native language has a
          // translation for the card; if not, store the LLM-provided one.
          await prisma.cardTranslation.upsert({
            where: {
              cardId_nativeLanguageCode: { cardId: card.id, nativeLanguageCode: nativeLang },
            },
            update: {},
            create: {
              cardId: card.id,
              nativeLanguageCode: nativeLang,
              translation: item.translation,
            },
          })

          // Ensure this CEFR level has its own example sentences so learners
          // don't get content written for a different level.
          const existingAtLevel = await prisma.exampleSentence.findMany({
            where: { cardId: card.id, cefrLevel: settings.cefrLevel },
            select: { id: true },
          })
          if (existingAtLevel.length === 0) {
            for (let idx = 0; idx < item.sentences.length; idx++) {
              const s = item.sentences[idx]!
              await prisma.exampleSentence.create({
                data: {
                  cardId: card.id,
                  text: s.text,
                  orderIndex: idx,
                  cefrLevel: settings.cefrLevel,
                  translations: {
                    create: [{ nativeLanguageCode: nativeLang, translation: s.translation }],
                  },
                },
              })
            }
          } else {
            // Level's examples exist but maybe not in this native language.
            // Backfill translations for those examples.
            for (let idx = 0; idx < existingAtLevel.length && idx < item.sentences.length; idx++) {
              const exampleId = existingAtLevel[idx]!.id
              const s = item.sentences[idx]!
              await prisma.exampleSentenceTranslation.upsert({
                where: {
                  exampleId_nativeLanguageCode: {
                    exampleId,
                    nativeLanguageCode: nativeLang,
                  },
                },
                update: {},
                create: {
                  exampleId,
                  nativeLanguageCode: nativeLang,
                  translation: s.translation,
                },
              })
            }
          }
        }
        if (!existingStateIds.has(card.id) && !selected.some((c) => c.id === card.id)) {
          selected.push(card)
        }
        if (selected.length >= settings.dailyNewCount) break
        success = true
      }
    }

    // 3. Create UserCardState (NEW) + DailyGenerationLog atomically
    const finalCardIds = selected.map((c) => c.id)
    const now = new Date()
    await prisma.$transaction(async (tx) => {
      for (const cardId of finalCardIds) {
        await tx.userCardState.upsert({
          where: { userId_cardId: { userId, cardId } },
          update: {},
          create: {
            userId,
            cardId,
            due: now,
            state: 'NEW',
          },
        })
      }
      await tx.dailyGenerationLog.create({
        data: {
          userId,
          generationDate: dateOnlyDate(dateOnly),
          languageCode: settings.targetLanguageCode,
          cefrLevel: settings.cefrLevel,
          cardIds: finalCardIds,
          provider: usedProvider,
        },
      })
    })

    // Invalidate due-card cache
    const cacheKeys = await redis.keys(`cards:due:${userId}:*`)
    if (cacheKeys.length) await redis.del(...cacheKeys)

    return {
      cardIds: finalCardIds,
      createdNew: needed,
      reusedExisting: selected.length - needed,
      provider: usedProvider,
    }
  } finally {
    await redis.del(lockKey)
  }
}

export interface GenerateAdditionalInput {
  userId: string
  generationDate: Date
  count: number
}

/**
 * Append `count` extra cards to the user's existing daily deck. Intended for
 * the "generate more words" action after the user has finished today's batch
 * and wants to learn more. Requires an existing DailyGenerationLog for today
 * (use generateForUser first).
 */
export async function generateAdditionalForUser(
  prisma: PrismaClient,
  redis: Redis,
  input: GenerateAdditionalInput,
): Promise<GenerateResult> {
  const { userId, count } = input
  if (count <= 0 || count > 20) throw new Error('count must be 1..20')

  const dateOnly = toDateOnly(input.generationDate)

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    include: { targetLanguage: true, nativeLanguage: true },
  })
  if (!settings) throw new Error('User settings not found')

  const existingLog = await prisma.dailyGenerationLog.findUnique({
    where: {
      userId_generationDate_languageCode: {
        userId,
        generationDate: dateOnlyDate(dateOnly),
        languageCode: settings.targetLanguageCode,
      },
    },
  })
  if (!existingLog) {
    throw new Error('No daily deck to extend — run /generate/today first')
  }

  // Separate lock key from the main daily lock so this doesn't collide with
  // a concurrent force-regenerate.
  const lockKey = `lock:additional:${userId}:${dateOnly}:${settings.targetLanguageCode}`
  const acquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  if (!acquired) throw new Error('Another "more words" job is already running')

  try {
    const nativeCode = settings.nativeLanguageCode

    const existingStateIds = new Set(
      (
        await prisma.userCardState.findMany({
          where: { userId },
          select: { cardId: true },
        })
      ).map((r) => r.cardId),
    )

    const candidates = await prisma.vocabularyCard.findMany({
      where: {
        languageCode: settings.targetLanguageCode,
        cefrLevel: settings.cefrLevel,
        id: { notIn: Array.from(existingStateIds) },
        translations: { some: { nativeLanguageCode: nativeCode } },
        examples: {
          some: {
            cefrLevel: settings.cefrLevel,
            translations: { some: { nativeLanguageCode: nativeCode } },
          },
        },
      },
      take: count * 3,
    })

    const selected: VocabularyCard[] = shuffle(candidates).slice(0, count)
    const needed = count - selected.length
    let usedProvider: LlmProvider | null = existingLog.provider

    if (needed > 0) {
      if (!settings.preferredLlmProvider) {
        throw new Error('LLM provider not configured for user')
      }
      usedProvider = settings.preferredLlmProvider

      const existingLemmas = await prisma.vocabularyCard.findMany({
        where: { languageCode: settings.targetLanguageCode },
        select: { lemma: true },
        take: 500,
      })
      const adapter = await getAdapterForUser(
        prisma,
        userId,
        settings.preferredLlmProvider,
        settings.preferredLlmModel,
      )
      const prompt = buildDailyWordsPrompt({
        targetLanguageName: settings.targetLanguage.name,
        nativeLanguageName: settings.nativeLanguage.name,
        cefr: settings.cefrLevel,
        count: needed,
        excludeLemmas: existingLemmas.map((l) => l.lemma),
      })
      const startedAt = Date.now()
      let newItems: WordItem[] = []
      try {
        const res = await adapter.complete(prompt)
        const parsed = wordResponseSchema.safeParse(extractJson(res.content))
        if (!parsed.success) throw new Error('LLM returned invalid JSON shape')
        newItems = parsed.data.words.slice(0, needed)
        await prisma.llmUsageLog.create({
          data: {
            userId,
            provider: adapter.provider,
            model: adapter.model,
            purpose: 'DAILY_GEN',
            promptTokens: res.promptTokens,
            completionTokens: res.completionTokens,
            latencyMs: Date.now() - startedAt,
            success: true,
          },
        })
      } catch (err) {
        await prisma.llmUsageLog.create({
          data: {
            userId,
            provider: adapter.provider,
            model: adapter.model,
            purpose: 'DAILY_GEN',
            latencyMs: Date.now() - startedAt,
            success: false,
            errorCode: err instanceof Error ? err.message : 'unknown',
          },
        })
        throw err
      }

      for (const item of newItems) {
        const existing = await prisma.vocabularyCard.findFirst({
          where: {
            languageCode: settings.targetLanguageCode,
            lemma: item.lemma,
            partOfSpeech: item.pos ?? null,
          },
        })
        let card = existing
        if (!card) {
          card = await prisma.vocabularyCard.create({
            data: {
              languageCode: settings.targetLanguageCode,
              lemma: item.lemma,
              partOfSpeech: item.pos ?? null,
              gender: item.gender ?? null,
              ipa: item.ipa ?? null,
              cefrLevel: settings.cefrLevel,
              sourceProvider: adapter.provider,
              translations: {
                create: [{ nativeLanguageCode: nativeCode, translation: item.translation }],
              },
              examples: {
                create: item.sentences.map((s, idx) => ({
                  text: s.text,
                  orderIndex: idx,
                  cefrLevel: settings.cefrLevel,
                  translations: {
                    create: [{ nativeLanguageCode: nativeCode, translation: s.translation }],
                  },
                })),
              },
            },
          })
        } else {
          await prisma.cardTranslation.upsert({
            where: {
              cardId_nativeLanguageCode: { cardId: card.id, nativeLanguageCode: nativeCode },
            },
            update: {},
            create: {
              cardId: card.id,
              nativeLanguageCode: nativeCode,
              translation: item.translation,
            },
          })
          const existingAtLevel = await prisma.exampleSentence.findMany({
            where: { cardId: card.id, cefrLevel: settings.cefrLevel },
            select: { id: true },
          })
          if (existingAtLevel.length === 0) {
            for (let idx = 0; idx < item.sentences.length; idx++) {
              const s = item.sentences[idx]!
              await prisma.exampleSentence.create({
                data: {
                  cardId: card.id,
                  text: s.text,
                  orderIndex: idx,
                  cefrLevel: settings.cefrLevel,
                  translations: {
                    create: [{ nativeLanguageCode: nativeCode, translation: s.translation }],
                  },
                },
              })
            }
          } else {
            for (let idx = 0; idx < existingAtLevel.length && idx < item.sentences.length; idx++) {
              const s = item.sentences[idx]!
              await prisma.exampleSentenceTranslation.upsert({
                where: {
                  exampleId_nativeLanguageCode: {
                    exampleId: existingAtLevel[idx]!.id,
                    nativeLanguageCode: nativeCode,
                  },
                },
                update: {},
                create: {
                  exampleId: existingAtLevel[idx]!.id,
                  nativeLanguageCode: nativeCode,
                  translation: s.translation,
                },
              })
            }
          }
        }
        if (!selected.some((c) => c.id === card.id)) selected.push(card)
        if (selected.length >= count) break
      }
    }

    const addedCardIds = selected.map((c) => c.id).filter((id) => !existingLog.cardIds.includes(id))
    const now = new Date()

    await prisma.$transaction(async (tx) => {
      for (const cardId of addedCardIds) {
        await tx.userCardState.upsert({
          where: { userId_cardId: { userId, cardId } },
          update: {},
          create: { userId, cardId, due: now, state: 'NEW' },
        })
      }
      await tx.dailyGenerationLog.update({
        where: { id: existingLog.id },
        data: {
          cardIds: { set: [...existingLog.cardIds, ...addedCardIds] },
          provider: usedProvider,
        },
      })
    })

    const cacheKeys = await redis.keys(`cards:due:${userId}:*`)
    if (cacheKeys.length) await redis.del(...cacheKeys)

    return {
      cardIds: addedCardIds,
      createdNew: needed,
      reusedExisting: addedCardIds.length - needed,
      provider: usedProvider,
    }
  } finally {
    await redis.del(lockKey)
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dateOnlyDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

function extractJson(content: string): unknown {
  // Strip Markdown code fences if the model added them
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const raw = fenced ? fenced[1]! : content
  return JSON.parse(raw)
}
