/**
 * Timetable Data Processor Module
 * Handles data transformation and alignment logic for timetable generation
 * Extracted from ScheduleController for better separation of concerns
 */

import {
  shortestCommonSupersequenceWithAlignments,
  SCSResultHelper,
} from './scs';
import {
  Routes,
  Stops,
  Calendar,
  CalendarDates,
  StopTimes,
  GTFSTableMap,
  Trips,
} from '../types/gtfs-entities.js';
import { CalendarSchema } from '../types/gtfs.js';

/**
 * Editable stop time interface for timetable editing
 * Contains both current and original time values for change tracking
 */
export interface EditableStopTime {
  stop_id: string;
  stop_sequence: string;
  arrival_time: string | null;
  departure_time: string | null;
  isSkipped: boolean;
  originalArrivalTime?: string;
  originalDepartureTime?: string;
}

/**
 * Aligned trip interface for timetable rendering
 * Contains time mappings aligned to the optimal stop sequence
 * Extends Trips to include all GTFS trip properties
 *
 * IMPORTANT: All maps use supersequence position (number) as keys, NOT stop_id
 * This ensures correct handling of duplicate stops (e.g., circular routes where
 * a stop appears multiple times in the sequence)
 */
export interface AlignedTrip extends Trips {
  headsign: string;
  stopTimes: Map<number, string>; // supersequence position -> time (departure or arrival)
  arrival_times?: Map<number, string>; // supersequence position -> arrival time
  departure_times?: Map<number, string>; // supersequence position -> departure time
  editableStopTimes?: Map<number, EditableStopTime>; // supersequence position -> editable stop time
}

/**
 * Direction information for route analysis
 * Contains direction metadata and trip statistics
 */
export interface DirectionInfo {
  id: string;
  name: string;
  tripCount: number;
  lastStopName?: string;
}

/**
 * Complete timetable data structure for rendering
 * Contains all necessary data for generating schedule views
 */
export interface TimetableData {
  route: Routes;
  service: Calendar | CalendarDates;
  stops: Stops[];
  trips: AlignedTrip[];
  direction_id?: string;
  directionName?: string;
  availableDirections?: DirectionInfo[];
  selectedDirectionId?: string;
  showArrivalDeparture?: boolean; // Whether to show separate arrival/departure columns
}

// Enhanced GTFS interfaces using standard GTFS property names
interface EnhancedTrip {
  // Shorthand properties
  id: string;
  headsign?: string;
  shortName?: string;
  // Original GTFS properties
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign?: string;
  trip_short_name?: string;
  direction_id?: string;
  block_id?: string;
  shape_id?: string;
  wheelchair_accessible?: string;
  bikes_allowed?: string;
}

interface GTFSRelationships {
  getCalendarForService(service_id: string): Record<string, unknown> | null;
  getTripsForRoute(route_id: string): EnhancedTrip[];
  getTripsForRouteAsync(route_id: string): Promise<EnhancedTrip[]>;
  getStopTimesForTrip(trip_id: string): Record<string, unknown>[];
  getStopById(stop_id: string): Record<string, unknown> | null;
  getStopByIdAsync(stop_id: string): Promise<Record<string, unknown> | null>;
}

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
    getRow<T extends keyof GTFSTableMap>(
      tableName: T,
      key: string
    ): Promise<GTFSTableMap[T] | null>;
  };
}

/**
 * Timetable Data Processor - Handles data transformation and alignment logic
 *
 * This class is responsible for:
 * - Generating timetable data from GTFS entities
 * - Trip alignment using Shortest Common Supersequence (SCS) algorithm
 * - Direction filtering and management
 * - GTFS schema validation during processing
 *
 * Follows FAIL HARD error handling policy - throws on data integrity issues.
 */
export class TimetableDataProcessor {
  private relationships: GTFSRelationships;
  private gtfsParser: GTFSParserInterface;

  /**
   * Initialize TimetableDataProcessor with required dependencies
   *
   * @param relationships - GTFS relationships manager for data queries
   * @param gtfsParser - GTFS parser for direct file access
   */
  constructor(
    relationships: GTFSRelationships,
    gtfsParser: GTFSParserInterface
  ) {
    this.relationships = relationships;
    this.gtfsParser = gtfsParser;
  }

