<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui.store'

const ui = useUiStore()
const { t } = useI18n()

const elapsedSec = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

watch(
  () => ui.isBusy,
  (busy) => {
    if (busy) {
      elapsedSec.value = 0
      const startedAt = Date.now()
      timer = setInterval(() => {
        elapsedSec.value = Math.floor((Date.now() - startedAt) / 1000)
      }, 500)
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  },
  { immediate: true },
)

const progressPct = computed(() => Math.min(95, Math.floor((elapsedSec.value / 25) * 100)))
const label = computed(() => ui.busyLabel ?? t('generation.generating'))
const subtext = computed(() =>
  t(ui.busySubtextKey ?? 'generation.subtext', { seconds: elapsedSec.value }),
)
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="ui.isBusy"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      :class="ui.busyQuiet ? 'bg-transparent cursor-progress' : 'bg-black/40 backdrop-blur-sm'"
      role="status"
      aria-live="polite"
      aria-busy="true"
      :aria-label="label"
      @keydown.stop
      @keyup.stop
      @keypress.stop
    >
      <div
        v-if="!ui.busyQuiet"
        class="w-full max-w-sm rounded-card border border-border bg-white p-6 shadow-lg dark:border-border-dark dark:bg-surface-dark-muted"
      >
        <div class="flex items-center gap-3">
          <span class="spinner" aria-hidden="true" />
          <div class="flex-1">
            <p class="font-medium">{{ label }}</p>
            <p class="mt-1 text-sm text-ink-muted">{{ subtext }}</p>
          </div>
        </div>
        <div
          class="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-surface-dark"
          aria-hidden="true"
        >
          <div
            class="h-full bg-brand-500 transition-[width] duration-500 ease-out"
            :style="{ width: `${progressPct}%` }"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.spinner {
  display: inline-block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  color: var(--color-brand-500);
  animation: spin 0.9s linear infinite;
  flex-shrink: 0;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
