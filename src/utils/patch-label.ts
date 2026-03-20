import { GTFSPatch, PatchRecord } from '../types/patch.js';

export function humanLabel(patch: GTFSPatch | undefined): string {
  if (!patch) {
    return 'Unknown change';
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

export type { PatchRecord };
