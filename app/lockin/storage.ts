import {
  DEFAULT_LOCK_IN_CHECK_IN_TIME,
  LOCK_IN_END_DATE,
  LOCK_IN_START_DATE,
  LOCK_IN_TIME_ZONE,
  isIsoDate,
  isLockInDate,
} from "./dates";
import {
  LOCK_IN_SCHEMA_VERSION,
  MAX_BABY_TASKS_PER_HABIT,
  MAX_LOCK_IN_HABITS,
  type BabyTask,
  type HabitCompletion,
  type IsoDate,
  type LockInDayEntry,
  type LockInHabit,
  type LockInState,
} from "./types";

export const LOCK_IN_STORAGE_KEY = "daymark:v2:lockin";

const DEFAULT_CHALLENGE_ID = "lock-in-2026";
const DEFAULT_CHALLENGE_TITLE = "My 122-day lock-in";
const MAX_TITLE_LENGTH = 120;
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_NOTE_LENGTH = 5_000;
const CHECK_IN_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LockInStorageErrorCode =
  | "storage-unavailable"
  | "read-failed"
  | "write-failed"
  | "invalid-json"
  | "invalid-data";

export interface LockInStorageError {
  code: LockInStorageErrorCode;
  message: string;
  recoverable: true;
  cause?: unknown;
}

export interface LockInValidationResult {
  state: LockInState;
  issues: string[];
  fatal: boolean;
}

export interface LoadLockInResult {
  state: LockInState;
  source: "storage" | "default" | "recovered";
  recovered: boolean;
  warnings: string[];
  error?: LockInStorageError;
}

export type SaveLockInResult =
  | { ok: true; state: LockInState; warnings: string[] }
  | { ok: false; state: LockInState; warnings: string[]; error: LockInStorageError };

function timestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function safeNow(now: Date): string {
  return Number.isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString();
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function makeUniqueId(
  value: unknown,
  fallback: string,
  usedIds: Set<string>,
): string {
  const candidate = cleanText(value, 100) || fallback;
  let unique = candidate;
  let suffix = 2;
  while (usedIds.has(unique)) {
    unique = `${candidate}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(unique);
  return unique;
}

export function createDefaultLockInState(now: Date = new Date()): LockInState {
  const createdAt = safeNow(now);
  return {
    version: LOCK_IN_SCHEMA_VERSION,
    challenge: {
      id: DEFAULT_CHALLENGE_ID,
      title: DEFAULT_CHALLENGE_TITLE,
      displayName: "",
      startDate: LOCK_IN_START_DATE,
      endDate: LOCK_IN_END_DATE,
      timeZone: LOCK_IN_TIME_ZONE,
      checkInTime: DEFAULT_LOCK_IN_CHECK_IN_TIME,
      createdAt,
    },
    habits: [],
    days: {},
    updatedAt: createdAt,
  };
}

function normalizeBabyTasks(
  value: unknown,
  habitId: string,
  issues: string[],
): BabyTask[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issues.push(`Baby tasks for ${habitId} were not a list and were removed.`);
    return [];
  }

  const usedIds = new Set<string>();
  const tasks: BabyTask[] = [];
  for (const [index, rawTask] of value.slice(0, MAX_BABY_TASKS_PER_HABIT).entries()) {
    if (!rawTask || typeof rawTask !== "object") {
      issues.push(`Invalid baby task ${index + 1} for ${habitId} was removed.`);
      continue;
    }
    const record = rawTask as Record<string, unknown>;
    const title = cleanText(record.title, MAX_TITLE_LENGTH);
    if (!title) {
      issues.push(`Untitled baby task ${index + 1} for ${habitId} was removed.`);
      continue;
    }
    tasks.push({
      id: makeUniqueId(record.id, `${habitId}-task-${index + 1}`, usedIds),
      title,
    });
  }

  if (value.length > MAX_BABY_TASKS_PER_HABIT) {
    issues.push(`Only the first ${MAX_BABY_TASKS_PER_HABIT} baby tasks for ${habitId} were kept.`);
  }
  return tasks;
}

function normalizeHabits(value: unknown, issues: string[]): LockInHabit[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issues.push("Habits were not a list and were reset.");
    return [];
  }

  const usedIds = new Set<string>();
  const habits: LockInHabit[] = [];
  for (const [index, rawHabit] of value.slice(0, MAX_LOCK_IN_HABITS).entries()) {
    if (!rawHabit || typeof rawHabit !== "object") {
      issues.push(`Invalid habit ${index + 1} was removed.`);
      continue;
    }
    const record = rawHabit as Record<string, unknown>;
    const title = cleanText(record.title, MAX_TITLE_LENGTH);
    if (!title) {
      issues.push(`Untitled habit ${index + 1} was removed.`);
      continue;
    }
    const id = makeUniqueId(record.id, `habit-${index + 1}`, usedIds);
    habits.push({ id, title, babyTasks: normalizeBabyTasks(record.babyTasks, id, issues) });
  }

  if (value.length > MAX_LOCK_IN_HABITS) {
    issues.push(`Only the first ${MAX_LOCK_IN_HABITS} habits were kept.`);
  }
  return habits;
}

function normalizeCompletion(
  value: unknown,
  habit: LockInHabit,
  issues: string[],
  date: IsoDate,
): HabitCompletion | null {
  if (!value || typeof value !== "object") {
    issues.push(`Invalid completion for ${habit.id} on ${date} was removed.`);
    return null;
  }

  const record = value as Record<string, unknown>;
  const allowedTaskIds = new Set(habit.babyTasks.map((task) => task.id));
  const rawIds = Array.isArray(record.completedBabyTaskIds) ? record.completedBabyTaskIds : [];
  const completedBabyTaskIds = Array.from(
    new Set(rawIds.filter((id): id is string => typeof id === "string" && allowedTaskIds.has(id))),
  );
  if (record.completedBabyTaskIds != null && !Array.isArray(record.completedBabyTaskIds)) {
    issues.push(`Invalid baby-task completion list for ${habit.id} on ${date} was reset.`);
  }

  const done = record.done === true;
  if (!done && completedBabyTaskIds.length === 0) return null;
  return { done, completedBabyTaskIds };
}

function normalizeDay(
  value: unknown,
  date: IsoDate,
  habitsById: Map<string, LockInHabit>,
  issues: string[],
): LockInDayEntry | null {
  if (!value || typeof value !== "object") {
    issues.push(`Invalid entry for ${date} was removed.`);
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawCompletions =
    record.completions && typeof record.completions === "object"
      ? (record.completions as Record<string, unknown>)
      : {};
  if (record.completions != null && typeof record.completions !== "object") {
    issues.push(`Invalid completions for ${date} were reset.`);
  }

  const completions: Record<string, HabitCompletion> = {};
  for (const [habitId, rawCompletion] of Object.entries(rawCompletions)) {
    const habit = habitsById.get(habitId);
    if (!habit) {
      issues.push(`Completion for unknown habit ${habitId} on ${date} was removed.`);
      continue;
    }
    const completion = normalizeCompletion(rawCompletion, habit, issues, date);
    if (completion) completions[habit.id] = completion;
  }

  const rawNote = typeof record.note === "string" ? record.note : "";
  const note = rawNote.slice(0, MAX_NOTE_LENGTH);
  if (rawNote.length > MAX_NOTE_LENGTH) issues.push(`The note for ${date} was shortened.`);

  let finalizedAt: string | undefined;
  if (typeof record.finalizedAt === "string" && !Number.isNaN(new Date(record.finalizedAt).getTime())) {
    finalizedAt = new Date(record.finalizedAt).toISOString();
  } else if (record.finalizedAt != null) {
    issues.push(`Invalid finalization time for ${date} was removed.`);
  }

  if (Object.keys(completions).length === 0 && note.length === 0 && !finalizedAt) return null;
  return {
    completions,
    ...(note ? { note } : {}),
    ...(finalizedAt ? { finalizedAt } : {}),
  };
}

/** Converts unknown persisted input into a safe v2 state without ever throwing. */
export function normalizeLockInState(
  value: unknown,
  now: Date = new Date(),
): LockInValidationResult {
  const fallback = createDefaultLockInState(now);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { state: fallback, issues: ["The saved Lock-in data was not an object."], fatal: true };
  }

  const record = value as Record<string, unknown>;
  if (record.version !== LOCK_IN_SCHEMA_VERSION) {
    return {
      state: fallback,
      issues: [`Unsupported Lock-in data version: ${String(record.version)}.`],
      fatal: true,
    };
  }

  const issues: string[] = [];
  const rawChallenge =
    record.challenge && typeof record.challenge === "object"
      ? (record.challenge as Record<string, unknown>)
      : {};
  const challengeTitle = cleanText(rawChallenge.title, MAX_TITLE_LENGTH) || DEFAULT_CHALLENGE_TITLE;
  const displayName = cleanText(rawChallenge.displayName, MAX_DISPLAY_NAME_LENGTH);
  const checkInTime =
    typeof rawChallenge.checkInTime === "string" &&
    CHECK_IN_TIME_PATTERN.test(rawChallenge.checkInTime)
      ? rawChallenge.checkInTime
      : DEFAULT_LOCK_IN_CHECK_IN_TIME;
  if (rawChallenge.startDate !== LOCK_IN_START_DATE || rawChallenge.endDate !== LOCK_IN_END_DATE) {
    issues.push("Challenge dates were restored to September 1–December 31, 2026.");
  }
  if (rawChallenge.timeZone !== LOCK_IN_TIME_ZONE) {
    issues.push(`Challenge timezone was restored to ${LOCK_IN_TIME_ZONE}.`);
  }
  if (
    rawChallenge.checkInTime != null &&
    (typeof rawChallenge.checkInTime !== "string" ||
      !CHECK_IN_TIME_PATTERN.test(rawChallenge.checkInTime))
  ) {
    issues.push(`Check-in time was restored to ${DEFAULT_LOCK_IN_CHECK_IN_TIME}.`);
  }

  const habits = normalizeHabits(record.habits, issues);
  const habitsById = new Map(habits.map((habit) => [habit.id, habit]));
  const days: Record<IsoDate, LockInDayEntry> = {};
  if (record.days != null && (!record.days || typeof record.days !== "object" || Array.isArray(record.days))) {
    issues.push("Daily entries were invalid and were reset.");
  } else if (record.days && typeof record.days === "object") {
    for (const [date, rawDay] of Object.entries(record.days as Record<string, unknown>)) {
      if (!isIsoDate(date) || !isLockInDate(date)) {
        issues.push(`Out-of-range daily entry ${date} was removed.`);
        continue;
      }
      const day = normalizeDay(rawDay, date, habitsById, issues);
      if (day) days[date] = day;
    }
  }

  const nowTimestamp = safeNow(now);
  return {
    state: {
      version: LOCK_IN_SCHEMA_VERSION,
      challenge: {
        id: cleanText(rawChallenge.id, 100) || DEFAULT_CHALLENGE_ID,
        title: challengeTitle,
        displayName,
        startDate: LOCK_IN_START_DATE,
        endDate: LOCK_IN_END_DATE,
        timeZone: LOCK_IN_TIME_ZONE,
        checkInTime,
        createdAt: timestamp(rawChallenge.createdAt, nowTimestamp),
      },
      habits,
      days,
      updatedAt: timestamp(record.updatedAt, nowTimestamp),
    },
    issues,
    fatal: false,
  };
}

function storageError(
  code: LockInStorageErrorCode,
  message: string,
  cause?: unknown,
): LockInStorageError {
  return { code, message, recoverable: true, ...(cause === undefined ? {} : { cause }) };
}

function resolveStorage(storage?: StorageLike):
  | { storage: StorageLike }
  | { error: LockInStorageError } {
  if (storage) return { storage };
  if (typeof window === "undefined") {
    return {
      error: storageError("storage-unavailable", "Browser storage is unavailable in this environment."),
    };
  }

  try {
    return { storage: window.localStorage };
  } catch (cause) {
    return {
      error: storageError("storage-unavailable", "Browser storage could not be accessed.", cause),
    };
  }
}

/** Always returns a usable state. Check error/recovered to show non-blocking recovery UI. */
export function loadLockInState(
  storage?: StorageLike,
  now: Date = new Date(),
): LoadLockInResult {
  const fallback = createDefaultLockInState(now);
  const resolved = resolveStorage(storage);
  if ("error" in resolved) {
    return {
      state: fallback,
      source: "default",
      recovered: true,
      warnings: [],
      error: resolved.error,
    };
  }

  let raw: string | null;
  try {
    raw = resolved.storage.getItem(LOCK_IN_STORAGE_KEY);
  } catch (cause) {
    return {
      state: fallback,
      source: "default",
      recovered: true,
      warnings: [],
      error: storageError("read-failed", "Saved Lock-in data could not be read.", cause),
    };
  }

  if (raw === null) {
    return { state: fallback, source: "default", recovered: false, warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return {
      state: fallback,
      source: "recovered",
      recovered: true,
      warnings: [],
      error: storageError("invalid-json", "Saved Lock-in data was damaged; a fresh copy was opened.", cause),
    };
  }

  const validation = normalizeLockInState(parsed, now);
  if (validation.fatal) {
    return {
      state: fallback,
      source: "recovered",
      recovered: true,
      warnings: validation.issues,
      error: storageError("invalid-data", "Saved Lock-in data could not be safely recovered."),
    };
  }

  return {
    state: validation.state,
    source: validation.issues.length ? "recovered" : "storage",
    recovered: validation.issues.length > 0,
    warnings: validation.issues,
    ...(validation.issues.length
      ? { error: storageError("invalid-data", "Some saved Lock-in fields were repaired.") }
      : {}),
  };
}

/** Saves only the v2 Lock-in key. Existing daymark:v1:* plans remain untouched. */
export function saveLockInState(
  value: LockInState,
  storage?: StorageLike,
  now: Date = new Date(),
): SaveLockInResult {
  const validation = normalizeLockInState(value, now);
  if (validation.fatal) {
    return {
      ok: false,
      state: validation.state,
      warnings: validation.issues,
      error: storageError("invalid-data", "Lock-in data was not saved because it was invalid."),
    };
  }

  const state = { ...validation.state, updatedAt: safeNow(now) };
  const resolved = resolveStorage(storage);
  if ("error" in resolved) {
    return { ok: false, state, warnings: validation.issues, error: resolved.error };
  }

  try {
    resolved.storage.setItem(LOCK_IN_STORAGE_KEY, JSON.stringify(state));
    return { ok: true, state, warnings: validation.issues };
  } catch (cause) {
    return {
      ok: false,
      state,
      warnings: validation.issues,
      error: storageError("write-failed", "Lock-in changes could not be saved on this device.", cause),
    };
  }
}

export type LockInStorageListener = (result: LoadLockInResult, event: StorageEvent) => void;

/** Keeps multiple Daymark tabs in sync. It is a no-op during SSR or tests without window. */
export function subscribeToLockInStorage(listener: LockInStorageListener): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    // A null key means another tab called localStorage.clear().
    if (event.key !== null && event.key !== LOCK_IN_STORAGE_KEY) return;
    // loadLockInState resolves localStorage defensively, including browsers where
    // accessing it can throw because of privacy settings.
    listener(loadLockInState(), event);
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
