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
