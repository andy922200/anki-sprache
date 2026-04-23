import { useAxios } from '@/composables/useAxios'
import type { FsrsRating, ReviewMode, LogbookPage } from '@/types/domain'

export interface SubmitReviewInput {
  cardId: string
  rating: FsrsRating
  mode: ReviewMode
  durationMs: number
}

export async function postReview(input: SubmitReviewInput) {
  const axios = useAxios()
  return (
    await axios.post<{
      state: { due: string; stability: number; difficulty: number; state: string }
      nextDueInMinutes: number
    }>('/reviews', input)
  ).data
}

export async function getLogbook(opts: {
  limit?: number
  cursor?: string
  rating?: FsrsRating
  mode?: ReviewMode
}): Promise<LogbookPage> {
  const axios = useAxios()
  return (await axios.get<LogbookPage>('/reviews/logbook', { params: opts })).data
}
