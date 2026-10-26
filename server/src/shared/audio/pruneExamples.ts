import { EXAMPLES_PER_LEVEL_MAX } from '@/config/limits.config.js'
import type { CEFR, PrismaClient } from '@/generated/prisma/client.js'
import { deleteAudio, extractKeyFromUrl } from '@/shared/storage/r2.js'

interface PrunableExample {
  id: string
  audioUrl: string | null
}

/**
 * Keeps at most `max` examples per (cardId, cefrLevel). Called after any code
 * path that inserts examples so total storage has a hard ceiling regardless
 * of how many times examples are regenerated for a card. Oldest by
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
