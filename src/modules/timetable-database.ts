/**
 * Timetable Database Module
 * Handles all database operations for timetable (schedule) functionality
 * Follows "FAIL HARD" error policy - no fallbacks, expose real errors
 */

import { StopTimes, GTFSTableMap } from '../types/gtfs-entities.js';
import { StopTimesSchema } from '../types/gtfs.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { notify } from './notification-system.js';

interface GTFSParserInterface {
  gtfsDatabase: {
    queryRows<T extends keyof GTFSTableMap>(
      tableName: T,
      filter?: { [key: string]: string | number | boolean }
    ): Promise<GTFSTableMap[T][]>;
    updateRow<T extends keyof GTFSTableMap>(
      tableName: T,
      key: string,
      data: Partial<GTFSTableMap[T]>
    ): Promise<void>;
    replaceRows<T extends keyof GTFSTableMap>(
      tableName: T,
      oldKeys: string[],
      newRows: GTFSTableMap[T][]
    ): Promise<void>;
  };
  getFileDataSync(fileName: string): Record<string, unknown>[];
  setInMemoryFileData(fileName: string, data: Record<string, unknown>[]): void;
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
   * Get current time for a stop in a trip (legacy single time method)
   *
   * Legacy method that returns a single time value for display purposes.
   * Prefers departure_time, falls back to arrival_time if departure is null.
   * Follows FAIL HARD policy - throws on database connection or query failures.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @returns Promise resolving to time string or null if no times set
   * @throws {Error} When database connection unavailable or stop_time not found
   */
  async getCurrentTime(
    trip_id: string,
    stop_id: string
  ): Promise<string | null> {
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Database connection lost');
      throw new Error(error);
    }

    const stopTimes = await database.queryRows('stop_times', {
      trip_id: trip_id,
      stop_id: stop_id,
    });

    if (stopTimes.length === 0) {
      const error = `No stop_time found for trip ${trip_id}, stop ${stop_id}`;
      console.error('Database query failed:', error);
      notify.error('Schedule record not found');
      throw new Error(error);
    }

