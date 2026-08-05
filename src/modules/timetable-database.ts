/**
 * Timetable Database Module
 * Handles all database operations for timetable (schedule) functionality
 * Follows "FAIL HARD" error policy - no fallbacks, expose real errors
 */

import { StopTimes, GTFSTableMap } from '../types/gtfs-entities.js';
import { StopTimesSchema } from '../types/gtfs.js';
import { notify } from './notification-system.js';

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
   * The target row is located by stop_sequence when the caller knows it
   * (unambiguous on loop routes, where one stop_id appears several times in a
   * trip); `forceInsert` skips the lookup entirely for the pending add-stop row.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param timeType - Which field to write ('arrival' or 'departure')
   * @param newTime - New HH:MM:SS value, or null to clear the field
   * @param stopSequence - stop_sequence of the row being edited, when known
   * @param forceInsert - Always create a new stop_time instead of editing one
   * @throws {Error} When the time fails GTFS schema validation
   */
  async planStopTimeEdit(
    trip_id: string,
    stop_id: string,
    timeType: 'arrival' | 'departure',
    newTime: string | null,
    stopSequence?: string,
    forceInsert = false
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
    const beforeRows = await this.gtfsParser.gtfsDatabase.queryRows(
      'stop_times',
      { trip_id }
    );
    beforeRows.sort(
      (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)
    );

    const targetIndex = forceInsert
      ? -1
      : beforeRows.findIndex((st) =>
          stopSequence !== undefined && stopSequence !== ''
            ? String(st.stop_sequence) === stopSequence
            : st.stop_id === stop_id
        );

    const edited = beforeRows.map((st) => ({ ...st }));
    const isInsert = targetIndex === -1;
    if (isInsert) {
      edited.push({
        trip_id,
        stop_id,
        stop_sequence: 0,
        arrival_time: null,
        departure_time: null,
        [field]: newTime,
      } as unknown as StopTimes);
    } else {
      (edited[targetIndex] as unknown as Record<string, unknown>)[field] =
        newTime;
    }

    // Numbers, not strings: the parser coerces every *_sequence field to a
    // number, and queryRows filters compare with ===, so a stringified
    // stop_sequence makes the row unfindable by its own primary key.
    const afterRows = this.reorderByTime(edited).map((st, index) => ({
      ...st,
      stop_sequence: index,
    })) as unknown as StopTimes[];

    return { beforeRows, afterRows, isInsert };
  }

  /**
   * Sort a trip's rows into chronological order, moving only the timed ones.
   *
   * Rows with no arrival and no departure keep the slot they already occupy:
   * in feeds that only time their timepoints, sorting them alongside timed rows
   * would fling every untimed stop to one end of the trip.
   */
  private reorderByTime(rows: StopTimes[]): StopTimes[] {
    const timeOf = (st: StopTimes): string =>
      st.arrival_time || st.departure_time || '';

    const timedSlots: number[] = [];
    rows.forEach((st, index) => {
      if (timeOf(st)) {
        timedSlots.push(index);
      }
    });

    const sortedTimed = timedSlots
      .map((index) => rows[index])
      .sort((a, b) => timeOf(a).localeCompare(timeOf(b)));

    const result = [...rows];
    timedSlots.forEach((slot, i) => {
      result[slot] = sortedTimed[i];
    });
    return result;
  }

  /**
   * Get stop_time record for querying database state
   *
   * Retrieves the complete stop_time record for state inspection.
   * Used to check current values before updates or state transitions.
   * Returns null if record not found (does not throw for missing records).
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @returns Promise resolving to StopTimes record or null if not found
   * @throws {Error} When database connection unavailable
   */
  async getStopTime(
    trip_id: string,
    stop_id: string,
    stop_sequence?: string
  ): Promise<StopTimes | null> {
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Database connection lost');
      throw new Error(error);
    }

    if (stop_sequence) {
      // Unambiguous lookup by primary key, required for loop routes where
      // the same stop_id appears at multiple positions.
      const results = await database.queryRows('stop_times', {
        trip_id,
        stop_sequence: Number(stop_sequence),
      });
      return results[0] ?? null;
    }

    const stopTimes = await database.queryRows('stop_times', {
      trip_id: trip_id,
      stop_id: stop_id,
    });

    if (stopTimes.length === 0) {
      return null;
    }

    return stopTimes[0];
  }

  /**
   * Validate arrival <= departure time constraint
   *
   * Checks that arrival time is not later than departure time.
   * Used before updating individual arrival/departure times to maintain
   * GTFS specification compliance. Only validates when both times are present.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param timeType - Which time field is being updated ('arrival' or 'departure')
   * @param newTime - New time value to validate against existing time
   * @param stop_sequence - stop_sequence of the edited row, when known
   * @returns Promise resolving to validation result with optional error message
   */
  async validateArrivalDepartureConstraint(
    trip_id: string,
    stop_id: string,
    timeType: 'arrival' | 'departure',
    newTime: string,
    stop_sequence?: string
  ): Promise<{ isValid: boolean; errorMessage?: string }> {
    const stopTime = await this.getStopTime(trip_id, stop_id, stop_sequence);
    if (!stopTime) {
      // No existing record means no constraints to validate
      return { isValid: true };
    }

    const currentArrivalTime = stopTime.arrival_time;
    const currentDepartureTime = stopTime.departure_time;

    // Validate arrival <= departure constraint if both are specified
    if (
      timeType === 'arrival' &&
      currentDepartureTime &&
      newTime > currentDepartureTime
    ) {
      return {
        isValid: false,
        errorMessage: 'Arrival time must be before or equal to departure time',
      };
    }

    if (
      timeType === 'departure' &&
      currentArrivalTime &&
      newTime < currentArrivalTime
    ) {
      return {
        isValid: false,
        errorMessage: 'Departure time must be after or equal to arrival time',
      };
    }

    return { isValid: true };
  }
}
