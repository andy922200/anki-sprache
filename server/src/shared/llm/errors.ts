export type LlmErrorCode =
  | 'LLM_PROVIDER_NOT_SET'
  | 'LLM_RATE_LIMITED'
  | 'LLM_API_KEY_INVALID'
  | 'LLM_QUOTA_EXCEEDED'
  | 'LLM_UPSTREAM_ERROR'
  | 'LLM_INVALID_RESPONSE'
  | 'EXAMPLES_GENERATION_IN_PROGRESS'

/**
 * Carries the code in `message` (same convention as `httpErrors.badRequest('LLM_…')`)
 * so the frontend matches on `message.startsWith(...)`. 424 for upstream failures keeps
 * them distinct from our own 429 rate limit, which triggers the generic toast.
 */
export class LlmRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: LlmErrorCode | `LLM_API_KEY_MISSING:${string}`,
  ) {
    super(message)
    this.name = 'LlmRequestError'
  }
}

export function toLlmRequestError(err: unknown): LlmRequestError {
  if (err instanceof LlmRequestError) return err
  const status = (err as { status?: number } | null)?.status
  if (status === 429) return new LlmRequestError(424, 'LLM_RATE_LIMITED')
  if (status === 401 || status === 403) return new LlmRequestError(424, 'LLM_API_KEY_INVALID')
  if (status === 402) return new LlmRequestError(424, 'LLM_QUOTA_EXCEEDED')
  return new LlmRequestError(424, 'LLM_UPSTREAM_ERROR')
}
