<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { LlmProvider } from '@/types/domain'
import AppCard from './AppCard.vue'

interface Props {
  missing: 'provider' | 'key'
  preferredProvider: LlmProvider | null
}
defineProps<Props>()
const { t } = useI18n()

const providerInfo = computed<Record<LlmProvider, { label: string; url: string; hint: string }>>(() => ({
  OPENAI: {
    label: t('provider.OPENAI'),
    url: 'https://platform.openai.com/api-keys',
    hint: 'platform.openai.com/api-keys',
  },
  ANTHROPIC: {
    label: t('provider.ANTHROPIC'),
    url: 'https://console.anthropic.com/settings/keys',
    hint: 'console.anthropic.com/settings/keys',
  },
  GOOGLE: {
    label: t('provider.GOOGLE'),
    url: 'https://aistudio.google.com/app/apikey',
    hint: 'aistudio.google.com/app/apikey',
  },
}))
</script>

<template>
  <AppCard>
    <div class="flex items-start gap-3">
      <div
        class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300"
        aria-hidden="true"
      >
        !
      </div>
      <div class="flex-1">
        <h2 class="text-lg font-semibold">{{ t('llmSetup.title') }}</h2>

        <template v-if="missing === 'provider'">
          <p class="mt-1 text-sm text-ink-muted">
            {{ t('llmSetup.missingProviderIntro') }}
          </p>
          <ol class="mt-3 ml-5 list-decimal space-y-1 text-sm">
            <li>{{ t('llmSetup.grabKey') }}</li>
          </ol>
          <ul class="mt-2 space-y-2 text-sm">
            <li v-for="(info, p) in providerInfo" :key="p">
              <a
                :href="info.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-brand-500 underline"
              >{{ info.label }}</a>
              <span class="text-ink-muted"> — {{ info.hint }}</span>
            </li>
          </ul>
          <ol start="2" class="mt-3 ml-5 list-decimal space-y-1 text-sm">
            <li>
              <RouterLink to="/settings/api-keys" class="text-brand-500 underline">
                {{ t('llmSetup.pasteYourKey') }}
              </RouterLink>
              {{ t('llmSetup.pasteYourKeyHint') }}
            </li>
            <li>
              <RouterLink to="/settings" class="text-brand-500 underline">
                {{ t('llmSetup.pickProvider') }}
              </RouterLink>
              {{ t('llmSetup.pickProviderHint') }}
            </li>
          </ol>
        </template>

        <template v-else>
          <p class="mt-1 text-sm text-ink-muted">
            {{
              t('llmSetup.missingKeyIntro', {
                provider: preferredProvider ? providerInfo[preferredProvider].label : '—',
              })
            }}
          </p>
          <p class="mt-2 text-sm">
            <a
              v-if="preferredProvider"
              :href="providerInfo[preferredProvider].url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-brand-500 underline"
            >{{ t('llmSetup.getKey', { provider: providerInfo[preferredProvider].label }) }}</a>
            <span class="text-ink-muted"> — </span>
            <RouterLink to="/settings/api-keys" class="text-brand-500 underline">
              {{ t('llmSetup.thenPaste') }}
            </RouterLink>
            .
          </p>
          <p v-if="preferredProvider" class="mt-2 text-sm text-ink-muted">
            {{ providerInfo[preferredProvider].hint }}
          </p>
        </template>
      </div>
    </div>
  </AppCard>
</template>
