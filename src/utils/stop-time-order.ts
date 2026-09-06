/**
 * The chronological ordering rule for one trip's stop_times.
 *
 * Shared so the "sort by time" action and the timetable header ask the same
 * question: the header flags a trip the sort would move, and pressing sort then
 * moves exactly those rows.
 */

import type { StopTimes } from '../types/gtfs-entities.js';

/**
 * The time a row sorts on.
 *
 * A flex row's pickup/drop-off window is a real time, so it sorts on that: a
 * deviation zone belongs between the timed stops its window falls between,
 * whatever slot it happens to sit in.
 */
export function effectiveStopTime(st: StopTimes): string {
  return (
    st.arrival_time ||
    st.departure_time ||
    st.start_pickup_drop_off_window ||
    st.end_pickup_drop_off_window ||
    ''
  );
}

/**
 * The sort key of each row, in the order given.
 *
 * A row with no time at all inherits the time of the row above it, so in feeds
 * that only time their timepoints the untimed stops travel with the timepoint
 * they follow instead of being flung to one end of the trip. Leading rows with
 * nothing above them to inherit from keep an empty key, which sorts them to the
 * front - where they already are.
 */
function anchorKeys(rows: StopTimes[]): string[] {
  let anchor = '';
  return rows.map((st) => {
    anchor = effectiveStopTime(st) || anchor;
    return anchor;
  });
}

/**
 * Sort a trip's rows into chronological order.
 *
 * Sorting whole rows rather than redistributing timed rows into the slots they
 * already occupy is what makes this safe across an insert: the old scheme
 * pinned untimed rows to an absolute index, so adding a row shifted every timed
 * row one place across them and silently changed their relative order.
 *
 * Row objects are returned by identity, never copied: callers locate the row
 * they edited with `indexOf` and detect movement by reference comparison.
 *
 * @param rows - The trip's stop_times, in stop_sequence order
 */
export function chronologicalOrder(rows: StopTimes[]): StopTimes[] {
  const keys = anchorKeys(rows);
  const keyed = rows.map((st, index) => ({ st, key: keys[index], index }));

  // Tie-break on the original index so equal times never churn.
  keyed.sort((a, b) =>
    a.key === b.key ? a.index - b.index : a.key.localeCompare(b.key)
  );
  return keyed.map((entry) => entry.st);
}

/**
 * Whether the rows are already in chronological order, i.e. whether
 * `chronologicalOrder` would move anything.
 *
 * @param rows - The trip's stop_times, in stop_sequence order
 */
export function isChronological(rows: StopTimes[]): boolean {
  const keys = anchorKeys(rows);
  return keys.every((key, index) => index === 0 || keys[index - 1] <= key);
}