  /**
   * Get stop times for a trip from the database (includes any edits)
   *
   * This method reads from the database instead of the cached relationships layer,
   * ensuring that any user edits are reflected in the timetable rendering.
   *
   * @param trip_id - GTFS trip identifier
   * @returns Promise resolving to array of stop times from database
   */
  private async getStopTimesFromDatabase(
    trip_id: string
  ): Promise<StopTimes[]> {
    const stopTimes = await this.gtfsParser.gtfsDatabase.queryRows(
      'stop_times',
      { trip_id }
    );
    return stopTimes;
  }

  /**
   * Generate timetable data for a route and service
   *
   * Main data processing method that:
   * - Validates route and service existence
   * - Filters trips by route, service, and optionally direction
   * - Computes optimal stop sequence using SCS algorithm
   * - Aligns trips to the optimal sequence
   * - Returns structured timetable data for rendering
   *
   * @param route_id - GTFS route identifier
   * @param service_id - GTFS service identifier (calendar or calendar_dates)
   * @param direction_id - Optional direction filter ('0', '1', etc.)
   * @returns Promise resolving to structured timetable data
   * @throws {Error} When route not found, no trips found, or data integrity issues
   */
  async generateTimetableData(
    route_id: string,
    service_id: string,
    direction_id?: string
  ): Promise<TimetableData> {
    // Get route information directly from database (no memory cache)
    const route = await this.gtfsParser.gtfsDatabase.getRow('routes', route_id);

    if (!route) {
      const error = `Route ${route_id} not found`;
      console.error(`[TimetableDataProcessor] ${error}`);
      throw new Error(error);
    }

    // Get service information - use GTFS standard validation
    const service = this.relationships.getCalendarForService(service_id) || {
      service_id,
    };

    // Validate service using GTFS schema
    try {
      CalendarSchema.parse(service);
    } catch (error) {
      console.warn(
        'Service validation failed, proceeding with available data:',
        error
      );
    }

    // Get all trips for this route and service (use async to get from database)
    const allTrips: EnhancedTrip[] =
      await this.relationships.getTripsForRouteAsync(route_id);
    let trips = allTrips.filter(
      (trip: EnhancedTrip) => trip.service_id === service_id
    );

    // Filter by direction if specified
    if (direction_id !== undefined) {
      trips = trips.filter(
        (trip: EnhancedTrip) =>
          String(trip.direction_id ?? '0') === direction_id
      );
    }

    if (trips.length === 0) {
      // Return empty timetable structure with default directions
      const defaultDirections: DirectionInfo[] = [
        { id: '0', name: 'Outbound', tripCount: 0 },
        { id: '1', name: 'Inbound', tripCount: 0 },
      ];

      return {
        route,
        service: service as Calendar | CalendarDates,
        stops: [],
        trips: [],
        availableDirections: defaultDirections,
        selectedDirectionId: direction_id || '0',
      };
    }

    // Build stop sequences for each trip
    const tripSequences: string[][] = [];
    for (const trip of trips) {
      const stopTimes = await this.getStopTimesFromDatabase(trip.id);
      const tripStops = stopTimes
        .sort(
          (a: StopTimes, b: StopTimes) =>
            parseInt(String(a.stop_sequence)) -
            parseInt(String(b.stop_sequence))
        )
        .map((st: StopTimes) => st.stop_id);
      tripSequences.push(tripStops);
    }

    // Use enhanced SCS to get both optimal sequence and alignments
    const scsResult = shortestCommonSupersequenceWithAlignments(tripSequences);
    const scsHelper = new SCSResultHelper(scsResult);

    // Get stop details for the optimal sequence
    const stops: Stops[] = (await Promise.all(
      scsResult.supersequence.map(async (stop_id) => {
        const stop = await this.relationships.getStopByIdAsync(stop_id);
        if (!stop) {
          const error = `Stop ${stop_id} not found in stops.txt but referenced in stop_times.txt`;
          console.error('GTFS Data Integrity Error:', error);
          throw new Error(error);
        }
        // Return the stop with standard GTFS properties
        return stop;
      })
    )) as Stops[];

    // Align trips using the SCS result
    const alignedTrips = await this.alignTripsWithSCS(
      trips,
      scsHelper,
      scsResult.supersequence
    );

    // Get direction name
    const directionName =
      direction_id !== undefined
        ? this.getDirectionName(direction_id)
        : undefined;

    return {
      route,
      service: service as Calendar | CalendarDates,
      stops,
      trips: alignedTrips,
      direction_id,
      directionName,
    };
  }

