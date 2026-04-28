import { z } from 'zod'

// Per-language convention for how an LLM-emitted lemma should look.
// Adding a new language = appending one entry below; the factory functions
// below pick the right entry from `targetLanguageCode`.
type LemmaConvention = {
  // Captures (article, nounBody) from a dictionary form like "die Stadt".
  // null → no article convention; lemma is left untouched.
  articlePattern: RegExp | null
  // Maps the captured article to a Gender enum value. null → schema has no
  // column to store this language's gender yet; we still strip the article
  // from the lemma but leave gender unset. Extending the Gender enum to
  // FEMININE/MASCULINE/NEUTER is tracked separately and gates fr/pt/es.
  toGender: ((article: string) => 'DER' | 'DIE' | 'DAS' | null) | null
  // Single bullet injected under the prompt's "Rules" section.
  promptRule: string | null
}

const NO_CONVENTION: LemmaConvention = {
  articlePattern: null,
  toGender: null,
  promptRule: null,
}

const LEMMA_CONVENTIONS: Record<string, LemmaConvention> = {
  de: {
    articlePattern: /^(der|die|das)\s+(.+)$/i,
    toGender: (a) => a.toUpperCase() as 'DER' | 'DIE' | 'DAS',
    promptRule:
      'German nouns: lemma is ONLY the noun itself (capitalized), with NO article. ' +
      'The article goes in "gender" as DER/DIE/DAS.\n' +
      '  Correct: { "lemma": "Stadt", "pos": "NOUN", "gender": "DIE" }\n' +
      '  Wrong:   { "lemma": "die Stadt", "pos": "NOUN", "gender": "DIE" }\n' +
      '  Wrong:   { "lemma": "Die Stadt", "pos": "NOUN", "gender": null }',
  },
  // To enable a new language: append { articlePattern, toGender, promptRule } here.
  // For Romance languages (fr/pt/es) keep `toGender: null` until the Gender enum
  // grows MASCULINE/FEMININE values — until then we only strip the article.
}

function getConvention(targetLanguageCode: string): LemmaConvention {
  return LEMMA_CONVENTIONS[targetLanguageCode] ?? NO_CONVENTION
}

const baseFields = {
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
}

export function buildWordItemSchema(targetLanguageCode: string) {
  const conv = getConvention(targetLanguageCode)

  // Defense in depth: even with the prompt rule, models occasionally emit
  // "die Stadt" for a noun lemma. The transform strips the article and
  // backfills gender so the canonical (languageCode, lemma, pos) unique
  // constraint actually dedups across runs.
  return z.object(baseFields).transform((item) => {
    if (item.pos !== 'NOUN' || !conv.articlePattern) return item
    const m = conv.articlePattern.exec(item.lemma)
    if (!m) return item
    const stripped = m[2]!.trim()
    const article = m[1]!
    const inferredGender = conv.toGender ? conv.toGender(article) : null
    return {
      ...item,
      lemma: stripped,
      gender: item.gender ?? inferredGender ?? null,
    }
  })
}

export function buildWordResponseSchema(targetLanguageCode: string) {
  return z.object({ words: z.array(buildWordItemSchema(targetLanguageCode)) })
}

export type WordItem = z.infer<ReturnType<typeof buildWordItemSchema>>

export function buildDailyWordsPrompt(params: {
  targetLanguageCode: string
  targetLanguageName: string
  nativeLanguageName: string
  cefr: string
  count: number
  excludeLemmas: string[]
}) {
  const exclude = params.excludeLemmas.slice(0, 200)
  const conv = getConvention(params.targetLanguageCode)
  const articleRule = conv.promptRule
    ? `- ${conv.promptRule}`
    : '- Lemma is the dictionary form; do not prefix with articles or particles.'

  const system = `You are a vocabulary curator for a language learner.
Target language: ${params.targetLanguageName}. Native language (for translations): ${params.nativeLanguageName}.
CEFR level: ${params.cefr}. Select words suited to this level — common, useful, level-appropriate.`

  const user = `Produce exactly ${params.count} ${params.targetLanguageName} lemmas suitable for CEFR ${params.cefr}.

Return a JSON object with shape:
{
  "words": [
    {
      "lemma": "string (dictionary form, NO article — see rules)",
      "pos": "NOUN|VERB|ADJECTIVE|ADVERB|PRONOUN|PREPOSITION|CONJUNCTION|ARTICLE|INTERJECTION|NUMERAL",
      "gender": "DER|DIE|DAS|null (REQUIRED for German nouns, null otherwise)",
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
${articleRule}
- Non-noun lemmas: lowercase unless orthography requires otherwise
- Avoid these lemmas: ${exclude.length ? exclude.join(', ') : '(none)'}
- Return ONLY the JSON object, no prose, no code fences.`

  return { system, user }
}
