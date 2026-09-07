/**
 * Patch Manager: append-only patch log with undo/redo support.
 *
 * INVARIANT: All user-initiated writes MUST go through this module
 * (recordUpdate / recordInsert / recordDelete). Direct database writes that
 * bypass patch recording are only permitted for: internal DB initialization,
 * patch replay (inside this file), and feed import.
 * Use patchUpdate() from utils/patch-utils.ts for interactive edit handlers.
 */
import { GTFSDatabase, GTFSDatabaseRecord } from './gtfs-database.js';
import { GTFSParser } from './gtfs-parser.js';
import {
  GTFSPatch,
  SingleGTFSPatch,
  BatchGTFSPatch,
  PatchRecord,
  SnapshotRecord,
  GTFSState,
} from '../types/patch.js';
import { CONFIG } from '../config.js';
import { getGTFSPrimaryKey } from '../utils/gtfs-primary-keys.js';

type PatchEventType = 'undo' | 'redo' | 'change' | 'jump';
type PatchEventListener = (record?: PatchRecord) => void;

/** The only GeoJSON-backed table: its store name has no `.txt` counterpart. */
const LOCATIONS_TABLE = 'locations';

function fileNameForTable(table: string): string {
  return table === LOCATIONS_TABLE ? 'locations.geojson' : `${table}.txt`;
}

export class PatchManager {
  private db: GTFSDatabase;
  private parser: GTFSParser;
  private currentVersion = 0;
  private headVersion = 0;
  private appliedCount = 0;
  private listeners = new Map<PatchEventType, Set<PatchEventListener>>();

  constructor(db: GTFSDatabase, parser: GTFSParser) {
    this.db = db;
    this.parser = parser;
  }

  /**
   * Restore state from the latest snapshot + subsequent patches.
   * Called once after GTFSParser.initialize().
   */
  async initialize(): Promise<void> {
    const { currentVersion, headVersion } = await this.db.getVersions();
    this.currentVersion = currentVersion;
    this.headVersion = headVersion;
    this.appliedCount = await this.db.countPatchesUpTo(currentVersion);

    const blobVersion = await this.db.getBlobVersion();
    if (blobVersion === currentVersion) {
      // Blobs were persisted at the current version, the in-memory state loaded
      // by GTFSParser.initialize() is already correct. Skip snapshot+replay entirely.
      console.log(
        `[PatchManager] Blob is current at version ${currentVersion}. Skipping snapshot restore.`
      );
      return;
    }

    const snapshot = await this.db.getLatestSnapshot();
    if (snapshot) {
      const stateJson = await decompress(snapshot.state);
      const state: GTFSState = JSON.parse(stateJson);

      // Restore each GTFS table to DB and in-memory
      for (const [table, rows] of Object.entries(state)) {
        if (!getGTFSPrimaryKey(table)) {
          continue;
        } // skip internal/unknown stores
        const fileName = fileNameForTable(table);
        await this.db.clearTable(table);
        if (rows.length > 0) {
          await this.db.insertRows(table, rows as GTFSDatabaseRecord[]);
        }
        this.parser.setInMemoryFileData(fileName, rows as GTFSDatabaseRecord[]);
      }
    }

    // Replay patches only up to currentVersion (handles mid-undo refresh).
    //
    // No pre-clearing needed: the blob loaded by GTFSParser.initialize() already
    // reflects the correct current state (original feed + all applied patches).
    // applyPatchForward routes inserts through vt.insert, which has a byId
    // deduplication guard, so replaying an insert patch whose row is already
    // present in the blob is a safe no-op. Delete patches are also safe: vt.delete
    // returns early if the row is not found in byId.
    const patches = await this.db.getPatchesAfter(snapshot?.version ?? 0);

    for (const record of patches) {
      if (record.version! > this.currentVersion) {
        break;
      }
      await this.applyPatchForward(record.patch);
    }
  }