  /**
   * Enhanced alignment algorithm using SCS result
   *
   * Aligns trips to the optimal stop sequence computed by SCS algorithm.
   * Creates time mappings for display time, arrival times, and departure times.
   * Uses stop_id as the key for all time lookups (clearer than numeric indices).
   * Sorts trips by departure time from the first stop before alignment.
   *
   * No manual alignment logic needed - everything is handled by SCS!
   *
   * @param trips - Array of enhanced trip objects to align
   * @param scsHelper - SCS result helper with position mappings
   * @param supersequence - The optimal supersequence of stop_ids from SCS
   * @returns Array of aligned trips with time mappings using stop_id as keys
   */
  async alignTripsWithSCS(
    trips: EnhancedTrip[],
    scsHelper: SCSResultHelper<string>,
    _supersequence: string[]
  ): Promise<AlignedTrip[]> {
    // Sort trips by departure time from first stop
    // IMPORTANT: Keep track of original indices because SCS alignments use original trip order!
    const tripsWithFirstTime = await Promise.all(
      trips.map(async (trip, originalIndex) => {
        const stopTimes = await this.getStopTimesFromDatabase(trip.id);
        const sortedStopTimes = stopTimes.sort(
          (a: StopTimes, b: StopTimes) =>
            parseInt(String(a.stop_sequence)) -
            parseInt(String(b.stop_sequence))
        );
        const firstStopTime = sortedStopTimes[0];
        const firstDepartureTime =
          firstStopTime?.departure_time || firstStopTime?.arrival_time || '';
        return { trip, firstDepartureTime, originalIndex };
      })
    );

    // Sort by first departure time
    tripsWithFirstTime.sort((a, b) => {
      if (!a.firstDepartureTime) {
        return 1;
      }
      if (!b.firstDepartureTime) {
        return -1;
      }
      return a.firstDepartureTime.localeCompare(b.firstDepartureTime);
    });

    const alignedTrips: AlignedTrip[] = [];

    for (
      let sortedIndex = 0;
      sortedIndex < tripsWithFirstTime.length;
      sortedIndex++
    ) {
      const { trip, originalIndex } = tripsWithFirstTime[sortedIndex];
      const stopTimes = await this.getStopTimesFromDatabase(trip.id);
      const stopTimeMap = new Map<number, string>();
      const arrival_timeMap = new Map<number, string>();
      const departure_timeMap = new Map<number, string>();
      const editableStopTimes = new Map<number, EditableStopTime>();

      // Sort stop times by sequence
      const sortedStopTimes = stopTimes.sort(
        (a: StopTimes, b: StopTimes) =>
          parseInt(String(a.stop_sequence)) - parseInt(String(b.stop_sequence))
      );

      // Note: Schema validation removed due to incorrect schema definition
      // The generated GTFS schema incorrectly marks optional fields as required
      // and doesn't handle string-to-number conversion for CSV data

      // Use SCS alignment to map times to supersequence positions
      // The position mapping tells us which stops in this trip align to which positions in the supersequence
      // IMPORTANT: This handles duplicate stops correctly (e.g., circular routes)
      // Use originalIndex because SCS was computed on the original unsorted trip order!
      const positionMapping = scsHelper.getPositionMapping(originalIndex);

      // Use position mapping from SCS to correctly handle duplicate stops
      // inputPosition = position in this trip's stop sequence (0, 1, 2, ...)
      // supersequencePosition = position in the optimal merged sequence
      sortedStopTimes.forEach((st: StopTimes, inputPosition: number) => {
        const stop_id = st.stop_id;
        const arrival_time = st.arrival_time;
        const departure_time = st.departure_time;
        const displayTime = departure_time || arrival_time;

        // Get the supersequence position for this stop from SCS alignment
        const supersequencePosition = positionMapping.get(inputPosition);

        if (supersequencePosition === undefined) {
          const errorMsg = `CRITICAL ERROR: No supersequence position found for trip ${trip.id}, inputPosition ${inputPosition}, stop_id ${stop_id}. This indicates a bug in the SCS alignment logic. Original trip index: ${originalIndex}, sorted trip index: ${sortedIndex}`;
          console.error(errorMsg);
          console.error('Position mapping:', positionMapping);
          console.error(
            'Available mappings:',
            Array.from(positionMapping.entries())
          );
          throw new Error(errorMsg);
        }

        // Use supersequence position as the key - this handles duplicate stops correctly!
        if (arrival_time) {
          arrival_timeMap.set(supersequencePosition, arrival_time);
          console.log(
            `  Set arrival_timeMap[${supersequencePosition}] = ${arrival_time}`
          );
        }
        if (departure_time) {
          departure_timeMap.set(supersequencePosition, departure_time);
          console.log(
            `  Set departure_timeMap[${supersequencePosition}] = ${departure_time}`
          );
        }
        if (displayTime) {
          stopTimeMap.set(supersequencePosition, displayTime);
          console.log(
            `  Set stopTimeMap[${supersequencePosition}] = ${displayTime}`
          );
        }

        // Create editable stop time with both arrival and departure
        // Key by supersequence position to handle duplicate stops
        if (arrival_time || departure_time) {
          editableStopTimes.set(supersequencePosition, {
            stop_id: st.stop_id,
            stop_sequence: String(st.stop_sequence),
            arrival_time: arrival_time,
            departure_time: departure_time,
            isSkipped: false,
            originalArrivalTime: arrival_time,
            originalDepartureTime: departure_time,
          });
          console.log(`  Set editableStopTimes[${supersequencePosition}]`);
        }
      });

      // Get full trip data from database to include all GTFS properties
      const fullTrip = (await this.gtfsParser.gtfsDatabase.getRow(
        'trips',
        trip.id
      )) as Trips;

      alignedTrips.push({
        ...fullTrip, // Spread all GTFS trip properties (shape_id, wheelchair_accessible, etc.)
        headsign: trip.headsign || trip.id,
        stopTimes: stopTimeMap,
        arrival_times: arrival_timeMap,
        departure_times: departure_timeMap,
        editableStopTimes,
      });
    }

    return alignedTrips;
  }

