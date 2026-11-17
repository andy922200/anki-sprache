import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import {
  buildTimezoneOption,
  buildTimezoneOptions,
  isIanaTimezone,
  useTimezoneOptions,
} from '../useTimezoneOptions'

const WINTER = new Date('2026-01-15T12:00:00Z')
const SUMMER = new Date('2026-07-15T12:00:00Z')

describe('isIanaTimezone', () => {
  it.each(['UTC', 'Asia/Taipei', 'America/Argentina/Buenos_Aires', 'US/Pacific'])(
    'accepts %s',
    (tz) => {
      expect(isIanaTimezone(tz)).toBe(true)
    },
  )

  it.each(['UTC+8', '+08:00', 'Etc/GMT-8', '', 'asia/taipei', 'GMT', 'Asia/Nowhere', 'Taipei'])(
    'rejects %j',
    (tz) => {
      expect(isIanaTimezone(tz)).toBe(false)
    },
  )
})

describe('buildTimezoneOptions', () => {
  it('lists the engine zones plus UTC, without duplicates', () => {
    const options = buildTimezoneOptions('en', WINTER)
    const values = options.map((o) => o.value)

    expect(values).toContain('UTC')
    expect(values).toContain('Asia/Taipei')
    expect(new Set(values).size).toBe(values.length)
    expect(values.length).toBe(Intl.supportedValuesOf('timeZone').length + 1)
  })

  it('is ordered by offset, then label', () => {
    const options = buildTimezoneOptions('en', WINTER)

    for (let i = 1; i < options.length; i++) {
      const prev = options[i - 1]!
      const cur = options[i]!
      expect(prev.offsetMinutes).toBeLessThanOrEqual(cur.offsetMinutes)
      if (prev.offsetMinutes === cur.offsetMinutes) {
        expect(prev.label.localeCompare(cur.label, 'en')).toBeLessThanOrEqual(0)
      }
    }
  })

  it('labels each zone "(GMT±hh:mm) name - city" in the requested language', () => {
    const en = buildTimezoneOptions('en', WINTER).find((o) => o.value === 'Asia/Taipei')
    const zh = buildTimezoneOptions('zh-TW', WINTER).find((o) => o.value === 'Asia/Taipei')

    expect(en?.label).toBe('(GMT+08:00) Taiwan Standard Time - Taipei')
    expect(zh?.label).toBe('(GMT+08:00) 台北標準時間 - Taipei')
    expect(en?.offsetMinutes).toBe(480)
  })

  it('keeps a half-hour offset and a negative offset readable', () => {
    const options = buildTimezoneOptions('en', WINTER)

    expect(options.find((o) => o.value === 'Asia/Calcutta')?.label).toMatch(/^\(GMT\+05:30\) /)
    expect(options.find((o) => o.value === 'America/New_York')?.label).toMatch(/^\(GMT-05:00\) /)
  })

  it('keeps UTC even though the engine list omits it, without a city suffix', () => {
    expect(Intl.supportedValuesOf('timeZone')).not.toContain('UTC')

    const utc = buildTimezoneOptions('en', WINTER).find((o) => o.value === 'UTC')

    expect(utc?.offsetMinutes).toBe(0)
    expect(utc?.label).toMatch(/^\(GMT\+00:00\) [^-]+$/)
  })

  it('follows daylight saving: the offset is the one in force at the given moment', () => {
    expect(buildTimezoneOption('America/New_York', 'en', WINTER).offsetMinutes).toBe(-300)
    expect(buildTimezoneOption('America/New_York', 'en', SUMMER).offsetMinutes).toBe(-240)
    expect(buildTimezoneOption('Asia/Taipei', 'en', WINTER).offsetMinutes).toBe(480)
    expect(buildTimezoneOption('Asia/Taipei', 'en', SUMMER).offsetMinutes).toBe(480)
  })

  it('tells zones that share a name apart by city', () => {
    const options = buildTimezoneOptions('en', WINTER)
    const berlin = options.find((o) => o.value === 'Europe/Berlin')!
    const paris = options.find((o) => o.value === 'Europe/Paris')!

    expect(berlin.label).not.toBe(paris.label)
  })
})

describe('useTimezoneOptions', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })
  afterEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('adds nothing extra when the stored value is already in the list', () => {
    const { options } = useTimezoneOptions('Asia/Taipei')

    expect(options.value.some((o) => o.unknown)).toBe(false)
    expect(options.value.filter((o) => o.value === 'Asia/Taipei')).toHaveLength(1)
  })

  it('keeps UTC selectable', () => {
    const { options } = useTimezoneOptions('UTC')

    expect(options.value.filter((o) => o.value === 'UTC')).toHaveLength(1)
    expect(options.value.some((o) => o.unknown)).toBe(false)
  })

  it('shows a legacy invalid value first, marked unknown, so it is not silently replaced', () => {
    const { options } = useTimezoneOptions('UTC+8')

    expect(options.value[0]).toMatchObject({
      value: 'UTC+8',
      unknown: true,
      label: 'Unknown timezone (UTC+8), please choose one',
    })
    expect(options.value).toHaveLength(buildTimezoneOptions('en').length + 1)
  })

  it('gives a valid alias that is not in the list an ordinary option', () => {
    expect(Intl.supportedValuesOf('timeZone')).not.toContain('US/Pacific')

    const { options } = useTimezoneOptions('US/Pacific')
    const alias = options.value.find((o) => o.value === 'US/Pacific')

    expect(alias).toBeDefined()
    expect(alias?.unknown).toBeUndefined()
    expect(alias?.label).toMatch(/^\(GMT-0[78]:00\) /)
  })

  it('adds nothing for an empty value', () => {
    const { options } = useTimezoneOptions('')

    expect(options.value).toHaveLength(buildTimezoneOptions('en').length)
  })

  it('follows the UI language', () => {
    const { options } = useTimezoneOptions('Asia/Taipei')
    const taipei = () => options.value.find((o) => o.value === 'Asia/Taipei')?.label

    expect(taipei()).toBe('(GMT+08:00) Taiwan Standard Time - Taipei')
    i18n.global.locale.value = 'zh-TW'
    expect(taipei()).toBe('(GMT+08:00) 台北標準時間 - Taipei')
  })

  it('translates the unknown label too', () => {
    i18n.global.locale.value = 'zh-TW'

    const { options } = useTimezoneOptions('UTC+8')

    expect(options.value[0]?.label).toBe('未知的時區（UTC+8），請重新選擇')
  })

  it('reacts when the stored value changes', () => {
    const current = ref('Asia/Taipei')
    const { options } = useTimezoneOptions(current)
    expect(options.value.some((o) => o.unknown)).toBe(false)

    current.value = 'UTC+8'

    expect(options.value[0]?.unknown).toBe(true)
  })
})
