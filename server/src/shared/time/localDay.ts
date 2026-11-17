import { dayjs } from './dayjs.js'

// An invalid IANA name makes dayjs's Intl lookup throw; user-supplied timezones fall back to UTC.
function inZone(tz: string, at: Date) {
  try {
    return dayjs(at).tz(tz)
  } catch {
    return dayjs(at).tz('UTC')
  }
}

/** [start, end) of the calendar day containing `now` in `tz`. */
export function localDayRange(tz: string, now: Date): { start: Date; end: Date } {
  const start = inZone(tz, now).startOf('day')
  return { start: start.toDate(), end: start.add(1, 'day').startOf('day').toDate() }
}

/** `YYYY-MM-DD` of `now` in `tz`. */
export function localDateFor(tz: string, now: Date): string {
  return inZone(tz, now).format('YYYY-MM-DD')
}

/** Hour of day (0-23) of `now` in `tz`. */
export function localHourFor(tz: string, now: Date): number {
  return inZone(tz, now).hour()
}
