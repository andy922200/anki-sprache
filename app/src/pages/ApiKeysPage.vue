<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppCard from '@/components/common/AppCard.vue'
import AppButton from '@/components/common/AppButton.vue'
import { useUiStore } from '@/stores/ui.store'
import { useSettingsStore } from '@/stores/settings.store'
import * as keysApi from '@/api/llmKeys.api'
import type { LlmProvider, MaskedKeyDto } from '@/types/domain'

const ui = useUiStore()
const settings = useSettingsStore()
const { t } = useI18n()

const providers: LlmProvider[] = ['OPENAI', 'ANTHROPIC', 'GOOGLE']
const providerLabel = computed<Record<LlmProvider, string>>(() => ({
  OPENAI: t('provider.OPENAI'),
  ANTHROPIC: t('provider.ANTHROPIC'),
  GOOGLE: t('provider.GOOGLE'),
}))

const keys = ref<MaskedKeyDto[]>([])
const input = reactive<Record<LlmProvider, string>>({
  OPENAI: '',
  ANTHROPIC: '',
  GOOGLE: '',
})
const busy = ref<LlmProvider | null>(null)
const showOthers = ref(false)

const primaryProvider = computed<LlmProvider | null>(
  () => settings.settings?.preferredLlmProvider ?? null,
)
const otherProviders = computed<LlmProvider[]>(() =>
  providers.filter((p) => p !== primaryProvider.value),
)
const othersWithKeys = computed(
  () => otherProviders.value.filter((p) => current(p)).length,
)

async function load() {
  keys.value = await keysApi.listKeys()
}

onMounted(async () => {
  if (!settings.settings) await settings.load()
  await load()
})

function current(p: LlmProvider) {
  return keys.value.find((k) => k.provider === p)
}

async function save(p: LlmProvider) {
  if (!input[p]) return
  busy.value = p
  try {
    await keysApi.setKey(p, input[p])
    input[p] = ''
    await load()
    ui.toast('success', t('apiKeys.providerSaved', { provider: providerLabel.value[p] }))
  } catch {
    ui.toast('error', t('apiKeys.saveFailed'))
  } finally {
    busy.value = null
  }
}

async function remove(p: LlmProvider) {
  busy.value = p
  try {
    await keysApi.deleteKey(p)
    await load()
    ui.toast('info', t('apiKeys.providerRemoved', { provider: providerLabel.value[p] }))
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 sm:p-6">
    <h1 class="mb-2 text-2xl font-semibold">{{ t('apiKeys.title') }}</h1>
    <p class="mb-6 text-sm text-ink-muted">{{ t('apiKeys.intro') }}</p>

    <template v-if="primaryProvider">
      <div class="mb-3 flex items-center justify-between text-sm">
        <span class="text-ink-muted">
          {{ t('apiKeys.currentPreferred', { provider: providerLabel[primaryProvider] }) }}
        </span>
        <RouterLink class="text-brand-500 underline" to="/settings">
          {{ t('apiKeys.changePreferred') }} →
        </RouterLink>
      </div>

      <AppCard class="mb-4 border-2 border-brand-500">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="font-semibold">🔑 {{ providerLabel[primaryProvider] }}</h2>
            <p v-if="current(primaryProvider)" class="text-sm text-ink-muted">
              {{ t('apiKeys.saved') }} <code>{{ current(primaryProvider)?.keyFingerprint }}</code>
            </p>
            <p v-else class="text-sm text-ink-muted">{{ t('apiKeys.notConfigured') }}</p>
          </div>
          <AppButton
            v-if="current(primaryProvider)"
            variant="danger"
            size="sm"
            :disabled="busy === primaryProvider"
            @click="remove(primaryProvider)"
          >
            {{ t('apiKeys.remove') }}
          </AppButton>
        </div>
        <div class="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            v-model="input[primaryProvider]"
            type="password"
            :placeholder="t('apiKeys.placeholder')"
            class="flex-1 rounded-md border border-border bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-border-dark"
          />
          <AppButton
            :disabled="busy === primaryProvider || !input[primaryProvider]"
            @click="save(primaryProvider)"
          >
            {{ current(primaryProvider) ? t('apiKeys.replace') : t('apiKeys.save') }}
          </AppButton>
        </div>
      </AppCard>
    </template>

    <AppCard v-else class="mb-4">
      <h2 class="font-semibold mb-2">{{ t('apiKeys.noProviderYet') }}</h2>
      <RouterLink class="text-brand-500 underline text-sm" to="/settings">
        {{ t('apiKeys.pickProviderLink') }}
      </RouterLink>
    </AppCard>

    <button
      type="button"
      class="flex w-full items-center justify-between rounded-md border border-border bg-surface-muted px-4 py-2 text-sm dark:border-border-dark dark:bg-surface-dark-muted"
      @click="showOthers = !showOthers"
    >
      <span>
        {{ showOthers ? t('apiKeys.hideOthers') : t('apiKeys.showOthers') }}
        {{ t('apiKeys.othersCount', { count: othersWithKeys }) }}
      </span>
      <span aria-hidden="true">{{ showOthers ? '▾' : '▸' }}</span>
    </button>

    <div v-if="showOthers" class="mt-3 space-y-4">
      <AppCard v-for="p in otherProviders" :key="p">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="font-semibold">{{ providerLabel[p] }}</h2>
            <p v-if="current(p)" class="text-sm text-ink-muted">
              {{ t('apiKeys.saved') }} <code>{{ current(p)?.keyFingerprint }}</code>
            </p>
            <p v-else class="text-sm text-ink-muted">{{ t('apiKeys.notConfigured') }}</p>
          </div>
          <AppButton
            v-if="current(p)"
            variant="danger"
            size="sm"
            :disabled="busy === p"
            @click="remove(p)"
          >
            {{ t('apiKeys.remove') }}
          </AppButton>
        </div>
        <div class="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            v-model="input[p]"
            type="password"
            :placeholder="t('apiKeys.placeholder')"
            class="flex-1 rounded-md border border-border bg-surface-muted px-3 py-2 dark:bg-surface-dark-muted dark:border-border-dark"
          />
          <AppButton :disabled="busy === p || !input[p]" @click="save(p)">
            {{ current(p) ? t('apiKeys.replace') : t('apiKeys.save') }}
          </AppButton>
        </div>
      </AppCard>
    </div>
  </div>
</template>
