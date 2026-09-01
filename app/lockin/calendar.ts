const DEFAULT_TIME_ZONE = "Africa/Lagos";
const DEFAULT_CHECK_IN_TIME = "21:00";
const DEFAULT_URL = "https://daymark-bice.vercel.app/";
const LOCK_IN_START = "20260901";
const LOCK_IN_OCCURRENCES = 122;

export type LockInCalendarOptions = {
  /** Local wall-clock time in 24-hour HH:mm format. */
  time?: string;
  /** An IANA time-zone name, for example Africa/Lagos. */
  timeZone?: string;
  title?: string;
  description?: string;
  alarmMinutesBefore?: number;
  url?: string;
  filename?: string;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold an iCalendar content line at 75 UTF-8 octets (continuations include one space). */
function foldLine(line: string) {
  const encoder = new TextEncoder();

  if (encoder.encode(line).length <= 75) {
    return line;
  }

  const chunks: string[] = [];
  let chunk = "";
  let limit = 75;

  for (const character of line) {
    if (chunk && encoder.encode(chunk + character).length > limit) {
      chunks.push(chunk);
      chunk = character;
      limit = 74;
    } else {
      chunk += character;
    }
  }

  if (chunk) chunks.push(chunk);

  return chunks
    .map((value, index) => (index === 0 ? value : ` ${value}`))
    .join("\r\n");
}

function serialize(lines: string[]) {
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function validateTime(value: string) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) {
    throw new Error(`Invalid check-in time "${value}". Use 24-hour HH:mm format.`);
  }
  return value.replace(":", "") + "00";
}

function validateTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    throw new Error(`Invalid IANA time zone "${value}".`);
  }
  return value;
}

function formatUtc(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function offsetValue(minutes: number) {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const remainder = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}${remainder}`;
}

/**
 * Produce a compact VTIMEZONE definition using the platform's IANA time-zone
 * data. This preserves the chosen local time even in zones with a DST change.
 */
function timeZoneLines(timeZone: string) {
  const partsFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const nameFormatter = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "short",
  });

  const zonedParts = (instant: number): ZonedDateParts => {
    const values: Record<string, number> = {};
    for (const part of partsFormatter.formatToParts(new Date(instant))) {
      if (part.type !== "literal") values[part.type] = Number(part.value);
    }
    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      second: values.second,
    };
  };

  const offsetAt = (instant: number) => {
    const parts = zonedParts(instant);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const wholeSecondInstant = Math.floor(instant / 1000) * 1000;
    return Math.round((representedAsUtc - wholeSecondInstant) / 60_000);
  };

  const localDateTime = (instant: number) => {
    const part = zonedParts(instant);
    return [
      String(part.year).padStart(4, "0"),
      String(part.month).padStart(2, "0"),
      String(part.day).padStart(2, "0"),
      "T",
      String(part.hour).padStart(2, "0"),
      String(part.minute).padStart(2, "0"),
      String(part.second).padStart(2, "0"),
    ].join("");
  };

  const zoneName = (instant: number) =>
    nameFormatter
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

  const rangeStart = Date.UTC(2026, 0, 1);
  const rangeEnd = Date.UTC(2027, 0, 2);
  const step = 6 * 60 * 60 * 1000;
  const transitions: Array<{
    instant: number;
    before: number;
    after: number;
  }> = [];

  let previousInstant = rangeStart;
  let previousOffset = offsetAt(previousInstant);

  for (let instant = rangeStart + step; instant <= rangeEnd; instant += step) {
    const offset = offsetAt(instant);
    if (offset !== previousOffset) {
      let low = previousInstant;
      let high = instant;
      const before = previousOffset;

      while (high - low > 60_000) {
        const middle = Math.floor((low + high) / 120_000) * 60_000;
        if (offsetAt(middle) === before) low = middle;
        else high = middle;
      }

      const transitionInstant = Math.ceil(high / 60_000) * 60_000;
      transitions.push({
        instant: transitionInstant,
        before,
        after: offsetAt(transitionInstant),
      });
    }
    previousInstant = instant;
    previousOffset = offset;
  }

  const allOffsets = [offsetAt(rangeStart), ...transitions.map(({ after }) => after)];
  const standardOffset = Math.min(...allOffsets);
  const initialOffset = offsetAt(rangeStart);
  const initialKind = initialOffset > standardOffset ? "DAYLIGHT" : "STANDARD";
  const lines = [
    "BEGIN:VTIMEZONE",
    `TZID:${escapeText(timeZone)}`,
    `X-LIC-LOCATION:${escapeText(timeZone)}`,
    `BEGIN:${initialKind}`,
    "DTSTART:20260101T000000",
    `TZOFFSETFROM:${offsetValue(initialOffset)}`,
    `TZOFFSETTO:${offsetValue(initialOffset)}`,
    `TZNAME:${escapeText(zoneName(rangeStart))}`,
    `END:${initialKind}`,
  ];

  for (const transition of transitions) {
    const kind = transition.after > transition.before ? "DAYLIGHT" : "STANDARD";
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${localDateTime(transition.instant)}`,
      `TZOFFSETFROM:${offsetValue(transition.before)}`,
      `TZOFFSETTO:${offsetValue(transition.after)}`,
      `TZNAME:${escapeText(zoneName(transition.instant))}`,
      `END:${kind}`,
    );
  }

  lines.push("END:VTIMEZONE");
  return lines;
}

/** Build the complete .ics payload for Daymark's September–December lock-in. */
export function createLockInCalendar(options: LockInCalendarOptions = {}) {
  const timeZone = validateTimeZone(options.timeZone ?? DEFAULT_TIME_ZONE);
  const localTime = validateTime(options.time ?? DEFAULT_CHECK_IN_TIME);
  const url = options.url ?? DEFAULT_URL;
  const title = options.title ?? "Daymark evening check-in";
  const description =
    options.description ??
    "Open Daymark, review your day, and mark today's habits complete.";
  const alarmMinutesBefore = options.alarmMinutesBefore ?? 10;

  if (
    !Number.isInteger(alarmMinutesBefore) ||
    alarmMinutesBefore < 0 ||
    alarmMinutesBefore > 10_080
  ) {
    throw new Error("alarmMinutesBefore must be a whole number from 0 to 10080.");
  }

  const trigger = alarmMinutesBefore === 0 ? "PT0M" : `-PT${alarmMinutesBefore}M`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Daymark//Lock-in Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Daymark Lock-in",
    `X-WR-TIMEZONE:${escapeText(timeZone)}`,
    ...timeZoneLines(timeZone),
    "BEGIN:VEVENT",
    "UID:daymark-lock-in-2026@daymark-bice.vercel.app",
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART;TZID=${timeZone}:${LOCK_IN_START}T${localTime}`,
    "DURATION:PT15M",
    `RRULE:FREQ=DAILY;COUNT=${LOCK_IN_OCCURRENCES}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(`${description}\n${url}`)}`,
    `URL;VALUE=URI:${url}`,
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    `TRIGGER:${trigger}`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return serialize(lines);
}

/** Generate and download the reminder in the browser. Returns the .ics payload. */
export function downloadLockInCalendar(options: LockInCalendarOptions = {}) {
  if (typeof document === "undefined") {
    throw new Error("downloadLockInCalendar can only run in a browser.");
  }

  const calendar = createLockInCalendar(options);
  const blobUrl = URL.createObjectURL(
    new Blob([calendar], { type: "text/calendar;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = options.filename ?? "daymark-lock-in-2026.ics";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);

  return calendar;
}
