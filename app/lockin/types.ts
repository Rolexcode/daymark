export const LOCK_IN_SCHEMA_VERSION = 2 as const;
export const MAX_LOCK_IN_HABITS = 10;
export const MAX_BABY_TASKS_PER_HABIT = 20;

/** A calendar date in YYYY-MM-DD form. Runtime validation lives in dates.ts. */
export type IsoDate = string;

export interface BabyTask {
  id: string;
  title: string;
}

export interface LockInHabit {
  id: string;
  title: string;
  babyTasks: BabyTask[];
}

/**
 * A completion exists only after the user interacts with a habit on that day.
 * Keeping baby-task ids here avoids copying habit definitions into every date.
 */
export interface HabitCompletion {
  done: boolean;
  completedBabyTaskIds: string[];
}

/**
 * Dates are sparse: a date with no interaction has no entry in LockInState.days.
 * Completions are also sparse and keyed by habit id.
 */
export interface LockInDayEntry {
  completions: Record<string, HabitCompletion>;
  note?: string;
  finalizedAt?: string;
}

export interface LockInChallenge {
  id: string;
  title: string;
  displayName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  timeZone: string;
  checkInTime: string;
  createdAt: string;
}

export interface LockInState {
  version: typeof LOCK_IN_SCHEMA_VERSION;
  challenge: LockInChallenge;
  habits: LockInHabit[];
  days: Record<IsoDate, LockInDayEntry>;
  updatedAt: string;
}
