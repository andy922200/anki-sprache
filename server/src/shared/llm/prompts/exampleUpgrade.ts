import { z } from 'zod'

export const exampleUpgradeResponseSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        translation: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(3),
})
export type ExampleUpgradeResponse = z.infer<typeof exampleUpgradeResponseSchema>

export function buildExampleUpgradePrompt(params: {
  targetLanguageName: string
  nativeLanguageName: string
  cefr: string
  lemma: string
  partOfSpeech: string | null
  translation: string
  referenceSentence: string | null
  count: number
}) {
  const system = `You are a language tutor rewriting example sentences for a learner.
Target language: ${params.targetLanguageName}. Native language (for translations): ${params.nativeLanguageName}.
Rewrite example sentences for the given word so the difficulty matches CEFR ${params.cefr}.`

  const pos = params.partOfSpeech ? ` (${params.partOfSpeech.toLowerCase()})` : ''
  const reference = params.referenceSentence
    ? `Reference sentence at a different level (for meaning, NOT style): "${params.referenceSentence}"`
    : 'No reference sentence; infer meaning from the lemma + translation.'

  const user = `Word: "${params.lemma}"${pos}
Meaning (${params.nativeLanguageName}): "${params.translation}"
${reference}

Produce exactly ${params.count} fresh example sentences in ${params.targetLanguageName} whose vocabulary and grammar fit CEFR ${params.cefr}.

Return a JSON object with shape:
{
  "sentences": [
    { "text": "example sentence in ${params.targetLanguageName}", "translation": "in ${params.nativeLanguageName}" }
  ]
}

Rules:
- Each sentence must use the word "${params.lemma}" naturally.
- Keep each sentence under 20 words.
- Difficulty must match CEFR ${params.cefr} — vocabulary, tense, and clause structure typical for that level.
- Do NOT reuse the reference sentence verbatim.
- Return ONLY the JSON object, no prose, no code fences.`

  return { system, user }
}
