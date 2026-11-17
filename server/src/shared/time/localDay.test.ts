import { describe, expect, it } from 'vitest'
import { localDateFor, localDayRange, localHourFor } from './localDay.js'

const iso = (r: { start: Date; end: Date }) => [r.start.toISOString(), r.end.toISOString()]

describe('localDayRange', () => {
  it('returns the UTC day for UTC', () => {
    expect(iso(localDayRange('UTC', new Date('2026-11-17T10:30:00.123Z')))).toEqual([
      '2026-11-17T00:00:00.000Z',
      '2026-11-18T00:00:00.000Z',
    ])
  })

  it('uses the local day east of UTC (Taipei is +8)', () => {
    // 2026-11-17 20:00Z is already 04:00 on the 18th in Taipei.
    expect(iso(localDayRange('Asia/Taipei', new Date('2026-11-17T20:00:00Z')))).toEqual([
      '2026-11-17T16:00:00.000Z',
      '2026-11-18T16:00:00.000Z',
    ])
  })

  it('uses the local day west of UTC', () => {
    // 2026-11-17 03:00Z is still the 16th in New York (EST, -5).
    expect(iso(localDayRange('America/New_York', new Date('2026-11-17T03:00:00Z')))).toEqual([
      '2026-11-16T05:00:00.000Z',
      '2026-11-17T05:00:00.000Z',
    ])
  })

  it('spans 23 hours on a spring-forward day', () => {
    const { start, end } = localDayRange('America/New_York', new Date('2026-03-08T12:00:00Z'))
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })

  it('falls back to UTC for an invalid timezone', () => {
    expect(iso(localDayRange('Not/AZone', new Date('2026-11-17T10:00:00Z')))).toEqual([
      '2026-11-17T00:00:00.000Z',
      '2026-11-18T00:00:00.000Z',
    ])
  })
})

describe('localDateFor / localHourFor', () => {
  const at = new Date('2026-11-17T20:00:00Z')

  it('reads the date and hour in the given zone', () => {
    expect(localDateFor('Asia/Taipei', at)).toBe('2026-11-18')
    expect(localHourFor('Asia/Taipei', at)).toBe(4)
    expect(localDateFor('America/New_York', at)).toBe('2026-11-17')
    expect(localHourFor('America/New_York', at)).toBe(15)
  })

  it('falls back to UTC for an invalid timezone', () => {
    expect(localDateFor('Not/AZone', at)).toBe('2026-11-17')
    expect(localHourFor('Not/AZone', at)).toBe(20)
  })
})
