import { useAxios } from '@/composables/useAxios'
import type { LlmProvider, MaskedKeyDto } from '@/types/domain'

export async function listKeys(): Promise<MaskedKeyDto[]> {
  const axios = useAxios()
  return (await axios.get<MaskedKeyDto[]>('/me/llm-keys')).data
}

export async function setKey(provider: LlmProvider, apiKey: string): Promise<MaskedKeyDto> {
  const axios = useAxios()
  return (await axios.put<MaskedKeyDto>(`/me/llm-keys/${provider}`, { apiKey })).data
}

export async function deleteKey(provider: LlmProvider): Promise<void> {
  const axios = useAxios()
  await axios.delete(`/me/llm-keys/${provider}`)
}
