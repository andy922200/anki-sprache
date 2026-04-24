import { defineStore } from 'pinia'
import type { UserSettingsDto } from '@/types/domain'
import * as settingsApi from '@/api/settings.api'
import { setLocaleFromEnum } from '@/i18n'

interface SettingsState {
  settings: UserSettingsDto | null
  loading: boolean
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    settings: null,
    loading: false,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        this.settings = await settingsApi.getSettings()
        if (this.settings.uiLanguage) {
          setLocaleFromEnum(this.settings.uiLanguage)
        }
      } finally {
        this.loading = false
      }
    },
    async update(patch: Partial<UserSettingsDto>) {
      this.settings = await settingsApi.patchSettings(patch)
      if (patch.uiLanguage) {
        setLocaleFromEnum(patch.uiLanguage)
      }
    },
  },
})
