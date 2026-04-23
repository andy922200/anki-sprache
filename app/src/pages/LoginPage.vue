<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import * as authApi from '@/api/auth.api'
import AppCard from '@/components/common/AppCard.vue'
import ThemeToggle from '@/components/common/ThemeToggle.vue'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const buttonEl = ref<HTMLDivElement | null>(null)
const loading = ref(false)

onMounted(() => {
  if (!window.google?.accounts?.id) {
    ui.toast('error', t('login.scriptNotLoaded'))
    return
  }
  window.google.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: async (response: google.accounts.id.CredentialResponse) => {
      if (!response.credential) return
      loading.value = true
      try {
        const { accessToken, user } = await authApi.googleLogin(response.credential)
        auth.setAccessToken(accessToken)
        auth.setUser(user)
        const next = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
        router.push(next)
      } catch {
        ui.toast('error', t('login.failed'))
      } finally {
        loading.value = false
      }
    },
  })
  if (buttonEl.value) {
    window.google.accounts.id.renderButton(buttonEl.value, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      width: 280,
    })
  }
})
</script>

<template>
  <div class="flex min-h-[calc(100vh-0)] flex-col">
    <div class="flex items-center justify-end p-4">
      <ThemeToggle />
    </div>
    <div class="flex flex-1 items-center justify-center px-4">
      <AppCard padding="lg" class="w-full max-w-md text-center">
        <h1 class="mb-2 text-3xl font-semibold">
          <span class="text-brand-500">Anki</span>
          <span class="text-ink-muted">·</span>
          Sprache
        </h1>
        <p class="mb-6 text-sm text-ink-muted">{{ t('login.subtitle') }}</p>
        <div class="flex justify-center">
          <div ref="buttonEl" />
        </div>
        <p v-if="loading" class="mt-4 text-sm text-ink-muted">{{ t('login.signingIn') }}</p>
      </AppCard>
    </div>
  </div>
</template>