  /**
   * Get available directions for a route and service
   *
   * Analyzes all trips for the given route and service to determine
   * which direction_id values are available. Groups trips by direction
   * and counts the number of trips per direction.
   *
   * @param route_id - GTFS route identifier
   * @param service_id - GTFS service identifier
   * @returns Array of direction info objects with ID, name, and trip count
   */
  async getAvailableDirectionsAsync(
    route_id: string,
    service_id: string
  ): Promise<DirectionInfo[]> {
    // Get all trips for this route and service
    const allTrips = await this.relationships.getTripsForRouteAsync(route_id);
    const trips = allTrips.filter(
      (trip: EnhancedTrip) => trip.service_id === service_id
    );

    // Group trips by direction ID
    const directionMap = new Map<string, number>();
    trips.forEach((trip: EnhancedTrip) => {
      const dirId = String(trip.direction_id ?? '0');
      directionMap.set(dirId, (directionMap.get(dirId) || 0) + 1);
    });

    // Group trips by direction for last-stop lookup
    const directionTrips = new Map<string, EnhancedTrip[]>();
    trips.forEach((trip: EnhancedTrip) => {
      const dirId = String(trip.direction_id ?? '0');
      const existing = directionTrips.get(dirId) || [];
      existing.push(trip);
      directionTrips.set(dirId, existing);
    });

    // Convert to DirectionInfo array, sorted by direction ID
    const directions: DirectionInfo[] = await Promise.all(
      Array.from(directionMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(async ([id, tripCount]) => {
          let lastStopName: string | undefined;
          if (tripCount > 0) {
            const dirTrips = directionTrips.get(id) || [];
            if (dirTrips.length > 0) {
              const representativeTrip = dirTrips[0];
              const stopTimes = await this.getStopTimesFromDatabase(
                representativeTrip.id
              );
              const sorted = stopTimes.sort(
                (a: StopTimes, b: StopTimes) =>
                  parseInt(String(a.stop_sequence)) -
                  parseInt(String(b.stop_sequence))
              );
              const lastStopTime = sorted[sorted.length - 1];
              if (lastStopTime) {
                const stop = await this.relationships.getStopByIdAsync(
                  lastStopTime.stop_id
                );
                lastStopName = stop?.stop_name as string | undefined;
              }
            }
          }
          return {
            id,
            name: this.getDirectionName(id),
            tripCount,
            lastStopName,
          };
        })
    );

    return directions;
  }

  /**
   * Get a human-readable direction name
   *
   * Converts GTFS direction_id to human-readable names.
   * Follows GTFS specification: 0 = Outbound, 1 = Inbound.
   *
   * @param direction_id - GTFS direction identifier ('0', '1', etc.)
   * @returns Human-readable direction name
   */
  private getDirectionName(direction_id: string): string {
    return `Direction ${direction_id}`;
  }
}
