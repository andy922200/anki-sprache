import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import zhTW from './locales/zh-TW.json'

export type UiLanguage = 'EN' | 'ZH_TW'
export type Locale = 'en' | 'zh-TW'

// Map backend enum <-> vue-i18n locale code
const ENUM_TO_LOCALE: Record<UiLanguage, Locale> = {
  EN: 'en',
  ZH_TW: 'zh-TW',
}

const LOCALE_TO_ENUM: Record<Locale, UiLanguage> = {
  en: 'EN',
  'zh-TW': 'ZH_TW',
}

const STORAGE_KEY = 'uiLanguage'

function detectInitialLocale(): Locale {
  // 1. localStorage override
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'zh-TW') return stored

  // 2. browser preferred
  const nav = navigator.language || (navigator.languages && navigator.languages[0]) || 'en'
  if (nav.toLowerCase().startsWith('zh')) return 'zh-TW'
  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectInitialLocale(),
  fallbackLocale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en,
    'zh-TW': zhTW,
  },
})

export function setLocaleFromEnum(uiLang: UiLanguage) {
  const locale = ENUM_TO_LOCALE[uiLang]
  i18n.global.locale.value = locale
  localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale
}

export function getCurrentLocaleEnum(): UiLanguage {
  const v = i18n.global.locale.value as Locale
  return LOCALE_TO_ENUM[v] ?? 'EN'
}

export function setLocaleFromBrowser() {
  const locale = detectInitialLocale()
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
}
