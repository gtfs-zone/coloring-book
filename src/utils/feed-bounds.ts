/**
 * Feed-wide date bounds, read from `feed_info.feed_start_date` /
 * `feed_end_date`. Scans all rows independently for each field and takes the
 * first non-blank value, since `initializeEmpty` seeds a header row with
 * every field `''` and that blank row is not guaranteed to sort last. Both
 * fields are optional per spec, so either can come back undefined; callers
 * disable whatever button needs the missing one rather than falling back to
 * a computed range.
 */

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
 * Set every `calendar` row's `start_date` (trim) or `end_date` (extend) to
 * `value`, skipping rows already there, as one `recordBatchMixed` update batch
 * so a single undo reverts all of them. Never touches `calendar_dates`.
 *
 * @returns the number of rows changed.
 */
export async function trimOrExtendAllServices(
  db: FeedBoundsWriteDatabase,
  patchManager: BatchMixedPatchManager,
  field: 'start_date' | 'end_date',
  value: string
): Promise<number> {
  const rows = (await db.getAllRows('calendar')) as Record<string, unknown>[];
  const ops: Parameters<BatchMixedPatchManager['recordBatchMixed']>[0] = [];
  for (const row of rows) {
    if (String(row[field] ?? '') === value) {
      continue;
    }
    const service_id = String(row.service_id);
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
  }
  if (ops.length > 0) {
    const verb = field === 'start_date' ? 'Trim' : 'Extend';
    const edge = field === 'start_date' ? 'start' : 'end';
    await patchManager.recordBatchMixed(
      ops,
      `${verb} ${ops.length} service${ops.length === 1 ? '' : 's'} to feed ${edge}`
    );
  }
  return ops.length;
}
