import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/generated/prisma/client.js'

// Each entry answers one LLM call: the lemmas to return, or an Error to throw.
let script: (string[] | Error)[] = []
const prompts: { system: string; user: string }[] = []
const complete = async (input: { system: string; user: string }) => {
  prompts.push(input)
  const next = script.shift()
  if (!next) throw new Error('unexpected LLM call')
  if (next instanceof Error) throw next
  const word = (lemma: string) => ({
    lemma,
    pos: 'ADJECTIVE',
    translation: lemma,
    sentences: [{ text: `${lemma} 1`, translation: `${lemma} 1` }],
  })
  return {
    content: JSON.stringify({ words: next.map(word) }),
    promptTokens: 1,
    completionTokens: 1,
  }
}
vi.mock('@/shared/llm/llmClient.js', () => ({
  getAdapterForUser: vi.fn(async () => ({ provider: 'GOOGLE', model: 'test-model', complete })),
}))
vi.mock('@/shared/audio/pruneExamples.js', () => ({ pruneExamples: vi.fn() }))

const { generateForUser, generateAdditionalForUser } = await import('./generation.service.js')

// Lemmas that already exist as cards, and the id they resolve to.
const EXISTING: Record<string, string> = { bom: 'removed-bom', livro: 'learned' }

function setup(pool: string[] = []) {
  prompts.length = 0
  const usage: { success: boolean }[] = []
  const logged: { cardIds: string[] }[] = []
  const tx = {
    userCardState: { upsert: vi.fn() },
    dailyGenerationLog: {
      create: vi.fn(async ({ data }: { data: { cardIds: string[] } }) => logged.push(data)),
      update: vi.fn(),
    },
  }
  const prisma = {
    userSettings: {
      findUnique: vi.fn(async () => ({
        targetLanguageCode: 'pt',
        nativeLanguageCode: 'en',
        cefrLevel: 'A2',
        dailyNewCount: 2,
        preferredLlmProvider: 'GOOGLE',
        preferredLlmModel: null,
        targetLanguage: { enabled: true, name: 'Portuguese' },
        nativeLanguage: { name: 'English' },
      })),
    },
    dailyGenerationLog: {
      findUnique: vi.fn(async () => null),
    },
    userCardState: { findMany: vi.fn(async () => [{ cardId: 'learned' }]) },
    vocabularyCard: {
      // Three shapes of call: lemmas of dropped cards, ids of every pool match, rows by id.
      findMany: vi.fn(
        async (args: {
          where: { id?: { in: string[] } }
          select?: { lemma?: true; id?: true }
        }) => {
          if (args.select?.lemma) return args.where.id!.in.map(() => ({ lemma: 'bom' }))
          if (args.select?.id) return pool.map((id) => ({ id }))
          return args.where.id!.in.map((id) => ({ id }))
        },
      ),
      findFirst: vi.fn(async ({ where }: { where: { lemma: string } }) => {
        const id = EXISTING[where.lemma]
        return id ? { id } : null
      }),
      create: vi.fn(async ({ data }: { data: { lemma: string } }) => ({ id: `new-${data.lemma}` })),
    },
    cardTranslation: { upsert: vi.fn() },
    exampleSentence: { findMany: vi.fn(async () => [{ id: 'e1' }]), create: vi.fn() },
    exampleSentenceTranslation: { upsert: vi.fn() },
    llmUsageLog: {
      create: vi.fn(async ({ data }: { data: { success: boolean } }) => usage.push(data)),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)),
  }
  const redis = { set: vi.fn(async () => 'OK'), del: vi.fn(), keys: vi.fn(async () => []) }
  const db = prisma as unknown as PrismaClient
  const cache = redis as unknown as Redis
  const generationDate = new Date('2026-10-26T00:00:00.000Z')
  return {
    prisma,
    usage,
    logged,
    daily: (excludeCardIds?: string[]) =>
      generateForUser(db, cache, { userId: 'u1', generationDate, excludeCardIds }),
    additional: (count: number) =>
      generateAdditionalForUser(db, cache, { userId: 'u1', generationDate, count }),
  }
}

