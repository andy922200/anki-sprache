import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { i18n } from '@/i18n'

export interface TimezoneOption {
  /** What gets stored: an IANA name (or `UTC`), never a fixed offset, so daylight saving still applies. */
  value: string
  /** `(GMT+08:00) Taiwan Standard Time - Taipei`, localized to the UI language. */
  label: string
  /** Offset at the time the options were built; the sort key. */
  offsetMinutes: number
  /** The stored value is not a usable timezone; shown so the select doesn't lie, but not pickable. */
  unknown?: boolean
}

// Same rule as `isValidTimezone` in server/src/shared/time/timezone.ts: keep the two in step.
const IANA_SHAPE = /^[A-Z][A-Za-z0-9_+-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/

export function isIanaTimezone(value: string): boolean {
  if (value === 'UTC') return true
  if (!IANA_SHAPE.test(value) || value.startsWith('Etc/')) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function partValue(
  timeZone: string,
  locale: string,
  timeZoneName: 'long' | 'longOffset',
  at: Date,
): string {
  return (
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? ''
  )
}

function offsetMinutesOf(timeZone: string, at: Date): number {
  // en-US so the "GMT+08:00" shape is the same whatever the UI language is.
  const match = /([+-])(\d{2}):?(\d{2})/.exec(partValue(timeZone, 'en-US', 'longOffset', at))
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `GMT${minutes < 0 ? '-' : '+'}${hh}:${mm}`
}

// The zone's own name does not separate Berlin from Paris ("Central European Standard Time"),
// so the city from the IANA id is appended.
function cityOf(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replaceAll('_', ' ')
}

export function buildTimezoneOption(timeZone: string, locale: string, at: Date): TimezoneOption {
  const offsetMinutes = offsetMinutesOf(timeZone, at)
  const name = partValue(timeZone, locale, 'long', at)
  const city = timeZone === 'UTC' ? '' : ` - ${cityOf(timeZone)}`
  return {
    value: timeZone,
    label: `(${formatOffset(offsetMinutes)}) ${name}${city}`,
    offsetMinutes,
  }
}

/** Every timezone the browser knows, plus `UTC`, ordered by current offset then label. */
export function buildTimezoneOptions(locale: string, at: Date = new Date()): TimezoneOption[] {
  // `UTC` is the stored default but the engine's list omits it.
  const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')]
  return zones
    .map((zone) => buildTimezoneOption(zone, locale, at))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label, locale))
}

/**
 * Options for a timezone `<select>`, in the current UI language.
 *
 * `current` is the value already stored. When it is not in the list: a valid IANA alias gets a
 * normal option of its own, anything else (e.g. a legacy "UTC+8") is added first as a disabled
 * "unknown" entry, so the select shows what is really stored instead of silently showing the
 * first option.
 */
export function useTimezoneOptions(current: MaybeRefOrGetter<string>) {
  const options = computed<TimezoneOption[]>(() => {
    const locale = i18n.global.locale.value
    const list = buildTimezoneOptions(locale)
    const value = toValue(current)
    if (!value || list.some((o) => o.value === value)) return list
    if (isIanaTimezone(value)) {
      const alias = buildTimezoneOption(value, locale, new Date())
      return [...list, alias].sort(
        (a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label, locale),
      )
    }
    const unknown: TimezoneOption = {
      value,
      label: i18n.global.t('settings.timezoneUnknown', { value }),
      offsetMinutes: Number.NEGATIVE_INFINITY,
      unknown: true,
    }
    return [unknown, ...list]
  })
  return { options }
}
