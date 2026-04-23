import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import { i18n } from '@/i18n'

const instance: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  timeout: 15_000,
})

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const res = await axios.post<{ accessToken: string }>(
    `${import.meta.env.VITE_API_BASE_URL}/auth/refresh`,
    {},
    { withCredentials: true },
  )
  const auth = useAuthStore()
  auth.setAccessToken(res.data.accessToken)
  return res.data.accessToken
}

instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const auth = useAuthStore()
  if (auth.accessToken) {
    config.headers.set('Authorization', `Bearer ${auth.accessToken}`)
  }
  return config
})

type RetryableConfig = AxiosRequestConfig & { _retry?: boolean }

instance.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const ui = useUiStore()
    const auth = useAuthStore()
    const original = error.config as RetryableConfig | undefined

    if (error.response?.status === 401 && original && !original._retry) {
      if (original.url?.endsWith('/auth/refresh')) {
        auth.clear()
        return Promise.reject(error)
      }
      original._retry = true
      try {
        refreshPromise ??= refreshAccessToken()
        const token = await refreshPromise
        original.headers = original.headers ?? {}
        ;(original.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
        return instance(original)
      } catch (refreshErr) {
        auth.clear()
        return Promise.reject(refreshErr)
      } finally {
        refreshPromise = null
      }
    }

    const status = error.response?.status
    const tr = i18n.global.t
    if (status === 429) {
      ui.toast('error', tr('errors.tooManyRequests'))
    } else if (status && status >= 500) {
      ui.toast('error', tr('errors.serverError'))
    } else if (!error.response) {
      ui.toast('error', tr('errors.networkError'))
    }
    return Promise.reject(error)
  },
)

export function useAxios(): AxiosInstance {
  return instance
}
