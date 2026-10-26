import { isDev } from '@/config/env.config.js'

const perHour = (dev: number, prod: number) =>
  ({ max: isDev ? dev : prod, timeWindow: '1 hour' }) as const
const perMinute = (max: number) => ({ max, timeWindow: '1 minute' }) as const

/** Mirrors the rate-limit table in .agents/guides/security.md; routes pick their entry from here. */
export const RATE_LIMITS = {
  global: perMinute(300),
  authGoogle: perMinute(10),
  authRefresh: perMinute(60),
  reviews: perMinute(120),
  audio: perHour(200, 60),
  examplesEnsure: perHour(120, 30),
  generateToday: perHour(60, 5),
  generateMore: perHour(60, 10),
}
