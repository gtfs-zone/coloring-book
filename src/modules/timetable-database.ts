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
        // Cast to z.ZodType to access safeParse — ZodTypeAny from ZodRawShape
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
   * Update both arrival and departure times to the same value (linked times)
   *
   * Sets both arrival_time and departure_time fields to the same value.
   * Used for stops without dwell time where arrival equals departure.
   * Validates time format and provides appropriate user feedback.
   * Follows FAIL HARD policy - throws on validation or database failures.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param newTime - New time value for both fields, or null to clear both
   * @throws {Error} When validation fails, database unavailable, or record not found
   */
  async updateLinkedTimes(
    trip_id: string,
    stop_id: string,
    newTime: string | null
  ): Promise<void> {
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
        // Cast to z.ZodType to access safeParse — ZodTypeAny from ZodRawShape
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

    // Find the stop_time record
    const stopTimes = await database.queryRows('stop_times', {
      trip_id: trip_id,
      stop_id: stop_id,
    });

    if (stopTimes.length === 0) {
      // This trip doesn't have this stop yet - INSERT new stop_time record
      const allStopTimesForTrip = await database.queryRows('stop_times', {
        trip_id: trip_id,
      });

      // Create new stop_time record (sequence will be determined after sorting)
      const newStopTime = {
        trip_id: trip_id,
        stop_id: stop_id,
        stop_sequence: 0, // Temporary, will be renumbered
        arrival_time: newTime ?? '',
        departure_time: newTime ?? '',
      };

      // ATOMIC: Add new record and renumber all in single transaction
      // Combine existing + new, sort by time, and replace all at once
      const allStopTimes = [...allStopTimesForTrip, newStopTime];

      // Sort by time (using newTime for records without times)
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (database as any).replaceRows(
        'stop_times',
        oldKeys,
        renumberedStopTimes
      );

      notify.success(`Added stop to trip`, { duration: 2000 });
      return;
    }

    const stopTime = stopTimes[0];
    const naturalKey = generateCompositeKeyFromRecord('stop_times', stopTime);

    // Update both times to the same value
    await database.updateRow('stop_times', naturalKey, {
      arrival_time: newTime ?? undefined,
      departure_time: newTime ?? undefined,
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
      // Unambiguous lookup by primary key — required for loop routes where
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
   * Rebuild stop_times for a trip from the rendered table (source of truth)
   *
   * Scans the DOM table to find all time inputs for this trip, builds a fresh
   * stop_times list, and replaces all database records. This ensures the database
   * matches exactly what's shown in the table.
   *
   * - Table is source of truth (WYSIWYG)
   * - Skipped stops have no database entry (gaps are preserved)
   * - Stop sequence determined by time order
   * - Handles add/remove/edit cases atomically
   *
   * @param trip_id - GTFS trip identifier
   * @throws {Error} When database connection unavailable or updates fail
   */
  async rebuildStopTimesFromTable(trip_id: string): Promise<void> {
    const database = this.gtfsParser.gtfsDatabase;
    if (!database) {
      const error = 'Database connection not available';
      console.error(error);
      notify.error('Database connection lost');
      throw new Error(error);
    }

    // Find all time inputs for this trip in the rendered table
    const inputs = document.querySelectorAll(
      `input[data-trip-id="${trip_id}"]`
    ) as NodeListOf<HTMLInputElement>;

    const stopTimesMap = new Map<string, Partial<StopTimes>>();

    inputs.forEach((input: HTMLInputElement) => {
      const stop_id = input.dataset.stopId;
      const timeType = input.dataset.timeType; // 'linked', 'arrival', or 'departure'
      const timeValue = input.value.trim();
      const superPos = input.dataset.supersequencePosition ?? 'new';

      if (!stop_id || !timeValue) {
        return; // Skip empty times
      }

      // Key by composite (stop_id, supersequencePosition) to preserve duplicate stops
      const key = `${stop_id}:${superPos}`;
      let stopTime = stopTimesMap.get(key);
      if (!stopTime) {
        stopTime = {
          trip_id,
          stop_id,
          stop_sequence: 0, // Temporary, will be set after sorting
          arrival_time: undefined,
          departure_time: undefined,
        };
        stopTimesMap.set(key, stopTime);
      }

      // Set the time based on input type
      const castedTime = timeValue; // Already in HH:MM:SS format from input
      if (timeType === 'linked') {
        stopTime!.arrival_time = castedTime;
        stopTime!.departure_time = castedTime;
      } else if (timeType === 'arrival') {
        stopTime!.arrival_time = castedTime;
      } else if (timeType === 'departure') {
        stopTime!.departure_time = castedTime;
      }
    });

    const stopTimesFromTable = Array.from(stopTimesMap.values());

    // Sort by time to determine sequence
    const sortedStopTimes = stopTimesFromTable.sort((a, b) => {
      const timeA = a.arrival_time || a.departure_time || '';
      const timeB = b.arrival_time || b.departure_time || '';
      return timeA.localeCompare(timeB);
    });

    // Assign sequential stop_sequence numbers
    const finalStopTimes = sortedStopTimes.map((st, index) => ({
      ...st,
      stop_sequence: index,
    })) as unknown as StopTimes[];

    // Get ALL old stop_times for this trip
    const oldStopTimes = await database.queryRows('stop_times', { trip_id });
    const oldKeys = oldStopTimes.map((st) =>
      generateCompositeKeyFromRecord('stop_times', st)
    );

    // Atomic replace: delete all old, insert all new from table
    await database.replaceRows('stop_times', oldKeys, finalStopTimes);

    // Sync in-memory data so getFileDataSync reflects the rebuilt state
    const inMemory = this.gtfsParser.getFileDataSync('stop_times.txt');
    const otherTrips = inMemory.filter(
      (st) => (st as { trip_id: string }).trip_id !== trip_id
    );
    this.gtfsParser.setInMemoryFileData('stop_times.txt', [
      ...otherTrips,
      ...(finalStopTimes as unknown as Record<string, unknown>[]),
    ]);

    console.log(
      `Rebuilt ${finalStopTimes.length} stop_times for trip ${trip_id} from table`
    );
  }
}
