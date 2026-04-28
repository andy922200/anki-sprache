<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store'
import * as authApi from '@/api/auth.api'
import ThemeToggle from '@/components/common/ThemeToggle.vue'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

async function onLogout() {
  try {
    await authApi.logout()
  } finally {
    auth.clear()
    router.push({ name: 'login' })
  }
}
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-brand-100 bg-white/80 backdrop-blur dark:bg-surface-dark/80 dark:border-surface-dark-muted"
  >
    <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
      <RouterLink to="/" class="flex items-center gap-2 text-lg font-semibold">
        <span class="text-brand-500">Anki</span>
        <span class="text-ink-muted">·</span>
        <span>Sprache</span>
      </RouterLink>
      <nav class="hidden gap-1 sm:flex">
        <RouterLink to="/" class="rounded-md px-3 py-1.5 text-sm hover:bg-surface-muted dark:hover:bg-surface-dark-muted" active-class="text-brand-500">{{ t('header.today') }}</RouterLink>
        <RouterLink to="/logbook" class="rounded-md px-3 py-1.5 text-sm hover:bg-surface-muted dark:hover:bg-surface-dark-muted" active-class="text-brand-500">{{ t('header.logbook') }}</RouterLink>
        <RouterLink to="/settings" class="rounded-md px-3 py-1.5 text-sm hover:bg-surface-muted dark:hover:bg-surface-dark-muted" active-class="text-brand-500">{{ t('header.settings') }}</RouterLink>
      </nav>
      <div class="flex items-center gap-3">
        <ThemeToggle />
        <img
          v-if="auth.user?.avatarUrl"
          :src="auth.user.avatarUrl"
          class="h-8 w-8 rounded-full"
          :alt="auth.user.displayName"
        />
        <button
          type="button"
          class="text-sm text-ink-muted hover:text-ink dark:hover:text-ink-invert"
          @click="onLogout"
        >
          {{ t('header.logout') }}
        </button>
      </div>
    </div>
  </header>

  <!-- Mobile bottom tab bar — mirrors the desktop nav. App.vue adds matching
       bottom padding to <main> so content isn't hidden behind it. -->
  <nav
    class="fixed inset-x-0 bottom-0 z-40 flex border-t border-brand-100 bg-white/95 backdrop-blur sm:hidden dark:bg-surface-dark/95 dark:border-surface-dark-muted"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <RouterLink
      to="/"
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-ink-muted transition active:bg-surface-muted dark:active:bg-surface-dark-muted"
      active-class="!text-brand-500"
    >
      <span class="text-xl leading-none">🏠</span>
      <span>{{ t('header.today') }}</span>
    </RouterLink>
    <RouterLink
      to="/logbook"
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-ink-muted transition active:bg-surface-muted dark:active:bg-surface-dark-muted"
      active-class="!text-brand-500"
    >
      <span class="text-xl leading-none">📓</span>
      <span>{{ t('header.logbook') }}</span>
    </RouterLink>
    <RouterLink
      to="/settings"
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-ink-muted transition active:bg-surface-muted dark:active:bg-surface-dark-muted"
      active-class="!text-brand-500"
    >
      <span class="text-xl leading-none">⚙️</span>
      <span>{{ t('header.settings') }}</span>
    </RouterLink>
  </nav>
</template>
