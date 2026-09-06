/**
 * Read and write access to on-demand zones (locations.geojson).
 *
 * locations.geojson is stored as a *single* row holding the whole
 * FeatureCollection, not one row per feature, so every write rewrites the
 * feature array. The row lives in the `locations` object store under the fixed
 * key `locations` (primary key type 'none', see utils/gtfs-primary-keys.ts).
 */

import type { GTFSParser } from './gtfs-parser.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import { patchUpdate } from '../utils/patch-utils.js';
import type { GTFSDatabaseRecord } from './gtfs-database.js';

/** Object store and row key for locations.geojson. */
export const LOCATIONS_TABLE = 'locations';
export const LOCATIONS_ROW_KEY = 'locations';

/**
 * The slice of PatchManager a zone write needs. Structural rather than the
 * class itself, so the view layer can pass the narrowed patch-manager handle it
 * already holds.
 */
export interface ZonePatchRecorder {
  recordInsert: (
    table: string,
    id: string,
    record: Record<string, unknown>
  ) => Promise<void>;
  recordUpdate: (
    table: string,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ) => Promise<void>;
}

/**
 * A stored locations.geojson feature.
 *
 * The geometry is nullable because a feed can arrive carrying a feature the
 * reference forbids, and dropping it on read would delete it on the next write.
 * `listZones` is the filtered view for everything that draws or lists zones.
 */
export type ZoneFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon | null
>;

/** A zone that passed `hasZoneGeometry`, so its geometry can be drawn. */
export type DrawnZoneFeature = GeoJSON.Feature<
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

/**
 * Every stored feature, exactly as the file carries it.
 *
 * Unfiltered on purpose: a zone write rewrites the whole feature array from
 * this list, so anything skipped here would be deleted from the file by the
 * next unrelated edit. Use `listZones` to list or draw zones.
 */
export function getZoneFeatures(parser: GTFSParser): ZoneFeature[] {
  return getZoneCollection(parser).features as ZoneFeature[];
}

/** Whether the feature carries a polygonal geometry with coordinates. */
export function hasZoneGeometry(feature: ZoneFeature): boolean {
  const type = feature.geometry?.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon') {
    return false;
  }
  return positionsOf(feature).length > 0;
}

/**
 * The zones that are usable as zones: an id and a real geometry.
 *
 * For the map, search and the pickers. A feature that fails either test is
 * reported by the validator and stays reachable from the On-Demand modal's
 * Zones pane, which reads the raw collection.
 */
export function listZones(parser: GTFSParser): DrawnZoneFeature[] {
  const features: DrawnZoneFeature[] = [];
  for (const feature of getZoneFeatures(parser)) {
    if (feature.id === undefined || feature.id === null || feature.id === '') {
      console.warn('[ZoneStore] Skipping locations.geojson feature with no id');
      continue;
    }
    if (!hasZoneGeometry(feature)) {
      console.warn(
        `[ZoneStore] Skipping locations.geojson feature ${String(feature.id)}: geometry is ${String(feature.geometry?.type)}, expected Polygon or MultiPolygon with coordinates`
      );
      continue;
    }
    features.push(feature as DrawnZoneFeature);
  }
  return features;
}

/**
 * One feature by id, geometry or not, so a feature the validator flagged can
 * be opened and repaired on its zone page.
 */
export function getZoneFeature(
  parser: GTFSParser,
  location_id: string
): ZoneFeature | null {
  return (
    getZoneFeatures(parser).find((f) => String(f.id ?? '') === location_id) ??
    null
  );
}

export function zoneName(feature: ZoneFeature): string {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return properties.stop_name ? String(properties.stop_name) : '';
}

export function zoneDescription(feature: ZoneFeature): string {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return properties.stop_desc ? String(properties.stop_desc) : '';
}

