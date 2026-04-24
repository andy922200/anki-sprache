import { defineStore } from 'pinia'

export type ThemePref = 'LIGHT' | 'DARK' | 'SYSTEM'
export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface UiState {
  themePref: ThemePref
  toasts: Toast[]
  isBusy: boolean
  busyLabel: string | null
}

// Module-scoped: monotonically increasing toast id; no need to be reactive.
let nextToastId = 1

export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    themePref: 'SYSTEM',
    toasts: [],
    isBusy: false,
    busyLabel: null,
  }),
  actions: {
    setTheme(t: ThemePref) {
      this.themePref = t
    },
    toast(kind: ToastKind, message: string, ttlMs = 4000) {
      const id = nextToastId++
      this.toasts.push({ id, kind, message })
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, ttlMs)
    },
    dismiss(id: number) {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },
    beginBusy(label: string) {
      this.isBusy = true
      this.busyLabel = label
    },
    endBusy() {
      this.isBusy = false
      this.busyLabel = null
    },
  },
})
