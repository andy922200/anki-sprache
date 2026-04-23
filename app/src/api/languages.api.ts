import { useAxios } from '@/composables/useAxios'
import type { LanguageDto } from '@/types/domain'

export async function listLanguages(): Promise<LanguageDto[]> {
  const axios = useAxios()
  return (await axios.get<LanguageDto[]>('/languages')).data
}
