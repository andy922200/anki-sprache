<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as reviewsApi from '@/api/reviews.api'
import * as cardsApi from '@/api/cards.api'
import type { CardDto, FsrsRating, ReviewMode, ReviewLogEntry } from '@/types/domain'
import AppCard from '@/components/common/AppCard.vue'
import AppButton from '@/components/common/AppButton.vue'
import FlipCard from '@/components/cards/FlipCard.vue'

const { t } = useI18n()

const entries = ref<ReviewLogEntry[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const ratingFilter = ref<FsrsRating | ''>('')
const modeFilter = ref<ReviewMode | ''>('')

const dialogRef = ref<HTMLDialogElement | null>(null)
const previewCard = ref<CardDto | null>(null)
const previewLoading = ref(false)

// Lock body scroll while the dialog is open. Compensate for the removed
// scrollbar by padding the body so the layout doesn't shift on desktop.
function lockBodyScroll() {
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
  document.body.style.overflow = 'hidden'
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
}

function unlockBodyScroll() {
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
}

async function openPreview(cardId: string) {
  previewCard.value = null
  previewLoading.value = true
  lockBodyScroll()
  dialogRef.value?.showModal()
  try {
    previewCard.value = await cardsApi.getCard(cardId)
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  dialogRef.value?.close()
}

// Single point of cleanup — fires for ESC, .close(), and backdrop click
// (which calls closePreview). Belt-and-braces release on unmount in case
// the user navigates away with the dialog open.
function onDialogClose() {
  previewCard.value = null
  unlockBodyScroll()
}

onBeforeUnmount(() => {
  unlockBodyScroll()
})

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
          class="flex flex-wrap items-baseline justify-between gap-2 py-3 px-2 -mx-2 cursor-pointer rounded transition hover:bg-brand-50 dark:hover:bg-surface-dark-hover"
          role="button"
          tabindex="0"
          @click="openPreview(e.cardId)"
          @keydown.enter.prevent="openPreview(e.cardId)"
          @keydown.space.prevent="openPreview(e.cardId)"
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

    <dialog
      ref="dialogRef"
      class="fixed inset-0 m-auto rounded-card p-0 bg-white shadow-xl backdrop:bg-black/40 dark:bg-surface-dark-muted"
      @click.self="closePreview"
      @close="onDialogClose"
    >
      <div class="p-6 w-[min(36rem,90vw)] max-h-[90vh] overflow-auto">
        <div v-if="previewLoading" class="py-12 text-center text-ink-muted">
          {{ t('common.loading') }}
        </div>
        <FlipCard v-else-if="previewCard" :key="previewCard.id" :card="previewCard" />
        <div class="mt-4 flex justify-end">
          <AppButton variant="secondary" size="sm" @click="closePreview">
            {{ t('common.close') }}
          </AppButton>
        </div>
      </div>
    </dialog>
  </div>
</template>
