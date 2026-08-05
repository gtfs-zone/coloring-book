import type { GTFSParser } from './gtfs-parser.js';
import type {
  RouteSource,
  RouteSourceTrip,
  RouteSourceStopTime,
} from './route-source.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import type { Stops } from '../types/gtfs-entities.js';

interface StopIndexEntry {
  parent?: string;
  name?: string;
}

/**
 * RouteSource over GTFSParser's virtual tables.
 *
 * The stop index and per-trip stop_time sort are memoized for the lifetime of
 * the instance, not the feed: coloring-book's data is mutable, so callers are
 * expected to build a fresh instance whenever the underlying tables might have
 * changed (the same cadence schedule-controller already rebuilds TimetableData at).
 */
export class GTFSRouteSource implements RouteSource {
  private stopIndex: Map<string, StopIndexEntry> | null = null;
  private sortedStopTimes = new Map<string, RouteSourceStopTime[]>();

  constructor(private readonly gtfsParser: GTFSParser) {}

  tripsForRoute(route_id: string, service_id?: string): RouteSourceTrip[] {
    const trips = this.gtfsParser.getTripsByRouteId(route_id);
    const scoped = service_id
      ? trips.filter((t) => String(t.service_id ?? '') === service_id)
      : trips;
    return scoped.map((t) => ({
      trip_id: String(t.trip_id ?? ''),
      direction_id:
        t.direction_id !== undefined && t.direction_id !== ''
          ? String(t.direction_id)
          : undefined,
      headsign: t.trip_headsign ? String(t.trip_headsign) : undefined,
    }));
  }

  stopTimesForTrip(trip_id: string): RouteSourceStopTime[] {
    const cached = this.sortedStopTimes.get(trip_id);
    if (cached) {
      return cached;
    }
    const sorted = this.gtfsParser
      .getStopTimesByTripId(trip_id)
      .map((st) => ({
        stop_id: String(st.stop_id),
        stop_sequence: Number(st.stop_sequence),
      }))
      .sort((a, b) => a.stop_sequence - b.stop_sequence);
    this.sortedStopTimes.set(trip_id, sorted);
    return sorted;
  }

  /** Walk parent_station to the topmost ancestor, guarding against cycles. */
  stationRoot(stop_id: string): string {
    const index = this.getStopIndex();
    const seen = new Set<string>([stop_id]);
    let current = stop_id;
    for (;;) {
      const parent = index.get(current)?.parent;
      if (!parent || !index.has(parent)) {
        return current;
      }
      if (seen.has(parent)) {
        console.warn(
          `[GTFSRouteSource] cyclic parent_station chain at stop ${stop_id}, treating ${current} as its own root`
        );
        return current;
      }
      seen.add(parent);
      current = parent;
    }
  }

  stopName(stop_id: string): string | undefined {
    return this.getStopIndex().get(stop_id)?.name;
  }

  private getStopIndex(): Map<string, StopIndexEntry> {
    if (this.stopIndex) {
      return this.stopIndex;
    }
    const index = new Map<string, StopIndexEntry>();
    for (const stop of this.gtfsParser.getFileDataSyncTyped<Stops>(
      GTFS_TABLES.STOPS
    )) {
      index.set(String(stop.stop_id), {
        parent: stop.parent_station ? String(stop.parent_station) : undefined,
        name: stop.stop_name ? String(stop.stop_name) : undefined,
      });
    }
    this.stopIndex = index;
    return index;
  }
}
