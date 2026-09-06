/**
 * Timetable Database Module
 * Handles all database operations for timetable (schedule) functionality
 * Follows "FAIL HARD" error policy - no fallbacks, expose real errors
 */

import { StopTimes, GTFSTableMap } from '../types/gtfs-entities.js';
import type { StopTimeRef } from '../types/gtfs-flex.js';
import { StopTimesSchema } from '../types/gtfs.js';
import type { CoupledTimes } from '../utils/stop-time-coupling.js';
import { TimeFormatter } from '../utils/time-formatter.js';
import { chronologicalOrder } from '../utils/stop-time-order.js';
import { mirrorTripTimes, shiftRowTimes } from '../utils/stop-time-shift.js';
import { notify } from './notification-system.js';

/** The two ends of a stop_time's pickup/drop-off window. */
export type FlexWindowField =
  | 'start_pickup_drop_off_window'
  | 'end_pickup_drop_off_window';

interface GTFSParserInterface {
  gtfsDatabase: {
    queryRows<T extends keyof GTFSTableMap>(
      tableName: T,
      filter?: { [key: string]: string | number | boolean }
    ): Promise<GTFSTableMap[T][]>;
  };
}

/**
 * The full before/after row set for one trip, produced by planStopTimeEdit.
 *
 * Nothing is written: the caller diffs the two sets, writes once, and records
 * the matching patch, so a stop_time create or a stop_sequence renumber is
 * never invisible to the patch log.
 */
export interface StopTimeEditPlan {
  /** Every stop_time of the trip as it currently stands. */
  beforeRows: StopTimes[];
  /** The same rows after the edit, re-sorted and renumbered from 0. */
  afterRows: StopTimes[];
  /** True when the edit creates a stop_time that did not exist. */
  isInsert: boolean;
  /** Index of the created row in `afterRows`, when the plan inserts one. */
  insertedIndex?: number;
  /**
   * Index in `afterRows` of the row the edit touched, which is also its new
   * stop_sequence. An insert renumbers every row after it, so this is how the
   * caller carries the selection onto the right cell.
   */
  resultIndex?: number;
  /** Rows the resort moved, as `before -> after` stop_sequence pairs. */
  moved?: { from: number; to: number }[];
}

/**
 * The fields a new on-demand row copies from a sibling trip's row on the same
 * timetable row. The window is deliberately not here: a differing window per
 * trip is the whole point of having several trips.
 */
export interface FlexRowShape {
  pickup_type: string;
  drop_off_type: string;
  pickup_booking_rule_id: string;
  drop_off_booking_rule_id: string;
}

/**
 * One stop_time as a single readable token for the debug logs:
 * `seq:ref@time`, where the time is whichever of arrival, departure or
 * pickup window the row actually carries.
 */
function describeRow(st: StopTimes): string {
  const ref = st.stop_id || st.location_group_id || st.location_id || '?';
  const time =
    st.arrival_time ||
    st.departure_time ||
    st.start_pickup_drop_off_window ||
    st.end_pickup_drop_off_window ||
    '-';
  return `${st.stop_sequence}:${ref}@${time}`;
}

/**
 * Timetable Database - Database operations for schedule functionality
 *
 * This class is responsible for:
 * - All stop_times table CRUD operations
 * - Time validation using GTFS schemas
 * - Arrival/departure constraint validation
 * - Linked time management (same arrival/departure values)
 * - FAIL HARD error handling with user notifications
 *
 * Follows the GTFS standard property naming and Enhanced GTFS Object pattern.
 * Never implements fallback logic - always exposes real errors for debugging.
 */
export class TimetableDatabase {
  private gtfsParser: GTFSParserInterface;

  /**
   * Initialize TimetableDatabase with GTFS parser dependency
   *
   * @param gtfsParser - GTFS parser interface with database access
   */
  constructor(gtfsParser: GTFSParserInterface) {
    this.gtfsParser = gtfsParser;
  }

