import { defineStore } from 'pinia'
import axios from 'axios'

export interface AppUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  timezone: string
}

interface AuthState {
  accessToken: string | null
  user: AppUser | null
  hydrated: boolean
}

// Module-scoped so concurrent hydrate() callers share the same in-flight
// promise; keeping it out of state avoids exposing it as a reactive ref.
let hydrationPromise: Promise<void> | null = null

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    accessToken: null,
    user: null,
    hydrated: false,
  }),
  getters: {
    IS_AUTHENTICATED: (state): boolean => !!state.accessToken && !!state.user,
  },
  actions: {
    setAccessToken(token: string | null) {
      this.accessToken = token
    },
    setUser(u: AppUser | null) {
      this.user = u
    },
    clear() {
      this.accessToken = null
      this.user = null
    },
    async hydrate(): Promise<void> {
      if (hydrationPromise) return hydrationPromise
      hydrationPromise = (async () => {
        try {
          const res = await axios.post<{ accessToken: string }>(
            `${import.meta.env.VITE_API_BASE_URL}/auth/refresh`,
            {},
            { withCredentials: true },
          )
          this.accessToken = res.data.accessToken
          const me = await axios.get<AppUser>(`${import.meta.env.VITE_API_BASE_URL}/me`, {
            headers: { Authorization: `Bearer ${this.accessToken}` },
            withCredentials: true,
          })
          this.user = me.data
        } catch {
          this.clear()
        } finally {
          this.hydrated = true
        }
      })()
      return hydrationPromise
    },
  },
})
