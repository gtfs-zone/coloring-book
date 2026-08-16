/**
 * The timetable's stop_times.txt field model.
 *
 * The roster is derived from `gtfsSpec` rather than hand-listed, so a spec
 * refresh that adds, removes or reorders a stop_times field shows up in the
 * grid without a second edit here. The five fields the timetable already
 * renders as structure (the trip column, the row label, the row order) are the
 * only exclusions.
 */

import { gtfsSpec } from '../gtfs-spec/index.js';
import { GTFSFieldType, mapGTFSTypeString } from '../types/gtfs-field-types.js';
import type { AlignedTrip } from './timetable-data-processor.js';

/** The editor a field's sub-row opens on click. */
export type StopTimeFieldKind =
  | 'time'
  | 'enum'
  | 'number'
  | 'text'
  | 'booking_rule';

/**
 * Fields the timetable renders as structure, not as a sub-row: `trip_id` is the
 * column, the three refs are the row label, `stop_sequence` is the row order.
 */
const STRUCTURAL_FIELDS = new Set([
  'trip_id',
  'stop_id',
  'location_group_id',
  'location_id',
  'stop_sequence',
]);

const BOOKING_RULE_FIELDS = new Set([
  'pickup_booking_rule_id',
  'drop_off_booking_rule_id',
]);

function stopTimesFields(): { name: string; type: string }[] {
  const file = gtfsSpec.files.find((f) => f.filename === 'stop_times.txt');
  if (!file?.fields) {
    throw new Error('[timetable-fields] stop_times.txt missing from gtfsSpec');
  }
  return file.fields;
}

const FIELD_TYPES: Map<string, string> = new Map(
  stopTimesFields().map((field) => [field.name, field.type])
);

/**
 * The 13 editable fields, in stop_times.txt spec order.
 */
export const STOP_TIME_EDITABLE_FIELDS: readonly string[] = stopTimesFields()
  .map((field) => field.name)
  .filter((name) => !STRUCTURAL_FIELDS.has(name));

/** The two time fields of a scheduled row. Always in the roster. */
export const TIME_FIELDS: readonly string[] = [
  'arrival_time',
  'departure_time',
];

/** The two time fields of an on-demand row. */
export const WINDOW_FIELDS: readonly string[] = [
  'start_pickup_drop_off_window',
  'end_pickup_drop_off_window',
];

/**
 * Which editor a field opens. Derived from the spec's type string, except for
 * the two booking rule ids, which are foreign IDs the picker handles specially.
 */
export function stopTimeFieldKind(field: string): StopTimeFieldKind {
  if (BOOKING_RULE_FIELDS.has(field)) {
    return 'booking_rule';
  }

  const type = FIELD_TYPES.get(field);
  if (!type) {
    throw new Error(`[timetable-fields] unknown stop_times field '${field}'`);
  }

  switch (mapGTFSTypeString(type)) {
    case GTFSFieldType.Time:
    case GTFSFieldType.LocalTime:
      return 'time';
    case GTFSFieldType.Enum:
      return 'enum';
    case GTFSFieldType.Integer:
    case GTFSFieldType.NonNegativeInteger:
    case GTFSFieldType.NonZeroInteger:
    case GTFSFieldType.PositiveInteger:
    case GTFSFieldType.Float:
    case GTFSFieldType.NonNegativeFloat:
    case GTFSFieldType.PositiveFloat:
      return 'number';
    case GTFSFieldType.Text:
      return 'text';
    default:
      throw new Error(
        `[timetable-fields] no editor for stop_times field '${field}' of type '${type}'`
      );
  }
}

/**
 * The fields non-empty on at least one stop_time across the supplied trips,
 * i.e. the current route + direction.
 */
export function usedStopTimeFields(trips: AlignedTrip[]): Set<string> {
  const used = new Set<string>();

  for (const trip of trips) {
    if (!trip.editableStopTimes) {
      continue;
    }
    for (const editable of trip.editableStopTimes.values()) {
      const row = editable as unknown as Record<string, unknown>;
      for (const field of STOP_TIME_EDITABLE_FIELDS) {
        if (used.has(field)) {
          continue;
        }
        const value = row[field];
        if (value !== null && value !== undefined && String(value) !== '') {
          used.add(field);
        }
      }
    }
  }

  return used;
}

/**
 * The sub-rows every cell renders, in spec order: the two time fields, every
 * field the current route + direction actually uses, and whatever `extra`
 * fields the user has added for this visit to the timetable.
 *
 * `extra` is filtered through the spec roster rather than trusted, so a UI-only
 * field name left over from before a spec refresh is dropped silently instead
 * of throwing in `stopTimeFieldKind`.
 */
export function visibleStopTimeFields(
  trips: AlignedTrip[],
  extra: readonly string[] = []
): string[] {
  const used = usedStopTimeFields(trips);
  const added = new Set(extra);
  return STOP_TIME_EDITABLE_FIELDS.filter(
    (field) =>
      TIME_FIELDS.includes(field) || used.has(field) || added.has(field)
  );
}
