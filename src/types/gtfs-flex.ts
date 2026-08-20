/**
 * GTFS Flex (on-demand service) shared types and helpers.
 *
 * A stop_time references exactly one of stop_id, location_group_id or
 * location_id. StopTimeRef is the generalized form of that reference so the
 * sequence and timetable pipelines do not have to assume stop_id.
 */

import type { StopTimes } from './gtfs-entities';

export type StopTimeRefKind = 'stop' | 'location_group' | 'location';

export interface StopTimeRef {
  kind: StopTimeRefKind;
  id: string;
}

// Non-empty string value, or null
function value(raw: unknown): string | null {
  if (typeof raw === 'number') {
    return String(raw);
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the single reference on a stop_time row. Returns null (and warns) if
 * zero or more than one of the three mutually exclusive fields is set.
 */
export function stopTimeRef(row: StopTimes): StopTimeRef | null {
  const stopId = value(row?.stop_id);
  const locationGroupId = value(row?.location_group_id);
  const locationId = value(row?.location_id);

  const refs: StopTimeRef[] = [];
  if (stopId !== null) {
    refs.push({ kind: 'stop', id: stopId });
  }
  if (locationGroupId !== null) {
    refs.push({ kind: 'location_group', id: locationGroupId });
  }
  if (locationId !== null) {
    refs.push({ kind: 'location', id: locationId });
  }

  if (refs.length === 1) {
    return refs[0];
  }

  const where = `trip_id=${row?.trip_id ?? '?'} stop_sequence=${row?.stop_sequence ?? '?'}`;
  if (refs.length === 0) {
    console.warn(
      `[Flex] stop_time has none of stop_id, location_group_id, location_id (${where})`
    );
  } else {
    console.warn(
      `[Flex] stop_time has ${refs.length} mutually exclusive references: ${refs
        .map((ref) => `${ref.kind}=${ref.id}`)
        .join(', ')} (${where})`
    );
  }
  return null;
}