  /**
   * Apply a patch in the forward direction (mutates memory + IndexedDB).
   *
   * All in-memory state is maintained exclusively via db.* calls, which route
   * through the virtual table handlers. Do not add direct array mutations here,
   * the virtual table's flat array IS gtfsData[fileName].data (same reference),
   * so bypassing the virtual table corrupts the byId index and fieldMaps.
   */
  async applyPatchForward(patch: GTFSPatch): Promise<void> {
    if (patch.op === 'batch') {
      for (const op of patch.ops) {
        await this.applyPatchForward(op);
      }
      return;
    }

    const { source, forward } = patch;

    if (patch.op === 'insert') {
      const record = (forward as { record: Record<string, unknown> })
        .record as GTFSDatabaseRecord;
      await this.db.insertRows(source.table, [record]);
    } else if (patch.op === 'delete') {
      await this.db.deleteRow(source.table, source.id);
    } else if (patch.op === 'update') {
      const changes = (forward as { changes: Record<string, unknown> }).changes;
      const delta: Partial<GTFSDatabaseRecord> = {};
      for (const [field, value] of Object.entries(changes)) {
        delta[field] = value as string | number | boolean | undefined;
      }
      await this.db.updateRow(source.table, source.id, delta);
    }

    await this.syncGeoJSONMemory(source.table);
  }

  /**
   * Push a GeoJSON table's IDB rows back into memory.
   *
   * Every other table is a virtual table whose in-memory array IS the array the
   * db.* handlers mutate. locations.geojson has no virtual table (it is one row
   * holding a whole FeatureCollection), so an applied patch reaches IndexedDB
   * only and memory would keep serving the pre-undo geometry.
   */
  private async syncGeoJSONMemory(table: string): Promise<void> {
    if (table !== LOCATIONS_TABLE) {
      return;
    }
    const rows = await this.db.getAllRows(table);
    this.parser.setInMemoryFileData(fileNameForTable(table), rows);
  }

  /**
   * Apply a patch in the reverse direction (undo).
   *
   * Same invariant as applyPatchForward: all in-memory state goes through db.*
   * (virtual table handlers). No direct array mutations.
   */
  async applyPatchInverse(patch: GTFSPatch): Promise<void> {
    if (patch.op === 'batch') {
      for (const op of [...patch.ops].reverse()) {
        await this.applyPatchInverse(op);
      }
      return;
    }

    const { source, inverse } = patch;

    if (patch.op === 'insert') {
      // Inverse of insert: delete by id
      await this.db.deleteRow(source.table, source.id);
    } else if (patch.op === 'delete') {
      // Inverse of delete: re-insert full record
      const record = (inverse as { record: Record<string, unknown> })
        .record as GTFSDatabaseRecord;
      await this.db.insertRows(source.table, [record]);
    } else if (patch.op === 'update') {
      // Inverse: apply before values
      const changes = (inverse as { changes: Record<string, unknown> }).changes;
      const delta: Partial<GTFSDatabaseRecord> = {};
      for (const [field, value] of Object.entries(changes)) {
        delta[field] = value as string | number | boolean | undefined;
      }
      await this.db.updateRow(source.table, source.id, delta);
    }

    await this.syncGeoJSONMemory(source.table);
  }

  async recordInsert(
    table: string,
    id: string,
    record: Record<string, unknown>
  ): Promise<void> {
    const patch: GTFSPatch = {
      op: 'insert',
      source: { table, id },
      forward: { record },
      inverse: { id },
    };
    await this.appendAndPush(patch);
  }

