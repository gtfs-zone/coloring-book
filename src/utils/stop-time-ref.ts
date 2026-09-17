/**
 * Reading a `StopTimeRef` off a stop_times row.
 *
 * The type itself is in `types/gtfs-flex.ts`, which stays free of any entity
 * import so it is shared as vocabulary. This is the half that knows what this
 * app's parsed `StopTimes` row looks like.
 */

import type { StopTimes } from '../types/gtfs-entities';
import type { StopTimeRef } from 'interlocking/gtfs/types';

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
