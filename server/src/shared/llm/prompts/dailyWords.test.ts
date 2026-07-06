import { describe, expect, it } from 'vitest'
import { buildWordItemSchema, normalizeIpa } from './dailyWords.js'

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

  it('strips Portuguese noun article and maps o/a to MASCULINE/FEMININE', () => {
    const fem = buildWordItemSchema('pt').parse({
      lemma: 'a palavra',
      pos: 'NOUN',
      translation: 'word',
      sentences: baseSentences,
    })
    expect(fem.lemma).toBe('palavra')
    expect(fem.gender).toBe('FEMININE')

    const masc = buildWordItemSchema('pt').parse({
      lemma: 'o livro',
      pos: 'NOUN',
      translation: 'book',
      sentences: baseSentences,
    })
    expect(masc.lemma).toBe('livro')
    expect(masc.gender).toBe('MASCULINE')
  })

  it('keeps an explicit Portuguese gender when the LLM already provided one', () => {
    const out = buildWordItemSchema('pt').parse({
      lemma: 'problema',
      pos: 'NOUN',
      gender: 'MASCULINE',
      translation: 'problem',
      sentences: baseSentences,
    })
    expect(out.lemma).toBe('problema')
    expect(out.gender).toBe('MASCULINE')
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

  it('normalizes IPA via the schema transform regardless of pos/language', () => {
    const out = buildWordItemSchema('en').parse({
      lemma: 'cat',
      pos: 'NOUN',
      ipa: '[kæt]',
      translation: 'cat',
      sentences: baseSentences,
    })
    expect(out.ipa).toBe('/kæt/')
  })
})

describe('normalizeIpa', () => {
  it.each([
    ['ʃtat', '/ʃtat/'],
    ['/ʃtat/', '/ʃtat/'],
    ['[fɛɐ̯ˈɡaŋənhaɪ̯t]', '/fɛɐ̯ˈɡaŋənhaɪ̯t/'],
    ['  /kæt/  ', '/kæt/'],
    ['/kæt]', '/kæt/'],
  ])('wraps %j as %j', (input, expected) => {
    expect(normalizeIpa(input)).toBe(expected)
  })

  it.each([null, undefined, '', '[]', '//', '   '])('returns null for %j', (input) => {
    expect(normalizeIpa(input)).toBeNull()
  })
})
