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

/** Times per day a user may ask to fill a deck that came up short of its target. */
export const MAX_DAILY_TOP_UPS = 3

/** Rejected lemmas remembered per user, and how many are handed to the LLM as "avoid". */
export const MAX_AVOID_LEMMAS = 30

/** Consecutive short decks after which the UI suggests raising the CEFR level. */
export const SHORT_STREAK_HINT_THRESHOLD = 3
