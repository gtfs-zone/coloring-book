/**
 * Rename a GTFS entity's ID, cascading to every field that references it.
 *
 * The cascade is derived from the spec: `GTFS_FOREIGN_KEYS` says which fields
 * point at the renamed table's primary key, and `GTFS_PRIMARY_KEYS` says
 * whether a referencing row's own key contains that field. A row whose key
 * contains it has to be deleted and re-inserted, not updated: an update leaves
 * the patch's `source.id` pointing at the old key and undo silently drops.
 */

import type { GTFSDatabaseRecord } from '../modules/gtfs-database';
import type { PatchManager } from '../modules/patch-manager';
import { GTFS_FOREIGN_KEYS } from '../types/gtfs';
import {
  generateCompositeKeyFromRecord,
  getGTFSPrimaryKey,
  getNaturalKeyField,
} from './gtfs-primary-keys';
import { CONFIG } from '../config';

/**
 * The database handle a rename needs. Structural rather than `GTFSDatabase`
 * so a page's narrower handle can drive it without being widened first.
 */
export interface RenameDatabase {
  getRow(
    tableName: string,
    key: string
  ): Promise<GTFSDatabaseRecord | undefined>;
  queryRows(
    tableName: string,
    filter?: Record<string, string | number | boolean>
  ): Promise<GTFSDatabaseRecord[]>;
  insertRows(tableName: string, rows: GTFSDatabaseRecord[]): Promise<void>;
  updateRow(
    tableName: string,
    key: string,
    data: Partial<GTFSDatabaseRecord>
  ): Promise<void>;
  deleteRow(tableName: string, key: string): Promise<void>;
}

/** The one patch call a rename makes. */
export interface RenamePatchManager {
  recordBatchMixed: PatchManager['recordBatchMixed'];
}

/** One referencing field's contribution to a rename, for display. */
export interface RenameCascade {
  table: string;
  field: string;
  rows: number;
  rekeys: boolean;
}

/** One row to rewrite. `rekeys` means delete + insert rather than update. */
export interface RenameEdit {
  table: string;
  rekeys: boolean;
  key: string;
  before: GTFSDatabaseRecord;
  after: GTFSDatabaseRecord;
  fields: string[];
}

export interface RenamePlan {
  table: string;
  keyField: string;
  oldId: string;
  newId: string;
  /** The row being renamed, as it stands before the rename. */
  row: GTFSDatabaseRecord;
  /** One entry per referencing (table, field) pair that has matching rows. */
  cascades: RenameCascade[];
  edits: RenameEdit[];
  /** Rows written, including the renamed row itself. */
  total: number;
  /** Set above CONFIG.RENAME_CASCADE_WARN: worth warning about, not refusing. */
  heavy: boolean;
}

function tableNameForFile(fileName: string): string {
  return fileName.replace(/\.txt$/, '');
}

/**
 * Whether a row in `table` re-keys when `field` changes.
 *
 * `all_fields` tables key on every column, so any change re-keys. `none` is a
 * single-row table (feed_info, locations), whose key is a constant.
 */
function fieldIsPartOfKey(table: string, field: string): boolean {
  const config = getGTFSPrimaryKey(table);
  if (!config) {
    return false;
  }
  if (config.type === 'all_fields') {
    return true;
  }
  return config.fields.includes(field);
}

/**
 * Check a proposed new ID. Returns an error message, or null if it is usable.
 * Exported so the modal can validate as the user types.
 */
export async function validateRenameTarget(
  db: RenameDatabase,
  table: string,
  oldId: string,
  newId: string
): Promise<string | null> {
  if (newId === '') {
    return 'ID cannot be empty';
  }
  if (newId !== newId.trim()) {
    return 'ID cannot start or end with whitespace';
  }
  if (newId === oldId) {
    return 'ID is unchanged';
  }
  const clash = await db.getRow(table, newId);
  if (clash) {
    return `${table} already has a row with ID "${newId}"`;
  }
  return null;
}

/**
 * Work out everything a rename would touch. Reads only: nothing is written
 * until `applyRename` is called with the returned plan.
 */
