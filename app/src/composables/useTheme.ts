import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore, type ThemePref } from '@/stores/ui.store'

const STORAGE_KEY = 'theme'

function getSystemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(pref: ThemePref) {
  const isDark = pref === 'DARK' || (pref === 'SYSTEM' && getSystemPrefersDark())
  document.documentElement.classList.toggle('dark', isDark)
}

export function useTheme() {
  const ui = useUiStore()
  const { themePref } = storeToRefs(ui)

  const stored = localStorage.getItem(STORAGE_KEY) as ThemePref | null
  if (stored) ui.setTheme(stored)
  applyTheme(ui.themePref)

  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', () => {
    if (ui.themePref === 'SYSTEM') applyTheme('SYSTEM')
  })

  watch(themePref, (t) => {
    localStorage.setItem(STORAGE_KEY, t)
    applyTheme(t)
  })
}
