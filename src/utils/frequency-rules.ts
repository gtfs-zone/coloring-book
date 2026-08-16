/**
 * The rules frequencies.txt puts on a headway period.
 *
 * Shared by the timetable band's commit gate and by the feed validator, so a
 * period typed in the app and one that arrived in an imported feed are judged
 * by the same rule. Messages read as statements about the row, since they are
 * shown both as an edit toast and as an Issues panel entry.
 *
 * Like `validateFlexStopTimeRow`, every check tolerates a half-typed row.
 */

import { generateCompositeKeyFromRecord } from './gtfs-primary-keys.js';
import { TimeFormatter } from './time-formatter.js';

function cell(row: Record<string, unknown>, field: string): string {
  return String(row[field] ?? '').trim();
}

/**
 * The row's composite primary key, `trip_id:start_time`.
 *
 * `start_time` is part of the key, so editing it re-keys the record: the write
 * path is a delete plus an insert, never an update.
 */
export function frequencyPeriodKey(row: Record<string, unknown>): string {
  return generateCompositeKeyFromRecord('frequencies', row);
}

/**
 * Required fields, value formats, ordering, and overlap against the trip's
 * other periods.
 *
 * @param row - The prospective period
 * @param siblings - The same trip's other periods, excluding this one
 * @returns The first violation, or null when the row is acceptable
 */
export function validateFrequencyRow(
  row: Record<string, unknown>,
  siblings: Record<string, unknown>[] = []
): string | null {
  const trip_id = cell(row, 'trip_id');
  if (trip_id === '') {
    return 'trip_id is required';
  }

  const start = cell(row, 'start_time');
  if (start === '') {
    return 'start_time is required';
  }
  const end = cell(row, 'end_time');
  if (end === '') {
    return 'end_time is required';
  }

  const startSecs = TimeFormatter.timeToSeconds(start);
  if (startSecs === null) {
    return `start_time '${start}' is not a valid time`;
  }
  const endSecs = TimeFormatter.timeToSeconds(end);
  if (endSecs === null) {
    return `end_time '${end}' is not a valid time`;
  }
  if (endSecs <= startSecs) {
    return 'end_time must be later than start_time';
  }

  const headway = cell(row, 'headway_secs');
  if (headway === '') {
    return 'headway_secs is required';
  }
  if (!/^\d+$/.test(headway) || parseInt(headway, 10) <= 0) {
    return `headway_secs '${headway}' must be a positive whole number of seconds`;
  }

  const exact_times = cell(row, 'exact_times');
  if (exact_times !== '' && exact_times !== '0' && exact_times !== '1') {
    return `exact_times '${exact_times}' must be 0, 1 or empty`;
  }

  // Intervals are half-open: "New headways may start at the exact time the
  // previous headway ends", so touching endpoints are legal and only a real
  // interior overlap is an error.
  for (const sibling of siblings) {
    const siblingStart = TimeFormatter.timeToSeconds(
      cell(sibling, 'start_time')
    );
    const siblingEnd = TimeFormatter.timeToSeconds(cell(sibling, 'end_time'));
    if (siblingStart === null || siblingEnd === null) {
      continue;
    }
    if (startSecs < siblingEnd && siblingStart < endSecs) {
      return `headway period ${start}-${end} overlaps ${cell(sibling, 'start_time')}-${cell(sibling, 'end_time')} on the same trip`;
    }
  }

  return null;
}

/**
 * One period spelled out for a tooltip, e.g. `06:00:00-09:00:00 every 10m`.
 * The headway shows in minutes only when it divides evenly.
 */
export function describeFrequency(row: Record<string, unknown>): string {
  const start = cell(row, 'start_time') || '?';
  const end = cell(row, 'end_time') || '?';
  const headway = cell(row, 'headway_secs');

  if (headway === '' || !/^\d+$/.test(headway)) {
    return `${start}-${end}`;
  }

  const secs = parseInt(headway, 10);
  const every = secs % 60 === 0 ? `${secs / 60}m` : `${secs}s`;
  return `${start}-${end} every ${every}`;
}
