/**
 * Feed-wide date bounds, read from `feed_info.feed_start_date` /
 * `feed_end_date`. Scans all rows independently for each field and takes the
 * first non-blank value, since `initializeEmpty` seeds a header row with
 * every field `''` and that blank row is not guaranteed to sort last. Both
 * fields are optional per spec, so either can come back undefined; callers
 * disable whatever button needs the missing one rather than falling back to
 * a computed range.
 */

import { generateCompositeKeyFromRecord } from './gtfs-primary-keys.js';

export interface FeedBounds {
  start?: string;
  end?: string;
}

export interface FeedBoundsSource {
  getAllRows: (tableName: string) => Promise<unknown[]>;
}

function firstNonBlank(
  rows: Record<string, unknown>[],
  field: string
): string | undefined {
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) {
      continue;
    }
    const trimmed = String(value).trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return undefined;
}

export async function feedBounds(db: FeedBoundsSource): Promise<FeedBounds> {
  const rows = (await db.getAllRows('feed_info')) as Record<string, unknown>[];
  const start = firstNonBlank(rows, 'feed_start_date');
  const end = firstNonBlank(rows, 'feed_end_date');
  if (rows.length > 0) {
    if (start === undefined) {
      console.warn(
        `[FeedBounds] feed_info has ${rows.length} row(s) but no usable feed_start_date`
      );
    }
    if (end === undefined) {
      console.warn(
        `[FeedBounds] feed_info has ${rows.length} row(s) but no usable feed_end_date`
      );
    }
  }
  return { start, end };
}

export interface FeedBoundsWriteDatabase extends FeedBoundsSource {
  updateRow: (
    tableName: string,
    key: string,
    data: Record<string, unknown>
  ) => Promise<void>;
  deleteRow: (tableName: string, key: string) => Promise<void>;
}

export interface BatchMixedPatchManager {
  recordBatchMixed: (
    ops: Array<
      | {
          op: 'insert';
          table: string;
          id: string;
          record: Record<string, unknown>;
        }
      | {
          op: 'delete';
          table: string;
          id: string;
          record: Record<string, unknown>;
        }
      | {
          op: 'update';
          table: string;
          id: string;
          before: Record<string, unknown>;
          after: Record<string, unknown>;
        }
    >,
    label?: string
  ) => Promise<void>;
}

/**
 * `calendar_dates` rows for `service_ids` lying past `value` on `field`'s side:
 * before it for `start_date`, after it for `end_date`. Both exception types are
 * selected. GTFS dates are `YYYYMMDD`, so string comparison is date comparison.
 *
 * `service_ids` undefined means every service.
 */
export async function outOfRangeExceptions(
  db: FeedBoundsSource,
  field: 'start_date' | 'end_date',
  value: string,
  service_ids?: Set<string>
): Promise<Record<string, unknown>[]> {
  const rows = (await db.getAllRows('calendar_dates')) as Record<
    string,
    unknown
  >[];
  return rows.filter((row) => {
    if (service_ids && !service_ids.has(String(row.service_id ?? ''))) {
      return false;
    }
    const date = String(row.date ?? '').trim();
    if (date === '') {
      return false;
    }
    return field === 'start_date' ? date < value : date > value;
  });
}

/** How many rows a trim or extend touched, for the caller's notification. */
export interface TrimOrExtendResult {
  services: number;
  exceptions: number;
}

/**
 * Set each named service's `start_date` (trim) or `end_date` (extend) to
 * `value`, skipping rows already there, and delete the `calendar_dates`
 * exceptions lying past that same edge. Recorded as one `recordBatchMixed` so a
 * single undo reverts the whole action.
 *
 * `service_ids` undefined means every service in `calendar`. Only the edge
 * being acted on is pruned; the other edge's exceptions are left alone.
 */
export async function trimOrExtendServices(
  db: FeedBoundsWriteDatabase,
  patchManager: BatchMixedPatchManager,
  field: 'start_date' | 'end_date',
  value: string,
  service_ids?: Set<string>
): Promise<TrimOrExtendResult> {
  const rows = (await db.getAllRows('calendar')) as Record<string, unknown>[];
  const ops: Parameters<BatchMixedPatchManager['recordBatchMixed']>[0] = [];

  let services = 0;
  for (const row of rows) {
    const service_id = String(row.service_id);
    if (service_ids && !service_ids.has(service_id)) {
      continue;
    }
    if (String(row[field] ?? '') === value) {
      continue;
    }
    const before = { [field]: row[field] };
    const after = { [field]: value };
    await db.updateRow('calendar', service_id, after);
    ops.push({
      op: 'update',
      table: 'calendar',
      id: service_id,
      before,
      after,
    });
    services += 1;
  }

  // Deletes after the updates, so replaying the batch applies them in the same
  // order they were written.
  const exceptions = await outOfRangeExceptions(db, field, value, service_ids);
  for (const record of exceptions) {
    const id = generateCompositeKeyFromRecord('calendar_dates', record);
    await db.deleteRow('calendar_dates', id);
    ops.push({ op: 'delete', table: 'calendar_dates', id, record });
  }

  if (ops.length > 0) {
    const verb = field === 'start_date' ? 'Trim' : 'Extend';
    const edge = field === 'start_date' ? 'start' : 'end';
    const removed =
      exceptions.length > 0
        ? `, remove ${exceptions.length} exception${exceptions.length === 1 ? '' : 's'}`
        : '';
    await patchManager.recordBatchMixed(
      ops,
      `${verb} ${services} service${services === 1 ? '' : 's'} to feed ${edge}${removed}`
    );
    console.log(
      `[FeedBounds] ${verb} to feed ${edge}: ${services} calendar row(s), ${exceptions.length} exception(s) removed`
    );
  }

  return { services, exceptions: exceptions.length };
}
