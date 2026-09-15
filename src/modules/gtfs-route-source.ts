import type { GTFSParser } from './gtfs-parser';
import type {
  RouteSource,
  RouteSourceTrip,
  RouteSourceStopTime,
} from './route-source';
import { GTFS_TABLES } from '../types/gtfs';
import type { LocationGroups, Stops } from '../types/gtfs-entities';
import type { StopTimeRef } from '../types/gtfs-flex';
import { stopTimeRef } from '../utils/stop-time-ref';

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
  private locationGroupIndex: Map<string, string> | null = null;
  private zoneIndex: Map<string, string> | null = null;
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
        ref: stopTimeRef(st),
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

  locationGroupName(location_group_id: string): string | undefined {
    return this.getLocationGroupIndex().get(location_group_id);
  }

  zoneName(location_id: string): string | undefined {
    return this.getZoneIndex().get(location_id);
  }

  refName(ref: StopTimeRef): string | undefined {
    if (ref.kind === 'stop') {
      return this.stopName(ref.id);
    }
    if (ref.kind === 'location_group') {
      return this.locationGroupName(ref.id);
    }
    return this.zoneName(ref.id);
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

  private getLocationGroupIndex(): Map<string, string> {
    if (this.locationGroupIndex) {
      return this.locationGroupIndex;
    }
    const index = new Map<string, string>();
    for (const group of this.gtfsParser.getFileDataSyncTyped<LocationGroups>(
      GTFS_TABLES.LOCATION_GROUPS
    )) {
      const id = String(group.location_group_id ?? '');
      if (!id) {
        continue;
      }
      if (group.location_group_name) {
        index.set(id, String(group.location_group_name));
      }
    }
    this.locationGroupIndex = index;
    return index;
  }

  /**
   * Zone names off locations.geojson, which is stored as a single row holding
   * the whole FeatureCollection rather than one row per feature.
   */
  private getZoneIndex(): Map<string, string> {
    if (this.zoneIndex) {
      return this.zoneIndex;
    }
    const index = new Map<string, string>();
    const rows = this.gtfsParser.getFileDataSync(GTFS_TABLES.LOCATIONS_GEOJSON);
    const collection = rows[0] as
      | { features?: Array<Record<string, unknown>> }
      | undefined;
    for (const feature of collection?.features ?? []) {
      const id = feature.id !== undefined ? String(feature.id) : '';
      if (!id) {
        continue;
      }
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      if (properties.stop_name) {
        index.set(id, String(properties.stop_name));
      }
    }
    this.zoneIndex = index;
    return index;
  }
}
