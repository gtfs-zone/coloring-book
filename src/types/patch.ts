/**
 * Patch types for the append-only edit history system.
 */

export type PatchOp = 'insert' | 'update' | 'delete';

/** Direction-specific payload, one of three shapes. */
export type PatchData =
  | { record: Record<string, unknown> } // full row (insert forward / delete inverse)
  | { changes: Record<string, unknown> } // field map (update, just the after/before values)
  | { id: string }; // key-only (insert inverse / delete forward)

/** A single semantic change to one GTFS record. */
export interface SingleGTFSPatch {
  op: PatchOp;
  source: { table: string; id: string; col?: string };
  forward: PatchData;
  inverse: PatchData;
}

/**
 * One entity's ID rename, carried by the batch that performs it.
 *
 * The page names its object by that ID, so replaying the batch in either
 * direction has to take the page with it. Persisted with the patch, so an undo
 * after a reload still follows.
 */
export interface PatchRename {
  table: string;
  keyField: string;
  from: string;
  to: string;
}

/** A batch of single-record updates recorded as one undo/redo step. */
export interface BatchGTFSPatch {
  op: 'batch';
  ops: SingleGTFSPatch[];
  label?: string;
  rename?: PatchRename;
}

/** A patch is either a single-record operation or a batch of them. */
export type GTFSPatch = SingleGTFSPatch | BatchGTFSPatch;

/** Persisted patch entry in IndexedDB (version is the autoIncrement key). */
export interface PatchRecord {
  version?: number; // absent on write, assigned by autoIncrement on read
  patch: GTFSPatch;
  timestamp: number; // Date.now()
}

/** Compressed full-state checkpoint. */
export interface SnapshotRecord {
  version: number; // version of the last patch included in this snapshot
  state: string; // base64-encoded gzip-compressed JSON of GTFSState
  timestamp: number; // Date.now()
}

/** Full GTFS state: table name -> array of row objects. */
export type GTFSState = Record<string, Record<string, unknown>[]>;
