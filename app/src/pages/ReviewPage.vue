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

onMounted(async () => {
  if (isPractice.value) {
    await cards.loadToday()
  } else if (cards.queue.length === 0) {
    await cards.loadDue(50)
  }
  startedAt.value = Date.now()
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
})

async function rate(rating: FsrsRating) {
  if (!cards.CURRENT) return
  const durationMs = Date.now() - startedAt.value
  try {
    await cards.submitReview(rating, mode.value, durationMs)
    startedAt.value = Date.now()
    lastChoiceCorrect.value = null
  } catch {
    ui.toast('error', t('review.saveFailed'))
  }
}

function onChoose(correct: boolean) {
  lastChoiceCorrect.value = correct
}

function onKey(e: KeyboardEvent) {
  if (mode.value === 'FLIP' || lastChoiceCorrect.value !== null) {
    if (e.key === '1') rate('AGAIN')
    if (e.key === '2') rate('HARD')
    if (e.key === '3') rate('GOOD')
    if (e.key === '4') rate('EASY')
  }
}

const distractors = computed(() =>
  cards.queue.filter((c) => c.id !== cards.CURRENT?.id).slice(0, 8),
)
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col items-center gap-6 p-4 pt-10 sm:p-6">
    <div v-if="cards.CURRENT" class="flex w-full flex-col items-center gap-6">
      <p class="text-sm text-ink-muted">
        <span v-if="cards.practiceMode" class="mr-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-700 dark:text-brand-50">
          {{ t('review.practiceBadge') }}
        </span>
        {{ t('review.remaining', { count: cards.REMAINING }) }}
      </p>
      <FlipCard v-if="mode === 'FLIP'" :card="cards.CURRENT" />
      <MultipleChoice
        v-else
        :card="cards.CURRENT"
        :distractors="distractors"
        @choose="onChoose"
      />
      <RatingButtons
        v-if="mode === 'FLIP' || lastChoiceCorrect !== null"
        @rate="rate"
      />
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
