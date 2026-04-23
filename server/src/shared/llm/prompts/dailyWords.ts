import { z } from 'zod'

export const wordItemSchema = z.object({
  lemma: z.string().min(1).max(60),
  pos: z
    .enum([
      'NOUN',
      'VERB',
      'ADJECTIVE',
      'ADVERB',
      'PRONOUN',
      'PREPOSITION',
      'CONJUNCTION',
      'ARTICLE',
      'INTERJECTION',
      'NUMERAL',
    ])
    .nullable()
    .optional(),
  gender: z.enum(['DER', 'DIE', 'DAS']).nullable().optional(),
  ipa: z.string().max(80).nullable().optional(),
  translation: z.string().min(1).max(200),
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
export type WordItem = z.infer<typeof wordItemSchema>

export const wordResponseSchema = z.object({
  words: z.array(wordItemSchema),
})

export function buildDailyWordsPrompt(params: {
  targetLanguageName: string
  nativeLanguageName: string
  cefr: string
  count: number
  excludeLemmas: string[]
}) {
  const exclude = params.excludeLemmas.slice(0, 200)
  const system = `You are a vocabulary curator for a language learner.
Target language: ${params.targetLanguageName}. Native language (for translations): ${params.nativeLanguageName}.
CEFR level: ${params.cefr}. Select words suited to this level — common, useful, level-appropriate.`

  const user = `Produce exactly ${params.count} ${params.targetLanguageName} lemmas suitable for CEFR ${params.cefr}.

Return a JSON object with shape:
{
  "words": [
    {
      "lemma": "string (dictionary form)",
      "pos": "NOUN|VERB|ADJECTIVE|ADVERB|PRONOUN|PREPOSITION|CONJUNCTION|ARTICLE|INTERJECTION|NUMERAL",
      "gender": "DER|DIE|DAS|null (ONLY for German nouns)",
      "ipa": "string|null",
      "translation": "translation into ${params.nativeLanguageName}",
      "sentences": [
        { "text": "example sentence in ${params.targetLanguageName}", "translation": "in ${params.nativeLanguageName}" }
      ]
    }
  ]
}

Rules:
- Give exactly 2 example sentences per word, each under 20 words
- For German nouns include gender (DER/DIE/DAS)
- Lowercase lemmas unless they must be capitalized (e.g. German nouns capitalized)
- Avoid these lemmas: ${exclude.length ? exclude.join(', ') : '(none)'}
- Return ONLY the JSON object, no prose, no code fences.`

  return { system, user }
}
