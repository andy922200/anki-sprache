import { defineStore } from 'pinia'
import axios from 'axios'
import { computed, ref } from 'vue'

export interface AppUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  timezone: string
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const user = ref<AppUser | null>(null)
  // Only flips to true once the first hydrate() attempt has finished —
  // whether it succeeded or failed. Use this to gate UI rendering.
  const hydrated = ref(false)
  let hydrationPromise: Promise<void> | null = null

  const isAuthenticated = computed(() => !!accessToken.value && !!user.value)

  function setAccessToken(token: string | null) {
    accessToken.value = token
  }
  function setUser(u: AppUser | null) {
    user.value = u
  }
  function clear() {
    accessToken.value = null
    user.value = null
  }

  async function hydrate(): Promise<void> {
    // Concurrent callers share the same promise so none of them observe
    // an in-between state where `hydrated` is true but user is still null.
    if (hydrationPromise) return hydrationPromise
    hydrationPromise = (async () => {
      try {
        const res = await axios.post<{ accessToken: string }>(
          `${import.meta.env.VITE_API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        )
        accessToken.value = res.data.accessToken
        const me = await axios.get<AppUser>(`${import.meta.env.VITE_API_BASE_URL}/me`, {
          headers: { Authorization: `Bearer ${accessToken.value}` },
          withCredentials: true,
        })
        user.value = me.data
      } catch {
        clear()
      } finally {
        hydrated.value = true
      }
    })()
    return hydrationPromise
  }

  return {
    accessToken,
    user,
    hydrated,
    isAuthenticated,
    setAccessToken,
    setUser,
    clear,
    hydrate,
  }
})
