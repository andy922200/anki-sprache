<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui.store'

interface Props {
  initialUrl: string | null
  fetcher: () => Promise<string>
  size?: 'sm' | 'md'
  label?: string
}
const props = withDefaults(defineProps<Props>(), {
  size: 'sm',
  label: undefined,
})

defineExpose({ play })

const { t } = useI18n()
const ui = useUiStore()

const currentUrl = ref<string | null>(props.initialUrl)
const isLoading = ref(false)
const isPlaying = ref(false)

let audio: HTMLAudioElement | null = null

watch(
  () => props.initialUrl,
  (next) => {
    currentUrl.value = next
    stopAndRelease()
  },
)

onUnmounted(() => {
  stopAndRelease()
})

function stopAndRelease() {
  if (audio) {
    // Strip handlers first so the upcoming pause / src reset doesn't fire a
    // spurious onerror that we'd surface as a toast to the user.
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.src = ''
    audio = null
  }
  isPlaying.value = false
}

function isInterruption(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')
}

async function play() {
  if (isLoading.value) return
  if (isPlaying.value) {
    stopAndRelease()
    return
  }

  try {
    if (!currentUrl.value) {
      isLoading.value = true
      ui.beginBusy(t('card.audio.generating'), 'card.audio.subtext', true)
      try {
        currentUrl.value = await props.fetcher()
      } finally {
        ui.endBusy()
      }
    }
    audio = new Audio(currentUrl.value)
    audio.onended = () => {
      isPlaying.value = false
    }
    audio.onerror = () => {
      isPlaying.value = false
      ui.toast('error', t('card.audio.error'))
    }
    isPlaying.value = true
    await audio.play()
  } catch (err) {
    isPlaying.value = false
    if (!isInterruption(err)) ui.toast('error', t('card.audio.error'))
  } finally {
    isLoading.value = false
  }
}

const sizeClass = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-base',
}
</script>

<template>
  <button
    type="button"
    :class="[
      'inline-flex items-center justify-center rounded-full transition',
      'bg-surface-muted hover:bg-brand-100 text-ink',
      'dark:bg-surface-dark-muted dark:hover:bg-brand-700 dark:text-ink-invert',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      sizeClass[size],
      isPlaying ? 'bg-brand-100 dark:bg-brand-700' : '',
    ]"
    :disabled="isLoading"
    :aria-label="label ?? t('card.audio.play')"
    :title="isLoading ? t('card.audio.generating') : label ?? t('card.audio.play')"
    @click.stop="play"
    @keydown.space.stop
    @keydown.enter.stop
  >
    <span v-if="isLoading" class="inline-block animate-spin">⏳</span>
    <span v-else>🔊</span>
  </button>
</template>
