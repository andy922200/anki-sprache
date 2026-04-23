import { useAxios } from '@/composables/useAxios'
import type { AppUser } from '@/stores/auth.store'

export async function googleLogin(idToken: string): Promise<{ accessToken: string; user: AppUser }> {
  const axios = useAxios()
  const res = await axios.post<{ accessToken: string; user: AppUser }>('/auth/google', { idToken })
  return res.data
}

export async function logout(): Promise<void> {
  const axios = useAxios()
  await axios.post('/auth/logout')
}
