<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  block?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  block: false,
})

const classes = computed(() => {
  const base = [
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition cursor-pointer',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  ]
  const sizes: Record<NonNullable<Props['size']>, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-5 py-2.5 text-lg',
  }
  const variants: Record<NonNullable<Props['variant']>, string> = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
    secondary:
      'bg-surface-muted text-ink hover:bg-brand-100 dark:bg-surface-dark-muted dark:text-ink-invert dark:hover:bg-brand-700',
    ghost:
      'text-ink hover:bg-surface-muted dark:text-ink-invert dark:hover:bg-surface-dark-muted',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  }
  return [...base, sizes[props.size], variants[props.variant], props.block ? 'w-full' : ''].join(
    ' ',
  )
})
</script>

<template>
  <button :type="type" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
