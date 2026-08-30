/**
 * How a single GTFS field is edited, derived from its spec.
 *
 * Which editor a field gets, how its raw input becomes a stored value, how that
 * value is validated, and how it is displayed are all questions with one answer
 * per field, not one answer per screen. The spec-driven table and the entity
 * property pages both ask them, so they live here rather than in either.
 */

import { GTFSSchemas } from '../types/gtfs.js';
import { GTFSFieldType, mapGTFSTypeString } from '../types/gtfs-field-types.js';
import {
  currencyOptions,
  languageOptions,
  timezoneOptions,
} from './constrained-values.js';
import { getGTFSPrimaryKey } from './gtfs-primary-keys.js';
import { getEntityDisplay, renderOptionLabel } from './entity-display.js';
import { TimeFormatter } from './time-formatter.js';
import type { OptionPickerItem } from '../modules/option-picker-modal.js';
import type { GTFSFieldSpec } from '../gtfs-spec/types.js';
import type { z } from 'zod';

export type SpecFieldKind =
  | 'text'
  | 'number'
  | 'enum'
  | 'foreign'
  | 'constrained';

/**
 * Field types whose values come from a standard's closed set, and where that
 * set comes from.
 *
 * These are not `enumValues` fields: the spec names the standard rather than
 * listing the values, so the options come from `Intl` instead of the reference
 * snapshot. The lists run to hundreds of entries, so they open the searchable
 * picker rather than an inline menu.
 */
const CONSTRAINED_OPTION_PROVIDERS: Partial<
  Record<GTFSFieldType, () => OptionPickerItem[]>
> = {
  [GTFSFieldType.LanguageCode]: languageOptions,
  [GTFSFieldType.Timezone]: timezoneOptions,
  [GTFSFieldType.CurrencyCode]: currencyOptions,
};

/** The picker options for a constrained field, or null if it is not one. */
export function constrainedOptions(
  spec: GTFSFieldSpec
): OptionPickerItem[] | null {
  const provider = CONSTRAINED_OPTION_PROVIDERS[mapGTFSTypeString(spec.type)];
  return provider ? provider() : null;
}

/** Field types whose values are stored as numbers, so Zod expects a number. */
const NUMERIC_FIELD_TYPES = new Set<GTFSFieldType>([
  GTFSFieldType.Integer,
  GTFSFieldType.NonNegativeInteger,
  GTFSFieldType.NonZeroInteger,
  GTFSFieldType.PositiveInteger,
  GTFSFieldType.Float,
  GTFSFieldType.NonNegativeFloat,
  GTFSFieldType.PositiveFloat,
  GTFSFieldType.Latitude,
  GTFSFieldType.Longitude,
]);

/** Read a table's store name (`stops`) from its file name (`stops.txt`). */
export function specStoreName(tableName: string): string {
  return tableName.replace(/\.txt$/, '');
}

function isNumericEnum(spec: GTFSFieldSpec): boolean {
  return (
    spec.enumValues !== undefined &&
    spec.enumValues.length > 0 &&
    spec.enumValues.every((v) => typeof v.value === 'number')
  );
}

function isNumericField(spec: GTFSFieldSpec): boolean {
  return (
    isNumericEnum(spec) || NUMERIC_FIELD_TYPES.has(mapGTFSTypeString(spec.type))
  );
}

/** Field types entered as a time of day, which accept fuzzy `H:M` input. */
const TIME_FIELD_TYPES = new Set<GTFSFieldType>([
  GTFSFieldType.Time,
  GTFSFieldType.LocalTime,
]);

function isTimeField(spec: GTFSFieldSpec): boolean {
  return TIME_FIELD_TYPES.has(mapGTFSTypeString(spec.type));
}

/** Which editor the field opens: a picker, a menu, or a live input. */
export function specFieldKind(spec: GTFSFieldSpec): SpecFieldKind {
  if (spec.foreignKey && spec.foreignKey.length > 0) {
    return 'foreign';
  }
  if (spec.enumValues && spec.enumValues.length > 0) {
    return 'enum';
  }
  const type = mapGTFSTypeString(spec.type);
  if (CONSTRAINED_OPTION_PROVIDERS[type]) {
    return 'constrained';
  }
  return NUMERIC_FIELD_TYPES.has(type) ? 'number' : 'text';
}

