// Audit & optionally clean up R2 audio objects that no longer have a DB
// reference (true orphans, e.g. left behind when cards were merged or deleted).
//
// Usage (run from server/):
//   pnpm audit:audio                     # dry-run; prints summary + first 5 orphans
//   pnpm audit:audio --verbose           # also lists every orphan key
//   pnpm audit:audio --delete            # shows what WOULD be deleted; still safe
//   pnpm audit:audio --delete --confirm  # actually deletes
//
// IMPORTANT: this hits whatever R2 bucket / DB the local .env points to.
// Double-check the printed bucket + DB host before passing --confirm.

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
import {
  deleteAudio,
  extractKeyFromUrl,
  listAudioObjects,
} from '../src/shared/storage/r2.js'

const argv = new Set(process.argv.slice(2))
const VERBOSE = argv.has('--verbose')
const DELETE = argv.has('--delete')
const CONFIRM = argv.has('--confirm')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma = new PrismaClient({ adapter })

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / 1024 / 1024).toFixed(1)} MiB`
}

function maskDb(url: string): string {
  return url.replace(/:[^:@]+@/, ':***@')
}

async function main() {
  console.log(`R2 bucket : ${process.env.R2_BUCKET}`)
  console.log(`R2 public : ${process.env.R2_PUBLIC_URL}`)
  console.log(`Database  : ${maskDb(process.env.DATABASE_URL ?? '(unset)')}`)
  const mode = DELETE
    ? CONFIRM
      ? 'DELETE (live — will remove orphans)'
      : 'DELETE (dry-run — add --confirm to execute)'
    : 'audit (dry-run)'
  console.log(`Mode      : ${mode}`)
  console.log('')

  const [cards, examples] = await Promise.all([
    prisma.vocabularyCard.findMany({
      where: { audioUrl: { not: null } },
      select: { audioUrl: true },
    }),
    prisma.exampleSentence.findMany({
      where: { audioUrl: { not: null } },
      select: { audioUrl: true },
    }),
  ])

  const referenced = new Set<string>()
  let unparseable = 0
  for (const row of [...cards, ...examples]) {
    const key = extractKeyFromUrl(row.audioUrl as string)
    if (!key) {
      unparseable++
      continue
    }
    referenced.add(key)
  }
  console.log(
    `DB references : ${referenced.size} unique keys ` +
      `(${cards.length} cards + ${examples.length} examples; ${unparseable} URLs not under R2_PUBLIC_URL)`,
  )

  let totalObjects = 0
  let totalBytes = 0
  const orphans: { key: string; size: number }[] = []
  for await (const obj of listAudioObjects()) {
    totalObjects++
    totalBytes += obj.size
    if (!referenced.has(obj.key)) orphans.push(obj)
  }
  const orphanBytes = orphans.reduce((sum, o) => sum + o.size, 0)
  console.log(`R2 objects    : ${totalObjects} total (${fmtBytes(totalBytes)})`)
  console.log(`Orphans       : ${orphans.length} (${fmtBytes(orphanBytes)})`)
  console.log('')

  if (orphans.length > 0) {
    const toShow = VERBOSE ? orphans : orphans.slice(0, 5)
    console.log(VERBOSE ? 'Orphan keys:' : 'First 5 orphan keys:')
    for (const o of toShow) console.log(`  ${o.key}  (${fmtBytes(o.size)})`)
    if (!VERBOSE && orphans.length > toShow.length) {
      console.log(`  ... and ${orphans.length - toShow.length} more (use --verbose to list all)`)
    }
    console.log('')
  }

  if (!DELETE) {
    console.log('Audit only. Pass --delete to see what would be removed.')
    return
  }
  if (!CONFIRM) {
    console.log(
      `Would delete ${orphans.length} orphan object(s). Re-run with --delete --confirm to execute.`,
    )
    return
  }
  if (orphans.length === 0) {
    console.log('Nothing to delete.')
    return
  }

  console.log(`Deleting ${orphans.length} orphan object(s) ...`)
  let deleted = 0
  let failed = 0
  for (const o of orphans) {
    try {
      await deleteAudio(o.key)
      deleted++
      if (deleted % 25 === 0) console.log(`  ... ${deleted}/${orphans.length}`)
    } catch (err) {
      failed++
      console.error(`  failed: ${o.key} — ${(err as Error).message}`)
    }
  }
  console.log(`Done. deleted=${deleted}, failed=${failed}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
