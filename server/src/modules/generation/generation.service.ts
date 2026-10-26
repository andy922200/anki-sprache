import type { Redis } from 'ioredis'
import type {
  LlmProvider,
  Prisma,
  PrismaClient,
  VocabularyCard,
} from '@/generated/prisma/client.js'
import { MAX_AVOID_LEMMAS } from '@/config/limits.config.js'
import { pruneExamples } from '@/shared/audio/pruneExamples.js'
import { extractJson } from '@/shared/llm/json.js'
import { getAdapterForUser, type LlmAdapter } from '@/shared/llm/llmClient.js'
import {
  buildDailyWordsPrompt,
  buildWordResponseSchema,
  type WordItem,
} from '@/shared/llm/prompts/dailyWords.js'

export interface GenerateForUserInput {
  userId: string
  generationDate: Date // midnight in user's timezone
  /** Cards dropped by a forced regenerate; never re-picked in this run. */
  excludeCardIds?: string[]
}

export interface GenerateResult {
  cardIds: string[]
  createdNew: number
  reusedExisting: number
  provider: LlmProvider | null
  /** Lemmas turned down while the deck still came up short of its target. */
  rejectedLemmas?: string[]
  /** Whether the deck came up short; absent when nothing was generated this run. */
  short?: boolean
}

const LOCK_TTL_SECONDS = 60
export const NO_NEW_WORDS_TTL_SECONDS = 60 * 60

/** The LLM answered, but nothing it suggested could be handed to this user. */
export class NoNewWordsError extends Error {
  constructor(readonly rejectedLemmas: string[]) {
    super('LLM returned no new words for this user')
  }
}

export const noNewWordsKey = (userId: string) => `gen:no-new-words:${userId}`

const REJECTED_LEMMAS_TTL_SECONDS = 24 * 60 * 60
const SHORT_STREAK_TTL_SECONDS = 7 * 24 * 60 * 60
const rejectedLemmasKey = (userId: string) => `gen:rejected-lemmas:${userId}`
export const shortStreakKey = (userId: string) => `gen:short-streak:${userId}`

/** Lemmas turned down recently, so a fresh request doesn't pay to hear them again. */
async function recentRejectedLemmas(redis: Redis, userId: string): Promise<string[]> {
  return (await redis.smembers(rejectedLemmasKey(userId))).slice(0, MAX_AVOID_LEMMAS)
}

async function rememberRejectedLemmas(redis: Redis, userId: string, lemmas: string[]) {
  if (!lemmas.length) return
  await redis.sadd(rejectedLemmasKey(userId), ...lemmas)
  await redis.expire(rejectedLemmasKey(userId), REJECTED_LEMMAS_TTL_SECONDS)
}