/** Parse a raw input into the type the spec (and Zod) expect. */
export function coerceFieldValue(
  spec: GTFSFieldSpec,
  raw: string
): { value: string | number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: '' };
  }
  if (isNumericField(spec)) {
    const num = Number(trimmed);
    if (Number.isNaN(num)) {
      return { error: 'Must be a number' };
    }
    return { value: num };
  }
  if (isTimeField(spec)) {
    return { value: TimeFormatter.castTimeToHHMMSS(trimmed) };
  }
  return { value: trimmed };
}

/**
 * Validate a committed value against the field's Zod schema.
 *
 * Returns an error message, or null when the value may be written. An empty
 * value is a clear, which is legal for anything the spec does not require.
 */
export function validateFieldValue(
  tableName: string,
  field: string,
  spec: GTFSFieldSpec,
  value: string | number
): string | null {
  if (value === '') {
    return spec.presence === 'Required' ? 'This field is required' : null;
  }

  const schema = GTFSSchemas[tableName as keyof typeof GTFSSchemas] as
    | z.ZodObject<z.ZodRawShape>
    | undefined;
  // Zod 4 erases the shape to `$ZodType`, which has no `safeParse`.
  const fieldSchema = schema?.shape[field] as z.ZodTypeAny | undefined;
  if (!fieldSchema) {
    return null;
  }

  const result = fieldSchema.safeParse(value);
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? 'Invalid value');
}

/** Plain-text display for a value, before escaping. */
export function formatSpecValue(
  spec: GTFSFieldSpec,
  kind: SpecFieldKind,
  value: unknown,
  foreignLabels?: Map<string, string>
): string {
  const raw = value === undefined || value === null ? '' : String(value);
  if (raw === '') {
    return '';
  }
  if (kind === 'enum') {
    const option = spec.enumValues?.find((v) => String(v.value) === raw);
    return option ? `${option.value} - ${option.label}` : raw;
  }
  if (kind === 'foreign') {
    return foreignLabels?.get(raw) ?? raw;
  }
  return raw;
}

export interface ForeignKeySource {
  getAllRows(tableName: string): Promise<Record<string, unknown>[]>;
}

export interface ForeignKeyRowSource extends ForeignKeySource {
  getRow(
    tableName: string,
    key: string
  ): Promise<Record<string, unknown> | undefined>;
}

/** Whether `target.field` is the whole primary key of the table it names. */
function targetIsEntityKey(table: string, field: string): boolean {
  const pk = getGTFSPrimaryKey(table);
  return pk?.type === 'natural' && pk.fields[0] === field;
}

/**
 * Build the picker options for a foreign-ID field.
 *
 * A field may name more than one target table (`fare_leg_rules.network_id`
 * references `routes.network_id` or `networks.network_id`), in which case the
 * option sets are unioned rather than one target winning.
 */
export async function buildForeignKeyOptions(
  db: ForeignKeySource,
  spec: GTFSFieldSpec
): Promise<OptionPickerItem[]> {
  const seen = new Map<string, OptionPickerItem>();
  for (const target of spec.foreignKey ?? []) {
    if (!target.file.endsWith('.txt')) {
      // locations.geojson has no table store to read from.
      continue;
    }
    const table = specStoreName(target.file);
    const isEntityKey = targetIsEntityKey(table, target.field);
    const rows = await db.getAllRows(table);
    for (const row of rows) {
      const value = row[target.field];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      const key = String(value);
      if (seen.has(key)) {
        continue;
      }
      const label = isEntityKey
        ? renderOptionLabel(
            getEntityDisplay(table, row as Record<string, string>)
          )
        : key;
      seen.set(key, { value: key, primary: label, secondary: key });
    }
  }
  return [...seen.values()];
}

/**
 * Resolve the display label for one foreign-ID value.
 *
 * A single-row lookup rather than `buildForeignKeyOptions`, because labelling
 * `stops.parent_station` must not cost a read of every stop in the feed. Falls
 * back to the value itself when the target is not keyed on the named field.
 */
export async function resolveForeignLabel(
  db: ForeignKeyRowSource,
  spec: GTFSFieldSpec,
  value: string
): Promise<string> {
  if (value === '') {
    return '';
  }
  for (const target of spec.foreignKey ?? []) {
    if (!target.file.endsWith('.txt')) {
      continue;
    }
    const table = specStoreName(target.file);
    if (!targetIsEntityKey(table, target.field)) {
      continue;
    }
    const row = await db.getRow(table, value);
    if (row) {
      return renderOptionLabel(
        getEntityDisplay(table, row as Record<string, string>)
      );
    }
  }
  return value;
}
