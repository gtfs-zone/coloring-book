/**
 * Patch Manager — append-only patch log with undo/redo support.
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
  PatchRecord,
  SnapshotRecord,
  GTFSState,
} from '../types/patch.js';
import { CONFIG } from '../config.js';
import {
  getNaturalKeyField,
  isNaturalKey,
  isCompositeKey,
  parseCompositeKey,
  getGTFSPrimaryKey,
} from '../utils/gtfs-primary-keys.js';

type PatchEventType = 'undo' | 'redo' | 'change' | 'jump';
type PatchEventListener = (record?: PatchRecord) => void;

export class PatchManager {
  private db: GTFSDatabase;
  private parser: GTFSParser;
  private currentVersion = 0;
  private headVersion = 0;
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

    const snapshot = await this.db.getLatestSnapshot();
    if (snapshot) {
      const stateJson = await decompress(snapshot.state);
      const state: GTFSState = JSON.parse(stateJson);

      // Restore each GTFS table to DB and in-memory
      for (const [table, rows] of Object.entries(state)) {
        if (!getGTFSPrimaryKey(table)) {
          continue;
        } // skip internal/unknown stores
        const fileName = `${table}.txt`;
        await this.db.clearTable(table);
        if (rows.length > 0) {
          await this.db.insertRows(table, rows as GTFSDatabaseRecord[]);
        }
        this.parser.setInMemoryFileData(fileName, rows as GTFSDatabaseRecord[]);
      }
    }

    // Replay patches only up to currentVersion (handles mid-undo refresh)
    const patches = await this.db.getPatchesAfter(snapshot?.version ?? 0);

    // Without a snapshot, blob-backed tables (stops, trips, routes, etc.) are
    // already restored from their CSV blobs by GTFSParser.initialize(). Replaying
    // insert patches on top of that data would double-insert, so we clear those
    // tables first. Update and delete patches are idempotent on blob-loaded data
    // and must NOT trigger a clear — clearing would destroy the blob-loaded rows
    // and leave the table empty after replay (update has nothing to match against).
    if (!snapshot && patches.length > 0) {
      const tablesToClear = new Set(
        patches
          .filter(
            (r) =>
              (r.version ?? 0) <= this.currentVersion && r.patch.op !== 'update'
          )
          .map((r) => r.patch.source.table)
      );
      for (const table of tablesToClear) {
        if (getGTFSPrimaryKey(table)) {
          await this.db.clearTable(table);
          this.parser.setInMemoryFileData(`${table}.txt`, []);
        }
      }
    }

    for (const record of patches) {
      if (record.version! > this.currentVersion) {
        break;
      }
      await this.applyPatchForward(record.patch);
    }
  }

  /** Apply a patch in the forward direction (mutates memory + IndexedDB). */
  async applyPatchForward(patch: GTFSPatch): Promise<void> {
    const { source, forward } = patch;
    const fileName = `${source.table}.txt`;
    const data = this.parser.getFileDataSync(fileName);

    if (patch.op === 'insert') {
      const record = (forward as { record: Record<string, unknown> })
        .record as GTFSDatabaseRecord;
      if (data) {
        data.push(record);
      }
      await this.db.insertRows(source.table, [record]);
    } else if (patch.op === 'delete') {
      if (data) {
        const idx = this.findRecordIndex(data, source.id, source.table);
        if (idx !== -1) {
          data.splice(idx, 1);
        }
      }
      await this.db.deleteRow(source.table, source.id);
    } else if (patch.op === 'update') {
      const changes = (forward as { changes: Record<string, unknown> }).changes;
      if (data) {
        const idx = this.findRecordIndex(data, source.id, source.table);
        if (idx !== -1) {
          for (const [field, value] of Object.entries(changes)) {
            (data[idx] as Record<string, unknown>)[field] = value;
          }
        }
      }
      const delta: Partial<GTFSDatabaseRecord> = {};
      for (const [field, value] of Object.entries(changes)) {
        delta[field] = value as string | number | boolean | undefined;
      }
      await this.db.updateRow(source.table, source.id, delta);
    }
  }

  /** Apply a patch in the reverse direction (undo). */
  async applyPatchInverse(patch: GTFSPatch): Promise<void> {
    const { source, inverse } = patch;
    const fileName = `${source.table}.txt`;
    const data = this.parser.getFileDataSync(fileName);

    if (patch.op === 'insert') {
      // Inverse of insert → delete by id
      if (data) {
        const idx = this.findRecordIndex(data, source.id, source.table);
        if (idx !== -1) {
          data.splice(idx, 1);
        }
      }
      await this.db.deleteRow(source.table, source.id);
    } else if (patch.op === 'delete') {
      // Inverse of delete → re-insert full record
      const record = (inverse as { record: Record<string, unknown> })
        .record as GTFSDatabaseRecord;
      if (data) {
        data.push(record);
      }
      await this.db.insertRows(source.table, [record]);
    } else if (patch.op === 'update') {
      // Inverse: apply before values
      const changes = (inverse as { changes: Record<string, unknown> }).changes;
      if (data) {
        const idx = this.findRecordIndex(data, source.id, source.table);
        if (idx !== -1) {
          for (const [field, value] of Object.entries(changes)) {
            (data[idx] as Record<string, unknown>)[field] = value;
          }
        }
      }
      const delta: Partial<GTFSDatabaseRecord> = {};
      for (const [field, value] of Object.entries(changes)) {
        delta[field] = value as string | number | boolean | undefined;
      }
      await this.db.updateRow(source.table, source.id, delta);
    }
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

  async revertPatch(version: number): Promise<void> {
    const record = await this.db.getPatch(version);
    if (!record) {
      return;
    }
    const { patch } = record;

    let inverted: GTFSPatch;
    if (patch.op === 'update') {
      inverted = {
        op: 'update',
        source: patch.source,
        forward: patch.inverse,
        inverse: patch.forward,
      };
    } else if (patch.op === 'insert') {
      inverted = {
        op: 'delete',
        source: patch.source,
        forward: patch.inverse,
        inverse: patch.forward,
      };
    } else {
      inverted = {
        op: 'insert',
        source: patch.source,
        forward: patch.inverse,
        inverse: patch.forward,
      };
    }

    await this.applyPatchForward(inverted);
    await this.appendAndPush(inverted);
    this.emit('jump');
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
    const version = await this.db.appendPatch({ patch, timestamp });
    this.currentVersion = version;
    this.headVersion = version;
    await this.db.setVersions(this.currentVersion, this.headVersion);
    await this.maybeSnapshot();
    this.emit('change', { version, patch, timestamp });
  }

  private emit(event: PatchEventType, record?: PatchRecord): void {
    this.listeners.get(event)?.forEach((l) => l(record));
  }

  private findRecordIndex(
    data: GTFSDatabaseRecord[],
    id: string,
    table: string
  ): number {
    if (isNaturalKey(table)) {
      const keyField = getNaturalKeyField(table);
      if (keyField) {
        return data.findIndex((r) => String(r[keyField]) === id);
      }
    } else if (isCompositeKey(table)) {
      const keyFields = parseCompositeKey(table, id);
      return data.findIndex((r) =>
        Object.entries(keyFields).every(([k, v]) => String(r[k]) === String(v))
      );
    }
    return -1;
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
