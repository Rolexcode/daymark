import {
  LOCK_IN_END_DATE,
  LOCK_IN_TOTAL_DAYS,
  getDateInTimeZone,
  getElapsedLockInDates,
  getLockInDates,
  isIsoDate,
} from "./dates";
import type { IsoDate, LockInDayEntry, LockInHabit, LockInState } from "./types";

export interface LockInDayStats {
  date: IsoDate;
  completedHabits: number;
  totalHabits: number;
  completedBabyTasks: number;
  totalBabyTasks: number;
  completionRate: number;
  isPerfect: boolean;
  isFinalized: boolean;
}

export interface LockInHabitStats {
  habitId: string;
  title: string;
  completedDays: number;
  eligibleDays: number;
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
}

export interface LockInStats {
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  finalizedDays: number;
  perfectDays: number;
  completedHabitChecks: number;
  possibleHabitChecks: number;
  completionRate: number;
  challengeProgressRate: number;
  currentStreak: number;
  longestStreak: number;
  habits: LockInHabitStats[];
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function getEntry(state: LockInState, date: IsoDate): LockInDayEntry | undefined {
  return state.days[date];
}

export function isHabitComplete(
  state: LockInState,
  date: IsoDate,
  habitId: string,
): boolean {
  return getEntry(state, date)?.completions[habitId]?.done === true;
}

export function calculateDayStats(state: LockInState, date: IsoDate): LockInDayStats {
  const entry = getEntry(state, date);
  const totalBabyTasks = state.habits.reduce((total, habit) => total + habit.babyTasks.length, 0);
  const completedHabits = state.habits.reduce(
    (total, habit) => total + (entry?.completions[habit.id]?.done === true ? 1 : 0),
    0,
  );
  const completedBabyTasks = state.habits.reduce((total, habit) => {
    const validIds = new Set(habit.babyTasks.map((task) => task.id));
    const completedIds = entry?.completions[habit.id]?.completedBabyTaskIds ?? [];
    return total + completedIds.filter((id) => validIds.has(id)).length;
  }, 0);

  return {
    date,
    completedHabits,
    totalHabits: state.habits.length,
    completedBabyTasks,
    totalBabyTasks,
    completionRate: percentage(completedHabits, state.habits.length),
    isPerfect: state.habits.length > 0 && completedHabits === state.habits.length,
    isFinalized: typeof entry?.finalizedAt === "string",
  };
}

function streaks(values: boolean[], allowOpenToday: boolean): { current: number; longest: number } {
  let running = 0;
  let longest = 0;

  for (const value of values) {
    running = value ? running + 1 : 0;
    longest = Math.max(longest, running);
  }

  let endIndex = values.length - 1;
  if (allowOpenToday && endIndex >= 0 && !values[endIndex]) endIndex -= 1;

  let current = 0;
  while (endIndex >= 0 && values[endIndex]) {
    current += 1;
    endIndex -= 1;
  }

  return { current, longest };
}

function calculateHabitStats(
  state: LockInState,
  habit: LockInHabit,
  elapsedDates: IsoDate[],
  allowOpenToday: boolean,
): LockInHabitStats {
  const completed = elapsedDates.map((date) => isHabitComplete(state, date, habit.id));
  const completedDays = completed.filter(Boolean).length;
  const habitStreaks = streaks(completed, allowOpenToday);

  return {
    habitId: habit.id,
    title: habit.title,
    completedDays,
    eligibleDays: elapsedDates.length,
    completionRate: percentage(completedDays, elapsedDates.length),
    currentStreak: habitStreaks.current,
    longestStreak: habitStreaks.longest,
  };
}

/**
 * Calculates adherence through asOfDate. An unfinished current day gets a grace
 * period for current-streak purposes, so opening Daymark in the morning does not
 * prematurely erase yesterday's streak.
 */
export function calculateLockInStats(
  state: LockInState,
  asOfDate: IsoDate = getDateInTimeZone(),
): LockInStats {
  const safeAsOfDate = isIsoDate(asOfDate) ? asOfDate : getDateInTimeZone();
  const elapsedDates = getElapsedLockInDates(safeAsOfDate);
  const dayStats = elapsedDates.map((date) => calculateDayStats(state, date));
  const completedHabitChecks = dayStats.reduce((total, day) => total + day.completedHabits, 0);
  const possibleHabitChecks = elapsedDates.length * state.habits.length;
  const perfectValues = dayStats.map((day) => day.isPerfect);
  const currentDateIsOpen =
    elapsedDates.at(-1) === safeAsOfDate &&
    safeAsOfDate <= LOCK_IN_END_DATE &&
    dayStats.at(-1)?.isFinalized !== true;
  const overallStreaks = streaks(perfectValues, currentDateIsOpen);
  const totalPossibleChecks = LOCK_IN_TOTAL_DAYS * state.habits.length;

  return {
    totalDays: LOCK_IN_TOTAL_DAYS,
    elapsedDays: elapsedDates.length,
    remainingDays: Math.max(0, LOCK_IN_TOTAL_DAYS - elapsedDates.length),
    finalizedDays: dayStats.filter((day) => day.isFinalized).length,
    perfectDays: perfectValues.filter(Boolean).length,
    completedHabitChecks,
    possibleHabitChecks,
    completionRate: percentage(completedHabitChecks, possibleHabitChecks),
    challengeProgressRate: percentage(completedHabitChecks, totalPossibleChecks),
    currentStreak: overallStreaks.current,
    longestStreak: overallStreaks.longest,
    habits: state.habits.map((habit) =>
      calculateHabitStats(state, habit, elapsedDates, currentDateIsOpen),
    ),
  };
}

export function getChallengeGrid(state: LockInState): LockInDayStats[] {
  return getLockInDates().map((date) => calculateDayStats(state, date));
}

