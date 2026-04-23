<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CardDto } from '@/types/domain'

interface Props {
  card: CardDto
}
const props = defineProps<Props>()
const { t } = useI18n()

const flipped = ref(false)

watch(
  () => props.card.id,
  () => {
    flipped.value = false
  },
)
</script>

<template>
  <div
    class="flip-card w-full max-w-xl select-none"
    :class="{ 'is-flipped': flipped }"
    role="button"
    tabindex="0"
    @click="flipped = !flipped"
    @keydown.space.prevent="flipped = !flipped"
    @keydown.enter.prevent="flipped = !flipped"
  >
    <div class="flip-card-inner">
      <div
        class="flip-card-face flip-card-front rounded-card bg-white p-8 shadow-md border border-brand-100 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
      >
        <p v-if="card.gender" class="mb-2 text-sm uppercase tracking-wide text-ink-muted">
          {{ card.gender.toLowerCase() }}
        </p>
        <h2 class="text-4xl font-semibold">{{ card.lemma }}</h2>
        <p v-if="card.ipa" class="mt-3 text-sm text-ink-muted">/{{ card.ipa }}/</p>
        <p v-if="card.partOfSpeech" class="mt-2 text-xs uppercase tracking-wider text-ink-muted">
          {{ card.partOfSpeech.toLowerCase() }}
        </p>
        <p class="mt-6 text-sm text-ink-muted">{{ t('flipCard.flipHint') }}</p>
      </div>
      <div
        class="flip-card-face flip-card-back rounded-card bg-white p-8 shadow-md border border-brand-100 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
      >
        <p class="mb-2 text-sm uppercase tracking-wide text-ink-muted">{{ t('flipCard.meaning') }}</p>
        <h3 class="text-2xl font-medium">{{ card.translation }}</h3>
        <div v-if="card.examples.length" class="mt-6">
          <p class="mb-2 text-sm uppercase tracking-wide text-ink-muted">{{ t('flipCard.examples') }}</p>
          <ul class="space-y-3">
            <li v-for="ex in card.examples" :key="ex.id">
              <p class="text-lg">{{ ex.text }}</p>
              <p class="text-sm text-ink-muted">{{ ex.translation }}</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.flip-card {
  perspective: 1200px;
  aspect-ratio: 5 / 3;
  cursor: pointer;
}
.flip-card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
  transform-style: preserve-3d;
}
.flip-card.is-flipped .flip-card-inner {
  transform: rotateY(180deg);
}
.flip-card-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  overflow: hidden;
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), transparent 50%);
    pointer-events: none;
  }
  &::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 4px;
    background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.06), transparent);
    pointer-events: none;
  }
}
.flip-card-back {
  transform: rotateY(180deg);
}
</style>
