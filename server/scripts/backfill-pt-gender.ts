// Backfill grammatical gender (MASCULINE/FEMININE) for existing Portuguese
// NOUN cards that predate the Gender-enum extension. Portuguese lemmas are
// stored bare (no article), so gender cannot be derived by SQL string rules
// reliably — this uses an LLM to classify each noun, then writes the result.
//
// Requires the schema migration `add_romance_gender` to be applied first
// (the MASCULINE/FEMININE enum values must exist).
//
// Auth: bring your own key via env (never committed):
//   BACKFILL_LLM_PROVIDER=ANTHROPIC   # OPENAI | ANTHROPIC | GOOGLE
//   BACKFILL_LLM_KEY=sk-...
//   BACKFILL_LLM_MODEL=...            # optional; adapter default otherwise
//
// Usage (run from server/):
//   pnpm backfill:pt-gender                      # dry-run; classify + print, no writes
//   pnpm backfill:pt-gender --verbose            # list every card + inferred gender
//   pnpm backfill:pt-gender --limit=20           # only process the first 20 nulls
//   pnpm backfill:pt-gender --confirm            # write gender to the DB
//   pnpm backfill:pt-gender --confirm --resynth-audio
//                                                # also NULL audioUrl so lemma
//                                                # audio re-synthesizes as
//                                                # "<article> <noun>" (e.g. "a
//                                                # palavra"). Orphaned mp3s can
//                                                # be cleaned later with
//                                                # `pnpm audit:audio --delete --confirm`.
//
// IMPORTANT: this hits whatever DB the local .env points at (DATABASE_URL).
// Double-check the printed DB host before passing --confirm.

import { writeFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import { z } from 'zod'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
import type { LlmProvider } from '../src/generated/prisma/client.js'
import { buildAdapter } from '../src/shared/llm/llmClient.js'
import { retryable } from '../src/shared/llm/retry.js'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')))
const opts = new Map(
  args
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => {
      const [k, v] = a.slice(2).split('=')
      return [k!, v ?? ''] as const
    }),
)
const VERBOSE = flags.has('--verbose')
const CONFIRM = flags.has('--confirm')
const RESYNTH_AUDIO = flags.has('--resynth-audio')
const LIMIT = opts.has('limit') ? Number.parseInt(opts.get('limit')!, 10) : undefined

const LANGUAGE_CODE = 'pt'
const BATCH_SIZE = 30

const PROVIDER = (opts.get('provider') ?? process.env.BACKFILL_LLM_PROVIDER ?? '').toUpperCase()
const MODEL = opts.get('model') ?? process.env.BACKFILL_LLM_MODEL ?? undefined
const API_KEY = process.env.BACKFILL_LLM_KEY ?? ''

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma = new PrismaClient({ adapter })

function maskDb(url: string): string {
  return url.replace(/:[^:@]+@/, ':***@')
}

const batchResponseSchema = z.object({
  results: z.array(
    z.object({
      lemma: z.string(),
      gender: z.enum(['MASCULINE', 'FEMININE']).nullable(),
    }),
  ),
})

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const raw = fenced ? fenced[1]! : content
  return JSON.parse(raw)
}

function buildGenderPrompt(lemmas: string[]) {
  const system =
    'You are a Portuguese lexicographer. For each Portuguese noun, return its ' +
    'grammatical gender as MASCULINE or FEMININE (European/Brazilian standard). ' +
    'If a word is not a noun or its gender is genuinely ambiguous, return null.'
  const user = `Classify the gender of these Portuguese nouns.

Return ONLY a JSON object with shape:
{ "results": [ { "lemma": "<echoed exactly>", "gender": "MASCULINE|FEMININE|null" } ] }

Echo each lemma back exactly as given. No prose, no code fences.

Nouns:
${lemmas.map((l) => `- ${l}`).join('\n')}`
  return { system, user }
}

async function classifyBatch(
  llm: ReturnType<typeof buildAdapter>,
  lemmas: string[],
): Promise<Map<string, 'MASCULINE' | 'FEMININE'>> {
  const res = await retryable(() => llm.complete(buildGenderPrompt(lemmas)), {
    onAttempt: (n, err) =>
      console.warn(`  retry ${n} after: ${err instanceof Error ? err.message : String(err)}`),
  })
  const parsed = batchResponseSchema.safeParse(extractJson(res.content))
  if (!parsed.success) throw new Error('LLM returned invalid JSON shape')

  const byLemma = new Map<string, 'MASCULINE' | 'FEMININE'>()
  for (const row of parsed.data.results) {
    if (!row.gender) continue
    byLemma.set(row.lemma, row.gender)
    byLemma.set(row.lemma.toLowerCase(), row.gender)
  }
  return byLemma
}

