<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CardDto } from '@/types/domain'

interface Props {
  card: CardDto
  distractors: CardDto[]
}
const props = defineProps<Props>()
const emit = defineEmits<{ choose: [correct: boolean] }>()

const chosen = ref<string | null>(null)

const options = computed(() => {
  const pool = [props.card, ...props.distractors.slice(0, 3)]
  return shuffle(pool).map((c) => ({ id: c.id, translation: c.translation }))
})

watch(
  () => props.card.id,
  () => {
    chosen.value = null
  },
)

function pick(id: string) {
  if (chosen.value) return
  chosen.value = id
  emit('choose', id === props.card.id)
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
</script>

<template>
  <div class="w-full max-w-xl space-y-6">
    <div
      class="rounded-card bg-white p-8 text-center shadow-md border border-brand-100 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
    >
      <p v-if="card.gender" class="mb-2 text-sm uppercase tracking-wide text-ink-muted">
        {{ card.gender.toLowerCase() }}
      </p>
      <h2 class="text-4xl font-semibold">{{ card.lemma }}</h2>
      <p v-if="card.ipa" class="mt-2 text-sm text-ink-muted">/{{ card.ipa }}/</p>
    </div>
    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-for="opt in options" :key="opt.id">
        <button
          type="button"
          class="w-full rounded-lg border px-4 py-3 text-left transition hover:border-brand-500 disabled:cursor-not-allowed"
          :class="{
            'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40':
              chosen === opt.id && opt.id === card.id,
            'border-red-500 bg-red-50 dark:bg-red-950/40':
              chosen === opt.id && opt.id !== card.id,
            'border-brand-100 dark:border-surface-dark-muted':
              chosen !== opt.id,
          }"
          :disabled="!!chosen"
          @click="pick(opt.id)"
        >
          {{ opt.translation }}
        </button>
      </li>
    </ul>
  </div>
</template>
