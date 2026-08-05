/**
 * Timetable Data Processor Module
 * Handles data transformation and alignment logic for timetable generation
 * Extracted from ScheduleController for better separation of concerns
 */

import {
  Routes,
  Stops,
  Calendar,
  CalendarDates,
  StopTimes,
  Trips,
} from '../types/gtfs-entities.js';
import { CalendarSchema } from '../types/gtfs.js';
import type { GTFSParser } from './gtfs-parser.js';
import { GTFSRouteSource } from './gtfs-route-source.js';
import type { RouteSourceTrip } from './route-source.js';
import {
  routeSequence,
  clearRouteSequenceCache,
  directionsForRoute,
  RouteSequence,
} from './route-sequence.js';
import { routeGraph, RouteGraph } from './route-graph.js';

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
  sequence?: RouteSequence;
  graph?: RouteGraph;
}

interface GTFSRelationships {
  getCalendarForService(service_id: string): Record<string, unknown> | null;
  getStopByIdAsync(stop_id: string): Promise<Record<string, unknown> | null>;
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
  private gtfsParser: GTFSParser;

  /**
   * The route-source adapter, held for the lifetime of the current feed state
   * so its stop index and per-trip stop_time sort survive across renders.
   * Dropped by invalidateRouteSource whenever the underlying tables change.
   */
  private routeSource: GTFSRouteSource | null = null;

  /**
   * Initialize TimetableDataProcessor with required dependencies
   *
   * @param relationships - GTFS relationships manager for data queries
   * @param gtfsParser - GTFS parser for direct file access
   */
  constructor(relationships: GTFSRelationships, gtfsParser: GTFSParser) {
    this.relationships = relationships;
    this.gtfsParser = gtfsParser;
  }

  private getRouteSource(): GTFSRouteSource {
    if (!this.routeSource) {
      this.routeSource = new GTFSRouteSource(this.gtfsParser);
    }
    return this.routeSource;
  }

  /**
   * Drop the cached route-source adapter and its route-sequence results.
   * Call after any edit that could change trips, stop_times, or stops.
   */
  public invalidateRouteSource(): void {
    if (this.routeSource) {
      clearRouteSequenceCache(this.routeSource);
      this.routeSource = null;
    }
  }

  /**
   * Generate timetable data for a route and service
   *
   * Main data processing method that:
   * - Validates route and service existence
   * - Filters trips by route, service, and direction
   * - Derives the canonical stop order from the shared route-sequence engine
   * - Aligns each trip's stop_times to that order
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

    // Feeds that omit direction_id entirely collapse to the '' direction -
    // directionsForRoute and routeSequence agree on that convention.
    const directionId = direction_id ?? '';
    const source = this.getRouteSource();
    const trips = source
      .tripsForRoute(route_id, service_id)
      .filter((trip) => (trip.direction_id ?? '') === directionId);

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

    const sequence = routeSequence(source, route_id, directionId, service_id);
    const graph = routeGraph(sequence);

    // Get stop details for the canonical stop order
    const stops: Stops[] = (await Promise.all(
      sequence.stops.map(async ({ stop_id }) => {
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

    // Align trips to the canonical stop order
    const alignedTrips = await this.alignTripsWithSequence(trips, sequence);

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
      sequence,
      graph,
    };
  }

  /**
   * Align each trip's stop_times to the route sequence's canonical stop
   * order, sorted by first departure time.
   *
   * `sequence.positionOf(trip_id, i)` maps the i-th entry of the trip's own
   * sorted stop_times to its row on the strip. That index space is the same
   * one `GTFSRouteSource.stopTimesForTrip` sorts into internally, so walking
   * `stop_times` sorted the same way here keeps the two aligned.
   *
   * @param trips - Trips to align, already filtered to route/service/direction
   * @param sequence - The route's canonical stop order
   * @returns Array of aligned trips with time mappings keyed by strip position
   */
  private async alignTripsWithSequence(
    trips: RouteSourceTrip[],
    sequence: RouteSequence
  ): Promise<AlignedTrip[]> {
    const tripsWithStopTimes = trips.map((trip) => {
      const stopTimes = this.gtfsParser
        .getStopTimesByTripId(trip.trip_id)
        .sort(
          (a, b) =>
            parseInt(String(a.stop_sequence)) -
            parseInt(String(b.stop_sequence))
        );
      const first = stopTimes[0];
      const firstDepartureTime =
        first?.departure_time || first?.arrival_time || '';
      return { trip, stopTimes, firstDepartureTime };
    });

    // Sort by first departure time
    tripsWithStopTimes.sort((a, b) => {
      if (!a.firstDepartureTime) {
        return 1;
      }
      if (!b.firstDepartureTime) {
        return -1;
      }
      return a.firstDepartureTime.localeCompare(b.firstDepartureTime);
    });

    const alignedTrips: AlignedTrip[] = [];

    for (const { trip, stopTimes } of tripsWithStopTimes) {
      const stopTimeMap = new Map<number, string>();
      const arrival_timeMap = new Map<number, string>();
      const departure_timeMap = new Map<number, string>();
      const editableStopTimes = new Map<number, EditableStopTime>();

      stopTimes.forEach((st: StopTimes, inputPosition: number) => {
        const arrival_time = st.arrival_time;
        const departure_time = st.departure_time;
        const displayTime = departure_time || arrival_time;

        const position = sequence.positionOf(trip.trip_id, inputPosition);
        if (position === null) {
          const errorMsg = `CRITICAL ERROR: no strip position for trip ${trip.trip_id} at stop_times index ${inputPosition} (stop_id ${st.stop_id}). Every pattern is included by routeSequence, so this should be unreachable.`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }

        if (arrival_time) {
          arrival_timeMap.set(position, arrival_time);
        }
        if (departure_time) {
          departure_timeMap.set(position, departure_time);
        }
        if (displayTime) {
          stopTimeMap.set(position, displayTime);
        }

        // Keep the trip's real platform stop_id, not the collapsed station
        // root - that's what keeps station collapse safe to edit.
        if (arrival_time || departure_time) {
          editableStopTimes.set(position, {
            stop_id: st.stop_id,
            stop_sequence: String(st.stop_sequence),
            arrival_time: arrival_time,
            departure_time: departure_time,
            isSkipped: false,
            originalArrivalTime: arrival_time,
            originalDepartureTime: departure_time,
          });
        }
      });

      // Get full trip data from database to include all GTFS properties
      const fullTrip = (await this.gtfsParser.gtfsDatabase.getRow(
        'trips',
        trip.trip_id
      )) as Trips;

      alignedTrips.push({
        ...fullTrip, // Spread all GTFS trip properties (shape_id, wheelchair_accessible, etc.)
        headsign: trip.headsign || trip.trip_id,
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
   * Labels each direction by its dominant trip_headsign (falling back to
   * terminal stop, then a bare "Direction N") rather than a generic
   * "Direction 0"/"Direction 1", and needs no per-direction stop_times fetch
   * to do it.
   *
   * @param route_id - GTFS route identifier
   * @param service_id - GTFS service identifier
   * @returns Array of direction info objects with ID, name, and trip count
   */
  async getAvailableDirectionsAsync(
    route_id: string,
    service_id: string
  ): Promise<DirectionInfo[]> {
    const source = this.getRouteSource();
    return directionsForRoute(source, route_id, service_id).map((d) => ({
      id: d.direction_id,
      name: d.label,
      tripCount: d.tripCount,
    }));
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
