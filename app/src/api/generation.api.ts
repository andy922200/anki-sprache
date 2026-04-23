import { useAxios } from '@/composables/useAxios'
import type { GenerationStatusDto } from '@/types/domain'

export async function generateToday(
  opts: { force?: boolean } = {},
): Promise<
  | { jobId: string; status: 'queued' }
  | { jobId: null; status: 'already-done'; cardIds: string[] }
> {
  const axios = useAxios()
  return (
    await axios.post(
      '/generate/today',
      {}, // empty object so axios sends Content-Type: application/json
      { params: opts.force ? { force: 'true' } : undefined },
    )
  ).data
}

export async function getStatus(): Promise<GenerationStatusDto> {
  const axios = useAxios()
  return (await axios.get<GenerationStatusDto>('/generate/status')).data
}

export async function generateMore(count = 5): Promise<{ jobId: string; status: 'queued' }> {
  const axios = useAxios()
  return (await axios.post('/generate/more', { count })).data
}