  async recordUpdate(
    table: string,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): Promise<void> {
    const forwardChanges: Record<string, unknown> = {};
    const inverseChanges: Record<string, unknown> = {};
    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) {
        forwardChanges[key] = after[key];
        inverseChanges[key] = before[key];
      }
    }
    if (Object.keys(forwardChanges).length === 0) {
      return;
    }
    const patch: GTFSPatch = {
      op: 'update',
      source: { table, id },
      forward: { changes: forwardChanges },
      inverse: { changes: inverseChanges },
    };
    await this.applyPatchForward(patch);
    await this.appendAndPush(patch);
  }

  async recordDelete(
    table: string,
    id: string,
    record: Record<string, unknown>
  ): Promise<void> {
    const patch: GTFSPatch = {
      op: 'delete',
      source: { table, id },
      forward: { id },
      inverse: { record },
    };
    await this.appendAndPush(patch);
  }

  async recordBatchInsert(
    ops: Array<{ table: string; id: string; record: Record<string, unknown> }>,
    label?: string
  ): Promise<void> {
    if (ops.length === 0) {
      return;
    }
    const singlePatches: SingleGTFSPatch[] = ops.map(
      ({ table, id, record }) => ({
        op: 'insert' as const,
        source: { table, id },
        forward: { record },
        inverse: { id },
      })
    );
    if (singlePatches.length === 1) {
      await this.appendAndPush(singlePatches[0]);
      return;
    }
    const batchPatch: BatchGTFSPatch = {
      op: 'batch',
      ops: singlePatches,
      label,
    };
    await this.appendAndPush(batchPatch);
  }

  async recordBatchDelete(
    ops: Array<{ table: string; id: string; record: Record<string, unknown> }>,
    label?: string
  ): Promise<void> {
    if (ops.length === 0) {
      return;
    }
    const singlePatches: SingleGTFSPatch[] = ops.map(
      ({ table, id, record }) => ({
        op: 'delete' as const,
        source: { table, id },
        forward: { id },
        inverse: { record },
      })
    );
    if (singlePatches.length === 1) {
      await this.appendAndPush(singlePatches[0]);
      return;
    }
    const batchPatch: BatchGTFSPatch = {
      op: 'batch',
      ops: singlePatches,
      label,
    };
    await this.appendAndPush(batchPatch);
  }

  /**
   * Record a batch of already-applied writes of mixed kinds.
   *
   * Like recordInsert/recordDelete (and unlike recordUpdate/recordBatch), this
   * only appends the patch: the caller has already written the rows. Ops are
   * kept in the order given, which matters when a batch both deletes and
   * inserts rows in the same table: put the deletes first so neither forward
   * replay nor the reversed inverse replay ever holds two rows on one key.
   */
  async recordBatchMixed(
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
  ): Promise<void> {
    if (ops.length === 0) {
      return;
    }
    const singlePatches: SingleGTFSPatch[] = [];
    for (const op of ops) {
      if (op.op === 'insert') {
        singlePatches.push({
          op: 'insert',
          source: { table: op.table, id: op.id },
          forward: { record: op.record },
          inverse: { id: op.id },
        });
      } else if (op.op === 'delete') {
        singlePatches.push({
          op: 'delete',
          source: { table: op.table, id: op.id },
          forward: { id: op.id },
          inverse: { record: op.record },
        });
      } else {
        const forwardChanges: Record<string, unknown> = {};
        const inverseChanges: Record<string, unknown> = {};
        for (const key of Object.keys(op.after)) {
          if (op.before[key] !== op.after[key]) {
            forwardChanges[key] = op.after[key];
            inverseChanges[key] = op.before[key];
          }
        }
        if (Object.keys(forwardChanges).length > 0) {
          singlePatches.push({
            op: 'update',
            source: { table: op.table, id: op.id },
            forward: { changes: forwardChanges },
            inverse: { changes: inverseChanges },
          });
        }
      }
    }
    if (singlePatches.length === 0) {
      return;
    }
    if (singlePatches.length === 1) {
      await this.appendAndPush(singlePatches[0]);
      return;
    }
    const batchPatch: BatchGTFSPatch = {
      op: 'batch',
      ops: singlePatches,
      label,
    };
    await this.appendAndPush(batchPatch);
  }

  async recordBatch(
    ops: Array<{
      table: string;
      id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>,
    label: string
  ): Promise<void> {
    const singlePatches: SingleGTFSPatch[] = [];

    for (const op of ops) {
      const forwardChanges: Record<string, unknown> = {};
      const inverseChanges: Record<string, unknown> = {};
      for (const key of Object.keys(op.after)) {
        if (op.before[key] !== op.after[key]) {
          forwardChanges[key] = op.after[key];
          inverseChanges[key] = op.before[key];
        }
      }
      if (Object.keys(forwardChanges).length === 0) {
        continue;
      }
      singlePatches.push({
        op: 'update',
        source: { table: op.table, id: op.id },
        forward: { changes: forwardChanges },
        inverse: { changes: inverseChanges },
      });
    }

    if (singlePatches.length === 0) {
      return;
    }

    if (singlePatches.length === 1) {
      const patch = singlePatches[0];
      await this.applyPatchForward(patch);
      await this.appendAndPush(patch);
      return;
    }

    const batchPatch: BatchGTFSPatch = {
      op: 'batch',
      ops: singlePatches,
      label,
    };
    await this.applyPatchForward(batchPatch);
    await this.appendAndPush(batchPatch);
  }

  async undo(): Promise<void> {
    if (this.currentVersion === 0) {
      return;
    }
    const record = await this.db.getPatch(this.currentVersion);
    if (!record) {
      return;
    }
    await this.applyPatchInverse(record.patch);
    this.currentVersion--;
    this.appliedCount--;
    await this.db.setVersions(this.currentVersion, this.headVersion);
    this.emit('undo', record);
  }

  async redo(): Promise<void> {
    if (this.currentVersion === this.headVersion) {
      return;
    }
    const record = await this.db.getPatch(this.currentVersion + 1);
    if (!record) {
      return;
    }
    await this.applyPatchForward(record.patch);
    this.currentVersion++;
    this.appliedCount++;
    await this.db.setVersions(this.currentVersion, this.headVersion);
    this.emit('redo', record);
  }

  get canUndo(): boolean {
    return this.currentVersion > 0;
  }

  get canRedo(): boolean {
    return this.currentVersion < this.headVersion;
  }

  get version(): number {
    return this.currentVersion;
  }

  /** Number of patches currently applied (undone patches do not count). */
  get changeCount(): number {
    return this.appliedCount;
  }

  /**
   * Reset in-memory version bookkeeping after the underlying stores are wiped
   * for a new/replacement feed (patches, snapshots, and meta are all cleared
   * by GTFSDatabase.commitFeedGeneration()). Without this, appendAndPush's stale
   * currentVersion/headVersion from the previous feed cause a spurious
   * deletePatchesAfter() call against the now-empty patches store on the
   * first edit of the new feed.
   */
  resetState(): void {
    this.currentVersion = 0;
    this.headVersion = 0;
    this.appliedCount = 0;
  }

  async jumpToVersion(target: number): Promise<void> {
    if (target === this.currentVersion) {
      return;
    }
    if (target < this.currentVersion) {
      for (let v = this.currentVersion; v > target; v--) {
        const record = await this.db.getPatch(v);
        if (record) {
          await this.applyPatchInverse(record.patch);
        }
      }
    } else {
      for (let v = this.currentVersion + 1; v <= target; v++) {
        const record = await this.db.getPatch(v);
        if (record) {
          await this.applyPatchForward(record.patch);
        }
      }
    }
    this.currentVersion = target;
    this.appliedCount = await this.db.countPatchesUpTo(target);
    await this.db.setVersions(this.currentVersion, this.headVersion);
    this.emit('jump');
  }

  async getHistory(): Promise<(PatchRecord & { applied: boolean })[]> {
    const all = await this.db.getPatchesAfter(0);
    return all.map((r) => ({
      ...r,
      applied: r.version! <= this.currentVersion,
    }));
  }

  on(event: PatchEventType, listener: PatchEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: PatchEventType, listener: PatchEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  // ===== Private helpers =====

  private async appendAndPush(patch: GTFSPatch): Promise<void> {
    if (this.currentVersion < this.headVersion) {
      await this.db.deletePatchesAfter(this.currentVersion);
      this.headVersion = this.currentVersion;
    }
    const timestamp = Date.now();
    // Version is assigned explicitly rather than by the store's key generator:
    // the generator keeps climbing after a discarded redo branch, which would
    // leave gaps that undo/redo cannot step across.
    const version = await this.db.appendPatch({
      version: this.currentVersion + 1,
      patch,
      timestamp,
    });
    this.currentVersion = version;
    this.headVersion = version;
    this.appliedCount++;
    await this.db.setVersions(this.currentVersion, this.headVersion);
    await this.maybeSnapshot();
    this.emit('change', { version, patch, timestamp });
  }

  private emit(event: PatchEventType, record?: PatchRecord): void {
    this.listeners.get(event)?.forEach((l) => l(record));
  }

  private async maybeSnapshot(): Promise<void> {
    if (
      this.currentVersion === 0 ||
      this.currentVersion % CONFIG.SNAPSHOT_INTERVAL !== 0
    ) {
      return;
    }

    const state: GTFSState = {};
    for (const fileName of this.parser.getAllFileNames()) {
      const table = fileName.replace('.txt', '').replace('.geojson', '');
      if (!getGTFSPrimaryKey(table)) {
        continue;
      } // skip internal/unknown stores
      const data = this.parser.getFileDataSync(fileName);
      if (data) {
        state[table] = data as Record<string, unknown>[];
      }
    }

    const compressed = await compress(JSON.stringify(state));
    const record: SnapshotRecord = {
      version: this.currentVersion,
      state: compressed,
      timestamp: Date.now(),
    };
    await this.db.saveSnapshot(record);
  }
}

// ===== Compression helpers (native CompressionStream API) =====

async function compress(data: string): Promise<string> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(data));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  const blob = new Blob(chunks as BlobPart[]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

async function decompress(data: string): Promise<string> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}
