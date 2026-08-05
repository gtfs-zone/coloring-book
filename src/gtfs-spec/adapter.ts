import { z } from 'zod';
import type { GTFSSpec, GTFSFieldSpec, GTFSPresence } from './types';
import {
  GTFS_FIELD_TYPE_METADATA,
  GTFSFieldType,
  mapGTFSTypeString,
} from '../types/gtfs-field-types';

// Local file info type: mirrors GTFSFileInfo in gtfs.ts to avoid circular deps in Phase 15
interface GTFSAdapterFileInfo {
  filename: string;
  presence: GTFSPresence;
  description: string;
  schema: z.ZodSchema;
}

// ─── Primary key mappings ─────────────────────────────────────────────────────

export function deriveGTFSPrimaryKeys(spec: GTFSSpec): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of spec.files) {
    if (!file.fields) {
      continue;
    }
    for (const field of file.fields) {
      if (field.isPrimaryKey) {
        result[file.filename] = field.name;
        break;
      }
    }
  }
  return result;
}

// ─── Field type strings ───────────────────────────────────────────────────────
// Builds filename -> fieldName -> GTFS type string. Spec types are already the
// verbatim reference strings, so this is a straight projection.

export function deriveGTFSFieldTypes(
  spec: GTFSSpec
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const file of spec.files) {
    if (!file.fields) {
      continue;
    }
    result[file.filename] = {};
    for (const field of file.fields) {
      result[file.filename][field.name] = field.type;
    }
  }
  return result;
}

// ─── Enum registry ────────────────────────────────────────────────────────────
// Collects all enumValues across all files, keyed by field name.
// When the same field name appears in multiple files (e.g. continuous_pickup
// in routes.txt and stop_times.txt) the first occurrence wins, since the spec
// guarantees they are identical.

interface GTFSAdapterEnumOption {
  value: number | string;
  label: string;
  description?: string;
}

export function deriveGTFSEnums(
  spec: GTFSSpec
): Record<string, GTFSAdapterEnumOption[]> {
  const result: Record<string, GTFSAdapterEnumOption[]> = {};
  for (const file of spec.files) {
    if (!file.fields) {
      continue;
    }
    for (const field of file.fields) {
      if (
        field.enumValues &&
        field.enumValues.length > 0 &&
        !(field.name in result)
      ) {
        result[field.name] = field.enumValues;
      }
    }
  }
  return result;
}

// ─── Zod schema derivation ────────────────────────────────────────────────────

export function deriveGTFSSchemas(
  spec: GTFSSpec,
  fieldTypeMeta: typeof GTFS_FIELD_TYPE_METADATA
): Record<string, z.ZodObject<z.ZodRawShape>> {
  const result: Record<string, z.ZodObject<z.ZodRawShape>> = {};
  for (const file of spec.files) {
    if (file.format === 'geojson' || !file.fields) {
      continue;
    }
    result[file.filename] = buildFileSchema(file.fields, fieldTypeMeta);
  }
  return result;
}

function buildFileSchema(
  fields: GTFSFieldSpec[],
  fieldTypeMeta: typeof GTFS_FIELD_TYPE_METADATA
): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    shape[field.name] = buildFieldSchema(field, fieldTypeMeta);
  }

  return z.object(shape);
}

function buildFieldSchema(
  field: GTFSFieldSpec,
  fieldTypeMeta: typeof GTFS_FIELD_TYPE_METADATA
): z.ZodTypeAny {
  const isRequired = field.presence === 'Required';
  const baseValidator = buildBaseValidator(field, fieldTypeMeta);

  if (field.allowEmpty) {
    // Wrap in union with empty literal, describe on the union so tooltips
    // can find it after unwrapping the outer ZodOptional.
    return z
      .union([z.literal(''), baseValidator])
      .describe(field.description)
      .optional();
  }

  if (!isRequired) {
    return baseValidator.describe(field.description).optional();
  }

  return baseValidator.describe(field.description);
}

function buildBaseValidator(
  field: GTFSFieldSpec,
  fieldTypeMeta: typeof GTFS_FIELD_TYPE_METADATA
): z.ZodTypeAny {
  if (
    field.type === 'Enum' &&
    field.enumValues &&
    field.enumValues.length > 0
  ) {
    // Numeric enum -> z.number(); mixed or string enum -> z.string()
    const allNumeric = field.enumValues.every(
      (v) => typeof v.value === 'number'
    );
    return allNumeric ? z.number() : z.string();
  }

  // Direct lookup by GTFSFieldType enum value
  const meta = fieldTypeMeta[field.type as GTFSFieldType];
  if (meta) {
    return meta.zodValidator(z);
  }

  // Fallback: use mapGTFSTypeString to normalize compound or variant type
  // strings (e.g. "Non-null integer" -> Integer, "Text or URL or Email" -> Text)
  const normalizedType = mapGTFSTypeString(field.type);
  const normalizedMeta = fieldTypeMeta[normalizedType];
  if (normalizedMeta) {
    return normalizedMeta.zodValidator(z);
  }

  return z.string();
}

// ─── Field spec lookup ────────────────────────────────────────────────────────
// Builds filename -> fieldName -> GTFSFieldSpec for presence/condition lookups.

export function deriveGTFSFieldSpecs(
  spec: GTFSSpec
): Record<string, Record<string, GTFSFieldSpec>> {
  const result: Record<string, Record<string, GTFSFieldSpec>> = {};
  for (const file of spec.files) {
    if (!file.fields) {
      continue;
    }
    result[file.filename] = {};
    for (const field of file.fields) {
      result[file.filename][field.name] = field;
    }
  }
  return result;
}

// ─── Full file info list ───────────────────────────────────────────────────────
// Combines spec metadata with derived Zod schemas into a GTFSFileInfo-compatible
// array. Use this to replace GTFS_FILES in Phase 15.

export function deriveGTFSFileInfos(
  spec: GTFSSpec,
  schemas: Record<string, z.ZodSchema>
): GTFSAdapterFileInfo[] {
  return spec.files.map((file) => ({
    filename: file.filename,
    presence: file.presence,
    description: file.description,
    schema: schemas[file.filename] ?? z.any(),
  }));
}
