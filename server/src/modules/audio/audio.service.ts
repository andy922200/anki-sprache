import type { Redis } from 'ioredis'
import type { Gender, PrismaClient } from '@/generated/prisma/client.js'
import {
  buildAudioKey,
  extractKeyFromUrl,
  objectExists,
  publicUrlFor,
  uploadAudio,
} from '@/shared/storage/r2.js'
import { buildTtsAdapter } from '@/shared/tts/ttsClient.js'

const LOCK_TTL_SECONDS = 30
const LOCK_POLL_INTERVAL_MS = 400
const LOCK_WAIT_TIMEOUT_MS = 20_000

// The definite article shown/spoken with a lemma. German stores its article as
// the gender value (der/die/das); Portuguese maps MASCULINE/FEMININE → o/a.
function genderArticle(languageCode: string, gender: Gender | null): string | null {
  if (!gender) return null
  if (languageCode === 'pt') {
    if (gender === 'MASCULINE') return 'o'
    if (gender === 'FEMININE') return 'a'
    return null
  }
  if (gender === 'DER' || gender === 'DIE' || gender === 'DAS') return gender.toLowerCase()
  return null
}

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
      select: { id: true, lemma: true, gender: true, languageCode: true, audioUrl: true },
    })
    if (!card) return null
    // Gendered nouns: synthesize "<article> <noun>" (e.g. "die Stadt", "a
    // palavra") so the audio matches what the UI renders and reinforces gender
    // memorization.
    const article = genderArticle(card.languageCode, card.gender)
    const text = article ? `${article} ${card.lemma}` : card.lemma
    return { id: card.id, text, languageCode: card.languageCode, audioUrl: card.audioUrl }
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
  audioUrl: string | null,
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
  if (target.audioUrl) {
    // Validate the cached object actually exists on R2. Without this, an
    // out-of-band deletion (audit-audio, lifecycle policy, manual op) leaves
    // the DB pointing at a dead URL and every subsequent play 404s. On
    // miss we drop the column so the rest of the function re-synthesizes
    // and persists a fresh URL.
    const cachedKey = extractKeyFromUrl(target.audioUrl)
    if (cachedKey && (await objectExists(cachedKey))) return target.audioUrl
    await persistAudioUrl(prisma, kind, id, null)
  }

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