describe('generateForUser', () => {
  beforeEach(() => {
    script = []
  })

  it('accepts what the LLM returns when none of it is already known', async () => {
    script = [['casa', 'sol']]
    const { daily } = setup()
    const result = await daily()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]!.user).toContain('Avoid these lemmas: (none)')
    expect(result.cardIds).toEqual(['new-casa', 'new-sol'])
  })

  it('drops words the user already has and asks once more, naming the rejected lemmas', async () => {
    script = [['livro', 'casa'], ['sol']]
    const { daily } = setup()
    const result = await daily()

    expect(prompts).toHaveLength(2)
    expect(prompts[0]!.user).toContain('Avoid these lemmas: (none)')
    expect(prompts[1]!.user).toContain('Produce exactly 1 ')
    expect(prompts[1]!.user).toContain('Avoid these lemmas: livro')
    expect(result.cardIds).toEqual(['new-casa', 'new-sol'])
  })

  it('never re-picks dropped cards after a forced regenerate, even if the LLM returns them', async () => {
    script = [
      ['bom', 'casa'],
      ['bom', 'sol'],
    ]
    const { daily, prisma } = setup()
    const result = await daily(['removed-bom'])

    expect(prompts[0]!.user).toContain('Avoid these lemmas: bom')
    expect(prisma.vocabularyCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ['learned', 'removed-bom'] } }),
      }),
    )
    expect(result.cardIds).toEqual(['new-casa', 'new-sol'])
  })

  it('makes at most one follow-up request and settles for a smaller deck', async () => {
    script = [['livro', 'casa'], ['livro']]
    const { daily } = setup()
    const result = await daily()

    expect(prompts).toHaveLength(2)
    expect(result.cardIds).toEqual(['new-casa'])
  })

  it('keeps the first round’s cards when the follow-up request fails', async () => {
    script = [['livro', 'casa'], new Error('upstream down')]
    const { daily, usage } = setup()
    const result = await daily()

    expect(result.cardIds).toEqual(['new-casa'])
    expect(usage.map((u) => u.success)).toEqual([true, false])
  })

  it('fails when the first request fails', async () => {
    script = [new Error('upstream down')]
    const { daily, logged } = setup()

    await expect(daily()).rejects.toThrow('upstream down')
    expect(logged).toHaveLength(0)
  })
})

describe('candidate pool', () => {
  beforeEach(() => {
    script = []
  })

  it('draws from every match without calling the LLM when the pool is big enough', async () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const { daily, prisma } = setup(pool)
    const result = await daily()

    expect(prompts).toHaveLength(0)
    expect(result.cardIds).toHaveLength(2)
    expect(result.cardIds.every((id) => pool.includes(id))).toBe(true)
    // No `take`: the draw must see the whole pool, not the first few rows.
    expect(prisma.vocabularyCard.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ take: expect.anything() }),
    )
  })

  it('can reach cards at the end of a large pool', async () => {
    const pool = Array.from({ length: 50 }, (_, i) => `card-${i}`)
    const seen = new Set<string>()
    for (let run = 0; run < 40; run++) {
      const { daily } = setup(pool)
      for (const id of (await daily()).cardIds) seen.add(id)
    }
    expect([...seen].some((id) => Number(id.split('-')[1]) >= 6)).toBe(true)
  })
})

describe('generateAdditionalForUser', () => {
  beforeEach(() => {
    script = []
  })

  it('skips words the user already has instead of adding them again', async () => {
    script = [['livro', 'casa']]
    const { additional, prisma } = setup()
    prisma.dailyGenerationLog.findUnique.mockResolvedValue({
      id: 'log1',
      cardIds: ['today'],
      provider: 'GOOGLE',
    } as never)
    const result = await additional(1)

    expect(prompts).toHaveLength(1)
    expect(result.cardIds).toEqual(['new-casa'])
  })
})
