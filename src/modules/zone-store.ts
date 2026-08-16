/**
 * Read and write access to on-demand zones (locations.geojson).
 *
 * locations.geojson is stored as a *single* row holding the whole
 * FeatureCollection, not one row per feature, so every write rewrites the
 * feature array. The row lives in the `locations` object store under the fixed
 * key `locations` (primary key type 'none', see utils/gtfs-primary-keys.ts).
 */

import type { GTFSParser } from './gtfs-parser.js';
import type { PatchManager } from './patch-manager.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import { patchUpdate } from '../utils/patch-utils.js';
import type { GTFSDatabaseRecord } from './gtfs-database.js';

/** Object store and row key for locations.geojson. */
export const LOCATIONS_TABLE = 'locations';
export const LOCATIONS_ROW_KEY = 'locations';

export type ZoneFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon
>;

/** [west, south, east, north] */
export type ZoneBounds = [number, number, number, number];

/** The stored FeatureCollection, or an empty one when the feed has no zones. */
export function getZoneCollection(
  parser: GTFSParser
): GeoJSON.FeatureCollection {
  const rows = parser.getFileDataSync(GTFS_TABLES.LOCATIONS_GEOJSON);
  const stored = rows[0] as unknown as Partial<GeoJSON.FeatureCollection>;
  if (!stored || !Array.isArray(stored.features)) {
    return { type: 'FeatureCollection', features: [] };
  }
  return stored as GeoJSON.FeatureCollection;
}

/** Every zone feature that has an id and a polygonal geometry. */
export function getZoneFeatures(parser: GTFSParser): ZoneFeature[] {
  const features: ZoneFeature[] = [];
  for (const feature of getZoneCollection(parser).features) {
    const type = feature.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') {
      console.warn(
        `[ZoneStore] Skipping locations.geojson feature ${String(feature.id)}: geometry is ${String(type)}, expected Polygon or MultiPolygon`
      );
      continue;
    }
    if (feature.id === undefined || feature.id === null || feature.id === '') {
      console.warn('[ZoneStore] Skipping locations.geojson feature with no id');
      continue;
    }
    features.push(feature as ZoneFeature);
  }
  return features;
}

export function getZoneFeature(
  parser: GTFSParser,
  location_id: string
): ZoneFeature | null {
  return (
    getZoneFeatures(parser).find((f) => String(f.id) === location_id) ?? null
  );
}

export function zoneName(feature: ZoneFeature): string {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return properties.stop_name ? String(properties.stop_name) : '';
}

/** Every position in a polygon or multipolygon, rings included. */
function positionsOf(feature: ZoneFeature): GeoJSON.Position[] {
  const geometry = feature.geometry;
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.flat();
  }
  return geometry.coordinates.flat(2);
}

export function zoneVertexCount(feature: ZoneFeature): number {
  return positionsOf(feature).length;
}

export function zoneBounds(feature: ZoneFeature): ZoneBounds | null {
  const positions = positionsOf(feature);
  if (positions.length === 0) {
    return null;
  }
  let [west, south] = positions[0];
  let east = west;
  let north = south;
  for (const [lng, lat] of positions) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

export interface ZoneMergeResult {
  features: ZoneFeature[];
  added: string[];
  updated: string[];
  removed: string[];
}

/**
 * Merge edited features back over the stored ones.
 *
 * geojson.io does not preserve unknown properties, so an incoming feature
 * replaces geometry and overlays its own properties on top of the stored ones
 * rather than overwriting the whole feature. `removeMissing` is for a
 * whole-collection round trip, where a feature the user deleted in geojson.io
 * should disappear here too; it must stay false when only one zone was sent
 * out, or the round trip would delete every other zone in the feed.
 */
export function mergeZoneFeatures(
  current: ZoneFeature[],
  incoming: GeoJSON.Feature[],
  removeMissing: boolean
): ZoneMergeResult {
  const incomingById = new Map<string, GeoJSON.Feature>();
  for (const feature of incoming) {
    const id =
      feature.id !== undefined && feature.id !== null && feature.id !== ''
        ? String(feature.id)
        : String(
            (feature.properties as Record<string, unknown> | null)?.id ?? ''
          );
    if (!id) {
      throw new Error(
        'A pasted feature has no id. Every zone needs an `id` matching its location_id.'
      );
    }
    if (incomingById.has(id)) {
      throw new Error(`Duplicate zone id in the pasted GeoJSON: ${id}`);
    }
    incomingById.set(id, feature);
  }

  const result: ZoneFeature[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const feature of current) {
    const id = String(feature.id);
    const edited = incomingById.get(id);
    if (!edited) {
      if (removeMissing) {
        removed.push(id);
      } else {
        result.push(feature);
      }
      continue;
    }
    incomingById.delete(id);
    result.push({
      ...feature,
      id,
      properties: {
        ...(feature.properties ?? {}),
        ...(edited.properties ?? {}),
      },
      geometry: edited.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    });
    updated.push(id);
  }

  const added: string[] = [];
  for (const [id, feature] of incomingById) {
    result.push({
      type: 'Feature',
      id,
      properties: { ...(feature.properties ?? {}) },
      geometry: feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    });
    added.push(id);
  }

  return { features: result, added, updated, removed };
}

/**
 * Persist a new zone feature array as a single recorded patch.
 *
 * The whole feature array is the patched value: the row is one FeatureCollection,
 * so there is no per-feature key to address.
 */
export async function writeZoneFeatures(
  parser: GTFSParser,
  patchManager: PatchManager | null,
  features: ZoneFeature[]
): Promise<void> {
  const collection = getZoneCollection(parser);
  const before = collection.features;

  // A feed with no locations.geojson has no row to update. Create the empty
  // collection first, as its own recorded patch, so the update below has a
  // target and undo walks back through both steps.
  const existing = await parser.gtfsDatabase.getRow(
    LOCATIONS_TABLE,
    LOCATIONS_ROW_KEY
  );
  if (!existing) {
    const empty = { type: 'FeatureCollection', features: [] };
    await parser.gtfsDatabase.insertRows(LOCATIONS_TABLE, [
      empty as unknown as GTFSDatabaseRecord,
    ]);
    await patchManager?.recordInsert(LOCATIONS_TABLE, LOCATIONS_ROW_KEY, empty);
  }

  await patchUpdate(
    parser.gtfsDatabase,
    patchManager,
    LOCATIONS_TABLE,
    LOCATIONS_ROW_KEY,
    { features: before },
    { features }
  );

  parser.setInMemoryFileData(GTFS_TABLES.LOCATIONS_GEOJSON, [
    { ...collection, type: 'FeatureCollection', features },
  ] as unknown as GTFSDatabaseRecord[]);

  console.log(
    `[ZoneStore] Wrote ${features.length} zone features (was ${before.length})`
  );
}
