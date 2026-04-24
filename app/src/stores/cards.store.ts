import { defineStore } from 'pinia'
import type { CardDto, FsrsRating, ReviewMode } from '@/types/domain'
import * as cardsApi from '@/api/cards.api'
import * as reviewsApi from '@/api/reviews.api'

interface CardsState {
  queue: CardDto[]
  cursor: number
  loading: boolean
  practiceMode: boolean
}

export const useCardsStore = defineStore('cards', {
  state: (): CardsState => ({
    queue: [],
    cursor: 0,
    loading: false,
    practiceMode: false,
  }),
  getters: {
    CURRENT: (state): CardDto | null => state.queue[state.cursor] ?? null,
    REMAINING: (state): number => Math.max(0, state.queue.length - state.cursor),
  },
  actions: {
    async loadDue(limit = 50) {
      this.loading = true
      this.practiceMode = false
      try {
        this.queue = await cardsApi.getDue(limit)
        this.cursor = 0
      } finally {
        this.loading = false
      }
    },
    async loadToday() {
      this.loading = true
      this.practiceMode = true
      try {
        this.queue = await cardsApi.getToday()
        this.cursor = 0
      } finally {
        this.loading = false
      }
    },
    async submitReview(rating: FsrsRating, mode: ReviewMode, durationMs: number) {
      const card = this.CURRENT
      if (!card) return
      if (!this.practiceMode) {
        await reviewsApi.postReview({ cardId: card.id, rating, mode, durationMs })
      }
      this.cursor++
    },
    reset() {
      this.queue = []
      this.cursor = 0
      this.practiceMode = false
    },
  },
})
