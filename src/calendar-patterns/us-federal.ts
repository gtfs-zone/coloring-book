import { toGtfsDate as toYYYYMMDD } from '../utils/gtfs-date.js';

/** Day of week for a UTC date (0=Sun, 1=Mon, ..., 6=Sat) */
function utcDow(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

/**
 * Observed date for a fixed holiday (Jan 1, Jun 19, Jul 4, Nov 11, Dec 25).
 * If the actual date falls on Saturday, observed Friday.
 * If it falls on Sunday, observed Monday.
 */
function fixedObserved(year: number, month: number, day: number): string {
  const dow = utcDow(year, month, day);
  let observedDay = day;
  let observedMonth = month;
  let observedYear = year;
  if (dow === 6) {
    // Saturday to Friday
    const d = new Date(Date.UTC(year, month, day - 1));
    observedYear = d.getUTCFullYear();
    observedMonth = d.getUTCMonth();
    observedDay = d.getUTCDate();
  } else if (dow === 0) {
    // Sunday to Monday
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
 * nth=1 is first, nth=2 is second, nth=-1 is last.
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

/** One observed federal holiday: the date it is observed and its name. */
export interface UsFederalHoliday {
  date: string;
  name: string;
}

/** Observed dates and names of the eleven US federal holidays in one year. */
export function getUsFederalHolidays(year: number): UsFederalHoliday[] {
  return [
    // New Year's Day: Jan 1
    { date: fixedObserved(year, 0, 1), name: "New Year's Day" },
    // MLK Day: 3rd Monday in January
    {
      date: nthWeekday(year, 0, 1, 3),
      name: 'Martin Luther King, Jr. Day',
    },
    // Presidents' Day: 3rd Monday in February
    { date: nthWeekday(year, 1, 1, 3), name: "Presidents' Day" },
    // Memorial Day: last Monday in May
    { date: nthWeekday(year, 4, 1, -1), name: 'Memorial Day' },
    // Juneteenth: Jun 19
    { date: fixedObserved(year, 5, 19), name: 'Juneteenth' },
    // Independence Day: Jul 4
    { date: fixedObserved(year, 6, 4), name: 'Independence Day' },
    // Labor Day: 1st Monday in September
    { date: nthWeekday(year, 8, 1, 1), name: 'Labor Day' },
    // Columbus Day: 2nd Monday in October
    { date: nthWeekday(year, 9, 1, 2), name: 'Columbus Day' },
    // Veterans Day: Nov 11
    { date: fixedObserved(year, 10, 11), name: 'Veterans Day' },
    // Thanksgiving: 4th Thursday in November
    { date: nthWeekday(year, 10, 4, 4), name: 'Thanksgiving Day' },
    // Christmas Day: Dec 25
    { date: fixedObserved(year, 11, 25), name: 'Christmas Day' },
  ];
}

/** Observed dates of the eleven US federal holidays in one year, as YYYYMMDD. */
export function getUsFederalDates(year: number): string[] {
  return getUsFederalHolidays(year).map((holiday) => holiday.date);
}