    // Return departure_time or fall back to arrival_time
    const stopTime = stopTimes[0];
    return stopTime.departure_time || stopTime.arrival_time || null;
  }

  /**
   * Get current arrival time for a stop in a trip
   *
   * Retrieves the arrival_time field specifically for a stop_time record.
   * Used for separate arrival/departure time handling.
   * Follows FAIL HARD policy - throws on database issues.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @returns Promise resolving to arrival time string or null
   * @throws {Error} When database connection unavailable or stop_time not found
   */
  async getCurrentArrivalTime(
    trip_id: string,
    stop_id: string
  ): Promise<string | null> {
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Database connection lost');
      throw new Error(error);
    }

    const stopTimes = await database.queryRows('stop_times', {
      trip_id: trip_id,
      stop_id: stop_id,
    });

    if (stopTimes.length === 0) {
      const error = `No stop_time found for trip ${trip_id}, stop ${stop_id}`;
      console.error('Database query failed:', error);
      notify.error('Schedule record not found');
      throw new Error(error);
    }

    const stopTime = stopTimes[0];
    return stopTime.arrival_time || null;
  }

  /**
   * Get current departure time for a stop in a trip
   *
   * Retrieves the departure_time field specifically for a stop_time record.
   * Used for separate arrival/departure time handling.
   * Follows FAIL HARD policy - throws on database issues.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @returns Promise resolving to departure time string or null
   * @throws {Error} When database connection unavailable or stop_time not found
   */
  async getCurrentDepartureTime(
    trip_id: string,
    stop_id: string
  ): Promise<string | null> {
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Database connection lost');
      throw new Error(error);
    }

    const stopTimes = await database.queryRows('stop_times', {
      trip_id: trip_id,
      stop_id: stop_id,
    });

    if (stopTimes.length === 0) {
      const error = `No stop_time found for trip ${trip_id}, stop ${stop_id}`;
      console.error('Database query failed:', error);
      notify.error('Schedule record not found');
      throw new Error(error);
    }

    const stopTime = stopTimes[0];
    return stopTime.departure_time || null;
  }

  /**
   * Update stop_time in database
   *
   * Main method for updating individual time fields in stop_times table.
   * Validates time format using GTFS schema before database update.
   * Shows success notifications and logs changes.
   * Follows FAIL HARD policy - throws on validation or database failures.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param newTime - New time value or null to clear the field
   * @param timeType - Which field to update ('arrival' or 'departure', defaults to 'departure')
   * @throws {Error} When validation fails, database unavailable, or record not found
   */
  async updateStopTimeInDatabase(
    trip_id: string,
    stop_id: string,
    newTime: string | null,
    timeType?: 'arrival' | 'departure'
  ): Promise<void> {
    // Access the database through gtfsParser
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Unable to save changes - database connection lost');
      throw new Error(error);
    }

    // Validate time format using GTFS schema if not null
    if (newTime !== null) {
      const timeValidation =
        // Cast to z.ZodType to access safeParse, ZodTypeAny from ZodRawShape
        // doesn't expose safeParse in its TypeScript type in Zod v4
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (StopTimesSchema.shape.arrival_time as any).safeParse(newTime);
      if (!timeValidation.success) {
        const error = `Invalid time format: ${newTime}. Must be HH:MM:SS format.`;
        console.error('Time validation failed:', timeValidation.error);
        notify.error(`Invalid time format: ${newTime}`);
        throw new Error(error);
      }
    }

    // Find the stop_time record by trip_id and stop_id
    const stopTimes = await database.queryRows('stop_times', {
      trip_id: trip_id,
      stop_id: stop_id,
    });

    if (stopTimes.length === 0) {
      // This trip doesn't have this stop yet - INSERT new stop_time record
      const allStopTimesForTrip = await database.queryRows('stop_times', {
        trip_id: trip_id,
      });

      // Create new stop_time record with only the specified time field
      const field = timeType === 'arrival' ? 'arrival_time' : 'departure_time';
      const newStopTime: Record<string, string | null> = {
        trip_id: trip_id,
        stop_id: stop_id,
        stop_sequence: '0', // Temporary, will be renumbered
        arrival_time: null,
        departure_time: null,
      };
      newStopTime[field] = newTime;

      // ATOMIC: Add new record and renumber all in single transaction
      // Combine existing + new, sort by time, and replace all at once
      const allStopTimes = [...allStopTimesForTrip, newStopTime];

      // Sort by time
      const sortedStopTimes = allStopTimes.sort((a, b) => {
        const timeA = a.arrival_time || a.departure_time || '99:99:99';
        const timeB = b.arrival_time || b.departure_time || '99:99:99';
        return timeA.localeCompare(timeB);
      });

      // Renumber sequences
      const renumberedStopTimes = sortedStopTimes.map((st, index) => ({
        ...st,
        stop_sequence: index,
      }));

      // Get old keys for deletion (only existing records, not the new one)
      const oldKeys = allStopTimesForTrip.map((st) =>
        generateCompositeKeyFromRecord('stop_times', st)
      );

      // Replace all in single transaction (delete old, insert new + renumbered)
      await database.replaceRows(
        'stop_times',
        oldKeys,
        renumberedStopTimes as unknown as StopTimes[]
      );

      notify.success(`Added stop to trip`, { duration: 2000 });
      return;
    }

    // Use the first matching record (there should be only one)
    const stopTime = stopTimes[0];

    // Determine which field to update
    const field =
      timeType === 'arrival'
        ? 'arrival_time'
        : timeType === 'departure'
          ? 'departure_time'
          : 'departure_time';

    // Generate composite key for the stop_time record and update
    const naturalKey = generateCompositeKeyFromRecord('stop_times', stopTime);
    await database.updateRow('stop_times', naturalKey, {
      [field]: newTime,
    });
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
   * @returns Promise resolving to validation result with optional error message
   */
  async validateArrivalDepartureConstraint(
    trip_id: string,
    stop_id: string,
    timeType: 'arrival' | 'departure',
    newTime: string
  ): Promise<{ isValid: boolean; errorMessage?: string }> {
    const stopTime = await this.getStopTime(trip_id, stop_id);
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

  /**
   * Renumber a trip's stop_sequence values to match chronological time order.
   *
   * Sourced from the database, not the DOM: with click-to-edit cells, at most
   * one `<input>` for the trip ever exists at a time, so a DOM scrape can no
   * longer see "every row" the way the old always-an-input rendering did.
   *
   * Returns the old composite key -> new `stop_sequence` mapping so the
   * caller can relocate the row it just edited without a full re-render:
   * the edited row's *pre-renumber* key (trip_id + stop_sequence, unaffected
   * by an arrival/departure field write) is a stable lookup into it.
   *
   * @param trip_id - GTFS trip identifier
   * @throws {Error} When database connection unavailable or updates fail
   */
  async renumberStopSequencesByTime(
    trip_id: string
  ): Promise<Map<string, string>> {
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Database connection lost');
      throw new Error(error);
    }

    const stopTimes = await database.queryRows('stop_times', { trip_id });
    const withOldKeys = stopTimes.map((st) => ({
      st,
      oldKey: generateCompositeKeyFromRecord('stop_times', st),
    }));

    // Stable sort: rows with unaffected times keep their relative order.
    const sorted = [...withOldKeys].sort((a, b) => {
      const timeA = a.st.arrival_time || a.st.departure_time || '';
      const timeB = b.st.arrival_time || b.st.departure_time || '';
      return timeA.localeCompare(timeB);
    });

    const renumbered = sorted.map(({ st }, index) => ({
      ...st,
      stop_sequence: String(index),
    })) as unknown as StopTimes[];

    const oldKeys = withOldKeys.map(({ oldKey }) => oldKey);
    await database.replaceRows('stop_times', oldKeys, renumbered);

    // Sync in-memory data so getFileDataSync reflects the renumbered state
    const inMemory = this.gtfsParser.getFileDataSync('stop_times.txt');
    const otherTrips = inMemory.filter(
      (st) => (st as { trip_id: string }).trip_id !== trip_id
    );
    this.gtfsParser.setInMemoryFileData('stop_times.txt', [
      ...otherTrips,
      ...(renumbered as unknown as Record<string, unknown>[]),
    ]);

    console.log(
      `Renumbered ${renumbered.length} stop_times for trip ${trip_id} by time order`
    );

    const oldKeyToNewSequence = new Map<string, string>();
    sorted.forEach(({ oldKey }, index) => {
      oldKeyToNewSequence.set(oldKey, String(index));
    });
    return oldKeyToNewSequence;
  }
}
