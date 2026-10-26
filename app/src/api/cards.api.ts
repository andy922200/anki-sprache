import { useAxios } from '@/composables/useAxios'
import type { CardDto } from '@/types/domain'

export async function getDue(): Promise<CardDto[]> {
  const axios = useAxios()
  return (await axios.get<CardDto[]>('/cards/due')).data
}

export async function ensureExamples(cardId: string): Promise<CardDto> {
  const axios = useAxios()
  return (await axios.post<CardDto>(`/cards/${cardId}/examples/ensure`, {})).data
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
  const res = await axios.post<{ audioUrl: string }>(`/audio/lemma/${cardId}`)
  return res.data.audioUrl
}

export async function fetchExampleAudio(exampleId: string): Promise<string> {
  const axios = useAxios()
  const res = await axios.post<{ audioUrl: string }>(`/audio/examples/${exampleId}`)
  return res.data.audioUrl
}