async function main() {
  console.log(`Database  : ${maskDb(process.env.DATABASE_URL ?? '(unset)')}`)
  console.log(`Language  : ${LANGUAGE_CODE}`)
  console.log(`Provider  : ${PROVIDER || '(unset)'}${MODEL ? ` (${MODEL})` : ''}`)
  console.log(
    `Mode      : ${CONFIRM ? 'WRITE (live)' : 'dry-run (add --confirm to write)'}` +
      `${RESYNTH_AUDIO ? ' + resynth-audio' : ''}`,
  )
  console.log('')

  if (!['OPENAI', 'ANTHROPIC', 'GOOGLE'].includes(PROVIDER)) {
    console.error(
      'Set BACKFILL_LLM_PROVIDER (or --provider=) to one of OPENAI | ANTHROPIC | GOOGLE.',
    )
    process.exit(1)
  }
  if (!API_KEY) {
    console.error('Set BACKFILL_LLM_KEY in the environment (raw API key, not stored/encrypted).')
    process.exit(1)
  }

  const cards = await prisma.vocabularyCard.findMany({
    where: { languageCode: LANGUAGE_CODE, partOfSpeech: 'NOUN', gender: null },
    select: { id: true, lemma: true, audioUrl: true },
    orderBy: { lemma: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  })
  console.log(`Found ${cards.length} Portuguese NOUN card(s) without gender.`)
  if (cards.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  const llm = buildAdapter(PROVIDER as LlmProvider, API_KEY, MODEL)

  const resolved: { id: string; lemma: string; gender: 'MASCULINE' | 'FEMININE'; audioUrl: string | null }[] =
    []
  const unresolved: string[] = []

  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE)
    console.log(`Classifying ${i + 1}-${i + batch.length} of ${cards.length} ...`)
    let byLemma: Map<string, 'MASCULINE' | 'FEMININE'>
    try {
      byLemma = await classifyBatch(llm, batch.map((c) => c.lemma))
    } catch (err) {
      console.error(`  batch failed: ${err instanceof Error ? err.message : String(err)}`)
      for (const c of batch) unresolved.push(c.lemma)
      continue
    }
    for (const c of batch) {
      const gender = byLemma.get(c.lemma) ?? byLemma.get(c.lemma.toLowerCase())
      if (gender) {
        resolved.push({ id: c.id, lemma: c.lemma, gender, audioUrl: c.audioUrl })
      } else {
        unresolved.push(c.lemma)
      }
    }
  }

  console.log('')
  console.log(`Resolved  : ${resolved.length}`)
  console.log(`Unresolved: ${unresolved.length}`)
  if (resolved.length) {
    const toShow = VERBOSE ? resolved : resolved.slice(0, 10)
    console.log(VERBOSE ? 'Gender assignments:' : 'First 10 assignments:')
    for (const r of toShow) {
      const article = r.gender === 'MASCULINE' ? 'o' : 'a'
      console.log(`  ${article} ${r.lemma}  → ${r.gender}`)
    }
    if (!VERBOSE && resolved.length > toShow.length) {
      console.log(`  ... and ${resolved.length - toShow.length} more (use --verbose)`)
    }
  }
  if (unresolved.length && VERBOSE) {
    console.log('Unresolved lemmas:')
    for (const l of unresolved) console.log(`  ${l}`)
  }
  console.log('')

  if (!CONFIRM) {
    console.log(`Would update ${resolved.length} card(s). Re-run with --confirm to write.`)
    return
  }

  console.log(`Writing gender for ${resolved.length} card(s) ...`)
  let updated = 0
  let audioCleared = 0
  for (const r of resolved) {
    await prisma.vocabularyCard.update({
      where: { id: r.id },
      data: {
        gender: r.gender,
        ...(RESYNTH_AUDIO && r.audioUrl ? { audioUrl: null } : {}),
      },
    })
    updated++
    if (RESYNTH_AUDIO && r.audioUrl) audioCleared++
    if (updated % 25 === 0) console.log(`  ... ${updated}/${resolved.length}`)
  }
  console.log(`Done. updated=${updated}, audioCleared=${audioCleared}, unresolved=${unresolved.length}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = pathResolve(process.cwd(), `backfill-pt-gender-${stamp}.json`)
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        database: maskDb(process.env.DATABASE_URL ?? '(unset)'),
        provider: PROVIDER,
        model: MODEL ?? null,
        resynthAudio: RESYNTH_AUDIO,
        updated,
        audioCleared,
        assignments: resolved.map((r) => ({ id: r.id, lemma: r.lemma, gender: r.gender })),
        unresolved,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`Log written to ${logPath}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
