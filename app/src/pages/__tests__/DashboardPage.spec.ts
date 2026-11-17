import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import type { CardDto, GenerationStatusDto, UserSettingsDto } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getStatus: vi.fn(),
  generateMore: vi.fn(),
  getDue: vi.fn(),
  getToday: vi.fn(),
  listKeys: vi.fn(),
  getSettings: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/api/generation.api', () => ({
  getStatus: mocks.getStatus,
  generateMore: mocks.generateMore,
  generateToday: vi.fn(),
}))
vi.mock('@/api/cards.api', () => ({ getDue: mocks.getDue, getToday: mocks.getToday }))
vi.mock('@/api/llmKeys.api', () => ({ listKeys: mocks.listKeys }))
vi.mock('@/api/settings.api', () => ({ getSettings: mocks.getSettings }))

import DashboardPage from '../DashboardPage.vue'

const card = (id: string): CardDto => ({
  id,
  languageCode: 'de',
  lemma: id,
  surfaceForm: null,
  partOfSpeech: null,
  gender: null,
  ipa: null,
  translation: `t-${id}`,
  cefrLevel: 'A1',
  audioUrl: null,
  examples: [],
  state: null,
})

const settings: UserSettingsDto = {
  targetLanguageCode: 'de',
  nativeLanguageCode: 'en',
  cefrLevel: 'A1',
  dailyNewCount: 5,
  maxDueCards: 50,
  preferredLlmProvider: 'OPENAI',
  preferredLlmModel: null,
  theme: 'SYSTEM',
  uiLanguage: 'EN',
}

const status: GenerationStatusDto = {
  done: true,
  cardIds: ['a', 'b'],
  provider: null,
  lastError: null,
  topUpsLeft: 3,
  suggestHigherLevel: false,
}

async function mountDashboard(opts: { due: CardDto[]; today?: CardDto[] }) {
  mocks.getSettings.mockResolvedValue(settings)
  mocks.getStatus.mockResolvedValue(status)
  mocks.getDue.mockResolvedValue(opts.due)
  mocks.getToday.mockResolvedValue(opts.today ?? [])
  mocks.listKeys.mockResolvedValue([
    { provider: 'OPENAI', keyFingerprint: '…abcd', updatedAt: '2026-11-17T00:00:00Z' },
  ])
  const wrapper = mount(DashboardPage, {
    global: { plugins: [i18n], stubs: { LlmSetupCard: true } },
  })
  await flushPromises()
  return wrapper
}

const findButton = (wrapper: Awaited<ReturnType<typeof mountDashboard>>, text: string) =>
  wrapper.findAll('button').find((b) => b.text().includes(text))

describe('DashboardPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    i18n.global.locale.value = 'en'
    // Date and timers only: stops generateMore's polling loop from running on after the test.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('practice button', () => {
    it("shows the size of today's whole session once nothing is due", async () => {
      const wrapper = await mountDashboard({
        due: [],
        today: [card('a'), card('b'), card('c')],
      })

      expect(mocks.getToday).toHaveBeenCalledTimes(1)
      expect(findButton(wrapper, "Practice today's words (3)")).toBeDefined()
    })

    it('opens the review page in practice mode', async () => {
      const wrapper = await mountDashboard({ due: [], today: [card('a')] })

      await findButton(wrapper, "Practice today's words")!.trigger('click')

      expect(mocks.push).toHaveBeenCalledWith({
        name: 'review',
        query: { mode: 'flip', practice: 'true' },
      })
    })

    it('is hidden, and today is not fetched, while cards are still due', async () => {
      const wrapper = await mountDashboard({ due: [card('d1')], today: [card('a')] })

      expect(mocks.getToday).not.toHaveBeenCalled()
      expect(findButton(wrapper, "Practice today's words")).toBeUndefined()
    })
  })

  describe('top-up button', () => {
    it('requests the default top-up count, not the click event', async () => {
      const wrapper = await mountDashboard({ due: [], today: [card('a')] })

      await findButton(wrapper, 'Generate 5 more')!.trigger('click')
      await flushPromises()

      // A MouseEvent here once reached the API as `count` and failed server validation.
      expect(mocks.generateMore).toHaveBeenCalledTimes(1)
      expect(mocks.generateMore).toHaveBeenCalledWith(5, false)
    })
  })
})
