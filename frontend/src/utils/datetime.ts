/**
 * IST (Asia/Kolkata, UTC+5:30) date/time formatters + a robust ISO parser.
 *
 * The backend stores datetimes as UTC but SQLite strips the tz info on retrieve,
 * so Pydantic emits naive ISO strings like "2026-05-18T09:21:00.123" (no Z).
 * `new Date(string)` parses such strings as LOCAL time, which would shift every
 * displayed timestamp by the user's UTC offset and break time-based comparisons
 * (e.g. lastSeen-vs-created_at for notification badges). `parseBackendTimestamp`
 * appends 'Z' when no timezone designator is present, so all backend timestamps
 * are interpreted as UTC.
 */

type DateInput = string | Date | number;

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Matches a trailing timezone designator: 'Z', '+0530', '+05:30', '-04:00', etc.
const TZ_DESIGNATOR = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parse a Date from any value the backend can emit. ISO strings without an
 * explicit timezone designator are assumed to be UTC.
 */
export function parseBackendTimestamp(input: DateInput): Date {
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  const trimmed = input.trim();
  const normalized = TZ_DESIGNATOR.test(trimmed) ? trimmed : trimmed + "Z";
  return new Date(normalized);
}

export function formatISTDate(input: DateInput): string {
  return DATE_FMT.format(parseBackendTimestamp(input));
}

export function formatISTDateTime(input: DateInput): string {
  return `${DATETIME_FMT.format(parseBackendTimestamp(input))} IST`;
}
