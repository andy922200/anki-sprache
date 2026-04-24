<script setup lang="ts">
import axios from 'axios'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppCard from '@/components/common/AppCard.vue'
import AppButton from '@/components/common/AppButton.vue'
import LlmSetupCard from '@/components/common/LlmSetupCard.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useUiStore } from '@/stores/ui.store'
import * as generationApi from '@/api/generation.api'
import * as cardsApi from '@/api/cards.api'
import * as llmKeysApi from '@/api/llmKeys.api'
import type { GenerationStatusDto, CardDto, LlmProvider, MaskedKeyDto } from '@/types/domain'

const auth = useAuthStore()
const settings = useSettingsStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const status = ref<GenerationStatusDto | null>(null)
const dueCount = ref(0)
const todayPreview = ref<CardDto[]>([])
const busy = ref(false)
const keys = ref<MaskedKeyDto[]>([])

const preferredProvider = computed<LlmProvider | null>(
  () => settings.settings?.preferredLlmProvider ?? null,
)

const setupMissing = computed<'provider' | 'key' | null>(() => {
  if (!settings.settings) return null
  if (!preferredProvider.value) return 'provider'
  const hasKey = keys.value.some((k) => k.provider === preferredProvider.value)
  return hasKey ? null : 'key'
})

async function refresh() {
  const [s, due, k] = await Promise.all([
    generationApi.getStatus(),
    cardsApi.getDue(100),
    llmKeysApi.listKeys(),
  ])
  status.value = s
  dueCount.value = due.length
  todayPreview.value = due.slice(0, 5)
  keys.value = k
}

onMounted(async () => {
  await settings.load()
  await refresh()
})

const POLL_INTERVAL_MS = 1500
// Cap the user-facing wait at ~15s (10 × 1.5s). The BullMQ job may keep
// running in the background; we tell the user to refresh rather than spin.
const POLL_MAX_ATTEMPTS = 10

async function onGenerate(force = false) {
  if (force) {
    const ok = window.confirm(
      t('dashboard.regenerateConfirm', { count: settings.settings?.dailyNewCount ?? 5 }),
    )
    if (!ok) return
  }
  busy.value = true
  ui.beginBusy(t(force ? 'generation.regenerating' : 'generation.generating'))
  try {
    const res = await generationApi.generateToday({ force })
    if (res.status === 'already-done') {
      ui.toast('info', t('dashboard.deckAlreadySet'))
    } else {
      // lastError can fire transiently while BullMQ retries the job. Keep
      // polling until we see `done: true`, which means DailyGenerationLog
      // was committed — the authoritative signal that cards exist.
      let finalStatus: GenerationStatusDto | null = null
      let observedTransientError: string | null = null
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        finalStatus = await generationApi.getStatus()
        if (finalStatus.done) break
        if (finalStatus.lastError) observedTransientError = finalStatus.lastError
      }
      if (finalStatus?.done) {
        ui.toast('success', t('dashboard.generated', { count: finalStatus.cardIds.length }))
      } else if (observedTransientError || finalStatus?.lastError) {
        ui.toast(
          'error',
          t('dashboard.generationFailed', {
            error: finalStatus?.lastError ?? observedTransientError ?? 'unknown',
          }),
        )
      } else {
        ui.toast('info', t('dashboard.generationStillRunning'))
      }
    }
    await refresh()
  } catch (err) {
    console.error('Generation error:', err)
    if (axios.isAxiosError(err)) {
      const status = err.response?.status
      const msg = String(err.response?.data?.message ?? '')
      if (status === 400 && msg.startsWith('LLM_PROVIDER_NOT_SET')) {
        ui.toast('error', t('dashboard.pickProvider'))
      } else if (status === 400 && msg.startsWith('LLM_API_KEY_MISSING')) {
        ui.toast('error', t('dashboard.addKey'))
      } else if (status === 429) {
        // interceptor already toasted
      } else if (status) {
        ui.toast('error', t('dashboard.generationStatusError', { status, message: msg || 'server error' }))
      } else {
        ui.toast('error', t('dashboard.generationNetworkError'))
      }
      await refresh()
    } else {
      ui.toast('error', t('dashboard.generationFailed', { error: err instanceof Error ? err.message : 'unknown' }))
    }
  } finally {
    busy.value = false
    ui.endBusy()
  }
}

function onStart(mode: 'FLIP' | 'MULTIPLE_CHOICE') {
  const modeParam = mode === 'MULTIPLE_CHOICE' ? 'choice' : 'flip'
  router.push({ name: 'review', query: { mode: modeParam } })
}

function onPractice() {
  router.push({ name: 'review', query: { mode: 'flip', practice: 'true' } })
}

