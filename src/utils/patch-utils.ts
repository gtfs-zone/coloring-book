/**
 * Patch utilities
 *
 * INVARIANT: All user-initiated writes MUST go through patchManager.recordUpdate().
 * Direct updateRow() calls are only for: internal DB initialization, patch replay,
 * and feed import. Use patchUpdate() for all interactive edit handlers.
 */

/**
 * Write a field update to the DB and record a corresponding patch.
 *
 * Use this instead of calling db.updateRow() + pm.recordUpdate() separately in
 * interactive edit handlers. Ensures the patch is always recorded and always
 * follows the DB write in the correct order.
 *
 * If patchManager is null (not yet initialized), the DB write still happens:
 * patch recording is omitted but the edit is not silently dropped.
 *
 * @param db - Database object with updateRow method
 * @param pm - PatchManager or null
 * @param table - GTFS table name (e.g. 'calendar', 'trips')
 * @param id - Primary or composite key for the row
 * @param before - Field values before the update (for undo)
 * @param after - Field values to write (for redo)
 */
export async function patchUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { updateRow: (table: any, key: string, data: any) => Promise<void> },
  pm: {
    recordUpdate: (
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ) => Promise<void>;
  } | null,
  table: string,
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<void> {
  await db.updateRow(table, id, after);
  if (pm) {
    await pm.recordUpdate(table, id, before, after);
  }
}
