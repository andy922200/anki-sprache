import { describe, expect, it } from 'vitest'
import {
  isValidTimezone,
  OFFSET_DEFAULT_ZONES,
  parseFixedOffset,
  planTimezoneFix,
} from './timezone.js'

describe('isValidTimezone', () => {
  it.each([
    'UTC',
    'Asia/Taipei',
    'America/New_York',
    'America/Argentina/Buenos_Aires',
  ])('accepts %s', (tz) => {
    expect(isValidTimezone(tz)).toBe(true)
  })

  it('accepts aliases the engine knows, so a browser and this server can differ on spelling', () => {
    expect(isValidTimezone('Asia/Calcutta')).toBe(true)
    expect(isValidTimezone('Asia/Kolkata')).toBe(true)
    expect(isValidTimezone('US/Pacific')).toBe(true)
  })

  it.each([
    ['a fixed offset in UTC+N form', 'UTC+8'],
    ['a fixed offset in ±HH:MM form', '+08:00'],
    ['an Etc/GMT zone (fixed offset, inverted sign)', 'Etc/GMT-8'],
    ['an empty string', ''],
    ['a lower-case name', 'asia/taipei'],
    ['the bare GMT alias', 'GMT'],
    ['lower-case utc', 'utc'],
    ['an unknown zone', 'Asia/Nowhere'],
    ['a bare city', 'Taipei'],
    ['surrounding whitespace', ' Asia/Taipei '],
  ])('rejects %s', (_label, tz) => {
    expect(isValidTimezone(tz)).toBe(false)
  })

  it('accepts every zone the engine itself lists, plus UTC', () => {
    const rejected = Intl.supportedValuesOf('timeZone').filter((tz) => !isValidTimezone(tz))
    expect(rejected).toEqual([])
  })
})

describe('parseFixedOffset', () => {
  it.each([
    ['UTC+8', '+08:00'],
    ['utc+8', '+08:00'],
    ['GMT+8', '+08:00'],
    ['+08:00', '+08:00'],
    ['+0800', '+08:00'],
    ['UTC+05:30', '+05:30'],
    ['UTC+0530', '+05:30'],
    ['UTC-5', '-05:00'],
    ['GMT -03:00', '-03:00'],
    [' UTC+8 ', '+08:00'],
  ])('reads %s as %s', (raw, expected) => {
    expect(parseFixedOffset(raw)).toBe(expected)
  })

  it.each([
    'Asia/Taipei',
    'UTC',
    'GMT',
    '8',
    'UTC+99',
    'UTC+8:75',
    '',
  ])('returns null for %s', (raw) => {
    expect(parseFixedOffset(raw)).toBeNull()
  })
})

describe('planTimezoneFix', () => {
  it('leaves valid values alone, aliases included', () => {
    expect(planTimezoneFix('Asia/Taipei')).toEqual({ status: 'ok' })
    expect(planTimezoneFix('UTC')).toEqual({ status: 'ok' })
    expect(planTimezoneFix('Asia/Calcutta')).toEqual({ status: 'ok' })
  })

  it('maps the common fixed-offset spellings through the default table', () => {
    for (const raw of ['UTC+8', 'GMT+8', '+08:00', 'utc+08:00']) {
      expect(planTimezoneFix(raw)).toEqual({
        status: 'convert',
        to: 'Asia/Taipei',
        reason: 'fixed offset +08:00',
      })
    }
    expect(planTimezoneFix('UTC+05:30')).toMatchObject({ status: 'convert', to: 'Asia/Kolkata' })
    expect(planTimezoneFix('UTC+0')).toMatchObject({ status: 'convert', to: 'UTC' })
  })

  it('does not guess when an offset has no obvious zone', () => {
    // -05:00 is New York in winter, Bogotá all year, Chicago in summer…
    expect(planTimezoneFix('UTC-5')).toEqual({ status: 'unmapped' })
    expect(planTimezoneFix('UTC+1')).toEqual({ status: 'unmapped' })
  })

  it('does not guess for values that are not offsets either', () => {
    expect(planTimezoneFix('Taiwan')).toEqual({ status: 'unmapped' })
    expect(planTimezoneFix('Etc/GMT-8')).toEqual({ status: 'unmapped' })
    expect(planTimezoneFix('')).toEqual({ status: 'unmapped' })
  })
})

describe('OFFSET_DEFAULT_ZONES', () => {
  it('only names zones the validator accepts', () => {
    for (const zone of Object.values(OFFSET_DEFAULT_ZONES)) {
      expect(isValidTimezone(zone)).toBe(true)
    }
  })

  it('only names zones whose current offset is the key it is filed under', () => {
    const format = (zone: string) =>
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(new Date('2026-01-15T12:00:00Z'))
        .find((p) => p.type === 'timeZoneName')?.value
    for (const [offset, zone] of Object.entries(OFFSET_DEFAULT_ZONES)) {
      expect(format(zone), zone).toBe(`GMT${offset}`)
    }
  })
})
