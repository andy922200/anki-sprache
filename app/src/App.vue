<script setup lang="ts">
import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { useGenerationStore } from '@/stores/generation.store'
import { useTheme } from '@/composables/useTheme'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppToast from '@/components/common/AppToast.vue'
import GlobalBusyOverlay from '@/components/common/GlobalBusyOverlay.vue'

const auth = useAuthStore()
const generation = useGenerationStore()
useTheme()
// Kick off hydration eagerly. The router's beforeEach guard also awaits
// the same promise, so this just warms it up before navigation runs.
void auth.hydrate()

watch(
  () => auth.IS_AUTHENTICATED,
  (isAuth) => {
    if (isAuth) void generation.bootstrap()
    else generation.reset()
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="!auth.hydrated" class="flex min-h-full items-center justify-center">
    <span class="spinner" aria-label="Loading" />
  </div>
  <div v-else class="flex min-h-full flex-col">
    <AppHeader v-if="auth.IS_AUTHENTICATED" />
    <main class="flex-1">
      <RouterView />
    </main>
    <AppToast />
    <GlobalBusyOverlay />
  </div>
</template>

<style lang="scss" scoped>
.spinner {
  display: inline-block;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid currentColor;
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
