import { z } from 'zod'
import { isValidTimezone } from '@/shared/time/timezone.js'

export const timezoneSchema = z
  .string()
  .min(1)
  .max(50)
  .refine(isValidTimezone, { error: 'Must be an IANA timezone name such as Asia/Taipei, or UTC' })
