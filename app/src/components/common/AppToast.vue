<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui.store'

const ui = useUiStore()
const { toasts } = storeToRefs(ui)
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto rounded-lg px-4 py-2 shadow-md text-sm"
        :class="{
          'bg-red-500 text-white': t.kind === 'error',
          'bg-emerald-500 text-white': t.kind === 'success',
          'bg-surface-muted text-ink dark:bg-surface-dark-muted dark:text-ink-invert': t.kind === 'info',
        }"
        @click="ui.dismiss(t.id)"
      >
        {{ t.message }}
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
