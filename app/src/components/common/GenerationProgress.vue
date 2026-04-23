<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  label?: string
}
const props = defineProps<Props>()
const { t } = useI18n()
const displayLabel = computed(() => props.label ?? t('generation.generating'))

const elapsedSec = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  const startedAt = Date.now()
  timer = setInterval(() => {
    elapsedSec.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 500)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// Heuristic: generation usually completes within ~25s including LLM retries.
// Cap display progress at 95% while we wait for the server.
const progressPct = computed(() => Math.min(95, Math.floor((elapsedSec.value / 25) * 100)))
</script>

<template>
  <div
    class="rounded-card border border-brand-100 bg-white p-6 shadow-sm dark:bg-surface-dark-muted dark:border-surface-dark-muted"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-3">
      <span class="spinner" aria-hidden="true" />
      <div class="flex-1">
        <p class="font-medium">{{ displayLabel }}</p>
        <p class="mt-1 text-sm text-ink-muted">
          {{ t('generation.subtext', { seconds: elapsedSec }) }}
        </p>
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
</template>

<style lang="scss" scoped>
.spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid currentColor;
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
