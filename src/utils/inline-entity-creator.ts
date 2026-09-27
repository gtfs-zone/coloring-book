/**
 * Suggested `<prefix>_<n>` IDs for new entities
 */

import { getNaturalKeyField } from './gtfs-primary-keys';

interface RowSource {
  getAllRows: (tableName: string) => Promise<unknown[]>;
}

/** First `<prefix>_<n>` not in `taken`, counting from 1. */
export function firstFreeId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}_${n}`)) {
    n += 1;
  }
  return `${prefix}_${n}`;
}

/**
 * First free `<prefix>_<n>` ID in a naturally-keyed table, counting from 1.
 * `alsoTaken` holds IDs in use outside the table's own rows.
 */
export async function nextEntityId(
  database: RowSource,
  tableName: string,
  prefix: string,
  alsoTaken: Iterable<string> = []
): Promise<string> {
  const keyField = getNaturalKeyField(tableName);
  if (!keyField) {
    throw new Error(`[nextEntityId] ${tableName} has no natural key`);
  }

  const rows = (await database.getAllRows(tableName)) as Record<
    string,
    unknown
  >[];
  return firstFreeId(prefix, [
    ...rows.map((row) => String(row[keyField])),
    ...alsoTaken,
  ]);
}

/**
 * First free `service_<n>`, skipping IDs held only by `calendar_dates` rows.
 */
export async function nextServiceId(database: RowSource): Promise<string> {
  const exceptions = (await database.getAllRows('calendar_dates')) as Record<
    string,
    unknown
  >[];
  return nextEntityId(
    database,
    'calendar',
    'service',
    exceptions.map((row) => String(row.service_id ?? ''))
  );
}
