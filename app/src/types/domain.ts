export type CEFR = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
export type LlmProvider = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE'
export type ThemePref = 'LIGHT' | 'DARK' | 'SYSTEM'
export type UiLanguage = 'EN' | 'ZH_TW'
export type FsrsState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING'
export type FsrsRating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY'
export type ReviewMode = 'FLIP' | 'MULTIPLE_CHOICE'
export type PartOfSpeech =
  | 'NOUN'
  | 'VERB'
  | 'ADJECTIVE'
  | 'ADVERB'
  | 'PRONOUN'
  | 'PREPOSITION'
  | 'CONJUNCTION'
  | 'ARTICLE'
  | 'INTERJECTION'
  | 'NUMERAL'
export type Gender = 'DER' | 'DIE' | 'DAS'

export interface LanguageDto {
  code: string
  name: string
  nativeName: string
  enabled: boolean
}

export interface UserSettingsDto {
  targetLanguageCode: string
  nativeLanguageCode: string
  cefrLevel: CEFR
  dailyNewCount: number
  preferredLlmProvider: LlmProvider | null
  preferredLlmModel: string | null
  theme: ThemePref
  uiLanguage: UiLanguage
}

export interface ExampleDto {
  id: string
  text: string
  translation: string
  audioUrl: string | null
  orderIndex: number
}

export interface CardStateDto {
  due: string
  state: FsrsState
  reps: number
  lapses: number
}

export interface CardDto {
  id: string
  languageCode: string
  lemma: string
  surfaceForm: string | null
  partOfSpeech: PartOfSpeech | null
  gender: Gender | null
  ipa: string | null
  translation: string
  cefrLevel: CEFR
  examples: ExampleDto[]
  state: CardStateDto | null
}

export interface MaskedKeyDto {
  provider: LlmProvider
  keyFingerprint: string
  updatedAt: string
}

export interface ReviewLogEntry {
  id: string
  cardId: string
  lemma: string
  translation: string
  rating: FsrsRating
  mode: ReviewMode
  durationMs: number
  reviewedAt: string
  stateBefore: FsrsState
  stateAfter: FsrsState
}

export interface LogbookPage {
  entries: ReviewLogEntry[]
  nextCursor: string | null
}

export interface UpgradeResultSummaryDto {
  completedAt: string
  upgraded: number
  skipped: number
  failed: number
  firstErrorReason: string | null
}

export interface GenerationStatusDto {
  done: boolean
  cardIds: string[]
  provider: LlmProvider | null
  lastError: string | null
  upgradeInFlight: boolean
  lastUpgradeError: string | null
  lastUpgradeResult: UpgradeResultSummaryDto | null
}
