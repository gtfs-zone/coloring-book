/**
 * Feed-wide whitespace autofix.
 *
 * The validator's UNCLEAN_VALUE warnings all have the same cause (a quoted CSV
 * field that swallowed its line ending) and the same fix, so clearing them one
 * cell at a time is busywork. This applies every one of them as a single patch,
 * which keeps the whole clean-up to one undo step.
 *
 * Anything it will not fix is counted rather than forced: a required field that
 * would be emptied, a re-keyed row that would collide with an existing one, and
 * a row the issue can no longer be matched to are all reported back to the
 * caller so the notification can say so.
 */

import type { ValidationEntity } from '../modules/gtfs-validator.js';
import type { EditableTableDeps } from '../modules/editable-table.js';
import { GTFS_FIELD_SPECS } from '../types/gtfs.js';
import {
  generateCompositeKeyFromRecord,
  getGTFSPrimaryKey,
} from './gtfs-primary-keys.js';

/** `data-issue-action` value of the "Fix all" button on an UNCLEAN_VALUE row. */
export const WHITESPACE_FIX_ACTION = 'fix-whitespace';

export interface WhitespaceFixResult {
  /** Cells whose value was rewritten. */
  cleaned: number;
  /** Rows those cells belong to. */
  rows: number;
  /** `file.txt field` of every cell skipped for emptying a required field. */
  skippedRequired: string[];
  /** Rows skipped because the trimmed key already belongs to another row. */
  skippedConflict: number;
  /** Issues whose row could not be found, so there was nothing to write. */
  skippedMissing: number;
}

/** The C0 control characters the validator flags on. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/g;

/**
 * The value with its control characters removed and its surrounding whitespace
 * trimmed. Same character class the validator flags on, so a cleaned value
 * never trips the warning again.
 */
export function cleanWhitespace(value: string): string {
  return value.replace(CONTROL_CHARS, '').trim();
}

/** The changed fields of one row, plus the record they were read from. */
interface PendingRow {
  key: string;
  record: Record<string, unknown>;
  changes: Record<string, string>;
}

type MixedOps = Parameters<
  EditableTableDeps['patchManager']['recordBatchMixed']
>[0];

export async function applyWhitespaceFix(
  entities: ValidationEntity[],
  deps: EditableTableDeps
): Promise<WhitespaceFixResult> {
  const result: WhitespaceFixResult = {
    cleaned: 0,
    rows: 0,
    skippedRequired: [],
    skippedConflict: 0,
    skippedMissing: 0,
  };

  const byFile = new Map<string, ValidationEntity[]>();
  for (const entity of entities) {
    byFile.set(entity.file, [...(byFile.get(entity.file) ?? []), entity]);
  }

  const ops: MixedOps = [];
  const deletes: Array<{ table: string; key: string }> = [];
  const inserts: Array<{ table: string; record: Record<string, unknown> }> = [];
  const updates: Array<{
    table: string;
    key: string;
    changes: Record<string, string>;
  }> = [];
  const required = new Set<string>();

  for (const [file, fileEntities] of byFile) {
    const table = file.replace(/\.txt$/, '');
    const rows = await deps.gtfsDatabase.getAllRows(table);
    const byKey = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      try {
        byKey.set(generateCompositeKeyFromRecord(table, row), row);
      } catch {
        // A row with no derivable key was never addressable by the issue list.
      }
    }

    const pending = new Map<string, PendingRow>();
    for (const entity of fileEntities) {
      const record = entity.id === '' ? undefined : byKey.get(entity.id);
      if (!record) {
        result.skippedMissing += 1;
        continue;
      }
      const raw = record[entity.field];
      if (typeof raw !== 'string') {
        continue;
      }
      const cleaned = cleanWhitespace(raw);
      if (cleaned === raw) {
        continue;
      }
      if (
        cleaned === '' &&
        GTFS_FIELD_SPECS[file]?.[entity.field]?.presence === 'Required'
      ) {
        required.add(`${file} ${entity.field}`);
        continue;
      }
      const entry = pending.get(entity.id) ?? {
        key: entity.id,
        record,
        changes: {},
      };
      entry.changes[entity.field] = cleaned;
      pending.set(entity.id, entry);
    }

    const keyConfig = getGTFSPrimaryKey(table);
    for (const entry of pending.values()) {
      const after = { ...entry.record, ...entry.changes };
      // A change to any key field re-keys the row, which an update cannot
      // express: the patch would keep the old id and undo would silently drop.
      const reKeys =
        keyConfig?.type === 'all_fields' ||
        (keyConfig?.fields ?? []).some((field) => field in entry.changes);

      if (!reKeys) {
        updates.push({ table, key: entry.key, changes: entry.changes });
        ops.push({
          op: 'update',
          table,
          id: entry.key,
          before: { ...entry.record },
          after,
        });
      } else {
        const newKey = generateCompositeKeyFromRecord(table, after);
        if (newKey !== entry.key && byKey.has(newKey)) {
          console.warn(
            `[WhitespaceFix] ${table} ${entry.key} would collide with ${newKey}, skipped`
          );
          result.skippedConflict += 1;
          continue;
        }
        deletes.push({ table, key: entry.key });
        inserts.push({ table, record: after });
        ops.push({
          op: 'delete',
          table,
          id: entry.key,
          record: { ...entry.record },
        });
        ops.push({ op: 'insert', table, id: newKey, record: after });
      }
      result.cleaned += Object.keys(entry.changes).length;
      result.rows += 1;
    }
  }

  result.skippedRequired = [...required].sort();

  if (result.rows === 0) {
    console.log('[WhitespaceFix] nothing to write');
    return result;
  }

  console.log(
    `[WhitespaceFix] cleaning ${result.cleaned} values across ${result.rows} rows`
  );

  // Deletes before inserts, so a re-keyed row never collides with itself.
  for (const entry of deletes) {
    await deps.gtfsDatabase.deleteRow(entry.table, entry.key);
  }
  for (const entry of inserts) {
    await deps.gtfsDatabase.insertRows(entry.table, [entry.record]);
  }
  for (const entry of updates) {
    await deps.gtfsDatabase.updateRow(entry.table, entry.key, entry.changes);
  }

  await deps.patchManager.recordBatchMixed(
    // Same order the writes above went in.
    [
      ...ops.filter((op) => op.op === 'delete'),
      ...ops.filter((op) => op.op === 'insert'),
      ...ops.filter((op) => op.op === 'update'),
    ],
    `Clean whitespace in ${result.cleaned} values`
  );

  return result;
}

/** The one-line notification text for a finished run. */
export function describeWhitespaceFix(result: WhitespaceFixResult): string {
  const parts: string[] = [
    result.cleaned === 1
      ? 'Cleaned 1 value'
      : `Cleaned ${result.cleaned} values`,
  ];
  if (result.skippedRequired.length > 0) {
    parts.push(
      `left ${result.skippedRequired.join(', ')} alone: trimming would empty a required field`
    );
  }
  if (result.skippedConflict > 0) {
    parts.push(
      `skipped ${result.skippedConflict} rows whose trimmed id is already taken`
    );
  }
  if (result.skippedMissing > 0) {
    parts.push(`skipped ${result.skippedMissing} rows that no longer exist`);
  }
  return parts.join('; ');
}
