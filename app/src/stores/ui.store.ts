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
  busySubtextKey: string | null
  busyQuiet: boolean
}

// Module-scoped: monotonically increasing toast id; no need to be reactive.
let nextToastId = 1

export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    themePref: 'SYSTEM',
    toasts: [],
    isBusy: false,
    busyLabel: null,
    busySubtextKey: null,
    busyQuiet: false,
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
    beginBusy(label: string, subtextKey?: string, quiet = false) {
      this.isBusy = true
      this.busyLabel = label
      this.busySubtextKey = subtextKey ?? null
      this.busyQuiet = quiet
    },
    endBusy() {
      this.isBusy = false
      this.busyLabel = null
      this.busySubtextKey = null
      this.busyQuiet = false
    },
  },
})
