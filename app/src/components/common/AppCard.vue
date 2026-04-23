<script setup lang="ts">
interface Props {
  padding?: 'sm' | 'md' | 'lg'
}
withDefaults(defineProps<Props>(), { padding: 'md' })
</script>

<template>
  <div
    class="rounded-card bg-white shadow-sm border border-brand-100 dark:bg-surface-dark-muted dark:border-surface-dark-muted"
    :class="{
      'p-4': padding === 'sm',
      'p-6': padding === 'md',
      'p-8': padding === 'lg',
    }"
  >
    <slot />
  </div>
</template>
