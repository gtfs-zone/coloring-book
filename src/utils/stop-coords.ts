/**
 * Stop coordinate resolution.
 *
 * Owns the question: "where on the map should we draw this stop?"
 *
 * Most stops have their own stop_lat/stop_lon and that's the answer. But per
 * GTFS spec, generic nodes (location_type=3) and boarding areas (location_type=4)
 * may omit coords and inherit position from their parent station. Even types
 * 0/2 sometimes ship with empty coords in real-world feeds.
 *
 * For coord-less children of a station, we don't render them on top of the
 * station (that would collapse N pathway lines onto a single point). Instead
 * we deterministically fan them out on a small circle of radius
 * CONFIG.MISSING_COORD_CIRCLE_RADIUS_METERS around their ancestor.
 *
 * Stops with no own coords AND no coord-having ancestor return null — callers
 * should skip them and surface a warning.
 */
import { CONFIG } from '../config';
import type { Stops } from '../types/gtfs-entities';

const MAX_PARENT_HOPS = 5;
const METERS_PER_DEGREE_LAT = 111_320;

/**
 * True iff the stop has finite numeric coords. Filters out '', null, undefined,
 * NaN, and non-numeric strings.
 */
export function hasValidCoords(stop: Stops): boolean {
  const lat =
    typeof stop.stop_lat === 'number' ? stop.stop_lat : Number(stop.stop_lat);
  const lon =
    typeof stop.stop_lon === 'number' ? stop.stop_lon : Number(stop.stop_lon);
  if (
    stop.stop_lat === '' ||
    stop.stop_lat === null ||
    stop.stop_lat === undefined
  ) {
    return false;
  }
  if (
    stop.stop_lon === '' ||
    stop.stop_lon === null ||
    stop.stop_lon === undefined
  ) {
    return false;
  }
  return Number.isFinite(lat) && Number.isFinite(lon);
}

/**
 * Convert an (east, north) offset in meters at a given latitude to a (dLon, dLat)
 * pair in degrees. Flat-earth approximation — fine for offsets up to ~100m.
 */
export function metersToLatLonOffset(
  centerLat: number,
  eastMeters: number,
  northMeters: number
): { dLat: number; dLon: number } {
  const dLat = northMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dLon = cosLat === 0 ? 0 : eastMeters / (METERS_PER_DEGREE_LAT * cosLat);
  return { dLat, dLon };
}

/**
 * Build a resolver that maps a stop_id to its visual [lon, lat], handling
 * coord-less children by distributing them in a circle around the nearest
 * coord-having ancestor.
 *
 * The resolver memoizes results so repeated lookups across rendering passes
 * are cheap. It expects the full stops array (used to walk parent_station
 * chains and to compute deterministic circular positions among siblings).
 *
 * Returns null for stops that have no own coords and no ancestor with coords.
 */
export function buildStopCoordResolver(
  stops: Stops[]
): (stop_id: string) => [number, number] | null {
  const byId = new Map<string, Stops>();
  for (const s of stops) {
    byId.set(String(s.stop_id), s);
  }

  // Find the nearest ancestor stop_id that has its own valid coords.
  const findCoordAncestor = (stop: Stops): Stops | null => {
    let current = stop;
    for (let i = 0; i < MAX_PARENT_HOPS; i++) {
      const parentId = current.parent_station
        ? String(current.parent_station)
        : '';
      if (!parentId) {
        return null;
      }
      const parent = byId.get(parentId);
      if (!parent) {
        return null;
      }
      if (hasValidCoords(parent)) {
        return parent;
      }
      current = parent;
    }
    return null;
  };

  // Group every coord-less stop by its *resolved* coord-having ancestor (not
  // just its immediate parent_station). This makes nested orphans — e.g., a
  // boarding area whose platform parent also lacks coords — share a single
  // circular layout around the station.
  const orphanSiblingsByAncestor = new Map<string, string[]>();
  for (const s of stops) {
    if (hasValidCoords(s)) {
      continue;
    }
    const ancestor = findCoordAncestor(s);
    if (!ancestor) {
      continue;
    }
    const ancestorId = String(ancestor.stop_id);
    let bucket = orphanSiblingsByAncestor.get(ancestorId);
    if (!bucket) {
      bucket = [];
      orphanSiblingsByAncestor.set(ancestorId, bucket);
    }
    bucket.push(String(s.stop_id));
  }
  // Sort deterministically so circle positions are stable across renders.
  for (const bucket of orphanSiblingsByAncestor.values()) {
    bucket.sort();
  }

  const cache = new Map<string, [number, number] | null>();

  return (stop_id: string): [number, number] | null => {
    const key = String(stop_id);
    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }
    const stop = byId.get(key);
    if (!stop) {
      cache.set(key, null);
      return null;
    }
    if (hasValidCoords(stop)) {
      const result: [number, number] = [
        Number(stop.stop_lon),
        Number(stop.stop_lat),
      ];
      cache.set(key, result);
      return result;
    }
    const ancestor = findCoordAncestor(stop);
    if (!ancestor) {
      cache.set(key, null);
      return null;
    }
    const ancestorLat = Number(ancestor.stop_lat);
    const ancestorLon = Number(ancestor.stop_lon);
    const siblings = orphanSiblingsByAncestor.get(String(ancestor.stop_id)) ?? [
      key,
    ];
    const index = siblings.indexOf(key);
    const count = siblings.length;
    const angle = count > 0 ? (2 * Math.PI * index) / count : 0;
    const radius = CONFIG.MISSING_COORD_CIRCLE_RADIUS_METERS;
    const east = radius * Math.cos(angle);
    const north = radius * Math.sin(angle);
    const { dLat, dLon } = metersToLatLonOffset(ancestorLat, east, north);
    const result: [number, number] = [ancestorLon + dLon, ancestorLat + dLat];
    cache.set(key, result);
    return result;
  };
}
