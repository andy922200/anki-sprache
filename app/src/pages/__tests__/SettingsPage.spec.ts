import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { useAuthStore, type AppUser } from '@/stores/auth.store'
import type { UserSettingsDto } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  patchMe: vi.fn(),
  listLanguages: vi.fn(),
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
}))
vi.mock('vue-router', () => ({ RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('@/api/users.api', () => ({ patchMe: mocks.patchMe }))
vi.mock('@/api/languages.api', () => ({ listLanguages: mocks.listLanguages }))
vi.mock('@/api/settings.api', () => ({
  getSettings: mocks.getSettings,
  patchSettings: mocks.patchSettings,
}))

import SettingsPage from '../SettingsPage.vue'

const user = (timezone: string): AppUser => ({
  id: 'u1',
  email: 'a@example.com',
  displayName: 'Andy',
  avatarUrl: null,
  timezone,
})

const settings: UserSettingsDto = {
  targetLanguageCode: 'pt',
  nativeLanguageCode: 'en',
  cefrLevel: 'A2',
  dailyNewCount: 5,
  maxDueCards: 50,
  preferredLlmProvider: null,
  preferredLlmModel: null,
  theme: 'SYSTEM',
  uiLanguage: 'EN',
}

async function mountPage(opts: { timezone: string; uiLanguage?: 'EN' | 'ZH_TW' }) {
  const auth = useAuthStore()
  auth.setUser(user(opts.timezone))
  mocks.getSettings.mockResolvedValue({ ...settings, uiLanguage: opts.uiLanguage ?? 'EN' })
  mocks.patchSettings.mockImplementation(async (patch: object) => ({ ...settings, ...patch }))
  mocks.listLanguages.mockResolvedValue([])
  mocks.patchMe.mockImplementation(async (patch: Partial<AppUser>) => ({
    ...user(opts.timezone),
    ...patch,
  }))
  const wrapper = mount(SettingsPage, { global: { plugins: [i18n] } })
  await flushPromises()
  return { wrapper, auth }
}

const field = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('label').find((l) => l.text().startsWith(label))!

const timezoneSelect = (wrapper: VueWrapper, label = 'Timezone') =>
  field(wrapper, label).find('select')

const save = async (wrapper: VueWrapper, label = 'Save') => {
  await wrapper
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click')
  await flushPromises()
}

describe('SettingsPage timezone', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    i18n.global.locale.value = 'en'
    // Only timers: stops the toast's 4s timeout from outliving the test.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    i18n.global.locale.value = 'en'
  })

  it('offers a select, not a free-text box, with the stored zone selected', async () => {
    const { wrapper } = await mountPage({ timezone: 'Asia/Taipei' })

    const select = timezoneSelect(wrapper)
    expect(field(wrapper, 'Timezone').find('input').exists()).toBe(false)
    expect(select.exists()).toBe(true)
    expect((select.element as HTMLSelectElement).value).toBe('Asia/Taipei')
    const selected = select.findAll('option').find((o) => (o.element as HTMLOptionElement).selected)
    expect(selected?.text()).toBe('(GMT+08:00) Taiwan Standard Time - Taipei')
  })

  it('shows offset-first labels, and UTC is among them', async () => {
    const { wrapper } = await mountPage({ timezone: 'UTC' })

    const options = timezoneSelect(wrapper).findAll('option')

    expect(options.length).toBeGreaterThan(400)
    expect(options.every((o) => o.text().startsWith('(GMT'))).toBe(true)
    expect(options.some((o) => (o.element as HTMLOptionElement).value === 'UTC')).toBe(true)
    expect((timezoneSelect(wrapper).element as HTMLSelectElement).value).toBe('UTC')
  })

  it('labels follow the UI language from the saved settings', async () => {
    const { wrapper } = await mountPage({ timezone: 'Asia/Taipei', uiLanguage: 'ZH_TW' })

    const select = timezoneSelect(wrapper, '時區')
    const taipei = select
      .findAll('option')
      .find((o) => (o.element as HTMLOptionElement).value === 'Asia/Taipei')

    expect(taipei?.text()).toBe('(GMT+08:00) 台北標準時間 - Taipei')
  })

  it('sends the chosen IANA name, and only the timezone, when just the timezone changed', async () => {
    const { wrapper, auth } = await mountPage({ timezone: 'Asia/Taipei' })

    await timezoneSelect(wrapper).setValue('America/New_York')
    await save(wrapper)

    expect(mocks.patchMe).toHaveBeenCalledTimes(1)
    expect(mocks.patchMe).toHaveBeenCalledWith({ timezone: 'America/New_York' })
    expect(auth.user?.timezone).toBe('America/New_York')
  })

  it('sends only the display name when just that changed', async () => {
    const { wrapper } = await mountPage({ timezone: 'Asia/Taipei' })

    await field(wrapper, 'Display name').find('input').setValue('New Name')
    await save(wrapper)

    expect(mocks.patchMe).toHaveBeenCalledWith({ displayName: 'New Name' })
  })

  it('does not call PATCH /me at all when the profile is unchanged, but still saves settings', async () => {
    const { wrapper } = await mountPage({ timezone: 'Asia/Taipei' })

    await save(wrapper)

    expect(mocks.patchMe).not.toHaveBeenCalled()
    expect(mocks.patchSettings).toHaveBeenCalledTimes(1)
  })

  describe('a legacy value that is not a timezone', () => {
    it('is listed first as a disabled "unknown" entry and is the selected one', async () => {
      const { wrapper } = await mountPage({ timezone: 'UTC+8' })

      const select = timezoneSelect(wrapper)
      const first = select.findAll('option')[0]!

      expect(first.text()).toBe('Unknown timezone (UTC+8), please choose one')
      expect((first.element as HTMLOptionElement).disabled).toBe(true)
      expect((select.element as HTMLSelectElement).value).toBe('UTC+8')
    })

    it('does not block saving other fields: the old value is not sent back', async () => {
      const { wrapper } = await mountPage({ timezone: 'UTC+8' })

      await field(wrapper, 'Display name').find('input').setValue('New Name')
      await save(wrapper)

      expect(mocks.patchMe).toHaveBeenCalledTimes(1)
      expect(mocks.patchMe).toHaveBeenCalledWith({ displayName: 'New Name' })
      expect(mocks.patchMe.mock.calls[0]?.[0]).not.toHaveProperty('timezone')
      expect(mocks.patchSettings).toHaveBeenCalledTimes(1)
    })

    it('is replaced once the user picks a real zone', async () => {
      const { wrapper, auth } = await mountPage({ timezone: 'UTC+8' })

      await timezoneSelect(wrapper).setValue('Asia/Taipei')
      await save(wrapper)

      expect(mocks.patchMe).toHaveBeenCalledWith({ timezone: 'Asia/Taipei' })
      expect(auth.user?.timezone).toBe('Asia/Taipei')
      expect(
        timezoneSelect(wrapper)
          .findAll('option')
          .some((o) => o.text().startsWith('Unknown timezone')),
      ).toBe(false)
    })
  })
})
