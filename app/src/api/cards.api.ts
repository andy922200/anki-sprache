import { useAxios } from '@/composables/useAxios'
import type { CardDto } from '@/types/domain'

export async function getDue(limit = 50): Promise<CardDto[]> {
  const axios = useAxios()
  return (await axios.get<CardDto[]>('/cards/due', { params: { limit } })).data
}

export async function getCard(id: string): Promise<CardDto> {
  const axios = useAxios()
  return (await axios.get<CardDto>(`/cards/${id}`)).data
}

export async function getToday(): Promise<CardDto[]> {
  const axios = useAxios()
  return (await axios.get<CardDto[]>('/cards/today')).data
}

export async function fetchLemmaAudio(cardId: string): Promise<string> {
  const axios = useAxios()
  const res = await axios.post<{ audioUrl: string }>(`/cards/${cardId}/lemma/audio`)
  return res.data.audioUrl
}

export async function fetchExampleAudio(cardId: string, exampleId: string): Promise<string> {
  const axios = useAxios()
  const res = await axios.post<{ audioUrl: string }>(
    `/cards/${cardId}/examples/${exampleId}/audio`,
  )
  return res.data.audioUrl
}
