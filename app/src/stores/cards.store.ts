import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CardDto, FsrsRating, ReviewMode } from '@/types/domain'
import * as cardsApi from '@/api/cards.api'
import * as reviewsApi from '@/api/reviews.api'

export const useCardsStore = defineStore('cards', () => {
  const queue = ref<CardDto[]>([])
  const cursor = ref(0)
  const loading = ref(false)
  // In practice mode we drill the same deck without touching FSRS state.
  const practiceMode = ref(false)

  const current = computed<CardDto | null>(() => queue.value[cursor.value] ?? null)
  const remaining = computed(() => Math.max(0, queue.value.length - cursor.value))

  async function loadDue(limit = 50) {
    loading.value = true
    practiceMode.value = false
    try {
      queue.value = await cardsApi.getDue(limit)
      cursor.value = 0
    } finally {
      loading.value = false
    }
  }

  async function loadToday() {
    loading.value = true
    practiceMode.value = true
    try {
      queue.value = await cardsApi.getToday()
      cursor.value = 0
    } finally {
      loading.value = false
    }
  }

  async function submitReview(rating: FsrsRating, mode: ReviewMode, durationMs: number) {
    const card = current.value
    if (!card) return
    // Practice mode: skip the server call so FSRS scheduling stays intact.
    if (!practiceMode.value) {
      await reviewsApi.postReview({ cardId: card.id, rating, mode, durationMs })
    }
    cursor.value++
  }

  function reset() {
    queue.value = []
    cursor.value = 0
    practiceMode.value = false
  }

  return {
    queue,
    cursor,
    current,
    remaining,
    loading,
    practiceMode,
    loadDue,
    loadToday,
    submitReview,
    reset,
  }
})
