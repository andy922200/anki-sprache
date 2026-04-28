import { describe, expect, it } from 'vitest'
import { buildWordItemSchema } from './dailyWords.js'

const baseSentences = [{ text: 'Foo bar baz.', translation: 'foo bar baz.' }]

describe('buildWordItemSchema', () => {
  it('strips German noun article and backfills gender from prefix', () => {
    const out = buildWordItemSchema('de').parse({
      lemma: 'die Stadt',
      pos: 'NOUN',
      translation: 'city',
      sentences: baseSentences,
    })
    expect(out.lemma).toBe('Stadt')
    expect(out.gender).toBe('DIE')
  })

  it('keeps explicit gender when LLM already provided one', () => {
    const out = buildWordItemSchema('de').parse({
      lemma: 'der Zug',
      pos: 'NOUN',
      gender: 'DER',
      translation: 'train',
      sentences: baseSentences,
    })
    expect(out.lemma).toBe('Zug')
    expect(out.gender).toBe('DER')
  })

  it('does not touch non-noun lemmas even in German', () => {
    const out = buildWordItemSchema('de').parse({
      lemma: 'fahren',
      pos: 'VERB',
      translation: 'to drive',
      sentences: baseSentences,
    })
    expect(out.lemma).toBe('fahren')
    expect(out.gender).toBeUndefined()
  })

  it('leaves lemma untouched for languages without an article convention', () => {
    const out = buildWordItemSchema('en').parse({
      lemma: 'die Stadt',
      pos: 'NOUN',
      translation: 'city',
      sentences: baseSentences,
    })
    expect(out.lemma).toBe('die Stadt')
  })

  it('falls back to no-op for unknown language codes', () => {
    const out = buildWordItemSchema('fr').parse({
      lemma: 'le chat',
      pos: 'NOUN',
      translation: 'cat',
      sentences: baseSentences,
    })
    expect(out.lemma).toBe('le chat')
  })
})
