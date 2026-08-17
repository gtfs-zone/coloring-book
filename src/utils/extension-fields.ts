/**
 * Non-spec ("extension") columns on a GTFS table.
 *
 * Producers routinely add their own columns to a GTFS file, and those columns
 * already survive the round trip: the import worker keeps every parsed column
 * and `generateCSVFromRows` writes the union of keys across all rows. Only the
 * UI could not see them, because it derives its columns from `src/gtfs-spec/`.
 *
 * So an extension column is *derived from the data*, not configured: a column
 * exists because rows have that key. The one case data-derivation cannot
 * express is a column the user just created and has not filled in yet, so that
 * single case is mirrored from the `meta` store into `added` below.
 *
 * Nothing here writes to the Zod schemas: those are generated from
 * `src/gtfs-spec/` and `pnpm check-spec` blocks a commit that diverges.
 */

import { GTFS_FIELD_SPECS } from '../types/gtfs.js';
import type { GTFSFieldSpec } from '../gtfs-spec/types.js';

export const EXTENSION_FIELD_DESCRIPTION =
  'This field is not part of the GTFS specification. It is preserved as-is on export.';

export interface ExtensionColumnStore {
  getExtensionColumns(): Promise<Record<string, string[]>>;
  setExtensionColumns(columns: Record<string, string[]>): Promise<void>;
}

let store: ExtensionColumnStore | null = null;

/** User-added column names per table, mirrored from the `meta` store. */
let added: Record<string, string[]> = {};

/**
 * Bumped whenever `added` changes, so the memo below cannot serve a list from
 * before a column was added.
 */
let generation = 0;

/**
 * Read the user-added columns into memory and keep the store for later writes.
 *
 * Called once at boot. `extensionFields` is synchronous because every caller
 * that needs it (column lists, cell renderers) is, so the async read has to
 * happen up front rather than per call.
 */
export async function loadExtensionColumns(
  db: ExtensionColumnStore
): Promise<void> {
  store = db;
  added = await db.getExtensionColumns();
  generation++;
  const count = Object.values(added).reduce((n, list) => n + list.length, 0);
  console.log(`[ExtensionFields] loaded ${count} user-added column(s)`);
}

// ─── Deriving the columns ─────────────────────────────────────────────────────

const memo = new WeakMap<
  object,
  Map<string, { gen: number; fields: string[] }>
>();

/**
 * The non-spec columns of a table, in order of first appearance.
 *
 * Returns nothing for a file with no field specs (`locations.geojson`), which
 * is not a CSV table and whose feature properties are not columns.
 *
 * Memoised on the rows array so the several callers per render share one pass.
 * Rows are only ever mutated in place field-by-field, never gaining a key, so
 * a result keyed on the array's identity cannot go stale.
 */
export function extensionFields(
  tableName: string,
  rows: Record<string, unknown>[]
): string[] {
  const specs = GTFS_FIELD_SPECS[tableName];
  if (!specs) {
    return [];
  }

  const byTable = memo.get(rows) ?? new Map();
  memo.set(rows, byTable);
  const cached = byTable.get(tableName);
  if (cached && cached.gen === generation) {
    return cached.fields;
  }

  const seen = new Set(Object.keys(specs));
  const fields: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      fields.push(key);
    }
  }
  // A column the user just created has no values in any row yet, so it only
  // exists here.
  for (const key of added[tableName] ?? []) {
    if (!seen.has(key)) {
      seen.add(key);
      fields.push(key);
    }
  }

  byTable.set(tableName, { gen: generation, fields });
  return fields;
}

const syntheticSpecs = new Map<string, GTFSFieldSpec>();

/**
 * The stand-in spec for an extension field.
 *
 * Everything that renders or edits a cell asks the spec how: which editor, how
 * to coerce, how to display. An extension field has no spec, so it gets a
 * plain optional text one. Cached per name so repeated lookups are identity
 * stable.
 */
export function extensionFieldSpec(field: string): GTFSFieldSpec {
  const existing = syntheticSpecs.get(field);
  if (existing) {
    return existing;
  }
  const spec: GTFSFieldSpec = {
    name: field,
    type: 'Text',
    presence: 'Optional',
    description: EXTENSION_FIELD_DESCRIPTION,
  };
  syntheticSpecs.set(field, spec);
  return spec;
}

/** Whether `field` is an extension field of `tableName` rather than a spec one. */
export function isExtensionField(tableName: string, field: string): boolean {
  const specs = GTFS_FIELD_SPECS[tableName];
  return specs !== undefined && specs[field] === undefined;
}

// ─── Adding a column ──────────────────────────────────────────────────────────

/** CSV header names we are willing to create: the shape GTFS itself uses. */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a proposed column name against the table's spec and existing
 * columns. Returns an error message, or null when the name may be used.
 *
 * The duplicate checks are case-insensitive: a column differing from a spec
 * field only in case is a typo every time, and accepting it would produce two
 * columns that read identically.
 */
export function validateExtensionColumnName(
  tableName: string,
  rows: Record<string, unknown>[],
  name: string
): string | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Enter a field name';
  }
  if (!VALID_NAME.test(trimmed)) {
    return 'Use letters, digits and underscores, starting with a letter or underscore';
  }
  const specs = GTFS_FIELD_SPECS[tableName];
  if (!specs) {
    return `${tableName} has no fields to extend`;
  }
  const lower = trimmed.toLowerCase();
  if (Object.keys(specs).some((f) => f.toLowerCase() === lower)) {
    return `${trimmed} is already a field of ${tableName}`;
  }
  if (extensionFields(tableName, rows).some((f) => f.toLowerCase() === lower)) {
    return `${tableName} already has a column named ${trimmed}`;
  }
  return null;
}

/**
 * Remember a user-added column for a table.
 *
 * No row is touched: seeding the key on every row would rewrite the whole
 * table to add an empty column, which is a large patch carrying no data. The
 * consequence is that a column left empty everywhere does not appear in the
 * export, since the export unions row keys. The Add field dialog says so.
 */
export async function addExtensionColumn(
  tableName: string,
  name: string
): Promise<void> {
  const field = name.trim();
  added = { ...added, [tableName]: [...(added[tableName] ?? []), field] };
  generation++;
  console.log(`[ExtensionFields] added column ${tableName}.${field}`);
  if (!store) {
    console.warn(
      '[ExtensionFields] no store, column will not survive a reload'
    );
    return;
  }
  await store.setExtensionColumns(added);
}
