<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-full flex-col items-center justify-center p-8 text-center">
    <h1 class="mb-2 text-5xl font-semibold">{{ t('notFound.title') }}</h1>
    <p class="mb-4 text-ink-muted">{{ t('notFound.message') }}</p>
    <RouterLink class="text-brand-500 underline" to="/">{{ t('notFound.goHome') }}</RouterLink>
  </div>
</template>
