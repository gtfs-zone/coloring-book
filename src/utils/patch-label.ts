import { GTFSPatch } from '../types/patch.js';

export function humanLabel(patch: GTFSPatch | undefined): string {
  if (!patch) {
    return 'Unknown change';
  }
  if (patch.op === 'batch') {
    return patch.label ?? `Batch update (${patch.ops.length} rows)`;
  }
  const { op, source } = patch;
  if (op === 'update') {
    const fields =
      source.col ??
      Object.keys(
        (patch.forward as { changes: Record<string, unknown> }).changes
      ).join(', ');
    return `Updated ${fields} in ${source.table} / ${source.id}`;
  }
  if (op === 'insert') {
    return `Created ${source.table} / ${source.id}`;
  }
  return `Deleted ${source.table} / ${source.id}`;
}
