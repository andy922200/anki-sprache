import type { Gender } from '@/types/domain'

// The definite article shown with a lemma. German stores its article as the
// gender value (der/die/das); Portuguese maps MASCULINE/FEMININE → o/a.
export function genderArticle(languageCode: string, gender: Gender | null): string | null {
  if (!gender) return null
  if (languageCode === 'pt') {
    if (gender === 'MASCULINE') return 'o'
    if (gender === 'FEMININE') return 'a'
    return null
  }
  if (gender === 'DER' || gender === 'DIE' || gender === 'DAS') return gender.toLowerCase()
  return null
}
