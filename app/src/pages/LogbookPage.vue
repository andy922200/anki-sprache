<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as reviewsApi from '@/api/reviews.api'
import type { FsrsRating, ReviewMode, ReviewLogEntry } from '@/types/domain'
import AppCard from '@/components/common/AppCard.vue'
import AppButton from '@/components/common/AppButton.vue'

const { t } = useI18n()

const entries = ref<ReviewLogEntry[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const ratingFilter = ref<FsrsRating | ''>('')
const modeFilter = ref<ReviewMode | ''>('')

async function load(reset: boolean) {
  loading.value = true
  try {
    const page = await reviewsApi.getLogbook({
      limit: 50,
      cursor: reset ? undefined : nextCursor.value ?? undefined,
      rating: ratingFilter.value || undefined,
      mode: modeFilter.value || undefined,
    })
    entries.value = reset ? page.entries : [...entries.value, ...page.entries]
    nextCursor.value = page.nextCursor
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))

const ratingColor: Record<FsrsRating, string> = {
  AGAIN: 'text-red-500',
  HARD: 'text-amber-500',
  GOOD: 'text-emerald-500',
  EASY: 'text-sky-500',
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-4 sm:p-6">
    <h1 class="mb-4 text-2xl font-semibold">{{ t('logbook.title') }}</h1>

    <AppCard padding="sm" class="mb-4">
      <div class="flex flex-wrap gap-3">
        <label class="text-sm">
          {{ t('logbook.filterRating') }}
          <select
            v-model="ratingFilter"
            class="ml-2 rounded-md border border-brand-100 bg-surface-muted px-2 py-1 text-sm dark:bg-surface-dark-muted dark:border-surface-dark-muted"
            @change="load(true)"
          >
            <option value="">{{ t('logbook.all') }}</option>
            <option value="AGAIN">{{ t('rating.again') }}</option>
            <option value="HARD">{{ t('rating.hard') }}</option>
            <option value="GOOD">{{ t('rating.good') }}</option>
            <option value="EASY">{{ t('rating.easy') }}</option>
          </select>
        </label>
        <label class="text-sm">
          {{ t('logbook.filterMode') }}
          <select
            v-model="modeFilter"
            class="ml-2 rounded-md border border-brand-100 bg-surface-muted px-2 py-1 text-sm dark:bg-surface-dark-muted dark:border-surface-dark-muted"
            @change="load(true)"
          >
            <option value="">{{ t('logbook.all') }}</option>
            <option value="FLIP">{{ t('logbook.modeFlip') }}</option>
            <option value="MULTIPLE_CHOICE">{{ t('logbook.modeChoice') }}</option>
          </select>
        </label>
      </div>
    </AppCard>

    <AppCard padding="sm">
      <ul v-if="entries.length" class="divide-y divide-brand-100 dark:divide-surface-dark-muted">
        <li
          v-for="e in entries"
          :key="e.id"
          class="flex flex-wrap items-baseline justify-between gap-2 py-3"
        >
          <div>
            <span class="font-medium">{{ e.lemma }}</span>
            <span class="ml-2 text-sm text-ink-muted">{{ e.translation }}</span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <span :class="ratingColor[e.rating]">{{ t(`rating.${e.rating.toLowerCase()}`) }}</span>
            <span class="text-ink-muted">
              {{ e.mode === 'FLIP' ? t('logbook.modeFlip') : t('logbook.modeChoice') }}
            </span>
            <span class="text-ink-muted">{{ fmtTime(e.reviewedAt) }}</span>
          </div>
        </li>
      </ul>
      <p v-else class="py-8 text-center text-ink-muted">{{ t('logbook.empty') }}</p>
    </AppCard>

    <div v-if="nextCursor" class="mt-4 flex justify-center">
      <AppButton variant="secondary" :disabled="loading" @click="load(false)">
        {{ loading ? t('common.loading') : t('logbook.loadMore') }}
      </AppButton>
    </div>
  </div>
</template>