async function onGenerateMore() {
  busy.value = true
  ui.beginBusy(t('dashboard.generateMoreQueued'))
  try {
    await generationApi.generateMore(5)
    ui.toast('success', t('dashboard.generateMoreQueued'))
    // Poll until new cards show up (log.cardIds length grows)
    const before = status.value?.cardIds.length ?? 0
    let grew = false
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      const s = await generationApi.getStatus()
      if (s.done && s.cardIds.length > before) {
        ui.toast('success', t('dashboard.generated', { count: s.cardIds.length - before }))
        grew = true
        break
      }
    }
    if (!grew) ui.toast('info', t('dashboard.generationStillRunning'))
    await refresh()
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg = String(err.response?.data?.message ?? '')
      if (msg.startsWith('LLM_PROVIDER_NOT_SET')) {
        ui.toast('error', t('dashboard.pickProvider'))
      } else if (msg.startsWith('LLM_API_KEY_MISSING')) {
        ui.toast('error', t('dashboard.addKey'))
      } else {
        ui.toast('error', t('dashboard.generationFailed', { error: msg || 'error' }))
      }
    } else {
      ui.toast('error', t('dashboard.generationFailed', { error: 'unknown' }))
    }
  } finally {
    busy.value = false
    ui.endBusy()
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-4 sm:p-6">
    <AppCard padding="lg" class="mb-6">
      <h1 class="text-2xl font-semibold">
        {{ t('dashboard.greeting', { name: auth.user?.displayName ?? 'learner' }) }}
      </h1>
      <p class="mt-1 text-sm text-ink-muted">
        {{ t('dashboard.target') }}: <strong>{{ settings.settings?.targetLanguageCode ?? '—' }}</strong> ·
        {{ t('dashboard.level') }}: <strong>{{ settings.settings?.cefrLevel ?? '—' }}</strong> ·
        {{ t('dashboard.dailyNew') }}: <strong>{{ settings.settings?.dailyNewCount ?? '—' }}</strong>
      </p>
    </AppCard>

    <LlmSetupCard
      v-if="setupMissing"
      class="mb-6"
      :missing="setupMissing"
      :preferred-provider="preferredProvider"
    />

    <AppCard v-if="!status?.done" class="mb-6">
      <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold">
            {{ t('dashboard.todayWords', { count: settings.settings?.dailyNewCount ?? 5 }) }}
          </h2>
          <p class="text-sm text-ink-muted">{{ t('dashboard.generatePrompt') }}</p>
        </div>
        <AppButton :disabled="!!setupMissing || busy" @click="onGenerate(false)">
          {{ t('dashboard.generateBtn') }}
        </AppButton>
      </div>
    </AppCard>

    <AppCard v-else class="mb-6">
      <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex-1">
          <h2 class="text-lg font-semibold">{{ t('dashboard.todayDeck') }}</h2>
          <p class="mt-1 text-sm text-ink-muted">
            {{
              status.provider
                ? t('dashboard.deckSummaryWithProvider', {
                    count: status.cardIds.length,
                    provider: status.provider,
                  })
                : t('dashboard.deckSummary', { count: status.cardIds.length })
            }}
          </p>
        </div>
        <AppButton
          variant="secondary"
          size="sm"
          :disabled="!!setupMissing || busy"
          @click="onGenerate(true)"
        >
          {{ t('dashboard.regenerate') }}
        </AppButton>
      </div>
    </AppCard>

    <AppCard class="mb-6">
      <h2 class="text-lg font-semibold">{{ t('dashboard.dueNow') }}</h2>
      <p class="mt-1 text-sm text-ink-muted">
        {{ t('dashboard.cardsReady', dueCount, { named: { count: dueCount } }) }}
      </p>
      <div v-if="dueCount > 0" class="mt-4 flex flex-wrap gap-2">
        <AppButton @click="onStart('FLIP')">{{ t('dashboard.startFlip') }}</AppButton>
        <AppButton variant="secondary" @click="onStart('MULTIPLE_CHOICE')">
          {{ t('dashboard.multipleChoice') }}
        </AppButton>
      </div>
      <div v-else-if="status?.done && status.cardIds.length > 0" class="mt-4">
        <p class="mb-3 text-sm text-ink-muted">{{ t('dashboard.caughtUp') }}</p>
        <div class="flex flex-wrap gap-2">
          <AppButton variant="secondary" :disabled="busy" @click="onPractice">
            {{ t('dashboard.practiceAgain') }}
          </AppButton>
          <AppButton variant="ghost" :disabled="!!setupMissing || busy" @click="onGenerateMore">
            {{ busy ? t('common.loading') : t('dashboard.generateMore', { count: 5 }) }}
          </AppButton>
        </div>
      </div>
    </AppCard>

    <AppCard v-if="todayPreview.length">
      <h2 class="mb-3 text-lg font-semibold">{{ t('dashboard.preview') }}</h2>
      <ul class="divide-y divide-brand-100 dark:divide-surface-dark-muted">
        <li v-for="c in todayPreview" :key="c.id" class="py-3 flex justify-between">
          <span class="font-medium">
            <span v-if="c.gender" class="text-ink-muted mr-1">{{ c.gender.toLowerCase() }}</span>
            {{ c.lemma }}
          </span>
          <span class="text-ink-muted">{{ c.translation }}</span>
        </li>
      </ul>
    </AppCard>
  </div>
</template>