export async function renamePlan(
  db: RenameDatabase,
  table: string,
  oldId: string,
  newId: string
): Promise<RenamePlan> {
  const keyField = getNaturalKeyField(table);
  if (!keyField) {
    throw new Error(`[renameEntity] ${table} has no natural key to rename`);
  }

  const invalid = await validateRenameTarget(db, table, oldId, newId);
  if (invalid) {
    throw new Error(`[renameEntity] ${invalid}`);
  }

  const row = await db.getRow(table, oldId);
  if (!row) {
    throw new Error(`[renameEntity] no row "${oldId}" in ${table}`);
  }

  const cascades: RenameCascade[] = [];
  // Keyed on table + current row key so a row matched by two fields (a
  // transfer from a stop to itself) is rewritten once, not twice.
  const edits = new Map<string, RenameEdit>();

  for (const ref of GTFS_FOREIGN_KEYS) {
    const pointsHere = ref.targets.some(
      (t) => t.file === `${table}.txt` && t.field === keyField
    );
    if (!pointsHere) {
      continue;
    }
    // locations.geojson is one row holding a FeatureCollection, not a table of
    // referencing rows. Renaming a location_id is out of scope for this pass.
    if (ref.file === 'locations.geojson') {
      continue;
    }
    // routes.network_id is never written: networks are canonical as
    // networks + route_networks, and only export reads it back.
    if (ref.file === 'routes.txt' && ref.field === 'network_id') {
      continue;
    }

    const refTable = tableNameForFile(ref.file);
    // Strict equality on the stored value, so an implicitly-resolved blank
    // agency_id in a single-agency feed is left alone.
    const matches = await db.queryRows(refTable, { [ref.field]: oldId });
    const rekeys = fieldIsPartOfKey(refTable, ref.field);

    let counted = 0;
    for (const match of matches) {
      const key = generateCompositeKeyFromRecord(refTable, match);
      if (refTable === table && key === oldId) {
        console.warn(
          `[renameEntity] ${table} row "${oldId}" references itself through ${ref.field}; skipping the self-reference`
        );
        continue;
      }
      counted++;
      const editKey = `${refTable}\u0000${key}`;
      const existing = edits.get(editKey);
      if (existing) {
        existing.after = { ...existing.after, [ref.field]: newId };
        existing.fields.push(ref.field);
        continue;
      }
      edits.set(editKey, {
        table: refTable,
        rekeys,
        key,
        before: match,
        after: { ...match, [ref.field]: newId },
        fields: [ref.field],
      });
    }

    if (counted > 0) {
      cascades.push({
        table: refTable,
        field: ref.field,
        rows: counted,
        rekeys,
      });
    }
  }

  const editList = [...edits.values()];
  const total = editList.length + 1;

  return {
    table,
    keyField,
    oldId,
    newId,
    row,
    cascades,
    edits: editList,
    total,
    heavy: total > CONFIG.RENAME_CASCADE_WARN,
  };
}

/**
 * Write a plan out: the renamed row plus every referencing row, applied first
 * and then recorded as a single patch so one undo takes the whole rename back.
 *
 * Deletes go first in both the writes and the patch ops, so neither forward
 * replay nor the reversed inverse replay ever holds two rows on one key.
 */
export async function applyRename(
  db: RenameDatabase,
  patchManager: RenamePatchManager,
  plan: RenamePlan
): Promise<void> {
  const { table, keyField, oldId, newId, row, edits } = plan;

  const invalid = await validateRenameTarget(db, table, oldId, newId);
  if (invalid) {
    throw new Error(`[renameEntity] ${invalid}`);
  }

  const rekeyEdits = edits.filter((e) => e.rekeys);
  const updateEdits = edits.filter((e) => !e.rekeys);
  const renamedRow: GTFSDatabaseRecord = { ...row, [keyField]: newId };

  const ops: Parameters<PatchManager['recordBatchMixed']>[0] = [];

  // Deletes: the renamed row (the store's keyPath is its natural key, so it
  // always re-keys) and every referencing row whose own key holds the field.
  await db.deleteRow(table, oldId);
  ops.push({ op: 'delete', table, id: oldId, record: row });
  for (const edit of rekeyEdits) {
    await db.deleteRow(edit.table, edit.key);
    ops.push({
      op: 'delete',
      table: edit.table,
      id: edit.key,
      record: edit.before,
    });
  }

  await db.insertRows(table, [renamedRow]);
  ops.push({ op: 'insert', table, id: newId, record: renamedRow });
  for (const edit of rekeyEdits) {
    const newKey = generateCompositeKeyFromRecord(edit.table, edit.after);
    await db.insertRows(edit.table, [edit.after]);
    ops.push({
      op: 'insert',
      table: edit.table,
      id: newKey,
      record: edit.after,
    });
  }

  for (const edit of updateEdits) {
    const delta: GTFSDatabaseRecord = {};
    const before: GTFSDatabaseRecord = {};
    for (const field of edit.fields) {
      delta[field] = newId;
      before[field] = edit.before[field];
    }
    await db.updateRow(edit.table, edit.key, delta);
    ops.push({
      op: 'update',
      table: edit.table,
      id: edit.key,
      before,
      after: delta,
    });
  }

  await patchManager.recordBatchMixed(
    ops,
    `Rename ${table}.${keyField} "${oldId}" to "${newId}"`
  );

  console.log(
    `[renameEntity] Renamed ${table}.${keyField} "${oldId}" to "${newId}": ${plan.total} row${plan.total !== 1 ? 's' : ''}, ${ops.length} patch ops`
  );
}
