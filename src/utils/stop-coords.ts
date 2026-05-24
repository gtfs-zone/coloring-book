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
 * For coord-less children of a station, we use the pathway graph (pathways.txt)
 * to place them sensibly via Tutte's barycentric embedding: each coord-less
 * stop is iteratively moved to the average position of its pathway neighbors,
 * with coord-having siblings pinned at their real coordinates. A coord-less
 * stop wired between two pinned stops lands on the midpoint; a chain spreads
 * evenly along the line between its endpoints.
 *
 * Fallback rules:
 *  - Coord-less stop with no pathway edges → stacked at the ancestor's coords.
 *  - Coord-less stop whose pathway component never reaches a pinned stop
 *    (orphan island) → returns null (caller skips and warns).
 *  - Stop with no own coords and no coord-having ancestor → returns null.
 */
import type { Pathways, Stops } from '../types/gtfs-entities';

const MAX_PARENT_HOPS = 5;
const METERS_PER_DEGREE_LAT = 111_320;
const TUTTE_ITERATIONS = 50;

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
 * coord-less children via Tutte's barycentric embedding over the pathway graph.
 *
 * The resolver memoizes results so repeated lookups across rendering passes
 * are cheap. It expects the full stops array (to walk parent_station chains)
 * and the full pathways array (to drive coord-less placement).
 *
 * Returns null for stops that have no own coords and no ancestor with coords,
 * and for coord-less stops in pathway components that don't reach any pinned
 * sibling (caller should skip these and surface a warning).
 */
export function buildStopCoordResolver(
  stops: Stops[],
  pathways: Pathways[] = []
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

  // Single pass: classify each stop as orphan (no own coords) or pinned (has
  // own coords). Orphans are bucketed by ancestor immediately; pinned candidates
  // are deferred because pinnedByAncestor can only be seeded after
  // orphansByAncestor is fully built.
  const orphansByAncestor = new Map<string, string[]>();
  const pendingPinned: Array<[string, string]> = [];
  for (const s of stops) {
    const stopId = String(s.stop_id);
    if (hasValidCoords(s)) {
      const ancestor = findCoordAncestor(s);
      if (ancestor) {
        pendingPinned.push([stopId, String(ancestor.stop_id)]);
      }
    } else {
      const ancestor = findCoordAncestor(s);
      if (!ancestor) {
        continue;
      }
      const ancestorId = String(ancestor.stop_id);
      let bucket = orphansByAncestor.get(ancestorId);
      if (!bucket) {
        bucket = [];
        orphansByAncestor.set(ancestorId, bucket);
      }
      bucket.push(stopId);
    }
  }

  // For each ancestor, gather the IDs of its pinned (coord-having) children
  // plus itself. These act as anchors in the Tutte solver and are the only
  // way an orphan stop can be reachable from "ground truth" positions.
  const pinnedByAncestor = new Map<string, Set<string>>();
  for (const ancestorId of orphansByAncestor.keys()) {
    pinnedByAncestor.set(ancestorId, new Set([ancestorId]));
  }
  for (const [stopId, ancestorId] of pendingPinned) {
    const pinned = pinnedByAncestor.get(ancestorId);
    if (pinned) {
      pinned.add(stopId);
    }
  }

  // Build a global adjacency map from pathways (undirected).
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    let setA = adjacency.get(a);
    if (!setA) {
      setA = new Set();
      adjacency.set(a, setA);
    }
    setA.add(b);
    let setB = adjacency.get(b);
    if (!setB) {
      setB = new Set();
      adjacency.set(b, setB);
    }
    setB.add(a);
  };
  for (const pw of pathways) {
    const from = pw.from_stop_id ? String(pw.from_stop_id) : '';
    const to = pw.to_stop_id ? String(pw.to_stop_id) : '';
    if (!from || !to || from === to) {
      continue;
    }
    addEdge(from, to);
  }

  const cache = new Map<string, [number, number] | null>();

  // Pre-compute coords for all coord-less stops, ancestor by ancestor.
  for (const [ancestorId, orphanIds] of orphansByAncestor) {
    const ancestor = byId.get(ancestorId);
    if (!ancestor) {
      continue;
    }
    const anchorCoord: [number, number] = [
      Number(ancestor.stop_lon),
      Number(ancestor.stop_lat),
    ];
    const pinned = pinnedByAncestor.get(ancestorId) ?? new Set([ancestorId]);

    // Local edge list: only edges where both endpoints belong to this station.
    // (Pathways crossing station boundaries are nonsensical anyway.)
    const inStation = (id: string) => pinned.has(id) || orphanIds.includes(id);

    // Classify each orphan and compute initial positions.
    type SolverNode = {
      id: string;
      neighbors: string[]; // ids in this station with edges to this orphan
      pos: [number, number];
    };
    const solverNodes: SolverNode[] = [];
    const positions = new Map<string, [number, number]>();

    for (const orphanId of orphanIds) {
      const neighborsAll = adjacency.get(orphanId);
      const neighbors = neighborsAll
        ? Array.from(neighborsAll).filter(inStation)
        : [];

      if (neighbors.length === 0) {
        // No-edge stop → stack at station center.
        positions.set(orphanId, [anchorCoord[0], anchorCoord[1]]);
        continue;
      }

      // Check reachability to any pinned node via BFS within the station.
      const visited = new Set<string>([orphanId]);
      const queue: string[] = [orphanId];
      let reachesPinned = false;
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (pinned.has(cur)) {
          reachesPinned = true;
          break;
        }
        const curNeighbors = adjacency.get(cur);
        if (!curNeighbors) {
          continue;
        }
        for (const nb of curNeighbors) {
          if (!inStation(nb) || visited.has(nb)) {
            continue;
          }
          visited.add(nb);
          queue.push(nb);
        }
      }

      if (!reachesPinned) {
        console.warn(
          `[stop-coords] Orphan-island pathway component: stop_id=${orphanId} has pathway edges but no path to a coord-having sibling in station ${ancestorId} — skipping render.`
        );
        cache.set(orphanId, null);
        continue;
      }

      solverNodes.push({
        id: orphanId,
        neighbors,
        pos: [anchorCoord[0], anchorCoord[1]],
      });
      positions.set(orphanId, [anchorCoord[0], anchorCoord[1]]);
    }

    // Resolver for a neighbor's current position (pinned → real coords).
    const neighborPos = (id: string): [number, number] | null => {
      if (id === ancestorId) {
        return anchorCoord;
      }
      if (pinned.has(id)) {
        const s = byId.get(id);
        if (s && hasValidCoords(s)) {
          return [Number(s.stop_lon), Number(s.stop_lat)];
        }
        return null;
      }
      return positions.get(id) ?? null;
    };

    // Tutte iteration: each unpinned node moves to the centroid of its neighbors.
    for (let iter = 0; iter < TUTTE_ITERATIONS; iter++) {
      for (const node of solverNodes) {
        let sumLon = 0;
        let sumLat = 0;
        let count = 0;
        for (const nbId of node.neighbors) {
          const np = neighborPos(nbId);
          if (!np) {
            continue;
          }
          sumLon += np[0];
          sumLat += np[1];
          count += 1;
        }
        if (count === 0) {
          continue;
        }
        node.pos = [sumLon / count, sumLat / count];
        positions.set(node.id, node.pos);
      }
    }

    for (const [id, pos] of positions) {
      cache.set(id, pos);
    }
  }

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
    // Coord-less stop not in any ancestor bucket (no coord-having ancestor).
    cache.set(key, null);
    return null;
  };
}
