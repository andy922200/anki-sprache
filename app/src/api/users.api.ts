import { useAxios } from '@/composables/useAxios'
import type { AppUser } from '@/stores/auth.store'

export async function getMe(): Promise<AppUser> {
  const axios = useAxios()
  return (await axios.get<AppUser>('/me')).data
}

export async function patchMe(patch: Partial<Pick<AppUser, 'displayName' | 'timezone'>>): Promise<AppUser> {
  const axios = useAxios()
  return (await axios.patch<AppUser>('/me', patch)).data
}