/** Every position in a polygon or multipolygon, rings included. */
function positionsOf(feature: ZoneFeature): GeoJSON.Position[] {
  const geometry = feature.geometry;
  if (!geometry) {
    return [];
  }
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
    // geojson.io returns a feature it could not draw with a null geometry.
    // Storing that is how a zone loses its polygon, so refuse it here.
    const type = feature.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') {
      throw new Error(
        `Zone ${id} came back with geometry ${String(type)}, expected a Polygon or MultiPolygon. Draw the zone in geojson.io first, then Share and paste the link.`
      );
    }
    incomingById.set(id, feature);
  }

  const result: ZoneFeature[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const feature of current) {
    const id = String(feature.id ?? '');
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

/** The before/after payloads of a zone write, for the caller's patch. */
export interface ZoneWritePayloads {
  before: { features: ZoneFeature[] };
  after: { features: ZoneFeature[] };
}

/**
 * Write a new zone feature array to the database and memory, recording nothing.
 *
 * For callers that fold the zone write into a batch patch of their own. Anything
 * else wants `writeZoneFeatures`, which records the patch too.
 */
export async function applyZoneFeatures(
  parser: GTFSParser,
  features: ZoneFeature[]
): Promise<ZoneWritePayloads> {
  const collection = getZoneCollection(parser);
  const before = collection.features as ZoneFeature[];

  await parser.gtfsDatabase.updateRow(LOCATIONS_TABLE, LOCATIONS_ROW_KEY, {
    features,
  } as unknown as Partial<GTFSDatabaseRecord>);

  parser.setInMemoryFileData(GTFS_TABLES.LOCATIONS_GEOJSON, [
    { ...collection, type: 'FeatureCollection', features },
  ] as unknown as GTFSDatabaseRecord[]);

  console.log(
    `[ZoneStore] Wrote ${features.length} zone features (was ${before.length})`
  );
  return { before: { features: before }, after: { features } };
}

/**
 * Create the locations.geojson row if the feed has none, as its own patch.
 *
 * A feed imported without the file has no row to update, so the update that
 * follows needs a target and undo needs both steps to walk back through.
 */
export async function ensureLocationsRow(
  parser: GTFSParser,
  patchManager: ZonePatchRecorder | null
): Promise<void> {
  const existing = await parser.gtfsDatabase.getRow(
    LOCATIONS_TABLE,
    LOCATIONS_ROW_KEY
  );
  if (existing) {
    return;
  }
  const empty = { type: 'FeatureCollection', features: [] };
  await parser.gtfsDatabase.insertRows(LOCATIONS_TABLE, [
    empty as unknown as GTFSDatabaseRecord,
  ]);
  await patchManager?.recordInsert(LOCATIONS_TABLE, LOCATIONS_ROW_KEY, empty);
}

/**
 * Persist a new zone feature array as a single recorded patch.
 *
 * The whole feature array is the patched value: the row is one FeatureCollection,
 * so there is no per-feature key to address.
 */
export async function writeZoneFeatures(
  parser: GTFSParser,
  patchManager: ZonePatchRecorder | null,
  features: ZoneFeature[]
): Promise<void> {
  await ensureLocationsRow(parser, patchManager);

  const collection = getZoneCollection(parser);
  const before = collection.features;

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

/**
 * Overlay properties onto one zone's feature.
 *
 * An empty value removes the property rather than storing `""`: the exported
 * locations.geojson should carry a `stop_desc` only when there is one.
 */
export async function setZoneProperties(
  parser: GTFSParser,
  patchManager: ZonePatchRecorder | null,
  location_id: string,
  properties: Record<string, string>
): Promise<void> {
  const features = getZoneFeatures(parser);
  const target = features.find((f) => String(f.id ?? '') === location_id);
  if (!target) {
    throw new Error(
      `Zone ${location_id} is no longer in locations.geojson. Reload the page.`
    );
  }

  const merged = { ...(target.properties ?? {}) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(properties)) {
    if (value === '') {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  const next = features.map((feature) =>
    feature === target ? { ...feature, properties: merged } : feature
  );
  await writeZoneFeatures(parser, patchManager, next);
  console.log(`[ZoneStore] Updated properties of zone ${location_id}`);
}
