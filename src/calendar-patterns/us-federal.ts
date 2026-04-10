import type { HolidayPattern } from './types.js';

/** Format a UTC Date as YYYYMMDD */
function toYYYYMMDD(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Day of week for a UTC date (0=Sun, 1=Mon, ..., 6=Sat) */
function utcDow(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

/**
 * Observed date for a fixed holiday (Jan 1, Jun 19, Jul 4, Nov 11, Dec 25).
 * If the actual date falls on Saturday → observed Friday.
 * If it falls on Sunday → observed Monday.
 */
function fixedObserved(year: number, month: number, day: number): string {
  const dow = utcDow(year, month, day);
  let observedDay = day;
  let observedMonth = month;
  let observedYear = year;
  if (dow === 6) {
    // Saturday → Friday
    const d = new Date(Date.UTC(year, month, day - 1));
    observedYear = d.getUTCFullYear();
    observedMonth = d.getUTCMonth();
    observedDay = d.getUTCDate();
  } else if (dow === 0) {
    // Sunday → Monday
    const d = new Date(Date.UTC(year, month, day + 1));
    observedYear = d.getUTCFullYear();
    observedMonth = d.getUTCMonth();
    observedDay = d.getUTCDate();
  }
  return toYYYYMMDD(
    new Date(Date.UTC(observedYear, observedMonth, observedDay))
  );
}

/**
 * Nth occurrence of a given day-of-week in a month.
 * nth=1 → first, nth=2 → second, nth=-1 → last.
 */
function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  nth: number
): string {
  if (nth > 0) {
    // Find first occurrence
    const firstDow = utcDow(year, month, 1);
    let day = 1 + ((weekday - firstDow + 7) % 7);
    day += (nth - 1) * 7;
    return toYYYYMMDD(new Date(Date.UTC(year, month, day)));
  } else {
    // Last occurrence: find last day of month, walk back
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const lastDow = utcDow(year, month, lastDay);
    const day = lastDay - ((lastDow - weekday + 7) % 7);
    return toYYYYMMDD(new Date(Date.UTC(year, month, day)));
  }
}

function getUsFederalDates(year: number): string[] {
  return [
    // New Year's Day — Jan 1
    fixedObserved(year, 0, 1),
    // MLK Day — 3rd Monday in January
    nthWeekday(year, 0, 1, 3),
    // Presidents' Day — 3rd Monday in February
    nthWeekday(year, 1, 1, 3),
    // Memorial Day — last Monday in May
    nthWeekday(year, 4, 1, -1),
    // Juneteenth — Jun 19
    fixedObserved(year, 5, 19),
    // Independence Day — Jul 4
    fixedObserved(year, 6, 4),
    // Labor Day — 1st Monday in September
    nthWeekday(year, 8, 1, 1),
    // Columbus Day — 2nd Monday in October
    nthWeekday(year, 9, 1, 2),
    // Veterans Day — Nov 11
    fixedObserved(year, 10, 11),
    // Thanksgiving — 4th Thursday in November
    nthWeekday(year, 10, 4, 4),
    // Christmas Day — Dec 25
    fixedObserved(year, 11, 25),
  ];
}

export const US_FEDERAL_HOLIDAYS: HolidayPattern = {
  id: 'us-federal',
  name: 'US Federal Holidays',
  region: 'US',
  getDates: getUsFederalDates,
};
