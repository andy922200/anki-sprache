import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardDto } from '@/types/domain'

const api = vi.hoisted(() => ({
  getDue: vi.fn(),
  getToday: vi.fn(),
  ensureExamples: vi.fn(),
  postReview: vi.fn(),
}))
vi.mock('@/api/cards.api', () => ({
  getDue: api.getDue,
  getToday: api.getToday,
  ensureExamples: api.ensureExamples,
}))
vi.mock('@/api/reviews.api', () => ({ postReview: api.postReview }))

import { useCardsStore } from '../cards.store'

const card = (id: string): CardDto => ({
  id,
  languageCode: 'de',
  lemma: id,
  surfaceForm: null,
  partOfSpeech: null,
  gender: null,
  ipa: null,
  translation: `t-${id}`,
  cefrLevel: 'A1',
  audioUrl: null,
  examples: [{ id: `e-${id}`, text: 'x', translation: 'y', audioUrl: null, orderIndex: 0 }],
  state: null,
})

describe('cards store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('practice mode', () => {
    it('loadToday fills the queue from /cards/today and turns practice mode on', async () => {
      api.getToday.mockResolvedValue([card('a'), card('b')])
      const cards = useCardsStore()

      await cards.loadToday()

      expect(cards.practiceMode).toBe(true)
      expect(cards.queue.map((c) => c.id)).toEqual(['a', 'b'])
      expect(cards.cursor).toBe(0)
    })

    it('advances without saving a review, so FSRS is untouched', async () => {
      api.getToday.mockResolvedValue([card('a'), card('b')])
      const cards = useCardsStore()
      await cards.loadToday()

      await cards.submitReview('GOOD', 'FLIP', 1200)

      expect(api.postReview).not.toHaveBeenCalled()
      expect(cards.CURRENT?.id).toBe('b')
      expect(cards.REMAINING).toBe(1)
    })

    it('loadDue switches practice mode back off', async () => {
      api.getToday.mockResolvedValue([card('a')])
      api.getDue.mockResolvedValue([card('z')])
      const cards = useCardsStore()
      await cards.loadToday()

      await cards.loadDue()

      expect(cards.practiceMode).toBe(false)
      expect(cards.queue.map((c) => c.id)).toEqual(['z'])
    })
  })

  describe('submitReview outside practice mode', () => {
    it('posts the rating with the measured duration', async () => {
      api.getDue.mockResolvedValue([card('a')])
      const cards = useCardsStore()
      await cards.loadDue()

      await cards.submitReview('GOOD', 'FLIP', 1500)

      expect(api.postReview).toHaveBeenCalledWith({
        cardId: 'a',
        rating: 'GOOD',
        mode: 'FLIP',
        durationMs: 1500,
      })
    })

    it('passes a null duration through unchanged', async () => {
      api.getDue.mockResolvedValue([card('a')])
      const cards = useCardsStore()
      await cards.loadDue()

      await cards.submitReview('GOOD', 'MULTIPLE_CHOICE', null)

      expect(api.postReview).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'a', durationMs: null }),
      )
    })

    it('does nothing when the queue is exhausted', async () => {
      const cards = useCardsStore()

      await cards.submitReview('GOOD', 'FLIP', 100)

      expect(api.postReview).not.toHaveBeenCalled()
      expect(cards.cursor).toBe(0)
    })
  })
})
