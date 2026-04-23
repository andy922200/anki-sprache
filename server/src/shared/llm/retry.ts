const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

interface WithStatus {
  status?: number
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as WithStatus & { code?: string; name?: string }
  if (typeof e.status === 'number' && RETRYABLE_STATUSES.has(e.status)) return true
  // Network-level problems
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'EAI_AGAIN') return true
  return false
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  onAttempt?: (attempt: number, err: unknown) => void
}

export async function retryable<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseDelay = opts.baseDelayMs ?? 1000
  const maxDelay = opts.maxDelayMs ?? 10_000

  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i === attempts - 1 || !isRetryable(err)) throw err
      opts.onAttempt?.(i + 1, err)
      const delay = Math.min(baseDelay * Math.pow(3, i), maxDelay)
      const jitter = Math.floor(Math.random() * 250)
      await new Promise((r) => setTimeout(r, delay + jitter))
    }
  }
  throw lastErr
}
