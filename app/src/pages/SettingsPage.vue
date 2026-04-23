<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppCard from '@/components/common/AppCard.vue'
import AppButton from '@/components/common/AppButton.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useUiStore } from '@/stores/ui.store'
import * as usersApi from '@/api/users.api'
import * as languagesApi from '@/api/languages.api'
import type { LanguageDto, CEFR, LlmProvider, UiLanguage, UserSettingsDto } from '@/types/domain'

const auth = useAuthStore()
const settings = useSettingsStore()
const ui = useUiStore()
const { t } = useI18n()

const languages = ref<LanguageDto[]>([])
const displayName = ref('')
const timezone = ref('UTC')
const draft = ref<UserSettingsDto | null>(null)
const saving = ref(false)

const cefrOptions: CEFR[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const providerOptions: (LlmProvider | '')[] = ['', 'OPENAI', 'ANTHROPIC', 'GOOGLE']
const uiLanguageOptions: { value: UiLanguage; label: string }[] = [
  { value: 'EN', label: 'English' },
  { value: 'ZH_TW', label: '繁體中文' },
]

const defaultModelsByProvider: Record<LlmProvider, string> = {
  OPENAI: 'gpt-4o-mini',
  ANTHROPIC: 'claude-sonnet-4-6',
  GOOGLE: 'gemini-2.5-flash',
}

const defaultModelForProvider = computed(() => {
  const p = draft.value?.preferredLlmProvider
  return p ? defaultModelsByProvider[p] : 'provider default'
})

const modelPlaceholder = computed(() => {
  const p = draft.value?.preferredLlmProvider
  return p ? defaultModelsByProvider[p] : 'Pick a provider first'
})

onMounted(async () => {
  languages.value = await languagesApi.listLanguages()
  await settings.load()
  if (settings.settings) draft.value = { ...settings.settings }
  if (auth.user) {
    displayName.value = auth.user.displayName
    timezone.value = auth.user.timezone
  }
})

async function save() {
  saving.value = true
  try {
    if (auth.user) {
      if (displayName.value !== auth.user.displayName || timezone.value !== auth.user.timezone) {
        const updated = await usersApi.patchMe({ displayName: displayName.value, timezone: timezone.value })
        auth.setUser(updated)
      }
    }
    if (draft.value) {
      await settings.update({
        targetLanguageCode: draft.value.targetLanguageCode,
        nativeLanguageCode: draft.value.nativeLanguageCode,
        cefrLevel: draft.value.cefrLevel,
        dailyNewCount: draft.value.dailyNewCount,
        preferredLlmProvider: draft.value.preferredLlmProvider || null,
        preferredLlmModel: draft.value.preferredLlmModel || null,
        uiLanguage: draft.value.uiLanguage,
      })
    }
    ui.toast('success', t('settings.saved'))
  } catch {
    ui.toast('error', t('settings.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 sm:p-6">
    <h1 class="mb-4 text-2xl font-semibold">{{ t('settings.title') }}</h1>

    <AppCard class="mb-6">
      <h2 class="mb-3 text-lg font-semibold">{{ t('settings.profile') }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm">
          {{ t('settings.displayName') }}
          <input
            v-model="displayName"
            type="text"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          />
        </label>
        <label class="text-sm">
          {{ t('settings.timezone') }}
          <input
            v-model="timezone"
            type="text"
            :placeholder="t('settings.timezoneHint')"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          />
        </label>
      </div>
    </AppCard>

    <AppCard v-if="draft" class="mb-6">
      <h2 class="mb-3 text-lg font-semibold">{{ t('settings.preferences') }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm">
          {{ t('settings.uiLanguage') }}
          <select
            v-model="draft.uiLanguage"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          >
            <option v-for="opt in uiLanguageOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
      </div>
    </AppCard>

    <AppCard v-if="draft" class="mb-6">
      <h2 class="mb-3 text-lg font-semibold">{{ t('settings.learning') }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm">
          {{ t('settings.targetLanguage') }}
          <select
            v-model="draft.targetLanguageCode"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          >
            <option v-for="l in languages.filter((x) => x.enabled)" :key="l.code" :value="l.code">
              {{ l.name }} ({{ l.nativeName }})
            </option>
          </select>
        </label>
        <label class="text-sm">
          {{ t('settings.nativeLanguage') }}
          <select
            v-model="draft.nativeLanguageCode"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          >
            <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.name }}</option>
          </select>
        </label>
        <label class="text-sm">
          {{ t('settings.cefrLevel') }}
          <select
            v-model="draft.cefrLevel"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          >
            <option v-for="c in cefrOptions" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="text-sm">
          {{ t('settings.dailyNewCount') }}
          <input
            v-model.number="draft.dailyNewCount"
            type="number"
            min="1"
            max="30"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          />
        </label>
      </div>
    </AppCard>

    <AppCard v-if="draft" class="mb-6">
      <h2 class="mb-3 text-lg font-semibold">{{ t('settings.llm') }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm">
          {{ t('settings.preferredProvider') }}
          <select
            v-model="draft.preferredLlmProvider"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          >
            <option v-for="p in providerOptions" :key="p || 'none'" :value="p || null">
              {{ p ? t(`provider.${p}`) : t('common.none') }}
            </option>
          </select>
        </label>
        <label class="text-sm">
          {{ t('settings.model', { optional: t('common.optional') }) }}
          <input
            v-model="draft.preferredLlmModel"
            type="text"
            :placeholder="modelPlaceholder"
            class="mt-1 w-full rounded-md border border-brand-100 bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
          />
          <span class="mt-1 block text-xs text-ink-muted">
            {{ t('settings.modelHint', { default: defaultModelForProvider }) }}
          </span>
        </label>
      </div>
      <p class="mt-3 text-sm text-ink-muted">
        {{ t('settings.manageKeys') }}
        <RouterLink class="text-brand-500 underline" to="/settings/api-keys">
          {{ t('settings.apiKeysLink') }}
        </RouterLink>.
        {{ t('settings.modelDocsHint') }}
      </p>
    </AppCard>

    <div class="flex justify-end">
      <AppButton :disabled="saving" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </AppButton>
    </div>
  </div>
</template>
