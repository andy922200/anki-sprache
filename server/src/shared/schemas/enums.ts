import { z } from 'zod'
import {
  CEFR,
  FsrsRating,
  FsrsState,
  Gender,
  LlmProvider,
  PartOfSpeech,
  ReviewMode,
  Theme,
  UiLanguage,
} from '@/generated/prisma/enums.js'

// Built from the Prisma enums so a value added in schema.prisma reaches request/response
// validation without a second edit.
export const cefrSchema = z.enum(CEFR)
export const fsrsRatingSchema = z.enum(FsrsRating)
export const fsrsStateSchema = z.enum(FsrsState)
export const genderSchema = z.enum(Gender)
export const llmProviderSchema = z.enum(LlmProvider)
export const partOfSpeechSchema = z.enum(PartOfSpeech)
export const reviewModeSchema = z.enum(ReviewMode)
export const themeSchema = z.enum(Theme)
export const uiLanguageSchema = z.enum(UiLanguage)
