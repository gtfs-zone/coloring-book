/**
 * Patch types for the append-only edit history system.
 */

export type PatchOp = 'insert' | 'update' | 'delete';

/** A single semantic change to one GTFS record. */
export interface GTFSPatch {
  op: PatchOp;
  table: string;
  id: string;
  /** For 'update': field-level diffs as [before, after] tuples */
  changes?: Record<string, [unknown, unknown]>;
  /** For 'insert' and 'delete': the full record */
  record?: Record<string, unknown>;
}

/** Persisted patch entry in IndexedDB (version is the autoIncrement key). */
export interface PatchRecord {
  version?: number; // absent on write, assigned by autoIncrement on read
  patch: GTFSPatch;
  timestamp: number; // Date.now()
  description: string;
}

/** Compressed full-state checkpoint. */
export interface SnapshotRecord {
  version: number; // version of the last patch included in this snapshot
  state: string; // base64-encoded gzip-compressed JSON of GTFSState
  timestamp: number; // Date.now()
}

/** Full GTFS state — table name → array of row objects. */
export type GTFSState = Record<string, Record<string, unknown>[]>;
