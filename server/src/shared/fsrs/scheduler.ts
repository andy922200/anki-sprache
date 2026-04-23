import {
  createEmptyCard,
  FSRS,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCardInternal,
  type Grade,
} from 'ts-fsrs'
import type { FsrsRating, FsrsState, UserCardState } from '@prisma/client'

const fsrs = new FSRS(
  generatorParameters({
    enable_fuzz: true,
    maximum_interval: 36500,
  }),
)

const RATING_MAP: Record<FsrsRating, Grade> = {
  AGAIN: Rating.Again,
  HARD: Rating.Hard,
  GOOD: Rating.Good,
  EASY: Rating.Easy,
}

const STATE_TO_PRISMA: Record<State, FsrsState> = {
  [State.New]: 'NEW',
  [State.Learning]: 'LEARNING',
  [State.Review]: 'REVIEW',
  [State.Relearning]: 'RELEARNING',
}

const PRISMA_TO_STATE: Record<FsrsState, State> = {
  NEW: State.New,
  LEARNING: State.Learning,
  REVIEW: State.Review,
  RELEARNING: State.Relearning,
}

export interface ScheduleResult {
  nextState: {
    due: Date
    stability: number
    difficulty: number
    elapsedDays: number
    scheduledDays: number
    reps: number
    lapses: number
    state: FsrsState
    lastReview: Date
  }
  snapshot: {
    stabilityBefore: number
    stabilityAfter: number
    difficultyBefore: number
    difficultyAfter: number
    stateBefore: FsrsState
    stateAfter: FsrsState
  }
}

export function scheduleReview(
  current: Pick<
    UserCardState,
    | 'due'
    | 'stability'
    | 'difficulty'
    | 'elapsedDays'
    | 'scheduledDays'
    | 'reps'
    | 'lapses'
    | 'state'
    | 'lastReview'
  > | null,
  rating: FsrsRating,
  now: Date = new Date(),
): ScheduleResult {
  const baseCard: FsrsCardInternal = current
    ? {
        due: current.due,
        stability: current.stability,
        difficulty: current.difficulty,
        elapsed_days: current.elapsedDays,
        scheduled_days: current.scheduledDays,
        learning_steps: 0,
        reps: current.reps,
        lapses: current.lapses,
        state: PRISMA_TO_STATE[current.state],
        last_review: current.lastReview ?? undefined,
      }
    : createEmptyCard(now)

  const entry = fsrs.next(baseCard, now, RATING_MAP[rating])

  return {
    nextState: {
      due: entry.card.due,
      stability: entry.card.stability,
      difficulty: entry.card.difficulty,
      elapsedDays: entry.card.elapsed_days,
      scheduledDays: entry.card.scheduled_days,
      reps: entry.card.reps,
      lapses: entry.card.lapses,
      state: STATE_TO_PRISMA[entry.card.state],
      lastReview: entry.card.last_review ?? now,
    },
    snapshot: {
      stabilityBefore: baseCard.stability,
      stabilityAfter: entry.card.stability,
      difficultyBefore: baseCard.difficulty,
      difficultyAfter: entry.card.difficulty,
      stateBefore: STATE_TO_PRISMA[baseCard.state],
      stateAfter: STATE_TO_PRISMA[entry.card.state],
    },
  }
}
