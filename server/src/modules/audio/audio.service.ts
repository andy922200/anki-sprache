import type { Redis } from 'ioredis'
import type { CEFR, PrismaClient } from '@/generated/prisma/client.js'
import {
  buildAudioKey,
  deleteAudio,
  extractKeyFromUrl,
  objectExists,
  publicUrlFor,
  uploadAudio,
} from '@/shared/storage/r2.js'
import { buildTtsAdapter } from '@/shared/tts/ttsClient.js'

export const EXAMPLES_PER_LEVEL_MAX = 3

const LOCK_TTL_SECONDS = 30
const LOCK_POLL_INTERVAL_MS = 400
const LOCK_WAIT_TIMEOUT_MS = 20_000

export type AudioKind = 'lemma' | 'example'

interface LoadedTarget {
  id: string
  text: string
  languageCode: string
  audioUrl: string | null
}

async function loadTarget(
  prisma: PrismaClient,
  kind: AudioKind,
  id: string,
): Promise<LoadedTarget | null> {
  if (kind === 'lemma') {
    const card = await prisma.vocabularyCard.findUnique({
      where: { id },
      select: { id: true, lemma: true, languageCode: true, audioUrl: true },
    })
    if (!card) return null
    return { id: card.id, text: card.lemma, languageCode: card.languageCode, audioUrl: card.audioUrl }
  }
  const example = await prisma.exampleSentence.findUnique({
    where: { id },
    select: {
      id: true,
      text: true,
      audioUrl: true,
      card: { select: { languageCode: true } },
    },
  })
  if (!example) return null
  return {
    id: example.id,
    text: example.text,
    languageCode: example.card.languageCode,
    audioUrl: example.audioUrl,
  }
}

async function persistAudioUrl(
  prisma: PrismaClient,
  kind: AudioKind,
  id: string,
  audioUrl: string,
): Promise<void> {
  if (kind === 'lemma') {
    await prisma.vocabularyCard.update({ where: { id }, data: { audioUrl } })
  } else {
    await prisma.exampleSentence.update({ where: { id }, data: { audioUrl } })
  }
}

async function waitForPeerResult(
  prisma: PrismaClient,
  kind: AudioKind,
  id: string,
): Promise<string | null> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS))
    const fresh = await loadTarget(prisma, kind, id)
    if (fresh?.audioUrl) return fresh.audioUrl
  }
  return null
}

export async function ensureAudio(
  prisma: PrismaClient,
  redis: Redis,
  kind: AudioKind,
  id: string,
): Promise<string> {
  const target = await loadTarget(prisma, kind, id)
  if (!target) throw new Error(`${kind} ${id} not found`)
  if (target.audioUrl) return target.audioUrl

  const lockKey = `tts:lock:${kind}:${id}`
  const acquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  if (!acquired) {
    const peerUrl = await waitForPeerResult(prisma, kind, id)
    if (peerUrl) return peerUrl
    throw new Error('Audio synthesis timed out waiting for peer')
  }

  try {
    // Re-check after acquiring the lock — another process may have finished
    // between our initial read and the lock grant.
    const fresh = await loadTarget(prisma, kind, id)
    if (fresh?.audioUrl) return fresh.audioUrl

    // Content-addressed key: identical (kind, languageCode, text) always
    // maps to the same R2 object. If an object already exists (e.g.
    // synthesised in another environment sharing this bucket), skip the
    // TTS call entirely and just persist the URL.
    const key = buildAudioKey(kind, target.languageCode, target.text)
    if (await objectExists(key)) {
      const existingUrl = publicUrlFor(key)
      await persistAudioUrl(prisma, kind, id, existingUrl)
      return existingUrl
    }

    const adapter = buildTtsAdapter('GOOGLE')
    const buffer = await adapter.synthesize({
      text: target.text,
      languageCode: target.languageCode,
    })

    const url = await uploadAudio(key, buffer, {
      // URL-encode so non-ASCII (中文 / 日文 / ß) survives S3's ASCII-only
      // metadata header transport. Decode with decodeURIComponent() when
      // reading back via HEAD or dashboard inspection tooling.
      text: encodeURIComponent(target.text),
      lang: target.languageCode,
      kind,
    })
    await persistAudioUrl(prisma, kind, id, url)
    return url
  } finally {
    await redis.del(lockKey)
  }
}

interface PrunableExample {
  id: string
  audioUrl: string | null
}

/**
 * Keeps at most `max` examples per (cardId, cefrLevel). Called after any code
 * path that inserts examples so total storage has a hard ceiling regardless
 * of how many regeneration / upgrade rounds a card accumulates. Oldest by
 * orderIndex (then id) gets evicted; associated R2 audio is deleted best-
 * effort after the DB transaction commits.
 */
export async function pruneExamples(
  prisma: PrismaClient,
  cardId: string,
  cefrLevel: CEFR,
  max: number = EXAMPLES_PER_LEVEL_MAX,
): Promise<void> {
  const rows = await prisma.exampleSentence.findMany({
    where: { cardId, cefrLevel },
    orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
    select: { id: true, audioUrl: true },
  })
  if (rows.length <= max) return

  const toDelete: PrunableExample[] = rows.slice(0, rows.length - max)
  const ids = toDelete.map((r) => r.id)

  await prisma.exampleSentence.deleteMany({ where: { id: { in: ids } } })

  for (const row of toDelete) {
    if (!row.audioUrl) continue
    const key = extractKeyFromUrl(row.audioUrl)
    if (!key) continue
    // Content-addressed keys mean two different records can share the
    // same R2 object. Only delete when we're the last reference so we
    // don't turn another record's audioUrl into a dead link.
    const [cardRefs, exampleRefs] = await Promise.all([
      prisma.vocabularyCard.count({ where: { audioUrl: row.audioUrl } }),
      prisma.exampleSentence.count({ where: { audioUrl: row.audioUrl } }),
    ])
    if (cardRefs > 0 || exampleRefs > 0) continue
    try {
      await deleteAudio(key)
    } catch {
      // Best-effort: an orphan R2 object is cheap compared to throwing
      // mid-transaction. A sweeper job (out of scope) can reconcile later.
    }
  }
}
