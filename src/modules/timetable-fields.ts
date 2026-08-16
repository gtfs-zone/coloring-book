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
import { getEnumOptions } from '../types/gtfs-enums.js';
import type { FieldPresence } from '../utils/flex-rules.js';
import type { FlagGlyph } from './flag-icons.js';
import type { AlignedTrip } from './timetable-data-processor.js';

/** Which sub-rows a cell shows. Persisted in localStorage by the controller. */
export type StopTimeFieldMode = 'compact' | 'used' | 'all';

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

/** The two fields compact mode shows on a timed row. */
export const TIME_FIELDS: readonly string[] = [
  'arrival_time',
  'departure_time',
];

/** The two fields compact mode shows on a windowed row. */
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
 * i.e. the current route + direction. This is what Used mode adds to the two
 * time fields.
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
 * The sub-rows a cell renders, in spec order.
 *
 * Compact returns the two time fields; whether a given cell swaps them for the
 * two window fields is a per-cell decision in the renderer, since a windowed
 * row and a timed row can share a column.
 */
export function visibleStopTimeFields(
  mode: StopTimeFieldMode,
  trips: AlignedTrip[]
): string[] {
  if (mode === 'compact') {
    return [...TIME_FIELDS];
  }
  if (mode === 'all') {
    return [...STOP_TIME_EDITABLE_FIELDS];
  }

  const used = usedStopTimeFields(trips);
  return STOP_TIME_EDITABLE_FIELDS.filter(
    (field) => TIME_FIELDS.includes(field) || used.has(field)
  );
}

/** One slot of the compact cell's flag row. */
export interface FlagSlot {
  field: string;
  value: string;
  glyph: FlagGlyph;
  /** `muted` is the field's default or unset state; `error` a forbidden value. */
  tone: 'muted' | 'normal' | 'error';
  tooltip: string;
  /** A hairline follows this slot: the row reads as four clusters. */
  endsCluster: boolean;
}

/**
 * The nine flag slots, in fixed cluster order: timepoint, the pickup trio, the
 * drop-off trio, then headsign and distance.
 *
 * Order is constant in every cell - a column of cells reads vertically slot by
 * slot - so this always returns exactly nine entries, unset ones included.
 */
const FLAG_FIELDS: readonly { field: string; endsCluster: boolean }[] = [
  { field: 'timepoint', endsCluster: true },
  { field: 'pickup_type', endsCluster: false },
  { field: 'pickup_booking_rule_id', endsCluster: false },
  { field: 'continuous_pickup', endsCluster: true },
  { field: 'drop_off_type', endsCluster: false },
  { field: 'drop_off_booking_rule_id', endsCluster: false },
  { field: 'continuous_drop_off', endsCluster: true },
  { field: 'stop_headsign', endsCluster: false },
  { field: 'shape_dist_traveled', endsCluster: false },
];

/** The glyph and tone for one field's value, before presence is folded in. */
function flagAppearance(
  field: string,
  value: string
): { glyph: FlagGlyph; muted: boolean } {
  switch (field) {
    case 'timepoint':
      // Empty is not 0 here: an unset timepoint says nothing, a 0 says the time
      // is explicitly approximate.
      if (value === '') {
        return { glyph: 'dot', muted: true };
      }
      return value === '0'
        ? { glyph: 'clock-approx', muted: true }
        : { glyph: 'clock', muted: false };

    case 'pickup_type':
    case 'drop_off_type': {
      const dflt = field === 'pickup_type' ? 'arrow-up' : 'arrow-down';
      switch (value) {
        case '1':
          return { glyph: 'circle-slash', muted: false };
        case '2':
          return { glyph: 'phone', muted: false };
        case '3':
          return { glyph: 'steering-wheel', muted: false };
        default:
          // '' and '0' both mean regularly scheduled.
          return { glyph: dflt, muted: true };
      }
    }

    case 'continuous_pickup':
    case 'continuous_drop_off': {
      const line =
        field === 'continuous_pickup' ? 'continuous-up' : 'continuous-down';
      switch (value) {
        case '0':
          return { glyph: line, muted: false };
        case '2':
          return { glyph: 'phone', muted: false };
        case '3':
          return { glyph: 'steering-wheel', muted: false };
        default:
          // '' inherits from routes.txt and '1' is "not continuous"; neither is
          // continuous service, so both stay a faint dot.
          return { glyph: 'dot', muted: true };
      }
    }

    case 'pickup_booking_rule_id':
    case 'drop_off_booking_rule_id':
      return value === ''
        ? { glyph: 'dot', muted: true }
        : { glyph: 'document', muted: false };

    case 'stop_headsign':
      return value === ''
        ? { glyph: 'dot', muted: true }
        : { glyph: 'sign', muted: false };

    case 'shape_dist_traveled':
      return value === ''
        ? { glyph: 'dot', muted: true }
        : { glyph: 'ruler', muted: false };

    default:
      throw new Error(`[timetable-fields] no flag slot for field '${field}'`);
  }
}

/**
 * The nine slots for one stop_time record, or for an empty cell when the trip
 * has no record at this row (every slot a faint dot).
 *
 * `presence` is the same map the sub-rows are decorated from, so a value the
 * spec forbids reads as an error in compact mode too.
 */
export function stopTimeFlagSlots(
  row: Record<string, unknown> | null,
  presence?: Map<string, FieldPresence>
): FlagSlot[] {
  return FLAG_FIELDS.map(({ field, endsCluster }) => {
    const raw = row ? row[field] : null;
    const value = raw === null || raw === undefined ? '' : String(raw);
    const { glyph, muted } = flagAppearance(field, value);
    const state = presence?.get(field);

    const tone: FlagSlot['tone'] =
      state?.state === 'forbidden' && value !== ''
        ? 'error'
        : muted
          ? 'muted'
          : 'normal';

    const label =
      value === ''
        ? '(unset)'
        : stopTimeFieldKind(field) === 'enum'
          ? enumLabel(field, value)
          : value;
    const tooltip = [`${field} = ${label}`, state?.reason]
      .filter(Boolean)
      .join(' - ');

    return { field, value, glyph, tone, tooltip, endsCluster };
  });
}

/** `2 (Must phone agency to arrange pickup)`, falling back to the bare value. */
function enumLabel(field: string, value: string): string {
  const option = (getEnumOptions(field) ?? []).find(
    (opt) => String(opt.value) === value
  );
  return option ? `${value} (${option.label})` : value;
}
