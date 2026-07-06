import { z } from 'zod'

// Mirrors the Prisma Gender enum. German stores its article as the value;
// Romance languages store grammatical gender.
type Gender = 'DER' | 'DIE' | 'DAS' | 'MASCULINE' | 'FEMININE'

// Per-language convention for how an LLM-emitted lemma should look.
// Adding a new language = appending one entry below; the factory functions
// below pick the right entry from `targetLanguageCode`.
type LemmaConvention = {
  // Captures (article, nounBody) from a dictionary form like "die Stadt".
  // null → no article convention; lemma is left untouched.
  articlePattern: RegExp | null
  // Maps the captured article to a Gender enum value. null → we still strip the
  // article from the lemma but leave gender unset (no representable value yet).
  toGender: ((article: string) => Gender | null) | null
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
  pt: {
    articlePattern: /^(o|a)\s+(.+)$/i,
    toGender: (a) => (a.toLowerCase() === 'o' ? 'MASCULINE' : 'FEMININE'),
    promptRule:
      'Portuguese nouns: lemma is ONLY the noun itself (lowercase), with NO article. ' +
      'The gender goes in "gender" as MASCULINE (o) or FEMININE (a).\n' +
      '  Correct: { "lemma": "palavra", "pos": "NOUN", "gender": "FEMININE" }\n' +
      '  Wrong:   { "lemma": "a palavra", "pos": "NOUN", "gender": "FEMININE" }',
  },
  // To enable a new language: append { articlePattern, toGender, promptRule } here.
  // Romance languages (fr/es) can mirror `pt`, mapping their article to
  // MASCULINE/FEMININE.
}

function getConvention(targetLanguageCode: string): LemmaConvention {
  return LEMMA_CONVENTIONS[targetLanguageCode] ?? NO_CONVENTION
}

// Strip any combination of leading/trailing slashes, brackets, and whitespace,
// then re-wrap in /…/. Idempotent. Returns null when the inner content is
// empty (e.g. raw was '', '[]', '//') so the column stays NULL rather than '//'.
export function normalizeIpa(raw: string | null | undefined): string | null {
  if (!raw) return null
  const inner = raw.replace(/^[/\[\s]+|[/\]\s]+$/g, '')
  if (!inner) return null
  return `/${inner}/`
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
  gender: z.enum(['DER', 'DIE', 'DAS', 'MASCULINE', 'FEMININE']).nullable().optional(),
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
  // "die Stadt" for a noun lemma or "[fɛɐ̯]" for an IPA. The transform strips
  // the article (so the (languageCode, lemma, pos) unique constraint dedups)
  // and normalizes IPA to /…/ so DB never sees mixed conventions.
  return z.object(baseFields).transform((item) => {
    const ipa = normalizeIpa(item.ipa)
    if (item.pos !== 'NOUN' || !conv.articlePattern) {
      return { ...item, ipa }
    }
    const m = conv.articlePattern.exec(item.lemma)
    if (!m) {
      return { ...item, ipa }
    }
    const stripped = m[2]!.trim()
    const article = m[1]!
    const inferredGender = conv.toGender ? conv.toGender(article) : null
    return {
      ...item,
      ipa,
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
      "gender": "DER|DIE|DAS|MASCULINE|FEMININE|null (see rules — required for nouns in gendered languages, null otherwise)",
      "ipa": "string in /.../ form (phonemic), or null",
      "translation": "translation into ${params.nativeLanguageName}",
      "sentences": [
        { "text": "example sentence in ${params.targetLanguageName}", "translation": "in ${params.nativeLanguageName}" }
      ]
    }
  ]
}

Rules:
- Give exactly 2 example sentences per word, each under 20 words
- IPA: phonemic notation wrapped in /.../, e.g. /ʃtat/, /fɛɐ̯ˈɡaŋənhaɪ̯t/. Never use [...] (phonetic).
${articleRule}
- Non-noun lemmas: lowercase unless orthography requires otherwise
- Avoid these lemmas: ${exclude.length ? exclude.join(', ') : '(none)'}
- Return ONLY the JSON object, no prose, no code fences.`

  return { system, user }
}
