/**
 * Owners of IDs in the namespace stops.txt, locations.geojson and
 * location_groups.txt share
 */

import { GTFS_TABLES } from '../types/gtfs';
import { LOCATIONS_TABLE } from '../modules/zone-store';
import { specStoreName } from './spec-field-edit';
import { t } from '../i18n/messages';

interface RowSource {
  getAllRows(tableName: string): Promise<Record<string, unknown>[]>;
}

/** The stored FeatureCollection's features, or an empty list. */
export async function readZoneFeatures(
  database: RowSource
): Promise<GeoJSON.Feature[]> {
  const rows = await database.getAllRows(LOCATIONS_TABLE);
  const stored = rows[0] as Partial<GeoJSON.FeatureCollection> | undefined;
  return Array.isArray(stored?.features) ? stored.features : [];
}

/** Every id already claimed by stops.txt or locations.geojson, and by which. */
export async function readIdOwners(
  database: RowSource
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  const stops = await database.getAllRows(specStoreName(GTFS_TABLES.STOPS));
  for (const stop of stops) {
    const id = String(stop.stop_id ?? '').trim();
    if (id !== '') {
      owners.set(id, t('ids.ownerStop'));
    }
  }
  for (const feature of await readZoneFeatures(database)) {
    const id = String(feature.id ?? '').trim();
    if (id !== '') {
      owners.set(id, t('ids.ownerZone'));
    }
  }
  return owners;
}

/**
 * Every id a new stop or zone may not take.
 *
 * `readIdOwners` covers stops and existing zones, which is all the location
 * group validator may see (it must not flag a row against its own id). A new
 * stop or zone is checked against the whole namespace, so the location groups
 * go on top.
 */
export async function readNewLocationIdOwners(
  database: RowSource
): Promise<Map<string, string>> {
  const owners = await readIdOwners(database);
  const groups = await database.getAllRows(
    specStoreName(GTFS_TABLES.LOCATION_GROUPS)
  );
  for (const group of groups) {
    const id = String(group.location_group_id ?? '').trim();
    if (id !== '' && !owners.has(id)) {
      owners.set(id, t('ids.ownerGroup'));
    }
  }
  return owners;
}

/** The message for an id `owners` already holds, or null if it is free. */
export function locationIdClash(
  owners: Map<string, string>,
  id: string
): string | null {
  const owner = owners.get(id);
  return owner ? t('ids.taken', { id, owner }) : null;
}
