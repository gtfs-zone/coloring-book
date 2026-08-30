/**
 * Feed-wide date bounds, read from `feed_info.feed_start_date` /
 * `feed_end_date` (row 0). Both fields are optional per spec, so either can
 * come back undefined; callers disable whatever button needs the missing one
 * rather than falling back to a computed range.
 */

export interface FeedBounds {
  start?: string;
  end?: string;
}

export interface FeedBoundsSource {
  getAllRows: (tableName: string) => Promise<unknown[]>;
}

export async function feedBounds(db: FeedBoundsSource): Promise<FeedBounds> {
  const rows = await db.getAllRows('feed_info');
  const row = rows[0] as Record<string, unknown> | undefined;
  const start = row?.feed_start_date;
  const end = row?.feed_end_date;
  return {
    start:
      start !== null && start !== undefined && start !== ''
        ? String(start)
        : undefined,
    end:
      end !== null && end !== undefined && end !== '' ? String(end) : undefined,
  };
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
