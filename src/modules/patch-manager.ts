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
} from '../utils/gtfs-primary-keys.js';

type PatchEventType = 'undo' | 'redo' | 'change';
type PatchEventListener = () => void;

export class PatchManager {
  private db: GTFSDatabase;
  private parser: GTFSParser;
  private undoStack: PatchRecord[] = [];
  private redoStack: PatchRecord[] = [];
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
    const snapshot = await this.db.getLatestSnapshot();
    if (!snapshot) {
      return; // No snapshot — IndexedDB tables are already current
    }

    const stateJson = await decompress(snapshot.state);
    const state: GTFSState = JSON.parse(stateJson);

    // Restore each GTFS table to DB and in-memory
    for (const [table, rows] of Object.entries(state)) {
      const fileName = `${table}.txt`;
      await this.db.clearTable(table);
      if (rows.length > 0) {
        await this.db.insertRows(table, rows as GTFSDatabaseRecord[]);
      }
      this.parser.setInMemoryFileData(fileName, rows as GTFSDatabaseRecord[]);
    }

    // Replay patches that came after the snapshot
    const patches = await this.db.getPatchesAfter(snapshot.version);
    for (const record of patches) {
      await this.applyPatchForward(record.patch);
    }
  }

  /** Apply a patch in the forward direction (mutates memory + IndexedDB). */
  async applyPatchForward(patch: GTFSPatch): Promise<void> {
    const fileName = `${patch.table}.txt`;
    const data = this.parser.getFileDataSync(fileName);

    if (patch.op === 'insert') {
      const record = patch.record as GTFSDatabaseRecord;
      if (data) {
        data.push(record);
      }
      await this.db.insertRows(patch.table, [record]);
    } else if (patch.op === 'delete') {
      if (data) {
        const idx = this.findRecordIndex(data, patch.id, patch.table);
        if (idx !== -1) {
          data.splice(idx, 1);
        }
      }
      await this.db.deleteRow(patch.table, patch.id);
    } else if (patch.op === 'update') {
      const changes = patch.changes!;
      if (data) {
        const idx = this.findRecordIndex(data, patch.id, patch.table);
        if (idx !== -1) {
          for (const [field, [, after]] of Object.entries(changes)) {
            (data[idx] as Record<string, unknown>)[field] = after;
          }
        }
      }
      const delta: Partial<GTFSDatabaseRecord> = {};
      for (const [field, [, after]] of Object.entries(changes)) {
        delta[field] = after as string | number | boolean | undefined;
      }
      await this.db.updateRow(patch.table, patch.id, delta);
    }
  }

  /** Apply a patch in the reverse direction (undo). */
  async applyPatchInverse(patch: GTFSPatch): Promise<void> {
    const fileName = `${patch.table}.txt`;
    const data = this.parser.getFileDataSync(fileName);

    if (patch.op === 'insert') {
      // Inverse of insert → delete
      if (data) {
        const idx = this.findRecordIndex(data, patch.id, patch.table);
        if (idx !== -1) {
          data.splice(idx, 1);
        }
      }
      await this.db.deleteRow(patch.table, patch.id);
    } else if (patch.op === 'delete') {
      // Inverse of delete → insert
      const record = patch.record as GTFSDatabaseRecord;
      if (data) {
        data.push(record);
      }
      await this.db.insertRows(patch.table, [record]);
    } else if (patch.op === 'update') {
      // Inverse: apply [before] values
      const changes = patch.changes!;
      if (data) {
        const idx = this.findRecordIndex(data, patch.id, patch.table);
        if (idx !== -1) {
          for (const [field, [before]] of Object.entries(changes)) {
            (data[idx] as Record<string, unknown>)[field] = before;
          }
        }
      }
      const delta: Partial<GTFSDatabaseRecord> = {};
      for (const [field, [before]] of Object.entries(changes)) {
        delta[field] = before as string | number | boolean | undefined;
      }
      await this.db.updateRow(patch.table, patch.id, delta);
    }
  }

  async recordInsert(
    table: string,
    id: string,
    record: Record<string, unknown>,
    description: string
  ): Promise<void> {
    const patch: GTFSPatch = { op: 'insert', table, id, record };
    await this.appendAndPush(patch, description);
  }

  async recordUpdate(
    table: string,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    description: string
  ): Promise<void> {
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) {
        changes[key] = [before[key], after[key]];
      }
    }
    if (Object.keys(changes).length === 0) {
      return;
    }
    const patch: GTFSPatch = { op: 'update', table, id, changes };
    await this.appendAndPush(patch, description);
  }

  async recordDelete(
    table: string,
    id: string,
    record: Record<string, unknown>,
    description: string
  ): Promise<void> {
    const patch: GTFSPatch = { op: 'delete', table, id, record };
    await this.appendAndPush(patch, description);
  }

  async undo(): Promise<void> {
    const record = this.undoStack.pop();
    if (!record) {
      return;
    }
    this.redoStack.push(record);
    await this.applyPatchInverse(record.patch);
    this.emit('undo');
  }

  async redo(): Promise<void> {
    const record = this.redoStack.pop();
    if (!record) {
      return;
    }
    this.undoStack.push(record);
    await this.applyPatchForward(record.patch);
    this.emit('redo');
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async getHistory(): Promise<PatchRecord[]> {
    return this.db.getPatchesAfter(0);
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

  private async appendAndPush(
    patch: GTFSPatch,
    description: string
  ): Promise<void> {
    const version = await this.db.appendPatch({
      patch,
      timestamp: Date.now(),
      description,
    });
    this.undoStack.push({ version, patch, timestamp: Date.now(), description });
    if (this.undoStack.length > CONFIG.MAX_UNDO_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    await this.maybeSnapshot();
    this.emit('change');
  }

  private emit(event: PatchEventType): void {
    this.listeners.get(event)?.forEach((l) => l());
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
    const count = this.undoStack.length;
    if (count === 0 || count % CONFIG.SNAPSHOT_INTERVAL !== 0) {
      return;
    }

    const latestVersion = this.undoStack[this.undoStack.length - 1].version!;
    const state: GTFSState = {};
    for (const fileName of this.parser.getAllFileNames()) {
      const table = fileName.replace('.txt', '').replace('.geojson', '');
      const data = this.parser.getFileDataSync(fileName);
      if (data) {
        state[table] = data as Record<string, unknown>[];
      }
    }

    const compressed = await compress(JSON.stringify(state));
    const record: SnapshotRecord = {
      version: latestVersion,
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
  return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
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
