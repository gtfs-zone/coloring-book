/**
 * Whole-trip time transforms on stop_times rows.
 *
 * Both return new row objects and never write: the callers hand them to a
 * StopTimeEditPlan or to an insert, so every change still goes through the
 * patch system.
 */

import type { StopTimes } from '../types/gtfs-entities';
import { TimeFormatter } from './time-formatter';
import { effectiveStopTime } from './stop-time-order';

/** The stop_time fields that carry a clock time. */
const TIME_FIELDS = [
  'arrival_time',
  'departure_time',
  'start_pickup_drop_off_window',
  'end_pickup_drop_off_window',
] as const;

/**
 * The same row with every time shifted along the clock.
 *
 * A field that is empty stays empty, so the shift never invents a time on an
 * untimed stop.
 *
 * @param st - The stop_time row
 * @param offsetSeconds - Seconds to add, may be negative
 */
export function shiftRowTimes(st: StopTimes, offsetSeconds: number): StopTimes {
  const shifted: StopTimes = { ...st };
  for (const field of TIME_FIELDS) {
    if (st[field]) {
      shifted[field] = TimeFormatter.addSecondsToTime(
        String(st[field]),
        offsetSeconds
      );
    }
  }
  return shifted;
}

/**
 * The trip's rows reversed, with their times mirrored so it still runs forward.
 *
 * Mirroring reflects every time about the trip's own span, so the reversed trip
 * departs when the original did and its leg durations are the original's in
 * reverse. Each row's arrival and departure swap roles under the reflection,
 * which is what preserves the dwell time and keeps arrival <= departure; the
 * pickup/drop-off window ends swap for the same reason.
 *
 * shape_dist_traveled is cleared: it measures along a shape the reversed trip
 * no longer follows. Rows are not renumbered - the caller owns stop_sequence.
 *
 * A trip whose first and last rows carry no parseable time is only reversed.
 *
 * @param rows - The trip's stop_times, in stop_sequence order
 */
export function mirrorTripTimes(rows: StopTimes[]): StopTimes[] {
  const first = TimeFormatter.timeToSeconds(effectiveStopTime(rows[0]));
  const last = TimeFormatter.timeToSeconds(
    effectiveStopTime(rows[rows.length - 1])
  );
  const base = first !== null && last !== null ? first + last : null;

  // A field keeps its own emptiness: only its value comes from its partner.
  const reflect = (value: string, partner: string): string => {
    if (!value || base === null) {
      return value;
    }
    const seconds = TimeFormatter.timeToSeconds(partner || value);
    return seconds === null
      ? value
      : TimeFormatter.secondsToTime(base - seconds);
  };

  return rows
    .map((st) => {
      const mirrored: StopTimes = { ...st };
      mirrored.arrival_time = reflect(st.arrival_time, st.departure_time);
      mirrored.departure_time = reflect(st.departure_time, st.arrival_time);
      mirrored.start_pickup_drop_off_window = reflect(
        st.start_pickup_drop_off_window,
        st.end_pickup_drop_off_window
      );
      mirrored.end_pickup_drop_off_window = reflect(
        st.end_pickup_drop_off_window,
        st.start_pickup_drop_off_window
      );
      if (mirrored.shape_dist_traveled) {
        mirrored.shape_dist_traveled = '';
      }
      return mirrored;
    })
    .reverse();
}
