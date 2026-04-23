import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserSettingsDto } from '@/types/domain'
import * as settingsApi from '@/api/settings.api'
import { setLocaleFromEnum } from '@/i18n'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<UserSettingsDto | null>(null)
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      settings.value = await settingsApi.getSettings()
      if (settings.value.uiLanguage) {
        setLocaleFromEnum(settings.value.uiLanguage)
      }
    } finally {
      loading.value = false
    }
  }

  async function update(patch: Partial<UserSettingsDto>) {
    settings.value = await settingsApi.patchSettings(patch)
    if (patch.uiLanguage) {
      setLocaleFromEnum(patch.uiLanguage)
    }
  }

  return { settings, loading, load, update }
})
