// Stored timezones are IANA names (or the literal `UTC`), never fixed offsets: an offset
// like +01:00 cannot follow daylight saving, so "today" would drift by an hour twice a year.
//
// Validity is "Intl accepts it and it has the Area/Location shape" rather than membership in
// `Intl.supportedValuesOf('timeZone')`: that list names zones the way the engine's ICU does
// (Node 24 lists `Asia/Calcutta` but not `Asia/Kolkata`), so it differs between a browser and
// this server and would reject a value the browser's own picker produced.
const IANA_SHAPE = /^[A-Z][A-Za-z0-9_+-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/

export function isValidTimezone(value: string): boolean {
  if (value === 'UTC') return true
  // `Etc/GMT-8`-style zones are fixed offsets in disguise (and their sign is inverted).
  if (!IANA_SHAPE.test(value) || value.startsWith('Etc/')) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// Fixed offset -> the zone assumed for it. An offset alone never identifies a place, so only
// offsets where one zone is the obvious reading (no daylight saving) are listed; anything else
// is reported instead of guessed. Printed by the normalize script before it writes anything.
export const OFFSET_DEFAULT_ZONES: Readonly<Record<string, string>> = {
  '+00:00': 'UTC',
  '+04:00': 'Asia/Dubai',
  '+05:30': 'Asia/Kolkata',
  '+07:00': 'Asia/Bangkok',
  '+08:00': 'Asia/Taipei',
  '+09:00': 'Asia/Tokyo',
}

const OFFSET_FORMAT = /^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i

/** Normalizes `UTC+8`, `GMT+8`, `+08:00`, `UTC+0530`, … to `+HH:MM`; null if it isn't an offset. */
export function parseFixedOffset(raw: string): string | null {
  const match = OFFSET_FORMAT.exec(raw.trim())
  if (!match) return null
  const [, sign, hours = '', minutes = '00'] = match
  if (Number(hours) > 14 || Number(minutes) > 59) return null
  return `${sign}${hours.padStart(2, '0')}:${minutes}`
}

export type TimezoneFix =
  | { status: 'ok' }
  | { status: 'convert'; to: string; reason: string }
  | { status: 'unmapped' }

/** What to do with a stored `User.timezone`: keep it, replace it, or leave it for a human. */
export function planTimezoneFix(raw: string): TimezoneFix {
  if (isValidTimezone(raw)) return { status: 'ok' }
  const offset = parseFixedOffset(raw)
  const to = offset ? OFFSET_DEFAULT_ZONES[offset] : undefined
  if (offset && to) return { status: 'convert', to, reason: `fixed offset ${offset}` }
  return { status: 'unmapped' }
}
