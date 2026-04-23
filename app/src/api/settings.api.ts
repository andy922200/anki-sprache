import { useAxios } from '@/composables/useAxios'
import type { UserSettingsDto } from '@/types/domain'

export async function getSettings(): Promise<UserSettingsDto> {
  const axios = useAxios()
  return (await axios.get<UserSettingsDto>('/me/settings')).data
}

export async function patchSettings(patch: Partial<UserSettingsDto>): Promise<UserSettingsDto> {
  const axios = useAxios()
  return (await axios.patch<UserSettingsDto>('/me/settings', patch)).data
}
