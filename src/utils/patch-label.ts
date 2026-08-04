import { GTFSPatch } from '../types/patch.js';
import { getEntityDisplay } from './entity-display.js';

/** Human-readable singular type names, keyed by GTFS table name. */
const TYPE_LABELS: Record<string, string> = {
  agency: 'Agency',
  stops: 'Stop',
  routes: 'Route',
  trips: 'Trip',
  calendar: 'Service',
  calendar_dates: 'Service exception',
  pathways: 'Pathway',
  stop_times: 'Stop time',
  shapes: 'Shape',
  fare_attributes: 'Fare',
  fare_rules: 'Fare rule',
  frequencies: 'Frequency',
  transfers: 'Transfer',
  levels: 'Level',
  feed_info: 'Feed info',
};

function typeLabel(table: string): string {
  return TYPE_LABELS[table] ?? table;
}

/**
 * Resolve the display name for a patch's entity from whatever row data the
 * patch carries (full record on insert/delete, just changed fields on update),
 * falling back to the raw id when no name field is present. Synchronous, no DB
 * lookups.
 */
function resolveName(
  table: string,
  record: Record<string, unknown> | undefined,
  fallbackId: string
): string {
  const info = getEntityDisplay(
    table,
    (record ?? {}) as Record<string, string>
  );
  return info.primary || fallbackId;
}

export function humanLabel(patch: GTFSPatch | undefined): string {
  if (!patch) {
    return 'Unknown change';
  }
  if (patch.op === 'batch') {
    return patch.label ?? `Batch update (${patch.ops.length} rows)`;
  }
  const { op, source } = patch;
  const type = typeLabel(source.table);

  if (op === 'insert') {
    const record = (patch.forward as { record: Record<string, unknown> })
      .record;
    return `${type} "${resolveName(source.table, record, source.id)}" created`;
  }
  if (op === 'delete') {
    const record = (patch.inverse as { record: Record<string, unknown> })
      .record;
    return `${type} "${resolveName(source.table, record, source.id)}" deleted`;
  }
  // update, only changed fields are available; name falls back to id
  const changes = (patch.forward as { changes: Record<string, unknown> })
    .changes;
  const name = resolveName(source.table, changes, source.id);
  const fields = source.col ?? Object.keys(changes).join(', ');
  return `${type} "${name}" updated (${fields})`;
}
