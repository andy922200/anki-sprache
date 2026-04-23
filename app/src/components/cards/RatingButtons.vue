<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FsrsRating } from '@/types/domain'

defineEmits<{ rate: [rating: FsrsRating] }>()
const { t } = useI18n()

const options: { value: FsrsRating; i18nKey: string; hotkey: string; className: string }[] = [
  {
    value: 'AGAIN',
    i18nKey: 'rating.again',
    hotkey: '1',
    className: 'bg-red-500 hover:bg-red-600 text-white',
  },
  {
    value: 'HARD',
    i18nKey: 'rating.hard',
    hotkey: '2',
    className: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  {
    value: 'GOOD',
    i18nKey: 'rating.good',
    hotkey: '3',
    className: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  },
  {
    value: 'EASY',
    i18nKey: 'rating.easy',
    hotkey: '4',
    className: 'bg-sky-500 hover:bg-sky-600 text-white',
  },
]
</script>

<template>
  <div class="grid w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="rounded-lg px-4 py-3 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      :class="o.className"
      @click="$emit('rate', o.value)"
    >
      <span class="block text-base">{{ t(o.i18nKey) }}</span>
      <span class="text-xs opacity-80">({{ o.hotkey }})</span>
    </button>
  </div>
</template>