export async function recordShortStreak(redis: Redis, userId: string, short: boolean) {
  if (!short) {
    await redis.del(shortStreakKey(userId))
    return
  }
  await redis.incr(shortStreakKey(userId))
  await redis.expire(shortStreakKey(userId), SHORT_STREAK_TTL_SECONDS)
}

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

    const excludeCardIds = input.excludeCardIds ?? []

    // 1. Pick candidates from existing global cards at target CEFR.
    //    Only reuse cards that ALREADY have content in the user's native
    //    language: a card-level translation AND at least one example at the
    //    user's CEFR level whose translation is in the native language. Cards
    //    without this content are deferred to the LLM path so we never hand
    //    the learner a card they can't understand.
    const nativeCode = settings.nativeLanguageCode
    const selected = await pickRandomCards(
      prisma,
      {
        languageCode: settings.targetLanguageCode,
        cefrLevel: settings.cefrLevel,
        id: { notIn: [...existingStateIds, ...excludeCardIds] },
        translations: { some: { nativeLanguageCode: nativeCode } },
        examples: {
          some: {
            cefrLevel: settings.cefrLevel,
            translations: { some: { nativeLanguageCode: nativeCode } },
          },
        },
      },
      settings.dailyNewCount,
    )

    const needed = settings.dailyNewCount - selected.length
    let usedProvider: LlmProvider | null = null
    let rejectedLemmas: string[] = []

    // 2. If short, ask the LLM for new words
    if (needed > 0) {
      if (!settings.preferredLlmProvider) {
        throw new Error('LLM provider not configured for user')
      }
      usedProvider = settings.preferredLlmProvider

      const rejected = await fillFromLlm(prisma, {
        userId,
        settings,
        provider: settings.preferredLlmProvider,
        selected,
        target: settings.dailyNewCount,
        skipCardIds: new Set([...existingStateIds, ...excludeCardIds]),
        avoidCardIds: excludeCardIds,
        avoidLemmas: await recentRejectedLemmas(redis, userId),
      })
      await rememberRejectedLemmas(redis, userId, rejected)
      // An empty log would make /generate/today answer "already-done" for the rest of the day.
      if (selected.length === 0) throw new NoNewWordsError(rejected)
      if (selected.length < settings.dailyNewCount) rejectedLemmas = rejected
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
      rejectedLemmas,
      short: selected.length < settings.dailyNewCount,
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

    const selected = await pickRandomCards(
      prisma,
      {
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
      count,
    )

    const needed = count - selected.length
    let usedProvider: LlmProvider | null = existingLog.provider
    let rejectedLemmas: string[] = []

    if (needed > 0) {
      if (!settings.preferredLlmProvider) {
        throw new Error('LLM provider not configured for user')
      }
      usedProvider = settings.preferredLlmProvider

      const rejected = await fillFromLlm(prisma, {
        userId,
        settings,
        provider: settings.preferredLlmProvider,
        selected,
        target: count,
        skipCardIds: existingStateIds,
        avoidCardIds: [],
        avoidLemmas: await recentRejectedLemmas(redis, userId),
      })
      await rememberRejectedLemmas(redis, userId, rejected)
      if (selected.length === 0) throw new NoNewWordsError(rejected)
      if (selected.length < count) rejectedLemmas = rejected
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
      rejectedLemmas,
      short: selected.length < count,
    }
  } finally {
    await redis.del(lockKey)
  }
}

type SettingsWithLanguages = Prisma.UserSettingsGetPayload<{
  include: { targetLanguage: true; nativeLanguage: true }
}>

interface FillFromLlmInput {
  userId: string
  settings: SettingsWithLanguages
  provider: LlmProvider
  selected: VocabularyCard[]
  target: number
  /** Cards that must not be handed to this user (already theirs, or just dropped). */
  skipCardIds: Set<string>
  /** Dropped cards whose lemmas the first request should steer away from. */
  avoidCardIds: string[]
  avoidLemmas: string[]
}

/**
 * Tops `selected` up to `target` with LLM-suggested words. The prompt carries no
 * global word list; each suggestion is checked against the DB instead, and a single
 * follow-up request names the lemmas that were turned down. Returns every lemma turned down.
 */
async function fillFromLlm(prisma: PrismaClient, input: FillFromLlmInput): Promise<string[]> {
  const { userId, settings, selected, target, skipCardIds } = input
  const adapter = await getAdapterForUser(
    prisma,
    userId,
    input.provider,
    settings.preferredLlmModel,
  )

  let avoidLemmas = [...input.avoidLemmas]
  if (input.avoidCardIds.length) {
    const avoided = await prisma.vocabularyCard.findMany({
      where: { id: { in: input.avoidCardIds } },
      select: { lemma: true },
    })
    avoidLemmas = [...new Set([...avoidLemmas, ...avoided.map((c) => c.lemma)])]
  }

  const allRejected = new Set<string>()
  for (const isFollowUp of [false, true]) {
    const needed = target - selected.length
    if (needed <= 0) break

    let items: WordItem[]
    try {
      items = await requestWords(prisma, adapter, { userId, settings, count: needed, avoidLemmas })
    } catch (err) {
      // A failed follow-up must not discard the cards the first round already secured.
      if (isFollowUp && selected.length > 0) break
      throw err
    }

    const rejected: string[] = []
    for (const item of items) {
      const existing = await prisma.vocabularyCard.findFirst({
        where: {
          languageCode: settings.targetLanguageCode,
          lemma: item.lemma,
          partOfSpeech: item.pos ?? null,
        },
      })
      if (
        existing &&
        (skipCardIds.has(existing.id) || selected.some((c) => c.id === existing.id))
      ) {
        rejected.push(item.lemma)
        allRejected.add(item.lemma)
        continue
      }
      selected.push(
        existing
          ? await backfillCard(prisma, settings, existing, item)
          : await createCard(prisma, settings, adapter.provider, item),
      )
      if (selected.length >= target) return [...allRejected]
    }
    avoidLemmas = [...new Set([...avoidLemmas, ...rejected])]
  }
  return [...allRejected]
}