  /**
   * Plan the effect of a single arrival/departure edit on a trip, without writing.
   *
   * Returns the trip's complete stop_times before and after the edit so the
   * caller can diff them, write once, and record one patch. This is the only
   * place stop_sequence numbering is decided.
   *
   * The target row is located by stop_sequence, the only unambiguous key on a
   * loop route where one stop_id appears several times in a trip. No
   * stop_sequence means the cell has no saved row, so the edit inserts one;
   * `forceInsert` does the same for the pending add-stop row.
   *
   * `insertIndex` is where a new row lands in the trip's own stop_sequence
   * order; it defaults to the end. Passing the slot the edited cell occupies on
   * the strip is what keeps a second visit to the same stop from being appended
   * behind the first. Nothing else moves: the trip is never re-sorted by time
   * behind the user's back, which is `planTripResort`'s job.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param timeType - Which field to write ('arrival' or 'departure')
   * @param newTime - New HH:MM:SS value, or null to clear the field
   * @param stopSequence - stop_sequence of the row being edited, when known
   * @param forceInsert - Always create a new stop_time instead of editing one
   * @param insertIndex - Slot in the trip's stop_sequence order for a new row
   * @param coupled - Both time fields as coupleStopTimes resolved them; when
   *   given, they are written together instead of only the edited field
   * @throws {Error} When the time fails GTFS schema validation
   */
  async planStopTimeEdit(
    trip_id: string,
    stop_id: string,
    timeType: 'arrival' | 'departure',
    newTime: string | null,
    stopSequence?: string,
    forceInsert = false,
    insertIndex?: number,
    coupled?: CoupledTimes
  ): Promise<StopTimeEditPlan> {
    if (newTime !== null) {
      const timeValidation =
        // Cast to z.ZodType to access safeParse, ZodTypeAny from ZodRawShape
        // doesn't expose safeParse in its TypeScript type in Zod v4
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (StopTimesSchema.shape.arrival_time as any).safeParse(newTime);
      if (!timeValidation.success) {
        const error = `Invalid time format: ${newTime}. Must be HH:MM:SS format.`;
        console.error('Time validation failed:', timeValidation.error);
        throw new Error(error);
      }
    }

    const field = timeType === 'arrival' ? 'arrival_time' : 'departure_time';
    // Coupling supplies field values only, never the insert-vs-update decision.
    const written: Record<string, string | null> = coupled
      ? {
          arrival_time: coupled.arrival_time,
          departure_time: coupled.departure_time,
        }
      : { [field]: newTime };
    const beforeRows = await this.gtfsParser.gtfsDatabase.queryRows(
      'stop_times',
      { trip_id }
    );
    beforeRows.sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)
    );

    const targetIndex =
      forceInsert || !stopSequence
        ? -1
        : beforeRows.findIndex(
            (st) => String(st.stop_sequence) === stopSequence
          );

    const edited = beforeRows.map((st) => ({ ...st }));
    const isInsert = targetIndex === -1;
    let target: StopTimes;
    if (isInsert) {
      const slot = Math.max(
        0,
        Math.min(insertIndex ?? edited.length, edited.length)
      );
      target = {
        trip_id,
        stop_id,
        stop_sequence: 0,
        arrival_time: null,
        departure_time: null,
        ...written,
      } as unknown as StopTimes;
      edited.splice(slot, 0, target);
    } else {
      target = edited[targetIndex];
      Object.assign(target as unknown as Record<string, unknown>, written);
    }

    // A row stays where the user put it. Sorting the trip by time here would
    // renumber it, and stop_sequence order is what defines a strip element's
    // occurrence - so re-sorting silently rewrites the identity of rows the
    // user never touched, and a trip that then disagrees with its siblings
    // about stop order has no valid supersequence at all. Sorting is an
    // explicit action instead: see planTripResort.
    const resultIndex = edited.indexOf(target);

    console.log(
      `[TimetableDatabase] planStopTimeEdit ${JSON.stringify({
        trip_id,
        stop_id,
        timeType,
        newTime,
        written,
        stopSequence,
        forceInsert,
        insertIndex,
        isInsert,
        resultIndex,
        before: beforeRows.map(describeRow),
        after: edited.map(describeRow),
      })}`
    );

    // Numbers, not strings: the parser coerces every *_sequence field to a
    // number, and queryRows filters compare with ===, so a stringified
    // stop_sequence makes the row unfindable by its own primary key.
    const afterRows = edited.map((st, index) => ({
      ...st,
      stop_sequence: index,
    })) as unknown as StopTimes[];

    return {
      beforeRows,
      afterRows,
      isInsert,
      insertedIndex: isInsert ? resultIndex : undefined,
      resultIndex,
    };
  }

  /**
   * Plan the creation of an on-demand stop_time on a trip, without writing.
   *
   * The sibling of planStopTimeEdit for flex rows. It cannot reuse that method:
   * that one edits a named time field on a row addressed by stop_sequence, and
   * a flex row has neither. The whole trip is renumbered from 0 over its
   * existing order once the row is spliced in.
   *
   * `insertIndex` is where the row lands in the trip's own stop_sequence order;
   * it defaults to the end. Appending unconditionally would scramble the
   * deviated-route shape, where a deviation zone has to sit between the two
   * timed stops it deviates from.
   *
   * Both ends of the window are seeded with the typed value: a window is only
   * valid with both set, so the first edit creates a zero-length window that the
   * second edit widens. pickup_type/drop_off_type default to 2 (must phone the
   * agency, both directions), the only pair that is legal for both fields under
   * a window, unless `shape` carries the values copied from a sibling trip.
   *
   * @param trip_id - GTFS trip identifier
   * @param ref - The location group or zone the new row references
   * @param window - HH:MM:SS value for both ends of the window
   * @param insertIndex - Slot in the trip's stop_sequence order; defaults to last
   * @param shape - Types and booking rules to copy onto the new row
   */
  async planFlexStopTimeInsert(
    trip_id: string,
    ref: StopTimeRef,
    window: string,
    insertIndex?: number,
    shape?: FlexRowShape
  ): Promise<StopTimeEditPlan> {
    if (ref.kind === 'stop') {
      throw new Error(
        `planFlexStopTimeInsert called with a stop ref (${ref.id}); stops go through planStopTimeEdit`
      );
    }

    const beforeRows = await this.gtfsParser.gtfsDatabase.queryRows(
      'stop_times',
      { trip_id }
    );
    beforeRows.sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)
    );

    const refField =
      ref.kind === 'location_group' ? 'location_group_id' : 'location_id';
    const newRow = {
      trip_id,
      [refField]: ref.id,
      stop_sequence: 0,
      arrival_time: null,
      departure_time: null,
      start_pickup_drop_off_window: window,
      end_pickup_drop_off_window: window,
      pickup_type: shape ? shape.pickup_type : 2,
      drop_off_type: shape ? shape.drop_off_type : 2,
      ...(shape?.pickup_booking_rule_id
        ? { pickup_booking_rule_id: shape.pickup_booking_rule_id }
        : {}),
      ...(shape?.drop_off_booking_rule_id
        ? { drop_off_booking_rule_id: shape.drop_off_booking_rule_id }
        : {}),
    } as unknown as StopTimes;

    const slot = Math.max(
      0,
      Math.min(insertIndex ?? beforeRows.length, beforeRows.length)
    );
    const edited = beforeRows.map((st) => ({ ...st }));
    edited.splice(slot, 0, newRow);

    console.log(
      `[TimetableDatabase] planFlexStopTimeInsert ${JSON.stringify({
        trip_id,
        ref: `${ref.kind}:${ref.id}`,
        window,
        insertIndex,
        slot,
        before: beforeRows.map(describeRow),
        after: edited.map(describeRow),
      })}`
    );

    const afterRows = edited.map((st, index) => ({
      ...st,
      stop_sequence: index,
    })) as unknown as StopTimes[];

    return {
      beforeRows,
      afterRows,
      isInsert: true,
      insertedIndex: slot,
      resultIndex: slot,
    };
  }

  /**
   * Plan the removal of one stop_time from a trip, without writing.
   *
   * Clearing the last thing that made a row a stop on this trip is a delete
   * rather than a field clear: a flex row with no window fails
   * `validateFlexStopTimeRow`, and a stop row with no arrival, no departure and
   * no window is not addressable from the grid at all, so in both cases "empty"
   * can only mean "this trip does not serve this row". The rest of the trip is
   * renumbered from 0, which moves every later row's primary key - the caller
   * writes the whole set as one patch for that reason.
   *
   * @param trip_id - GTFS trip identifier
   * @param stopSequence - stop_sequence of the row to remove
   */
  async planStopTimeDelete(
    trip_id: string,
    stopSequence: string
  ): Promise<StopTimeEditPlan | null> {
    const beforeRows = await this.gtfsParser.gtfsDatabase.queryRows(
      'stop_times',
      { trip_id }
    );
    beforeRows.sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)
    );

    const targetIndex = beforeRows.findIndex(
      (st) => String(st.stop_sequence) === stopSequence
    );
    if (targetIndex === -1) {
      return null;
    }

    const edited = beforeRows
      .filter((_, index) => index !== targetIndex)
      .map((st) => ({ ...st }));
    const afterRows = edited.map((st, index) => ({
      ...st,
      stop_sequence: index,
    })) as unknown as StopTimes[];

    return { beforeRows, afterRows, isInsert: false };
  }

  /**
   * Plan a re-sort of one whole trip into chronological order, without writing.
   *
   * The explicit counterpart to the edits, which never move a row on their own.
   * Sorting renumbers rows, and stop_sequence order is what gives a strip
   * element its occurrence number, so a re-sort can change which strip column
   * every row of the trip belongs to - and if it leaves this trip disagreeing
   * with its siblings about stop order, the route has no valid supersequence
   * and the strip falls back to a fold that can emit duplicate columns. That is
   * a thing to do on request and then look at, not a side effect of typing a
   * time.
   *
   * Returns null when the trip has no rows or is already in order, so the
   * caller can say "nothing to do" instead of recording an empty patch.
   *
   * @param trip_id - GTFS trip identifier
   */
  async planTripResort(trip_id: string): Promise<StopTimeEditPlan | null> {
    const beforeRows = await this.readTripRows(trip_id);
    if (beforeRows.length === 0) {
      return null;
    }

    const edited = beforeRows.map((st) => ({ ...st }));
    const reordered = this.reorderByTime(edited);
    const moved = reordered
      .map((row, index) => ({ from: edited.indexOf(row), to: index }))
      .filter((pair) => pair.from !== pair.to);

    console.log(
      `[TimetableDatabase] planTripResort ${JSON.stringify({
        trip_id,
        moved,
        before: beforeRows.map(describeRow),
        after: reordered.map(describeRow),
      })}`
    );

    if (moved.length === 0) {
      return null;
    }

    const afterRows = reordered.map((st, index) => ({
      ...st,
      stop_sequence: index,
    })) as unknown as StopTimes[];

    return { beforeRows, afterRows, isInsert: false, moved };
  }

  /**
   * Plan a shift of every time in one trip, without writing.
   *
   * Rows keep their stop_sequence: a shift moves the whole trip along the clock
   * and cannot change stop order.
   *
   * @param trip_id - GTFS trip identifier
   * @param offsetSeconds - Seconds to add to every time, may be negative
   */
  async planTripShift(
    trip_id: string,
    offsetSeconds: number
  ): Promise<StopTimeEditPlan | null> {
    const beforeRows = await this.readTripRows(trip_id);
    if (beforeRows.length === 0 || offsetSeconds === 0) {
      return null;
    }

    const afterRows = beforeRows.map((st) => shiftRowTimes(st, offsetSeconds));

    console.log(
      `[TimetableDatabase] planTripShift ${JSON.stringify({
        trip_id,
        offsetSeconds,
        before: beforeRows.map(describeRow),
        after: afterRows.map(describeRow),
      })}`
    );

    return { beforeRows, afterRows, isInsert: false, moved: [] };
  }

  /**
   * Plan a reversal of one trip's stop order, without writing.
   *
   * The rows are reversed and renumbered from 0, and the times are mirrored so
   * the trip still runs forward: the reversed trip departs when the original
   * did and its leg durations are the original's in reverse. shape_dist_traveled
   * is cleared because it measures along a shape the trip no longer follows.
   *
   * Returns null for a trip with fewer than two rows, which has no order to
   * reverse.
   *
   * @param trip_id - GTFS trip identifier
   */
  async planTripReverse(trip_id: string): Promise<StopTimeEditPlan | null> {
    const beforeRows = await this.readTripRows(trip_id);
    if (beforeRows.length < 2) {
      return null;
    }

    const afterRows: StopTimes[] = mirrorTripTimes(beforeRows).map(
      (st, index) => ({ ...st, stop_sequence: index })
    );

    const last = beforeRows.length - 1;
    console.log(
      `[TimetableDatabase] planTripReverse ${JSON.stringify({
        trip_id,
        before: beforeRows.map(describeRow),
        after: afterRows.map(describeRow),
      })}`
    );

    return {
      beforeRows,
      afterRows,
      isInsert: false,
      moved: beforeRows.map((_, index) => ({ from: index, to: last - index })),
    };
  }

  /** One trip's stop_times, sorted by stop_sequence. */
  private async readTripRows(trip_id: string): Promise<StopTimes[]> {
    const rows = await this.gtfsParser.gtfsDatabase.queryRows('stop_times', {
      trip_id,
    });
    rows.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    return rows;
  }

  private reorderByTime(rows: StopTimes[]): StopTimes[] {
    return chronologicalOrder(rows);
  }

  /**
   * Get one trip's stop_time by its primary key.
   *
   * Addressed by stop_sequence only: a stop_id is ambiguous on loop routes,
   * where the same stop appears at several positions of a trip. A cell with no
   * stop_sequence has no record behind it yet, so this returns null rather than
   * guessing at another instance of the same stop.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_sequence - stop_sequence of the row, when the caller knows it
   * @returns Promise resolving to StopTimes record or null if not found
   * @throws {Error} When database connection unavailable
   */
  async getStopTime(
    trip_id: string,
    stop_sequence?: string
  ): Promise<StopTimes | null> {
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Database connection lost');
      throw new Error(error);
    }

    if (!stop_sequence) {
      return null;
    }

    const results = await database.queryRows('stop_times', {
      trip_id,
      stop_sequence: Number(stop_sequence),
    });
    return results[0] ?? null;
  }

  /**
   * Validate the arrival <= departure constraint on a resolved pair.
   *
   * The pair comes from `coupleStopTimes`, so both fields are the values the
   * edit is about to write. Checking the incoming value against the row's
   * stored counterpart would reject an arrival edit that legitimately carries
   * its departure along with it.
   *
   * @param times - Both time fields as they are about to be written
   * @returns Validation result with an optional error message
   */
  validateArrivalDepartureConstraint(times: CoupledTimes): {
    isValid: boolean;
    errorMessage?: string;
  } {
    const arrival = TimeFormatter.timeToSeconds(times.arrival_time);
    const departure = TimeFormatter.timeToSeconds(times.departure_time);
    if (arrival !== null && departure !== null && arrival > departure) {
      return {
        isValid: false,
        errorMessage: 'Arrival time must be before or equal to departure time',
      };
    }

    return { isValid: true };
  }
}
