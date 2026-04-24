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
        class="flip-card-face flip-card-front rounded-card bg-white shadow-md border border-brand-100 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
      >
        <div class="flip-card-content p-8">
          <p v-if="card.gender" class="mb-2 text-sm uppercase tracking-wide text-ink-muted">
            {{ card.gender.toLowerCase() }}
          </p>
          <h2 class="text-4xl font-semibold wrap-break-word">{{ card.lemma }}</h2>
          <p v-if="card.ipa" class="mt-3 text-sm text-ink-muted wrap-break-word">/{{ card.ipa }}/</p>
          <p v-if="card.partOfSpeech" class="mt-2 text-xs uppercase tracking-wider text-ink-muted">
            {{ card.partOfSpeech.toLowerCase() }}
          </p>
          <p class="mt-6 text-sm text-ink-muted">{{ t('flipCard.flipHint') }}</p>
        </div>
      </div>
      <div
        class="flip-card-face flip-card-back rounded-card bg-white shadow-md border border-brand-100 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
      >
        <div class="flip-card-content p-8">
          <p class="mb-2 text-sm uppercase tracking-wide text-ink-muted">{{ t('flipCard.meaning') }}</p>
          <h3 class="text-2xl font-medium wrap-break-word">{{ card.translation }}</h3>
          <div v-if="card.examples.length" class="mt-6">
            <p class="mb-2 text-sm uppercase tracking-wide text-ink-muted">{{ t('flipCard.examples') }}</p>
            <ul class="space-y-3">
              <li v-for="ex in card.examples" :key="ex.id">
                <p class="text-lg wrap-break-word">{{ ex.text }}</p>
                <p class="text-sm text-ink-muted wrap-break-word">{{ ex.translation }}</p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.flip-card {
  perspective: 1200px;
  aspect-ratio: 5 / 3;
  min-height: 360px;
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
    z-index: 1;
  }
}
.flip-card-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}
.flip-card-back {
  transform: rotateY(180deg);
}
</style>
