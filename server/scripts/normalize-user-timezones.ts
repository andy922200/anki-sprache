// Rewrite `User.timezone` values that are not valid IANA names (e.g. "UTC+8", "+08:00",
// "GMT+8") to a real IANA zone. Such values make Intl throw, so the worker and the "today"
// queries silently fall back to UTC for that user.
//
// A fixed offset does not identify a place, so values are converted through a small table of
// default zones (OFFSET_DEFAULT_ZONES in src/shared/time/timezone.ts, printed on every run).
// Anything the table does not cover is only listed, never guessed or written — the user can
// pick a zone themselves in Settings. Values that are already valid (aliases included) are
// left alone.
//
// Usage (run from server/):
//   pnpm normalize:timezones             # dry-run; prints every "old -> new" and the unmapped rows
//   pnpm normalize:timezones --confirm   # writes the conversions
//
// IMPORTANT: this hits whatever DB the local .env points at (DATABASE_URL).
// Double-check the printed DB host before passing --confirm.

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { OFFSET_DEFAULT_ZONES, planTimezoneFix } from '../src/shared/time/timezone.js'

const CONFIRM = process.argv.slice(2).includes('--confirm')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma = new PrismaClient({ adapter })

function maskDb(url: string): string {
  return url.replace(/:[^:@]+@/, ':***@')
}

async function main() {
  console.log(`Database  : ${maskDb(process.env.DATABASE_URL ?? '(unset)')}`)
  console.log(`Mode      : ${CONFIRM ? 'WRITE (live)' : 'dry-run (add --confirm to execute)'}`)
  console.log('')
  console.log('Default zone per fixed offset:')
  for (const [offset, zone] of Object.entries(OFFSET_DEFAULT_ZONES)) {
    console.log(`  ${offset} -> ${zone}`)
  }
  console.log('')

  const users = await prisma.user.findMany({
    select: { id: true, timezone: true },
    orderBy: { createdAt: 'asc' },
  })

  const conversions: { id: string; from: string; to: string; reason: string }[] = []
  const unmapped: { id: string; timezone: string }[] = []
  for (const user of users) {
    const fix = planTimezoneFix(user.timezone)
    if (fix.status === 'convert') {
      conversions.push({ id: user.id, from: user.timezone, to: fix.to, reason: fix.reason })
    } else if (fix.status === 'unmapped') {
      unmapped.push(user)
    }
  }

  console.log(`Users     : ${users.length}`)
  console.log(`Valid     : ${users.length - conversions.length - unmapped.length}`)
  console.log(`To convert: ${conversions.length}`)
  for (const c of conversions) {
    console.log(`  ${c.id}  ${JSON.stringify(c.from)} -> ${c.to}  (${c.reason})`)
  }
  console.log(`Unmapped  : ${unmapped.length}`)
  for (const u of unmapped) {
    console.log(`  ${u.id}  ${JSON.stringify(u.timezone)}  (no default zone; left unchanged)`)
  }
  console.log('')

  if (conversions.length === 0) {
    console.log('Nothing to convert.')
    return
  }
  if (!CONFIRM) {
    console.log('Dry-run only. Re-run with --confirm to write the conversions above.')
    return
  }

  let written = 0
  for (const c of conversions) {
    // Matching on the old value too keeps a user who changed it meanwhile from being overwritten.
    const result = await prisma.user.updateMany({
      where: { id: c.id, timezone: c.from },
      data: { timezone: c.to },
    })
    written += result.count
  }
  console.log(`Updated ${written} of ${conversions.length} users.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