async function requestWords(
  prisma: PrismaClient,
  adapter: LlmAdapter,
  p: { userId: string; settings: SettingsWithLanguages; count: number; avoidLemmas: string[] },
): Promise<WordItem[]> {
  const { settings } = p
  const prompt = buildDailyWordsPrompt({
    targetLanguageCode: settings.targetLanguageCode,
    targetLanguageName: settings.targetLanguage.name,
    nativeLanguageName: settings.nativeLanguage.name,
    cefr: settings.cefrLevel,
    count: p.count,
    excludeLemmas: p.avoidLemmas,
  })
  const startedAt = Date.now()
  try {
    const res = await adapter.complete(prompt)
    const parsed = buildWordResponseSchema(settings.targetLanguageCode).safeParse(
      extractJson(res.content),
    )
    if (!parsed.success) throw new Error('LLM returned invalid JSON shape')
    await prisma.llmUsageLog.create({
      data: {
        userId: p.userId,
        provider: adapter.provider,
        model: adapter.model,
        purpose: 'DAILY_GEN',
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        latencyMs: Date.now() - startedAt,
        success: true,
      },
    })
    return parsed.data.words
  } catch (err) {
    await prisma.llmUsageLog.create({
      data: {
        userId: p.userId,
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
}

// Brand-new card: card + CardTranslation + examples + their translations, all tied to the
// user's native language.
function createCard(
  prisma: PrismaClient,
  settings: SettingsWithLanguages,
  provider: LlmProvider,
  item: WordItem,
): Promise<VocabularyCard> {
  const nativeLang = settings.nativeLanguageCode
  return prisma.vocabularyCard.create({
    data: {
      languageCode: settings.targetLanguageCode,
      lemma: item.lemma,
      partOfSpeech: item.pos ?? null,
      gender: item.gender ?? null,
      ipa: item.ipa ?? null,
      cefrLevel: settings.cefrLevel,
      sourceProvider: provider,
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
}

// Card exists globally: make sure this user's native language has a card translation, and
// that this CEFR level has examples (with a native translation) instead of another level's.
async function backfillCard(
  prisma: PrismaClient,
  settings: SettingsWithLanguages,
  card: VocabularyCard,
  item: WordItem,
): Promise<VocabularyCard> {
  const nativeLang = settings.nativeLanguageCode
  await prisma.cardTranslation.upsert({
    where: { cardId_nativeLanguageCode: { cardId: card.id, nativeLanguageCode: nativeLang } },
    update: {},
    create: { cardId: card.id, nativeLanguageCode: nativeLang, translation: item.translation },
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
            create: [{ nativeLanguageCode: nativeLang, translation: s.translation }],
          },
        },
      })
    }
    await pruneExamples(prisma, card.id, settings.cefrLevel)
  } else {
    for (let idx = 0; idx < existingAtLevel.length && idx < item.sentences.length; idx++) {
      const exampleId = existingAtLevel[idx]!.id
      const s = item.sentences[idx]!
      await prisma.exampleSentenceTranslation.upsert({
        where: { exampleId_nativeLanguageCode: { exampleId, nativeLanguageCode: nativeLang } },
        update: {},
        create: { exampleId, nativeLanguageCode: nativeLang, translation: s.translation },
      })
    }
  }
  return card
}

// Uniform draw from every match: ids are cheap to load, and an unordered `take` would only
// ever see whichever rows the table happens to return first.
async function pickRandomCards(
  prisma: PrismaClient,
  where: Prisma.VocabularyCardWhereInput,
  n: number,
): Promise<VocabularyCard[]> {
  const matches = await prisma.vocabularyCard.findMany({ where, select: { id: true } })
  const ids = shuffle(matches)
    .slice(0, n)
    .map((c) => c.id)
  if (!ids.length) return []
  return prisma.vocabularyCard.findMany({ where: { id: { in: ids } } })
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
