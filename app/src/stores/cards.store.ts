import { defineStore } from 'pinia'
import axios from 'axios'
import type { CardDto, FsrsRating, ReviewMode } from '@/types/domain'
import * as cardsApi from '@/api/cards.api'
import * as reviewsApi from '@/api/reviews.api'
import { i18n } from '@/i18n'
import { useUiStore } from '@/stores/ui.store'

interface CardsState {
  queue: CardDto[]
  cursor: number
  loading: boolean
  practiceMode: boolean
  ensuring: boolean
  // i18n key of the LLM failure that halted the review; null while healthy.
  llmErrorKey: string | null
}

const LLM_ERROR_KEYS: Record<string, string> = {
  LLM_RATE_LIMITED: 'errors.llmRateLimited',
  LLM_API_KEY_INVALID: 'errors.llmApiKeyInvalid',
  LLM_QUOTA_EXCEEDED: 'errors.llmQuotaExceeded',
  LLM_UPSTREAM_ERROR: 'errors.llmUpstreamError',
  LLM_INVALID_RESPONSE: 'errors.llmUpstreamError',
  LLM_PROVIDER_NOT_SET: 'errors.llmProviderNotSet',
  LLM_API_KEY_MISSING: 'errors.llmApiKeyMissing',
  EXAMPLES_GENERATION_IN_PROGRESS: 'errors.examplesInProgress',
}

const PREFETCH_AHEAD = 2

// Module-level: not reactive state, just de-dupes concurrent ensure calls per card.
const ensuringCardIds = new Set<string>()

const needsExamples = (c: CardDto): boolean =>
  !c.translation || c.examples.length === 0 || c.examples.some((e) => !e.translation)

export const useCardsStore = defineStore('cards', {
  state: (): CardsState => ({
    queue: [],
    cursor: 0,
    loading: false,
    practiceMode: false,
    ensuring: false,
    llmErrorKey: null,
  }),
  getters: {
    CURRENT: (state): CardDto | null => state.queue[state.cursor] ?? null,
    REMAINING: (state): number => Math.max(0, state.queue.length - state.cursor),
  },
  actions: {
    async loadDue() {
      this.loading = true
      this.practiceMode = false
      this.llmErrorKey = null
      try {
        this.queue = await cardsApi.getDue()
        this.cursor = 0
      } finally {
        this.loading = false
      }
    },
    async loadToday() {
      this.loading = true
      this.practiceMode = true
      this.llmErrorKey = null
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
    async ensureCard(index: number): Promise<boolean> {
      const card = this.queue[index]
      if (!card || !needsExamples(card)) return true
      if (ensuringCardIds.has(card.id)) return true
      ensuringCardIds.add(card.id)
      try {
        const fresh = await cardsApi.ensureExamples(card.id)
        const at = this.queue.findIndex((c) => c.id === card.id)
        if (at >= 0) this.queue[at] = fresh
        return true
      } catch (err) {
        this.haltOnLlmError(err)
        return false
      } finally {
        ensuringCardIds.delete(card.id)
      }
    },
    // Blocks on the current card, then fills the next few in the background.
    // Any LLM failure halts the whole chain until the user retries or leaves.
    async prepareCurrent() {
      if (this.llmErrorKey || !this.CURRENT) return
      this.ensuring = true
      try {
        if (!(await this.ensureCard(this.cursor))) return
      } finally {
        this.ensuring = false
      }
      void this.prefetchAhead()
    },
    async prefetchAhead() {
      for (let i = 1; i <= PREFETCH_AHEAD; i++) {
        if (this.llmErrorKey) return
        const idx = this.cursor + i
        if (idx >= this.queue.length) return
        if (!(await this.ensureCard(idx))) return
      }
    },
    retryLlm() {
      this.llmErrorKey = null
      return this.prepareCurrent()
    },
    haltOnLlmError(err: unknown) {
      const res = axios.isAxiosError(err) ? err.response : undefined
      const message = String(res?.data?.message ?? '')
      const [code = '', detail = ''] = message.split(':')
      const key = LLM_ERROR_KEYS[code]
      if (!key) {
        // Not LLM-origin (our own 429, 5xx, network): the axios interceptor already toasted.
        this.llmErrorKey = res?.status === 429 ? 'errors.tooManyRequests' : 'errors.serverError'
        return
      }
      this.llmErrorKey = key
      useUiStore().toast('error', i18n.global.t(key, { provider: detail }), 6000)
    },
    reset() {
      this.queue = []
      this.cursor = 0
      this.practiceMode = false
      this.ensuring = false
      this.llmErrorKey = null
    },
  },
})
