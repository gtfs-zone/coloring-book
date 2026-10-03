/**
 * Bulk trip deletion.
 *
 * Deletes trips and the frequencies rows that belong to them as one patch, so
 * the whole run is one undo step. The caller picks the trips; this does not
 * touch stop_times, so it is meant for trips that have none.
 */

import type { EditableTableDeps } from '../modules/editable-table';
import { generateCompositeKeyFromRecord } from './gtfs-primary-keys';
import { t } from '../i18n/messages';

export interface TripDeleteResult {
  /** Trips deleted. */
  trips: number;
  /** frequencies rows deleted along with them. */
  frequencies: number;
  /** Trip ids that no longer exist, so there was nothing to delete. */
  missing: number;
}

type MixedOps = Parameters<
  EditableTableDeps['patchManager']['recordBatchMixed']
>[0];

export async function deleteTrips(
  trip_ids: string[],
  deps: EditableTableDeps
): Promise<TripDeleteResult> {
  const wanted = new Set(trip_ids);
  const result: TripDeleteResult = { trips: 0, frequencies: 0, missing: 0 };

  const trips = await deps.gtfsDatabase.getAllRows('trips');
  const found = trips.filter((trip) => wanted.has(String(trip.trip_id ?? '')));
  const foundIds = new Set(found.map((trip) => String(trip.trip_id)));
  result.missing = [...wanted].filter((id) => !foundIds.has(id)).length;

  const frequencies = (
    await deps.gtfsDatabase.getAllRows('frequencies')
  ).filter((row) => foundIds.has(String(row.trip_id ?? '')));

  const ops: MixedOps = [
    ...frequencies.map((row) => ({
      op: 'delete' as const,
      table: 'frequencies',
      id: generateCompositeKeyFromRecord('frequencies', row),
      record: { ...row },
    })),
    ...found.map((trip) => ({
      op: 'delete' as const,
      table: 'trips',
      id: String(trip.trip_id),
      record: { ...trip },
    })),
  ];

  if (ops.length === 0) {
    console.log('[TripDelete] nothing to delete');
    return result;
  }

  console.log(
    `[TripDelete] deleting ${found.length} trips and ${frequencies.length} frequencies rows`
  );
  for (const op of ops) {
    await deps.gtfsDatabase.deleteRow(op.table, op.id);
  }
  await deps.patchManager.recordBatchMixed(
    ops,
    t('fix.deleteTripsLabel', { count: found.length })
  );

  result.trips = found.length;
  result.frequencies = frequencies.length;
  return result;
}

/** The one-line notification text for a finished run. */
export function describeTripDelete(result: TripDeleteResult): string {
  const parts = [t('fix.deletedTrips', { count: result.trips })];
  if (result.frequencies > 0) {
    parts.push(t('fix.removedFrequencies', { count: result.frequencies }));
  }
  if (result.missing > 0) {
    parts.push(t('fix.skippedTrips', { count: result.missing }));
  }
  return parts.join('; ');
}
