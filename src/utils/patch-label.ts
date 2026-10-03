import { GTFSPatch } from '../types/patch';
import { getEntityDisplay } from './entity-display';
import { t } from '../i18n/messages';

/** Human-readable singular type names, keyed by GTFS table name. */
const TYPE_LABELS: Record<string, string> = {
  agency: t('patch.type.agency'),
  stops: t('patch.type.stops'),
  routes: t('patch.type.routes'),
  trips: t('patch.type.trips'),
  calendar: t('patch.type.calendar'),
  calendar_dates: t('patch.type.calendar_dates'),
  pathways: t('patch.type.pathways'),
  stop_times: t('patch.type.stop_times'),
  shapes: t('patch.type.shapes'),
  fare_attributes: t('patch.type.fare_attributes'),
  fare_rules: t('patch.type.fare_rules'),
  frequencies: t('patch.type.frequencies'),
  transfers: t('patch.type.transfers'),
  levels: t('patch.type.levels'),
  feed_info: t('patch.type.feed_info'),
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
    return t('patch.unknown');
  }
  if (patch.op === 'batch') {
    return patch.label ?? t('patch.batch', { count: patch.ops.length });
  }
  const { op, source } = patch;
  const type = typeLabel(source.table);

  if (op === 'insert') {
    const record = (patch.forward as { record: Record<string, unknown> })
      .record;
    return t('patch.created', {
      type,
      name: resolveName(source.table, record, source.id),
    });
  }
  if (op === 'delete') {
    const record = (patch.inverse as { record: Record<string, unknown> })
      .record;
    return t('patch.deleted', {
      type,
      name: resolveName(source.table, record, source.id),
    });
  }
  // update, only changed fields are available; name falls back to id
  const changes = (patch.forward as { changes: Record<string, unknown> })
    .changes;
  const name = resolveName(source.table, changes, source.id);
  const fields = source.col ?? Object.keys(changes).join(', ');
  return t('patch.updated', { type, name, fields });
}
