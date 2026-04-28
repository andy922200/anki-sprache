// Delete every R2 audio object under a given language code prefix.
// Use when retiring a language entirely — the language's audio under
// `audio/lemma/<code>/` and `audio/example/<code>/` is removed regardless of
// whether DB rows still reference it.
//
// Usage (run from server/):
//   pnpm prune:audio:lang ja                     # dry-run; prints summary + first 5 keys
//   pnpm prune:audio:lang ja --verbose           # also lists every key
//   pnpm prune:audio:lang ja --confirm           # actually deletes
//
// IMPORTANT: this hits whatever R2 bucket the local .env points to. Double-check
// the printed bucket before passing --confirm.

import { writeFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import { deleteAudio, listAudioObjects } from '../src/shared/storage/r2.js'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))
const VERBOSE = flags.has('--verbose')
const CONFIRM = flags.has('--confirm')
const languageCode = positional[0]

if (!languageCode || !/^[a-z]{2,8}$/.test(languageCode)) {
  console.error('Usage: pnpm prune:audio:lang <code> [--verbose] [--confirm]')
  console.error('  <code> must match Language.code (lowercase, 2-8 letters), e.g. "ja"')
  process.exit(1)
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / 1024 / 1024).toFixed(1)} MiB`
}

async function main() {
  console.log(`R2 bucket : ${process.env.R2_BUCKET}`)
  console.log(`R2 public : ${process.env.R2_PUBLIC_URL}`)
  console.log(`Language  : ${languageCode}`)
  console.log(`Mode      : ${CONFIRM ? 'DELETE (live)' : 'dry-run (add --confirm to execute)'}`)
  console.log('')

  const prefixes = [`audio/lemma/${languageCode}/`, `audio/example/${languageCode}/`]
  const matched: { key: string; size: number }[] = []
  for (const prefix of prefixes) {
    let count = 0
    let bytes = 0
    for await (const obj of listAudioObjects(prefix)) {
      matched.push(obj)
      count++
      bytes += obj.size
    }
    console.log(`${prefix.padEnd(20)} : ${count} objects (${fmtBytes(bytes)})`)
  }
  const totalBytes = matched.reduce((sum, o) => sum + o.size, 0)
  console.log(`Total           : ${matched.length} objects (${fmtBytes(totalBytes)})`)
  console.log('')

  if (matched.length > 0) {
    const toShow = VERBOSE ? matched : matched.slice(0, 5)
    console.log(VERBOSE ? 'Keys:' : 'First 5 keys:')
    for (const o of toShow) console.log(`  ${o.key}  (${fmtBytes(o.size)})`)
    if (!VERBOSE && matched.length > toShow.length) {
      console.log(`  ... and ${matched.length - toShow.length} more (use --verbose to list all)`)
    }
    console.log('')
  }

  if (!CONFIRM) {
    console.log(
      `Would delete ${matched.length} object(s). Re-run with --confirm to execute.`,
    )
    return
  }
  if (matched.length === 0) {
    console.log('Nothing to delete.')
    return
  }

  console.log(`Deleting ${matched.length} object(s) ...`)
  const deletedKeys: { key: string; size: number }[] = []
  const failedKeys: { key: string; size: number; error: string }[] = []
  for (const o of matched) {
    try {
      await deleteAudio(o.key)
      deletedKeys.push({ key: o.key, size: o.size })
      if (deletedKeys.length % 25 === 0) {
        console.log(`  ... ${deletedKeys.length}/${matched.length}`)
      }
    } catch (err) {
      const message = (err as Error).message
      failedKeys.push({ key: o.key, size: o.size, error: message })
      console.error(`  failed: ${o.key} — ${message}`)
    }
  }
  console.log(`Done. deleted=${deletedKeys.length}, failed=${failedKeys.length}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = pathResolve(process.cwd(), `prune-audio-${languageCode}-${stamp}.json`)
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        bucket: process.env.R2_BUCKET ?? null,
        publicUrl: process.env.R2_PUBLIC_URL ?? null,
        languageCode,
        scanned: { totalObjects: matched.length, totalBytes },
        deleted: deletedKeys,
        failed: failedKeys,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`Log written to ${logPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
