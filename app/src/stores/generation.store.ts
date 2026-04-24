import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import * as generationApi from '@/api/generation.api'
import type { GenerationStatusDto } from '@/types/domain'
import { useUiStore } from './ui.store'

const POLL_INTERVAL_MS = 3000
const LAST_SEEN_UPGRADE_KEY = 'upgrade:lastSeenCompletedAt'

interface GenerationState {
  status: GenerationStatusDto | null
  pollingActive: boolean
}

// Module-scoped: timer handle doesn't need to be reactive.
let pollTimer: ReturnType<typeof setTimeout> | null = null

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_UPGRADE_KEY)
  } catch {
    return null
  }
}

function writeLastSeen(value: string): void {
  try {
    localStorage.setItem(LAST_SEEN_UPGRADE_KEY, value)
  } catch {
    // ignore storage failures
  }
}

export const useGenerationStore = defineStore('generation', {
  state: (): GenerationState => ({
    status: null,
    pollingActive: false,
  }),
  getters: {
    UPGRADE_IN_FLIGHT: (state): boolean => state.status?.upgradeInFlight === true,
  },
  actions: {
    async refresh(): Promise<GenerationStatusDto | null> {
      try {
        const next = await generationApi.getStatus()
        this.handleTransition(this.status, next)
        this.status = next
        return next
      } catch {
        return null
      }
    },
    handleTransition(
      prev: GenerationStatusDto | null,
      next: GenerationStatusDto,
    ): void {
      const result = next.lastUpgradeResult
      if (!result) return

      const wasInFlight = prev?.upgradeInFlight === true
      const nowIdle = next.upgradeInFlight === false
      const lastSeen = readLastSeen()
      const isNewResult = lastSeen !== result.completedAt

      if (!isNewResult) return
      // Only announce when we actually observed the flight finish OR the
      // store was just hydrated and we're seeing a fresh result for the first
      // time on this client.
      if (!nowIdle) return
      if (prev && !wasInFlight && !this.pollingActive) {
        // Stale result from before this client loaded — persist anchor so we
        // don't re-notify on next refresh, but skip the toast.
        writeLastSeen(result.completedAt)
        return
      }

      const ui = useUiStore()
      const { t } = i18n.global
      if (result.failed > 0) {
        ui.toast(
          'error',
          t('settings.upgradePartialSummary', {
            upgraded: result.upgraded,
            failed: result.failed,
            skipped: result.skipped,
            error: result.firstErrorReason ?? 'unknown',
          }),
          8000,
        )
      } else {
        ui.toast(
          'success',
          t('settings.upgradeSuccessSummary', {
            upgraded: result.upgraded,
            skipped: result.skipped,
          }),
          6000,
        )
      }
      writeLastSeen(result.completedAt)
    },
    startUpgradePolling() {
      if (this.pollingActive) return
      this.pollingActive = true
      const tick = async () => {
        if (!this.pollingActive) return
        const next = await this.refresh()
        if (!this.pollingActive) return
        if (next && !next.upgradeInFlight) {
          this.pollingActive = false
          pollTimer = null
          return
        }
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
      }
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
    },
    stopPolling() {
      this.pollingActive = false
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
    },
    async bootstrap() {
      const next = await this.refresh()
      if (next?.upgradeInFlight) {
        this.startUpgradePolling()
      }
    },
    reset() {
      this.stopPolling()
      this.status = null
    },
  },
})
