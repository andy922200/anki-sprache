<script setup lang="ts">
import { useUiStore, type ThemePref } from '@/stores/ui.store'

const ui = useUiStore()

const options: { value: ThemePref; label: string }[] = [
  { value: 'LIGHT', label: '☀' },
  { value: 'SYSTEM', label: '⌘' },
  { value: 'DARK', label: '☾' },
]
</script>

<template>
  <div
    class="inline-flex rounded-lg bg-surface-muted p-0.5 dark:bg-surface-dark-muted"
    role="radiogroup"
    aria-label="Theme"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="px-2.5 py-1 text-sm rounded-md transition"
      :class="
        ui.themePref === opt.value
          ? 'bg-white shadow-sm text-ink dark:bg-surface-dark dark:text-ink-invert'
          : 'text-ink-muted hover:text-ink dark:hover:text-ink-invert'
      "
      :aria-checked="ui.themePref === opt.value"
      role="radio"
      @click="ui.setTheme(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
