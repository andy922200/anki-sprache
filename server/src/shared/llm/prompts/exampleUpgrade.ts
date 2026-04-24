import { z } from 'zod'

export const cardAdjustmentResponseSchema = z.object({
  cardTranslation: z.string().min(1).max(300).optional(),
  newExamples: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        translation: z.string().min(1).max(300),
      }),
    )
    .max(3)
    .optional(),
  existingExampleTranslations: z
    .array(
      z.object({
        text: z.string().min(1),
        translation: z.string().min(1).max(300),
      }),
    )
    .optional(),
})
export type CardAdjustmentResponse = z.infer<typeof cardAdjustmentResponseSchema>

export interface BuildCardAdjustmentPromptInput {
  targetLanguageName: string
  nativeLanguageName: string
  cefr: string
  lemma: string
  partOfSpeech: string | null
  /** A meaning anchor in any available native language; helps when we have to ask the LLM to translate. */
  meaningAnchor: string | null
  needCardTranslation: boolean
  needNewExamples: { count: number; referenceSentence: string | null } | null
  existingExamplesNeedingTranslation: string[]
}

/**
 * Builds a prompt that asks the LLM to fill specific gaps for a card:
 *   - the word's translation in the user's current native language
 *   - new example sentences at the user's current CEFR level
 *   - translations for already-existing example sentences in the new native
 *
 * The prompt only requests the fields that the caller marks as missing, so
 * fully-covered cards never reach this builder.
 */
export function buildCardAdjustmentPrompt(input: BuildCardAdjustmentPromptInput) {
  const requested: string[] = []
  if (input.needCardTranslation) requested.push('cardTranslation')
  if (input.needNewExamples) requested.push('newExamples')
  if (input.existingExamplesNeedingTranslation.length > 0) requested.push('existingExampleTranslations')

  const pos = input.partOfSpeech ? ` (${input.partOfSpeech.toLowerCase()})` : ''
  const meaningLine = input.meaningAnchor
    ? `Meaning anchor (in another language, for context only): "${input.meaningAnchor}"`
    : 'No prior translation available; infer the meaning from the word alone.'

  const system = `You are a language tutor filling in missing translation/example data for a vocabulary card.
Target language: ${input.targetLanguageName}.
Native language (for translations): ${input.nativeLanguageName}.
You will be told which JSON fields to return; return ONLY those fields.`

  const sections: string[] = [
    `Word: "${input.lemma}"${pos}`,
    meaningLine,
    `CEFR level: ${input.cefr}`,
    '',
    `Return a JSON object containing ONLY these keys: ${requested.join(', ')}. Omit any key not listed.`,
  ]

  if (input.needCardTranslation) {
    sections.push(
      '',
      `- "cardTranslation" (string): the word's natural meaning in ${input.nativeLanguageName}, ` +
        'concise (typically 1-5 words). Match part-of-speech where possible.',
    )
  }

  if (input.needNewExamples) {
    const ref = input.needNewExamples.referenceSentence
      ? `\n  Reference sentence at a different level (for meaning, NOT style): "${input.needNewExamples.referenceSentence}"`
      : ''
    sections.push(
      '',
      `- "newExamples" (array of ${input.needNewExamples.count}): each item ` +
        `{ "text": <example sentence in ${input.targetLanguageName}>, "translation": <translation in ${input.nativeLanguageName}> }. ` +
        `Vocabulary, tense, and clause structure must match CEFR ${input.cefr}. Each sentence under 20 words. Use "${input.lemma}" naturally.${ref}`,
    )
  }

  if (input.existingExamplesNeedingTranslation.length > 0) {
    const list = input.existingExamplesNeedingTranslation
      .map((t, i) => `  ${i + 1}. "${t}"`)
      .join('\n')
    sections.push(
      '',
      `- "existingExampleTranslations" (array): provide a ${input.nativeLanguageName} translation ` +
        'for each of these existing sentences. Each item must be { "text": <exact original>, "translation": <translation> }. ' +
        'Echo the "text" verbatim so we can match it back. Sentences:',
      list,
    )
  }

  sections.push('', 'Return ONLY the JSON object — no prose, no markdown, no code fences.')

  return { system, user: sections.join('\n') }
}
