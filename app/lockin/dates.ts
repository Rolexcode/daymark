import type { IsoDate } from "./types";

export const LOCK_IN_START_DATE: IsoDate = "2026-09-01";
export const LOCK_IN_END_DATE: IsoDate = "2026-12-31";
export const LOCK_IN_TIME_ZONE = "Africa/Lagos";
export const DEFAULT_LOCK_IN_CHECK_IN_TIME = "21:00";
export const LOCK_IN_TOTAL_DAYS = 122;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_IN_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toUtcDate(date: IsoDate): Date {
  if (!isIsoDate(date)) {
    throw new RangeError(`Invalid ISO calendar date: ${String(date)}`);
  }

  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addCalendarDays(date: IsoDate, amount: number): IsoDate {
  if (!Number.isInteger(amount)) {
    throw new RangeError("Calendar-day amount must be an integer.");
  }

  const next = toUtcDate(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / DAY_IN_MS);
}

export function compareIsoDates(left: IsoDate, right: IsoDate): -1 | 0 | 1 {
  if (!isIsoDate(left) || !isIsoDate(right)) {
    throw new RangeError("Both values must be valid ISO calendar dates.");
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

export function getDateInTimeZone(
  instant: Date = new Date(),
  timeZone: string = LOCK_IN_TIME_ZONE,
): IsoDate {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Cannot format an invalid Date.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isLockInDate(date: unknown): date is IsoDate {
  return (
    isIsoDate(date) &&
    date >= LOCK_IN_START_DATE &&
    date <= LOCK_IN_END_DATE
  );
}

/** Returns a one-based challenge day, or null when outside the challenge. */
export function getLockInDayNumber(date: IsoDate): number | null {
  if (!isLockInDate(date)) return null;
  return calendarDaysBetween(LOCK_IN_START_DATE, date) + 1;
}

export function clampToLockIn(date: IsoDate): IsoDate {
  if (!isIsoDate(date)) throw new RangeError(`Invalid ISO calendar date: ${String(date)}`);
  if (date < LOCK_IN_START_DATE) return LOCK_IN_START_DATE;
  if (date > LOCK_IN_END_DATE) return LOCK_IN_END_DATE;
  return date;
}

export function getLockInDates(): IsoDate[] {
  return Array.from({ length: LOCK_IN_TOTAL_DAYS }, (_, index) =>
    addCalendarDays(LOCK_IN_START_DATE, index),
  );
}

export function getElapsedLockInDates(asOfDate: IsoDate = getDateInTimeZone()): IsoDate[] {
  if (!isIsoDate(asOfDate) || asOfDate < LOCK_IN_START_DATE) return [];
  const lastDate = asOfDate > LOCK_IN_END_DATE ? LOCK_IN_END_DATE : asOfDate;
  const count = calendarDaysBetween(LOCK_IN_START_DATE, lastDate) + 1;
  return getLockInDates().slice(0, count);
}

export function isFutureLockInDate(
  date: IsoDate,
  today: IsoDate = getDateInTimeZone(),
): boolean {
  return isLockInDate(date) && isIsoDate(today) && date > today;
}

export function canCheckInOn(
  date: IsoDate,
  today: IsoDate = getDateInTimeZone(),
): boolean {
  return isLockInDate(date) && isIsoDate(today) && date <= today;
}
