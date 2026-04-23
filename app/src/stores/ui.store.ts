import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemePref = 'LIGHT' | 'DARK' | 'SYSTEM'
export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export const useUiStore = defineStore('ui', () => {
  const themePref = ref<ThemePref>('SYSTEM')
  const toasts = ref<Toast[]>([])
  let nextToastId = 1

  function setTheme(t: ThemePref) {
    themePref.value = t
  }

  function toast(kind: ToastKind, message: string, ttlMs = 4000) {
    const id = nextToastId++
    toasts.value.push({ id, kind, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, ttlMs)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { themePref, toasts, setTheme, toast, dismiss }
})
