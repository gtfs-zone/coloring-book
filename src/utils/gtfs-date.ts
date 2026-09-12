/**
 * GTFS Date Utility
 *
 * GTFS service dates are bare `YYYYMMDD` strings with no timezone attached: a
 * calendar day, not an instant. Every conversion here therefore goes through
 * UTC. Reading a `Date` built from a date-only string with local getters is the
 * classic way to lose a day west of Greenwich, and this module exists so that
 * mistake has exactly one place it could live.
 *
 * Pure functions, no DOM, no dependencies. Never throws: unparseable input
 * comes back unchanged, falsy input comes back as ''.
 */

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const GTFS_DATE_PATTERN = /^\d{8}$/;

/**
 * Parse a GTFS date into a Date pinned to UTC midnight.
 *
 * @returns null when the input is not 8 digits.
 * @example
 * parseGtfsDate('20260101') -> Date(2026-01-01T00:00:00Z)
 * parseGtfsDate('') -> null
 */
export function parseGtfsDate(date: string): Date | null {
  const trimmed = String(date ?? '').trim();
  if (!GTFS_DATE_PATTERN.test(trimmed)) {
    return null;
  }
  const year = Number(trimmed.slice(0, 4));
  const month = Number(trimmed.slice(4, 6));
  const day = Number(trimmed.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Format a Date as a GTFS date string, reading it in UTC.
 *
 * @example
 * toGtfsDate(new Date(Date.UTC(2026, 0, 1))) -> '20260101'
 */
export function toGtfsDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format a Date as a GTFS date string, reading it in the user's timezone.
 *
 * Use this only for dates derived from the wall clock, where "today" means the
 * user's today. Everything that originates in the feed must use `toGtfsDate`.
 */
export function toGtfsDateLocal(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/** Today in the user's timezone, as a GTFS date. */
export function todayGtfsDate(): string {
  return toGtfsDateLocal(new Date());
}

/**
 * Human-readable form of a single GTFS date.
 *
 * @returns the input unchanged when it is not a GTFS date, so a malformed feed
 * value stays visible to the user rather than silently blanking.
 * @example
 * formatGtfsDate('20260101') -> 'Jan 1, 2026'
 */
export function formatGtfsDate(date: string): string {
  const parsed = parseGtfsDate(date);
  if (!parsed) {
    return String(date ?? '');
  }
  return `${MONTH_ABBR[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

/**
 * Human-readable form with the weekday spelled out, for contexts where which
 * day of the week a date lands on is the point.
 *
 * @example
 * formatGtfsDateWithWeekday('20260101') -> 'Thu, Jan 1, 2026'
 */
export function formatGtfsDateWithWeekday(date: string): string {
  const parsed = parseGtfsDate(date);
  if (!parsed) {
    return String(date ?? '');
  }
  return `${DAY_ABBR[parsed.getUTCDay()]}, ${formatGtfsDate(date)}`;
}

/**
 * Human-readable date range. Endpoints in the same year print the year once.
 *
 * @example
 * formatGtfsDateRange('20260101', '20261231') -> 'Jan 1 - Dec 31, 2026'
 * formatGtfsDateRange('20251215', '20260301') -> 'Dec 15, 2025 - Mar 1, 2026'
 * formatGtfsDateRange('20260704', '20260704') -> 'Jul 4, 2026'
 */
export function formatGtfsDateRange(start: string, end?: string): string {
  const startText = formatGtfsDate(start);
  if (!end || start === end) {
    return startText;
  }

  const startDate = parseGtfsDate(start);
  const endDate = parseGtfsDate(end);
  if (
    startDate &&
    endDate &&
    startDate.getUTCFullYear() === endDate.getUTCFullYear()
  ) {
    const startNoYear = `${MONTH_ABBR[startDate.getUTCMonth()]} ${startDate.getUTCDate()}`;
    return `${startNoYear} - ${formatGtfsDate(end)}`;
  }

  return `${startText} - ${formatGtfsDate(end)}`;
}

/**
 * A GTFS date as the calendar input speaks it: `YYYYMMDD` in, a UTC-midnight
 * `Date` out. Structurally a `DateCodec`, without importing the DOM module
 * that declares the type - this file has no dependencies and keeps none.
 */
export const GTFS_DATE_CODEC = {
  parse: parseGtfsDate,
  format: toGtfsDate,
};

/**
 * GTFS date to the `YYYY-MM-DD` value an `<input type="date">` requires.
 *
 * @example
 * toInputValue('20260101') -> '2026-01-01'
 */
export function toInputValue(date: string): string {
  const trimmed = String(date ?? '').trim();
  if (!GTFS_DATE_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
}

/**
 * `<input type="date">` value back to a GTFS date.
 *
 * Deliberately string manipulation rather than a Date round-trip: `new
 * Date('2026-01-01')` is UTC midnight, and any local-time getter applied to it
 * yields the previous day in the Americas.
 *
 * @example
 * fromInputValue('2026-01-01') -> '20260101'
 */
export function fromInputValue(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/-/g, '');
}
