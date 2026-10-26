<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCardsStore } from '@/stores/cards.store'
import { useUiStore } from '@/stores/ui.store'
import type { FsrsRating, ReviewMode } from '@/types/domain'
import FlipCard from '@/components/cards/FlipCard.vue'
import MultipleChoice from '@/components/cards/MultipleChoice.vue'
import RatingButtons from '@/components/cards/RatingButtons.vue'
import AppButton from '@/components/common/AppButton.vue'

const route = useRoute()
const router = useRouter()
const cards = useCardsStore()
const ui = useUiStore()
const { t } = useI18n()

const mode = computed<ReviewMode>(() =>
  route.query.mode === 'choice' ? 'MULTIPLE_CHOICE' : 'FLIP',
)
const isPractice = computed(() => route.query.practice === 'true')

const startedAt = ref(Date.now())
const lastChoiceCorrect = ref<boolean | null>(null)
const flipCardRef = ref<InstanceType<typeof FlipCard> | null>(null)

onMounted(async () => {
  if (isPractice.value) {
    await cards.loadToday()
  } else if (!cards.CURRENT) {
    // Queue may be non-empty but fully consumed (cursor past end) from a
    // previous session — treat that the same as empty and refetch.
    await cards.loadDue()
  }
  await cards.prepareCurrent()
  startedAt.value = Date.now()
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
})

const blocked = computed(() => cards.ensuring || !!cards.llmErrorKey)
const needsSetup = computed(
  () =>
    cards.llmErrorKey === 'errors.llmProviderNotSet' ||
    cards.llmErrorKey === 'errors.llmApiKeyMissing',
)

async function rate(rating: FsrsRating) {
  if (!cards.CURRENT || blocked.value) return
  const durationMs = Date.now() - startedAt.value
  try {
    await cards.submitReview(rating, mode.value, durationMs)
    lastChoiceCorrect.value = null
    await cards.prepareCurrent()
    startedAt.value = Date.now()
  } catch {
    ui.toast('error', t('review.saveFailed'))
  }
}

function onChoose(correct: boolean) {
  lastChoiceCorrect.value = correct
}

async function retry() {
  await cards.retryLlm()
  startedAt.value = Date.now()
}

function onKey(e: KeyboardEvent) {
  if (blocked.value) return
  if (mode.value === 'FLIP' || lastChoiceCorrect.value !== null) {
    if (e.key === '1') rate('AGAIN')
    if (e.key === '2') rate('HARD')
    if (e.key === '3') rate('GOOD')
    if (e.key === '4') rate('EASY')
  }
  if (e.key === 'p' || e.key === 'P') {
    flipCardRef.value?.playLemma()
  }
}

const distractors = computed(() =>
  cards.queue.filter((c) => c.id !== cards.CURRENT?.id).slice(0, 8),
)
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col items-center gap-6 p-4 pt-10 md:p-6">
    <div
      v-if="cards.CURRENT && cards.llmErrorKey"
      class="flex flex-col items-center gap-3 text-center"
      role="alert"
    >
      <p class="text-ink-muted">{{ t(cards.llmErrorKey, { provider: '' }) }}</p>
      <div class="flex gap-2">
        <AppButton v-if="needsSetup" @click="router.push({ name: 'settings' })">
          {{ t('review.goSettings') }}
        </AppButton>
        <AppButton v-else @click="retry">{{ t('review.retry') }}</AppButton>
        <AppButton variant="secondary" @click="router.push({ name: 'dashboard' })">
          {{ t('review.backDashboard') }}
        </AppButton>
      </div>
    </div>
    <div v-else-if="cards.CURRENT && cards.ensuring" class="flex flex-col items-center gap-3">
      <span class="spinner" aria-hidden="true" />
      <p class="text-ink-muted">{{ t('review.preparing') }}</p>
    </div>
    <div v-else-if="cards.CURRENT" class="flex w-full flex-col items-center gap-6">
      <p class="text-sm text-ink-muted">
        <span
          v-if="cards.practiceMode"
          class="mr-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-700 dark:text-brand-50"
        >
          {{ t('review.practiceBadge') }}
        </span>
        {{ t('review.remaining', { count: cards.REMAINING }) }}
      </p>
      <FlipCard v-if="mode === 'FLIP'" ref="flipCardRef" :card="cards.CURRENT" />
      <MultipleChoice v-else :card="cards.CURRENT" :distractors="distractors" @choose="onChoose" />
      <RatingButtons v-if="mode === 'FLIP' || lastChoiceCorrect !== null" @rate="rate" />
    </div>
    <div v-else class="flex flex-col items-center gap-3 text-center">
      <h2 class="text-xl font-semibold">{{ t('review.allDone') }}</h2>
      <p class="text-ink-muted">{{ t('review.comeBack') }}</p>
      <AppButton @click="router.push({ name: 'dashboard' })">
        {{ t('review.backDashboard') }}
      </AppButton>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.spinner {
  display: inline-block;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid currentColor;
  border-top-color: transparent;
  color: var(--color-brand-500);
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
