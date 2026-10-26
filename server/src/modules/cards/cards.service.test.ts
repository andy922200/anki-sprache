import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/generated/prisma/client.js'
import type { Redis } from 'ioredis'

// Plain function (not vi.fn): vitest's settled-result tracking leaves rejected mock promises unhandled.
const calls: unknown[] = []
let impl: (input: unknown) => Promise<unknown> = async () => ({})
const complete = (input: unknown) => {
  calls.push(input)
  return impl(input)
}
vi.mock('@/shared/llm/llmClient.js', () => ({
  getAdapterForUser: vi.fn(async () => ({ provider: 'OPENAI', model: 'test-model', complete })),
}))
vi.mock('@/shared/audio/pruneExamples.js', () => ({ pruneExamples: vi.fn() }))

const { ensureCardExamples } = await import('./cards.service.js')
const { toLlmRequestError, LlmRequestError } = await import('@/shared/llm/errors.js')

interface FakeExample {
  id: string
  text: string
  cefrLevel: string
  translations: { id: string }[]
}

function setup(opts: { translations?: string[]; examples?: FakeExample[] }) {
  const card = {
    lemma: 'Haus',
    partOfSpeech: 'NOUN',
    translations: (opts.translations ?? ['en']).map((nativeLanguageCode) => ({
      translation: 'house',
      nativeLanguageCode,
    })),
    examples: opts.examples ?? [],
  }
  const created: unknown[] = []
  const usage: { success: boolean; errorCode?: string }[] = []
  const tx = {
    cardTranslation: { upsert: vi.fn() },
    exampleSentence: { create: vi.fn(async (a: unknown) => created.push(a)) },
    exampleSentenceTranslation: { upsert: vi.fn() },
  }
  const prisma = {
    userSettings: {
      findUniqueOrThrow: vi.fn(async () => ({
        cefrLevel: 'B1',
        nativeLanguageCode: 'en',
        preferredLlmProvider: 'OPENAI',
        preferredLlmModel: null,
        targetLanguage: { name: 'German' },
        nativeLanguage: { name: 'English' },
      })),
    },
    vocabularyCard: { findUniqueOrThrow: vi.fn(async () => card) },
    llmApiKey: { findUnique: vi.fn(async () => ({ id: 'k' })) },
    llmUsageLog: {
      create: vi.fn(async ({ data }: { data: (typeof usage)[number] }) => usage.push(data)),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)),
  }
  const redis = { set: vi.fn(async () => 'OK'), del: vi.fn(), keys: vi.fn(async () => []) }
  const run = () =>
    ensureCardExamples(prisma as unknown as PrismaClient, redis as unknown as Redis, 'u1', 'c1')
  return { run, prisma, redis, created, usage, tx }
}

const generated = {
  content: JSON.stringify({
    newExamples: [
      { text: 'Das Haus ist groß.', translation: 'The house is big.' },
      { text: 'Wir kaufen ein Haus.', translation: 'We are buying a house.' },
    ],
  }),
  promptTokens: 10,
  completionTokens: 20,
}

describe('ensureCardExamples', () => {
  beforeEach(() => {
    calls.length = 0
    impl = async () => ({})
  })

  it('skips the LLM when the card is complete for the requester', async () => {
    const { run, redis } = setup({
      examples: [{ id: 'e1', text: 'x', cefrLevel: 'B1', translations: [{ id: 't1' }] }],
    })
    await run()
    expect(calls).toHaveLength(0)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('treats examples at another level as missing and generates once, failing fast', async () => {
    impl = async () => generated
    const { run, created, usage, redis } = setup({
      examples: [{ id: 'e1', text: 'x', cefrLevel: 'A2', translations: [{ id: 't1' }] }],
    })
    await run()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ attempts: 1 })
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ data: { cefrLevel: 'B1', orderIndex: 0 } })
    expect(usage).toEqual([expect.objectContaining({ success: true })])
    expect(redis.del).toHaveBeenCalledWith('lock:ensure-examples:c1:B1:en')
  })

  it('only translates existing same-level examples that lack a native translation', async () => {
    impl = async () => ({
      content: JSON.stringify({
        existingExampleTranslations: [{ text: 'Das Haus.', translation: 'The house.' }],
      }),
      promptTokens: 1,
      completionTokens: 1,
    })
    const { run, tx, created } = setup({
      examples: [{ id: 'e1', text: 'Das Haus.', cefrLevel: 'B1', translations: [] }],
    })
    await run()
    expect(created).toHaveLength(0)
    expect(tx.exampleSentenceTranslation.upsert).toHaveBeenCalledTimes(1)
  })

  it('maps a provider 429 to LLM_RATE_LIMITED, writes nothing and releases the lock', async () => {
    impl = async () => {
      throw Object.assign(new Error('Too Many Requests'), { status: 429 })
    }
    const { run, prisma, usage, redis } = setup({ examples: [] })
    const err = await run().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmRequestError)
    expect(err).toMatchObject({ statusCode: 424, message: 'LLM_RATE_LIMITED' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(usage).toEqual([
      expect.objectContaining({ success: false, errorCode: 'LLM_RATE_LIMITED' }),
    ])
    expect(redis.del).toHaveBeenCalledWith('lock:ensure-examples:c1:B1:en')
  })

  it('rejects a response missing required examples', async () => {
    impl = async () => ({ content: '{}', promptTokens: 0, completionTokens: 0 })
    const { run, prisma } = setup({ examples: [] })
    const err = await run().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmRequestError)
    expect((err as Error).message).toBe('LLM_INVALID_RESPONSE')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('toLlmRequestError', () => {
  it.each([
    [429, 'LLM_RATE_LIMITED'],
    [401, 'LLM_API_KEY_INVALID'],
    [403, 'LLM_API_KEY_INVALID'],
    [402, 'LLM_QUOTA_EXCEEDED'],
    [500, 'LLM_UPSTREAM_ERROR'],
    [undefined, 'LLM_UPSTREAM_ERROR'],
  ])('maps status %s to %s', (status, code) => {
    const err = toLlmRequestError({ status })
    expect(err).toBeInstanceOf(LlmRequestError)
    expect(err.message).toBe(code)
    expect(err.statusCode).toBe(424)
  })
})
