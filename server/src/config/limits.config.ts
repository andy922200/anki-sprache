/** Largest per-day new-word target a user can set; also caps one "more words" top-up. */
export const MAX_DAILY_NEW_COUNT = 30

/** Largest due-card queue a user can ask `/cards/due` and the review page to load. */
export const MAX_DUE_CARDS = 200

/** Examples the LLM is asked for per card and CEFR level. */
export const EXAMPLES_PER_LEVEL_TARGET = 2

/** Examples kept per card and CEFR level; older ones beyond this are pruned. */
export const EXAMPLES_PER_LEVEL_MAX = 3

/** Longest example sentence (and its translation) accepted from an LLM. */
export const SENTENCE_MAX_LENGTH = 300
