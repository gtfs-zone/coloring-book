import JSZip from 'jszip';
import Papa from 'papaparse';
import { CONFIG } from '../config.js';
import {
  GTFSDatabase,
  GTFSDatabaseRecord,
  type FeedSummary,
  type NetworksMode,
} from './gtfs-database.js';
import { GTFS_FILES, GTFS_TABLES } from '../types/gtfs.js';
import { feedProgressIndicator } from './feed-progress-indicator.js';
import { notify } from './notification-system.js';
import {
  ALL_GTFS_FILES,
  makeHeaderOnlyCSV,
  getFileHeaders,
} from './gtfs-file-registry.js';
import type {
  ImportSource,
  WorkerDoneMessage,
  WorkerOutbound,
  WorkerOversizeMessage,
} from '../workers/gtfs-parser.worker.js';
import { showModal } from './modal-utils.js';
import { escapeHtml } from '../utils/escape-html.js';
import { GTFSTableMap, StopTimes } from '../types/gtfs-entities.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { splitInnerZipPath } from './feed-url-resolve.js';
import { yieldToEventLoop } from '../utils/async-yield.js';
import { processParsedData } from '../utils/gtfs-field-values.js';
import { LoadCancelledError, formatBytes } from './feed-download.js';

/**
 * The shell one feed-producing operation runs inside: its progress key, its
 * watchdog, and the single point a cancel or a failure enters from outside the
 * body's own await chain.
 */
interface FeedOperation {
  /** Progress key, unique per operation. */
  readonly key: string;
  /** Fail the operation from outside. Idempotent. */
  fail(error: Error): void;
  /** Unwind at the next checkpoint if the operation has been failed. */
  throwIfAborted(): void;
  /** Re-arm the no-progress deadline. Called on every sign of life. */
  armWatchdog(): void;
  clearWatchdog(): void;
  /** Run on failure, to unwind whatever is producing chunks. */
  onAbort(handler: (error: Error) => void): void;
}

/** Store names backed by a .geojson file rather than a CSV table. */
const GEOJSON_TABLES = new Set(
  ALL_GTFS_FILES.filter((f) => f.endsWith('.geojson')).map((f) =>
    f.replace('.geojson', '')
  )
);

/**
 * Serialize a table's rows as `BLOB_CHUNK_ROWS`-row JSON strings.
 *
 * No chunk approaches the engine's max string length (a 4.5M-row stop_times
 * serializes to ~1.09 GB as one string, over SpiderMonkey's 1.07 GB limit).
 * A table with no rows still gets exactly one `[]` chunk, so an intentionally
 * empty table reads back as empty rather than as a table that was never
 * written.
 */
function serializeRowChunks(rows: GTFSDatabaseRecord[]): string[] {
  if (rows.length === 0) {
    return ['[]'];
  }
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += CONFIG.BLOB_CHUNK_ROWS) {
    chunks.push(JSON.stringify(rows.slice(i, i + CONFIG.BLOB_CHUNK_ROWS)));
  }
  return chunks;
}

/**
 * Ask before loading a feed the browser may not survive. Answered while the
 * worker is parked before its first inflation, so declining costs nothing and
 * leaves the currently loaded feed untouched.
 */
async function confirmLargeFeed(
  label: string,
  estimate: WorkerOversizeMessage,
  // Lets the caller take the prompt down if the load is cancelled or dies
  // while it is open.
  onOpen: (close: () => void) => void
): Promise<boolean> {
  const biggest = estimate.tables
    .slice(0, 3)
    .map(
      (t) =>
        `<li>${escapeHtml(t.fileName)}: ~${t.rows.toLocaleString()} rows (${formatBytes(t.bytes)})</li>`
    )
    .join('');

  let accepted = false;
  await showModal({
    title: 'Large feed',
    body: `
      <p><strong>${escapeHtml(label)}</strong> is large and may crash the
      browser on computers with less memory available.</p>
      <p class="mt-2">Roughly ${estimate.totalRows.toLocaleString()} rows across
      ${formatBytes(estimate.totalBytes)} of uncompressed data, needing about
      ${formatBytes(estimate.memoryBytes)} of memory once loaded. Row counts are
      estimated from file sizes.</p>
      <ul class="list-disc list-inside mt-2">${biggest}</ul>
      <p class="mt-2">Loading it may take several minutes or run the tab out of
      memory. Cancelling leaves the feed you have loaded now exactly as it is.</p>
    `,
    escapeAction: 1,
    onMount: onOpen,
    actions: [
      {
        label: 'Load anyway',
        className: 'btn-warning',
        onClick: () => {
          accepted = true;
        },
      },
      { label: 'Cancel', className: 'btn-outline', onClick: () => {} },
    ],
  });
  return accepted;
}

interface GTFSFileData<T = GTFSDatabaseRecord> {
  content: string;
  data: T[];
  errors: Papa.ParseError[];
}

/**
 * The chunks a worker posts, as something the hydration can `for await` over.
 *
 * The worker pushes on its own schedule and never blocks; the hydration pulls
 * one chunk at a time and yields between them, which is what keeps the page
 * painting through a large import.
 */
class ChunkQueue implements AsyncIterable<HydrationChunk> {
  private items: HydrationChunk[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private failure: Error | null = null;

  push(chunk: HydrationChunk): void {
    this.items.push(chunk);
    this.signal();
  }

  /** No more chunks: the iteration ends once the queued ones are drained. */
  end(): void {
    this.ended = true;
    this.signal();
  }

  /** Unwind the hydration when the worker dies or the load is cancelled. */
  fail(error: Error): void {
    this.failure = error;
    this.ended = true;
    this.signal();
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<HydrationChunk> {
    for (;;) {
      while (this.items.length > 0) {
        yield this.items.shift()!;
      }
      if (this.failure) {
        throw this.failure;
      }
      if (this.ended) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

/**
 * Primary-key lookups for one virtual table.
 *
 * The seam exists so a table whose key can be answered from a field map does
 * not have to carry a key-to-row map of its own. `add` and `remove` take the
 * row as well as the key so a derived implementation can ignore both and let
 * the field map loop do the storage.
 */
interface KeyIndex {
  get(key: string): GTFSDatabaseRecord | undefined;
  has(key: string): boolean;
  add(key: string, row: GTFSDatabaseRecord): void;
  remove(key: string, row: GTFSDatabaseRecord): void;
  clear(): void;
}

/** The default: one key-to-row map per table. Last row with a key wins. */
class MapKeyIndex implements KeyIndex {
  private map = new Map<string, GTFSDatabaseRecord>();

  get(key: string): GTFSDatabaseRecord | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  add(key: string, row: GTFSDatabaseRecord): void {
    this.map.set(key, row);
  }

  remove(key: string, _row: GTFSDatabaseRecord): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

/** The lookup structures a virtual table answers queries from. */
interface TableIndex {
  byId: KeyIndex;
  fieldMaps: Map<string, Map<string, GTFSDatabaseRecord[]>>;
}

/** One table's rows plus the index built over them as they arrived. */
interface HydratedFeed {
  data: { [fileName: string]: GTFSFileData };
  indexes: Map<string, TableIndex>;
}

/** A serialized slice of one table, as written to (or read from) `file_blobs`. */
interface HydrationChunk {
  tableName: string;
  json: string;
}

/**
 * Every GTFS file present and empty, each with its header-only CSV.
 * The invariant the rest of the app reads against: a file is always in
 * `gtfsData`, whether or not the feed carried it.
 */
function createFeedScaffold(): { [fileName: string]: GTFSFileData } {
  const data: { [fileName: string]: GTFSFileData } = {};
  for (const fileName of ALL_GTFS_FILES) {
    data[fileName] = {
      content: makeHeaderOnlyCSV(fileName),
      data: [],
      errors: [],
    };
  }
  return data;
}

function addToBucket(
  map: Map<string, GTFSDatabaseRecord[]>,
  val: string,
  row: GTFSDatabaseRecord
): void {
  let bucket = map.get(val);
  if (!bucket) {
    bucket = [];
    map.set(val, bucket);
  }
  if (!bucket.includes(row)) {
    bucket.push(row);
  }
}

function removeFromBucket(
  map: Map<string, GTFSDatabaseRecord[]>,
  val: string,
  row: GTFSDatabaseRecord
): void {
  const bucket = map.get(val);
  if (bucket) {
    const i = bucket.indexOf(row);
    if (i !== -1) {
      bucket.splice(i, 1);
    }
    if (bucket.length === 0) {
      map.delete(val);
    }
  }
}

// Type-safe table name to entity type mapping
type GTFSTableName = keyof GTFSTableMap;

interface PatchManagerRef {
  readonly version: number;
  recordInsert(
    table: string,
    id: string,
    record: Record<string, unknown>
  ): Promise<void>;
  recordUpdate(
    table: string,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): Promise<void>;
  resetState?(): void;
}

export class GTFSParser {
  private gtfsData: { [fileName: string]: GTFSFileData } = {};
  private passthroughFiles: Map<string, string> = new Map();
  public gtfsDatabase: GTFSDatabase;
  private patchManager: PatchManagerRef | null = null;

  // In-memory index for stop_times stop_id lookups (used by synchronous getRoutesForStop)
  private stopTimesByStopId = new Map<string, StopTimes[]>();
  // In-memory index for stop_times trip_id lookups (used by synchronous getStopIdsForRoute)
  private stopTimesByTripId = new Map<string, StopTimes[]>();
  // In-memory index for trips route_id lookups (used by synchronous getTripsByRouteId)
  private tripsByRouteId = new Map<string, GTFSDatabaseRecord[]>();
  // Dirty-blob tracking for deferred persistence
  private blobDirty = new Set<string>();
  private blobPersistTimer: ReturnType<typeof setTimeout> | null = null;
  // One feed-producing operation at a time, import or boot restore: the file
  // input is wired before the boot restore is awaited, so a user load can
  // otherwise start mid-restore and have the restore install its rows over it.
  // Also gates the visibilitychange flush: that write stamps blobVersion from
  // patchManager.version, which is meaningless while a staging generation is
  // mid-import and shares the flush chain with it.
  private feedOperationInFlight = false;
  // Progress keys have to be unique per operation: two loads sharing one key
  // would delete each other's entry and strand every later updateProgress.
  private operationSeq = 0;

  constructor() {
    this.gtfsData = {};
    this.gtfsDatabase = new GTFSDatabase();

    // A reload can outrun the 3-second debounce. Flush when the page is
    // hidden, which fires before a refresh or a tab close.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || this.blobDirty.size === 0) {
        return;
      }
      if (this.feedOperationInFlight) {
        console.log(
          '[GTFSParser] Page hidden with dirty blobs, but a feed operation is in flight: skipping the flush'
        );
        return;
      }
      console.log('[GTFSParser] Page hidden with dirty blobs, flushing');
      void this.persistDirtyBlobs();
    });
  }

  setPatchManager(pm: PatchManagerRef): void {
    this.patchManager = pm;
  }

  // ===== Blob-backed virtual table infrastructure =====

  /**
   * Register a virtual table handler over rows that are already indexed.
   * All mutations maintain the key index and any provided field-level Maps.
   * For stop_times and trips, the class fields the synchronous lookup paths
   * read are repointed at this index here.
   *
   * COPY-ON-READ INVARIANT: All query methods (getAll, getById, query) return
   * shallow copies of the stored rows, never live references. This prevents
   * silent aliasing bugs where a caller's "before" snapshot is mutated by a
   * later vt.update() call. Mutations (insert, update, delete, replace) still
   * operate on the internal objects directly: the copies are only for callers.
   *
   * SHARED-ARRAY INVARIANT: The `flat` array passed in is stored as a live
   * reference and is the same object as gtfsData[fileName].data. All in-memory
   * mutations MUST go through the virtual table methods (insert, update, delete,
   * clear). Direct pushes or splices on the array bypass the byId index and
   * fieldMaps, corrupting them silently.
   */
  private registerVirtual(
    tableName: string,
    flat: GTFSDatabaseRecord[],
    index: TableIndex
  ): void {
    const { byId, fieldMaps } = index;

    // Rebinding a table's rows invalidates anything memoized off them. Boot
    // reads the shape ids for the navbar badge before the feed is restored,
    // and an empty cached array is truthy, so without this the ids stay empty
    // for the whole session.
    if (tableName === 'shapes') {
      this.shapeIdsCache = null;
    }

    // The synchronous lookup paths read these directly, so they must point at
    // the maps this table was indexed with. Assigned here rather than in
    // createTableIndex so a hydration that never commits leaves the live
    // feed's indexes alone.
    if (tableName === 'stop_times') {
      this.stopTimesByTripId = fieldMaps.get('trip_id')!;
      this.stopTimesByStopId = fieldMaps.get('stop_id')!;
    } else if (tableName === 'trips') {
      this.tripsByRouteId = fieldMaps.get('route_id')!;
    }

    this.gtfsDatabase.registerVirtualTable(tableName, {
      getAll: () => flat.map((r) => ({ ...r })),

      getById: (key) => {
        const row = byId.get(key);
        return row ? { ...row } : undefined;
      },

      query: (filter) => {
        if (!filter || Object.keys(filter).length === 0) {
          return flat.map((r) => ({ ...r }));
        }
        // Use a fieldMap if available for the first filter key
        for (const [k, v] of Object.entries(filter)) {
          const map = fieldMaps.get(k);
          if (map) {
            const results = map.get(String(v)) ?? [];
            const rest = Object.entries(filter).filter(([kk]) => kk !== k);
            if (rest.length === 0) {
              return results.map((r) => ({ ...r }));
            }
            return results
              .filter((r) =>
                rest.every(
                  ([rk, rv]) => (r as Record<string, unknown>)[rk] === rv
                )
              )
              .map((r) => ({ ...r }));
          }
        }
        // Linear scan fallback (fine for small tables)
        return flat
          .filter((r) =>
            Object.entries(filter).every(
              ([k, v]) => (r as Record<string, unknown>)[k] === v
            )
          )
          .map((r) => ({ ...r }));
      },

      insert: (rows) => {
        for (const row of rows) {
          const key = generateCompositeKeyFromRecord(
            tableName,
            row as Record<string, unknown>
          );
          if (byId.has(key)) {
            continue; // deduplication: skip rows already present (e.g. replaying an insert patch whose row was already loaded from the blob)
          }
          flat.push(row);
          byId.add(key, row);
          for (const [field, map] of fieldMaps) {
            const val = String((row as Record<string, unknown>)[field] ?? '');
            addToBucket(map, val, row);
          }
        }
        this.invalidateBlobForTable(tableName);
      },

      update: (key, delta) => {
        const row = byId.get(key);
        if (!row) {
          console.warn(
            `[VirtualTable] update dropped: no row ${key} in ${tableName}`
          );
          return;
        }
        // Remove from old fieldMap buckets for any changed fields
        for (const [field, map] of fieldMaps) {
          if ((delta as Record<string, unknown>)[field] !== undefined) {
            const oldVal = String(
              (row as Record<string, unknown>)[field] ?? ''
            );
            removeFromBucket(map, oldVal, row);
          }
        }
        Object.assign(row, delta);
        // Re-add to fieldMap buckets and update byId key if it changed
        for (const [field, map] of fieldMaps) {
          if ((delta as Record<string, unknown>)[field] !== undefined) {
            const newVal = String(
              (row as Record<string, unknown>)[field] ?? ''
            );
            addToBucket(map, newVal, row);
          }
        }
        const newKey = generateCompositeKeyFromRecord(
          tableName,
          row as Record<string, unknown>
        );
        if (newKey !== key) {
          byId.remove(key, row);
          byId.add(newKey, row);
        }
        this.invalidateBlobForTable(tableName);
      },

      delete: (key) => {
        const row = byId.get(key);
        if (!row) {
          return;
        } // already removed by PatchManager
        byId.remove(key, row);
        const i = flat.indexOf(row);
        if (i !== -1) {
          flat.splice(i, 1);
        }
        for (const [field, map] of fieldMaps) {
          const val = String((row as Record<string, unknown>)[field] ?? '');
          removeFromBucket(map, val, row);
        }
        this.invalidateBlobForTable(tableName);
      },

      replace: (oldKeys, newRows) => {
        for (const k of oldKeys) {
          const row = byId.get(k);
          if (!row) {
            continue;
          }
          byId.remove(k, row);
          const i = flat.indexOf(row);
          if (i !== -1) {
            flat.splice(i, 1);
          }
          for (const [field, map] of fieldMaps) {
            const val = String((row as Record<string, unknown>)[field] ?? '');
            removeFromBucket(map, val, row);
          }
        }
        for (const row of newRows) {
          const key = generateCompositeKeyFromRecord(
            tableName,
            row as Record<string, unknown>
          );
          if (byId.has(key)) {
            continue;
          }
          flat.push(row);
          byId.add(key, row);
          for (const [field, map] of fieldMaps) {
            const val = String((row as Record<string, unknown>)[field] ?? '');
            addToBucket(map, val, row);
          }
        }
        this.invalidateBlobForTable(tableName);
      },

      clear: () => {
        flat.length = 0;
        byId.clear();
        for (const [, map] of fieldMaps) {
          map.clear();
        }
        this.invalidateBlobForTable(tableName);
      },
    });
  }

  /**
   * Empty lookup structures for one table, with a fieldMap per field that needs
   * an indexed query. The maps are fresh: nothing here touches live state, so a
   * hydration that is later discarded costs the loaded feed nothing.
   */
  private createTableIndex(tableName: string): TableIndex {
    // Only CSV tables get a virtual table. locations.geojson is one row holding
    // a whole FeatureCollection: a virtual table would intercept every db.*
    // call on it, so the rows never reach IndexedDB and the zones are lost on
    // reload. Throw rather than skip, so a caller that reintroduces this breaks
    // where the mistake is.
    if (GEOJSON_TABLES.has(tableName)) {
      throw new Error(
        `[GTFSParser] ${tableName} is a GeoJSON table and must not have a virtual table`
      );
    }

    const fieldMaps = new Map<string, Map<string, GTFSDatabaseRecord[]>>();

    if (tableName === 'stop_times') {
      fieldMaps.set('trip_id', new Map());
      fieldMaps.set('stop_id', new Map());
    } else if (tableName === 'trips') {
      fieldMaps.set('route_id', new Map());
      fieldMaps.set('service_id', new Map());
    } else if (tableName === 'stops') {
      // Without this, every queryRows('stops', { stop_id }) is a linear scan
      // that clones a matching row out of a 10,000-row table. The timetable
      // did one per stop on the route.
      fieldMaps.set('stop_id', new Map());
    } else if (tableName === 'agency') {
      fieldMaps.set('agency_id', new Map());
    } else if (tableName === 'routes') {
      fieldMaps.set('agency_id', new Map());
    }

    return { byId: new MapKeyIndex(), fieldMaps };
  }

  /**
   * Index one batch of rows into an existing table index.
   *
   * Called per hydrated chunk so the byId map and the fieldMaps are built in
   * the same yielding pass as the rows, rather than in one synchronous sweep
   * over the whole table afterwards.
   */
  private indexRowsInto(
    tableName: string,
    rows: GTFSDatabaseRecord[],
    index: TableIndex
  ): void {
    if (CONFIG.DEBUG_BOOT) {
      // Split the two halves so boot timing says which one to defer.
      const t0 = performance.now();
      for (const row of rows) {
        const key = generateCompositeKeyFromRecord(
          tableName,
          row as Record<string, unknown>
        );
        index.byId.add(key, row);
      }
      const t1 = performance.now();
      for (const row of rows) {
        for (const [field, map] of index.fieldMaps) {
          const val = String((row as Record<string, unknown>)[field] ?? '');
          addToBucket(map, val, row);
        }
      }
      const acc = this.debugIndexSplit.get(tableName) ?? { byId: 0, fields: 0 };
      acc.byId += t1 - t0;
      acc.fields += performance.now() - t1;
      this.debugIndexSplit.set(tableName, acc);
      return;
    }
    for (const row of rows) {
      const key = generateCompositeKeyFromRecord(
        tableName,
        row as Record<string, unknown>
      );
      index.byId.add(key, row);
      for (const [field, map] of index.fieldMaps) {
        const val = String((row as Record<string, unknown>)[field] ?? '');
        addToBucket(map, val, row);
      }
    }
  }

  /** Boot timing only: per-table byId vs fieldMaps cost, filled when DEBUG_BOOT. */
  private debugIndexSplit = new Map<string, { byId: number; fields: number }>();

  /**
   * Index a table's rows in one sweep and register its virtual table.
   * The incremental path (import and boot restore) indexes as it hydrates and
   * calls `registerVirtual` directly instead.
   */
  private setupVirtual(tableName: string, data: GTFSDatabaseRecord[]): void {
    const index = this.createTableIndex(tableName);
    this.indexRowsInto(tableName, data, index);
    this.registerVirtual(tableName, data, index);
  }

  /** Mark a table's blob as needing re-persistence and schedule a debounced flush. */
  invalidateBlobForTable(tableName: string): void {
    if (tableName === 'shapes') {
      this.shapeIdsCache = null;
    }
    this.blobDirty.add(tableName);
    if (this.blobPersistTimer) {
      clearTimeout(this.blobPersistTimer);
    }
    this.blobPersistTimer = setTimeout(() => {
      this.blobPersistTimer = null;
      void this.persistDirtyBlobs();
    }, 3000);
  }

  /**
   * Flush all dirty blobs to IDB immediately. Called before export and on demand.
   * If `version` is provided (or can be read from the current patchManager), records
   * it in meta.blobVersion so the next restore can skip snapshot+replay entirely.
   *
   * The dirty set and the version are both captured before the first await. An
   * edit landing mid-flush must stay dirty and must not be covered by the
   * blobVersion this run stamps: PatchManager skips snapshot+replay entirely
   * when blobVersion equals currentVersion, so a stamp that runs ahead of what
   * was actually written loses that edit on the next reload. Writing a blob
   * that is *ahead* of the stamped version is safe in the other direction,
   * because replaying a patch already reflected in memory is a no-op.
   *
   * Runs are serialized: two overlapping flushes would interleave their writes
   * and their version stamps.
   */
  async persistDirtyBlobs(version?: number): Promise<void> {
    const run = this.blobFlushChain.then(() => this.flushBlobsOnce(version));
    // Swallow here only so one failed flush does not poison the chain; the
    // caller still sees the rejection through `run`.
    this.blobFlushChain = run.catch(() => {});
    return run;
  }

  private blobFlushChain: Promise<void> = Promise.resolve();

  private async flushBlobsOnce(version?: number): Promise<void> {
    if (this.blobPersistTimer) {
      clearTimeout(this.blobPersistTimer);
      this.blobPersistTimer = null;
    }
    const pending = Array.from(this.blobDirty);
    this.blobDirty.clear();
    const v = version ?? this.patchManager?.version;
    const gen = await this.gtfsDatabase.getActiveFeedGen();

    for (let i = 0; i < pending.length; i++) {
      const tableName = pending[i];
      const fileName = `${tableName}.txt`;
      // Only CSV tables are blob-backed. A dirty mark on anything else means a
      // caller wrote through the wrong path; persisting `[]` for it would stamp
      // a blobVersion claiming a table was saved that was never read back.
      if (!this.gtfsData[fileName]) {
        console.warn(
          `[GTFSParser] Skipping blob flush for ${tableName}: no ${fileName} in memory`
        );
        continue;
      }
      const rows = this.gtfsData[fileName].data;
      try {
        // An emptied table is written as `[]` rather than skipped: skipping
        // leaves the pre-delete blob on disk and the rows come back on reload.
        await this.gtfsDatabase.putTableChunks(
          gen,
          tableName,
          serializeRowChunks(rows)
        );
      } catch (error) {
        // Re-mark every table this run has not written yet, not only the one
        // that threw: the tables queued behind it were cleared from the dirty
        // set and would never be retried. And do not stamp a version that
        // claims they were written.
        for (const unwritten of pending.slice(i)) {
          this.blobDirty.add(unwritten);
        }
        console.error(
          `[GTFSParser] Failed to persist ${tableName} blob:`,
          error
        );
        throw error;
      }
      // Serialization is synchronous, so a many-table flush is one long task
      // without this.
      await yieldToEventLoop();
    }

    // Record the version at which blobs were last fully flushed, together with
    // the summary describing those rows.
    const summary = this.computeFeedSummary(this.gtfsData, this.feedLabel);
    if (v !== undefined) {
      await this.gtfsDatabase.setBlobStamp(v, summary);
    } else {
      await this.gtfsDatabase.setFeedSummary(summary);
    }
    console.log(`[GTFSParser] feed summary written: ${summary.name}`);
  }

  /**
   * Describe a feed from its rows alone, so an import can compute the summary
   * for a pending feed and fold the write into its commit transaction.
   *
   * Recomputed on every flush rather than only on import, so an edited feed's
   * counts never drift from the rows the boot screen would restore.
   */
  private computeFeedSummary(
    data: { [fileName: string]: GTFSFileData },
    label: string
  ): FeedSummary {
    const rows = (fileName: string) => data[fileName]?.data ?? [];
    const firstValue = (fileName: string, field: string): string => {
      const value = rows(fileName)[0]?.[field];
      return typeof value === 'string' ? value.trim() : '';
    };
    return {
      name:
        firstValue('feed_info.txt', 'feed_publisher_name') ||
        firstValue('agency.txt', 'agency_name') ||
        label ||
        'Untitled feed',
      routes: rows('routes.txt').length,
      stops: rows('stops.txt').length,
      trips: rows('trips.txt').length,
      updatedAt: Date.now(),
    };
  }

  /**
   * Generate CSV text from an in-memory row array.
   *
   * Uses Papa.unparse so commas, double-quotes, and newlines in field values
   * are properly escaped. The header set is the union of keys across all
   * rows (not just rows[0]) so columns added later (e.g. when the UI
   * inserts a new stop with `location_type` set, but the original imported
   * CSV didn't have that column) survive the round-trip.
   *
   * `newline: '\n'` is not cosmetic. Papa.unparse defaults to `\r\n` between
   * rows, and the `+ '\n'` terminator here is a bare LF. Papa.parse then
   * autodetects `\r\n` from the body, so that final LF is not a row terminator
   * and gets absorbed into the last field of the last row: every export/import
   * round-trip appended a newline to one value per file.
   */
  private generateCSVFromRows(
    fileName: string,
    rows: GTFSDatabaseRecord[]
  ): string {
    if (rows.length === 0) {
      return makeHeaderOnlyCSV(fileName);
    }
    const fields = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        fields.add(key);
      }
    }
    return (
      Papa.unparse(
        {
          fields: Array.from(fields),
          data: rows,
        },
        { newline: '\n' }
      ) + '\n'
    );
  }

  /**
   * Fast stop_times lookup by stop_id via in-memory index (used by synchronous getRoutesForStop).
   * Returns shallow copies of the stored rows (copy-on-read invariant).
   */
  getStopTimesByStopId(stop_id: string): StopTimes[] {
    const indexed = this.stopTimesByStopId.get(stop_id);
    if (indexed) {
      return indexed.map((r) => ({ ...r }));
    }

    console.warn(
      '[GTFSParser] getStopTimesByStopId: index miss, falling back to linear scan'
    );
    return this.getFileDataSyncTyped(GTFS_TABLES.STOP_TIMES).filter(
      (st) => st.stop_id === stop_id
    );
  }

  /**
   * Fast stop_times lookup by trip_id via in-memory index (used by synchronous getStopIdsForRoute).
   * Returns shallow copies of the stored rows (copy-on-read invariant).
   */
  getStopTimesByTripId(trip_id: string): StopTimes[] {
    const indexed = this.stopTimesByTripId.get(trip_id);
    if (indexed) {
      return indexed.map((r) => ({ ...r }));
    }

    console.warn(
      '[GTFSParser] getStopTimesByTripId: index miss, falling back to linear scan'
    );
    return this.getFileDataSyncTyped(GTFS_TABLES.STOP_TIMES).filter(
      (st) => st.trip_id === trip_id
    );
  }

  /**
   * Fast trips lookup by route_id via in-memory index (used by the route-source
   * adapter). Returns shallow copies of the stored rows (copy-on-read invariant).
   */
  getTripsByRouteId(route_id: string): GTFSDatabaseRecord[] {
    const indexed = this.tripsByRouteId.get(route_id);
    if (indexed) {
      return indexed.map((r) => ({ ...r }));
    }

    console.warn(
      '[GTFSParser] getTripsByRouteId: index miss, falling back to linear scan'
    );
    return this.getFileDataSyncTyped(GTFS_TABLES.TRIPS).filter(
      (t) => String(t.route_id ?? '') === route_id
    );
  }

  /**
   * The distinct shape_ids in the feed, sorted.
   *
   * Callers only ever want the id set, and reading the shapes table to get it
   * copies every shape point (394,557 rows on the MBTA feed to derive 1,200
   * ids. Cached until a shapes edit invalidates it.
   */
  getShapeIds(): string[] {
    if (this.shapeIdsCache) {
      return this.shapeIdsCache;
    }
    const ids = new Set<string>();
    for (const row of this.getFileDataSyncTyped(GTFS_TABLES.SHAPES)) {
      if (row.shape_id) {
        ids.add(String(row.shape_id));
      }
    }
    this.shapeIdsCache = Array.from(ids).sort();
    return this.shapeIdsCache;
  }

  private shapeIdsCache: string[] | null = null;

  /**
   * Insert shapes.txt rows, guaranteeing `gtfsData['shapes.txt']` (and the
   * `shapeIdsCache` it feeds) stays in sync even if the shapes virtual table
   * were ever missing at write time.
   *
   * `GTFSDatabase.insertRows` normally routes through the virtual table
   * registered in `setupVirtual`, which keeps memory current as a side
   * effect. If that table is somehow unregistered, the write falls straight
   * through to IndexedDB and memory goes stale, which is exactly the bug
   * `getShapeIds()` (and the timetable's shape picker built on it) cannot
   * silently tolerate. Resync from the database rather than trust the
   * assumption.
   */
  async insertShapeRows(rows: GTFSDatabaseRecord[]): Promise<void> {
    const hadVirtualTable = this.gtfsDatabase.hasVirtualTable('shapes');
    await this.gtfsDatabase.insertRows('shapes', rows);
    if (!hadVirtualTable) {
      console.warn(
        '[GTFSParser] shapes virtual table missing at insert time; resyncing memory from IndexedDB'
      );
      await this.resyncShapesFromDatabase();
    }
    this.shapeIdsCache = null;
  }

  /** Delete shapes.txt rows by composite key. See `insertShapeRows` for why this resyncs defensively. */
  async deleteShapeRows(keys: string[]): Promise<void> {
    const hadVirtualTable = this.gtfsDatabase.hasVirtualTable('shapes');
    await this.gtfsDatabase.deleteRows('shapes', keys);
    if (!hadVirtualTable) {
      console.warn(
        '[GTFSParser] shapes virtual table missing at delete time; resyncing memory from IndexedDB'
      );
      await this.resyncShapesFromDatabase();
    }
    this.shapeIdsCache = null;
  }

  /** Re-reads shapes.txt from IndexedDB into memory and re-registers its virtual table. */
  private async resyncShapesFromDatabase(): Promise<void> {
    const rows = await this.gtfsDatabase.getAllRows('shapes');
    this.gtfsData['shapes.txt'] = { content: '', data: rows, errors: [] };
    this.setupVirtual('shapes', rows);
    // The rows reached memory without going through a virtual table, so
    // nothing has marked the blob dirty. Restore reads blobs, not rows.
    this.invalidateBlobForTable('shapes');
  }

  // ===== Feed replacement signal =====

  private feedListeners = new Set<() => void>();
  private generation = 0;

  /** Bumps on every whole-feed swap. Feed-scoped memos key on this. */
  get feedGeneration(): number {
    return this.generation;
  }

  /**
   * Subscribe to whole-feed swaps. There is no unsubscribe: the listeners are
   * the app's long-lived modules, registered once in `src/index.ts`.
   */
  onFeedReplaced(listener: () => void): void {
    this.feedListeners.add(listener);
  }

  /**
   * Announce that a different feed is now in memory.
   *
   * Called at the END of each lifecycle method, never at the start: the
   * contract listeners rely on is that the new rows are already in place when
   * this fires. Emitting from resetInMemoryFeedState() would hand every
   * listener the empty state and re-cache the same staleness this signal
   * exists to prevent.
   *
   * Every module is constructed and can read feed data before a feed exists,
   * so a cache guarded only by `if (this.cache)` pins the empty boot scaffold
   * for the whole session unless it keys on `feedGeneration` or subscribes here.
   *
   * `parseFile` and `initializeEmpty` call this themselves. The boot restore is
   * the one path the parser cannot close on its own: `restoreDataFromDatabase`
   * is only half of it, and the rows are not final until `PatchManager.initialize`
   * has replayed the patch log over them, so `GTFSEditor.restoreStoredFeed` calls
   * this once that pairing is complete. Do not add a third caller.
   */
  markFeedReplaced(): void {
    this.generation++;
    console.log(`[GTFSParser] feed replaced (generation ${this.generation})`);
    for (const listener of this.feedListeners) {
      try {
        listener();
      } catch (e) {
        // One bad listener must not strand the rest mid-swap.
        console.error('[GTFSParser] feed-replaced listener threw:', e);
      }
    }
  }

  /** Where the current feed came from: the last resort for its display name. */
  private feedLabel = '';

  /** Names the feed for the boot screen's continue card. */
  setFeedLabel(label: string): void {
    this.feedLabel = label;
  }

  /**
   * Open the database and scaffold every table as header-only and empty.
   *
   * Deliberately does not read any rows: boot decides whether the stored feed
   * is the one the user wants before paying for it, and calls
   * `restoreDataFromDatabase` only if so.
   */
  async initialize(): Promise<void> {
    await this.gtfsDatabase.initialize();

    // Invariant: all GTFS files are always in gtfsData from this point forward.
    this.gtfsData = createFeedScaffold();
    for (const filename of ALL_GTFS_FILES) {
      if (filename.endsWith('.txt')) {
        const tableName = this.getTableName(filename);
        this.setupVirtual(tableName, []);
      }
    }
  }

  /**
   * Turn a stream of serialized chunks into a feed, one chunk at a time.
   *
   * The single hydration path: an import consumes the chunks the worker posts
   * as it writes them, a boot restore consumes the chunks it reads back out of
   * IndexedDB, and both end up with the same structure. Each chunk is parsed,
   * appended and indexed, and the event loop is drained every
   * `HYDRATE_YIELD_ROWS` rows so the page keeps painting.
   *
   * Nothing here touches live state: the caller installs the result only once
   * the feed it belongs to has been committed.
   */
  private async hydrateFeed(
    chunks: AsyncIterable<HydrationChunk>
  ): Promise<HydratedFeed> {
    const data = createFeedScaffold();
    const indexes = new Map<string, TableIndex>();
    let rowsSinceYield = 0;
    // Boot timing: where the per-chunk work goes, accumulated per table.
    const spent = new Map<
      string,
      { rows: number; parse: number; append: number; index: number }
    >();
    let yieldMs = 0;

    for await (const { tableName, json } of chunks) {
      const entry = data[`${tableName}.txt`];
      if (!entry) {
        throw new Error(
          `[GTFSParser] hydration got an unknown table: ${tableName}`
        );
      }
      let index = indexes.get(tableName);
      if (!index) {
        index = this.createTableIndex(tableName);
        indexes.set(tableName, index);
      }

      const tParse = performance.now();
      const rows = JSON.parse(json) as GTFSDatabaseRecord[];
      const tAppend = performance.now();
      for (const row of rows) {
        entry.data.push(row);
      }
      const tIndex = performance.now();
      this.indexRowsInto(tableName, rows, index);

      if (CONFIG.DEBUG_BOOT) {
        const now = performance.now();
        let acc = spent.get(tableName);
        if (!acc) {
          acc = { rows: 0, parse: 0, append: 0, index: 0 };
          spent.set(tableName, acc);
        }
        acc.rows += rows.length;
        acc.parse += tAppend - tParse;
        acc.append += tIndex - tAppend;
        acc.index += now - tIndex;
      }

      rowsSinceYield += rows.length;
      if (rowsSinceYield >= CONFIG.HYDRATE_YIELD_ROWS) {
        rowsSinceYield = 0;
        const tYield = performance.now();
        await yieldToEventLoop();
        if (CONFIG.DEBUG_BOOT) {
          yieldMs += performance.now() - tYield;
        }
      }
    }

    if (CONFIG.DEBUG_BOOT) {
      for (const [table, acc] of [...spent].sort(
        (a, b) =>
          b[1].parse +
          b[1].append +
          b[1].index -
          (a[1].parse + a[1].append + a[1].index)
      )) {
        console.log(
          `[hydrate] ${table}: ${acc.rows} rows, parse ${Math.round(acc.parse)}ms, ` +
            `append ${Math.round(acc.append)}ms, index ${Math.round(acc.index)}ms`
        );
      }
      for (const [table, acc] of this.debugIndexSplit) {
        if (acc.byId + acc.fields >= 20) {
          console.log(
            `[hydrate] ${table} index split: byId ${Math.round(acc.byId)}ms, ` +
              `fieldMaps ${Math.round(acc.fields)}ms`
          );
        }
      }
      this.debugIndexSplit.clear();
      console.log(`[hydrate] yields: ${Math.round(yieldMs)}ms`);
    }

    // A populated table regenerates its CSV from the rows on demand, so its
    // cached content must be empty rather than the header-only scaffold that
    // getFileContent would return in preference to the rows.
    for (const fileData of Object.values(data)) {
      if (fileData.data.length > 0) {
        fileData.content = '';
      }
    }

    return { data, indexes };
  }

  /**
   * Run one feed-producing operation: an import or a boot restore.
   *
   * Both produce the feed the app will be looking at, so both get the same
   * shell: one operation at a time, a progress key nothing else can collide
   * with, a Cancel button, a watchdog the body re-arms on every sign of
   * progress, and a `finally` that always takes the bar down. The only thing
   * that differs is what produces the chunk stream inside.
   */
  private async runFeedOperation<T>(
    kind: 'load' | 'restore',
    initialStatus: string,
    body: (op: FeedOperation) => Promise<T>
  ): Promise<T> {
    if (this.feedOperationInFlight) {
      throw new Error(
        'Another feed is already loading. Wait for it to finish, or cancel it first.'
      );
    }
    this.feedOperationInFlight = true;

    const key = `${kind}:${++this.operationSeq}`;
    const abortHandlers: ((error: Error) => void)[] = [];
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let abortError: Error | null = null;

    const clearWatchdog = (): void => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    const op: FeedOperation = {
      key,
      fail: (error: Error): void => {
        // Idempotent: a cancel that lands while a watchdog is firing, or an
        // error from a worker that is already being torn down, must not run
        // the unwinding twice.
        if (abortError) {
          return;
        }
        abortError = error;
        clearWatchdog();
        for (const handler of abortHandlers) {
          handler(error);
        }
      },
      throwIfAborted: (): void => {
        if (abortError) {
          throw abortError;
        }
      },
      // Work can die without throwing (an OOM-killed worker is the case that
      // matters), which leaves the operation pending and the bar up forever.
      // Every sign of progress resets the deadline; silence past it fails it.
      armWatchdog: (): void => {
        clearWatchdog();
        watchdog = setTimeout(() => {
          watchdog = null;
          op.fail(
            new Error(
              `The feed loader stopped responding (no progress for ${Math.round(CONFIG.LOAD_WATCHDOG_MS / 1000)}s). The feed may be too large for this browser.`
            )
          );
        }, CONFIG.LOAD_WATCHDOG_MS);
      },
      clearWatchdog,
      onAbort: (handler: (error: Error) => void): void => {
        abortHandlers.push(handler);
      },
    };

    console.time(`[GTFS] ${key}`);
    feedProgressIndicator.startLoading(key, initialStatus, {
      onCancel: () => op.fail(new LoadCancelledError()),
    });
    try {
      return await body(op);
    } finally {
      clearWatchdog();
      this.feedOperationInFlight = false;
      feedProgressIndicator.finishLoading(key);
      console.timeEnd(`[GTFS] ${key}`);
    }
  }

  /**
   * Read a stored generation's chunks back out of IndexedDB, one at a time.
   *
   * Sequential and lazy on purpose: the hydration parses and drops each JSON
   * string before the next is read, so a 200 MB table is never held twice.
   */
  private async *readStoredChunks(
    gen: number,
    counts: Map<string, number>,
    op: FeedOperation
  ): AsyncGenerator<HydrationChunk> {
    const totalChunks = [...counts.values()].reduce((sum, n) => sum + n, 0);
    let read = 0;
    // Boot timing: how much of the restore is waiting on IndexedDB itself.
    let idbMs = 0;
    let bytes = 0;
    for (const [tableName, count] of counts) {
      for (let chunk = 0; chunk < count; chunk++) {
        // A cancel or a watchdog fire unwinds the hydration here, at the one
        // point of the restore that runs often enough to be responsive.
        op.throwIfAborted();
        const tRead = performance.now();
        const json = await this.gtfsDatabase.getBlobChunk(
          gen,
          tableName,
          chunk
        );
        if (CONFIG.DEBUG_BOOT) {
          idbMs += performance.now() - tRead;
          bytes += json?.length ?? 0;
        }
        if (json === undefined) {
          throw new Error(
            `[GTFSParser] stored feed is missing ${tableName} chunk ${chunk} of generation ${gen}`
          );
        }
        read++;
        op.armWatchdog();
        // 5-90: the same span the import gives its producer, so the bar does
        // not jump to 100 with the index build and the map still to come.
        feedProgressIndicator.updateProgress(
          op.key,
          5 + (read / totalChunks) * 85,
          `Restoring ${tableName}...`
        );
        yield { tableName, json };
      }
    }
    if (CONFIG.DEBUG_BOOT) {
      console.log(
        `[hydrate] idb read: ${Math.round(idbMs)}ms for ${read} chunk(s), ` +
          `${(bytes / 1e6).toFixed(1)}MB of JSON text`
      );
    }
  }

  /**
   * Restore the stored feed from the active generation's blob chunks.
   *
   * Returns false when that generation holds no table at all, which is the one
   * "nothing stored" case; every other failure throws, because a half-restored
   * feed that the caller then replays the patch log over is exactly how a feed
   * gets corrupted.
   */
  async restoreDataFromDatabase(): Promise<boolean> {
    return this.runFeedOperation('restore', 'Opening stored feed...', (op) =>
      this.restoreActiveGeneration(op)
    );
  }

  private async restoreActiveGeneration(op: FeedOperation): Promise<boolean> {
    op.armWatchdog();
    const gen = await this.gtfsDatabase.getActiveFeedGen();

    // A table written as empty still has one `[]` chunk, so a table with no
    // chunks at all was never written and keeps its header-only scaffold.
    const counts = await this.gtfsDatabase.listBlobChunkCounts(gen);
    if (counts.size === 0) {
      console.log(`[GTFSParser] No stored feed under generation ${gen}`);
      return false;
    }
    op.throwIfAborted();
    feedProgressIndicator.updateProgress(op.key, 5, 'Reading stored feed...');

    const tHydrate = performance.now();
    const { data, indexes } = await this.hydrateFeed(
      this.readStoredChunks(gen, counts, op)
    );
    const tGeojson = performance.now();

    // GeoJSON tables are per-row IDB reads (they're tiny) and get no chunks.
    for (const fileName of ALL_GTFS_FILES.filter((f) =>
      f.endsWith('.geojson')
    )) {
      const rows = await this.gtfsDatabase.getAllRows(
        this.getTableName(fileName)
      );
      if (rows.length > 0) {
        data[fileName] = { content: '', data: rows, errors: [] };
      }
    }

    // Last chance to bail: installFeed swaps the rows into live memory, and
    // from there a cancel would leave a half-adopted feed behind.
    op.throwIfAborted();
    op.clearWatchdog();
    const tInstall = performance.now();
    feedProgressIndicator.updateProgress(op.key, 92, 'Building indexes...');
    this.installFeed(data, indexes);

    const tPassthrough = performance.now();
    feedProgressIndicator.updateProgress(op.key, 96, 'Restoring files...');
    const ptFiles = await this.gtfsDatabase.getAllPassthroughFiles(gen);
    for (const [fileName, rawContent] of Object.entries(ptFiles)) {
      this.passthroughFiles.set(fileName, rawContent);
    }
    if (this.passthroughFiles.size > 0) {
      console.log(
        `[GTFSParser] Restored ${this.passthroughFiles.size} passthrough file(s)`
      );
    }

    for (const [tableName, count] of counts) {
      const rows = data[`${tableName}.txt`]?.data.length ?? 0;
      if (rows > 0) {
        console.log(
          `[GTFSParser] Restored ${tableName} from blob: ${rows} rows in ${count} chunk(s)`
        );
      }
    }
    if (CONFIG.DEBUG_BOOT) {
      console.log(
        `[hydrate] phases: hydrate ${Math.round(tGeojson - tHydrate)}ms, ` +
          `geojson ${Math.round(tInstall - tGeojson)}ms, ` +
          `install ${Math.round(tPassthrough - tInstall)}ms, ` +
          `passthrough+summary ${Math.round(performance.now() - tPassthrough)}ms`
      );
    }
    feedProgressIndicator.updateProgress(op.key, 100, 'Complete!');
    return true;
  }

  /**
   * Reset all in-memory feed state, immediately before a new feed is installed.
   *
   * Cancels any pending debounced blob write first: a write scheduled by an edit
   * to the *previous* feed would otherwise fire after the generation pointer has
   * moved and re-write the old feed's rows under the new generation (it reads
   * gtfsData, which at that point still holds the old rows).
   */
  private resetInMemoryFeedState(): void {
    if (this.blobPersistTimer) {
      clearTimeout(this.blobPersistTimer);
      this.blobPersistTimer = null;
    }
    this.blobDirty.clear();
    this.stopTimesByStopId.clear();
    this.stopTimesByTripId.clear();
    this.tripsByRouteId.clear();
    this.shapeIdsCache = null;
    this.passthroughFiles.clear();
    this.gtfsData = {};
    this.patchManager?.resetState?.();
  }

  /**
   * Persist a pending feed's CSV tables under one generation.
   */
  private async writeFeedBlobs(
    gen: number,
    data: { [fileName: string]: GTFSFileData }
  ): Promise<void> {
    for (const [fileName, fileData] of Object.entries(data)) {
      if (!fileName.endsWith('.txt')) {
        continue;
      }
      await this.gtfsDatabase.putTableChunks(
        gen,
        this.getTableName(fileName),
        serializeRowChunks(fileData.data)
      );
      await yieldToEventLoop();
    }
  }

  /**
   * Swap a committed feed into live memory.
   *
   * Called only after `commitFeedGeneration` has succeeded: everything before
   * that point must be reachable by a rollback that leaves the old feed intact.
   */
  private installFeed(
    data: { [fileName: string]: GTFSFileData },
    indexes?: Map<string, TableIndex>
  ): void {
    this.resetInMemoryFeedState();
    this.gtfsData = data;
    this.gtfsDatabase.clearVirtualTables();
    for (const [fileName, fileData] of Object.entries(data)) {
      if (!fileName.endsWith('.txt')) {
        continue;
      }
      const tableName = this.getTableName(fileName);
      // The virtual table holds the same array as gtfsData[fileName].data. If
      // they diverge, persistDirtyBlobs reads a stale array and edits are lost.
      const index = indexes?.get(tableName);
      if (index) {
        // Hydration already indexed these rows as they arrived; re-sweeping a
        // 4.5M-row table here is the freeze this path exists to avoid.
        this.registerVirtual(tableName, fileData.data, index);
      } else {
        this.setupVirtual(tableName, fileData.data);
      }
    }
  }

  /**
   * Retire the generation the previous feed lived in.
   *
   * Best-effort by design: the pointer has already moved, so a failure here
   * costs disk space and nothing else, and the boot sweep collects it later.
   */
  private retireGeneration(gen: number): void {
    void this.gtfsDatabase
      .deleteGeneration(gen)
      .catch((error: unknown) =>
        console.error(
          `[GTFSParser] Failed to retire feed generation ${gen}:`,
          error
        )
      );
  }

  /**
   * Discard a staged generation after a failed or cancelled import.
   */
  private async discardStagingGeneration(gen: number): Promise<void> {
    try {
      await this.gtfsDatabase.deleteGeneration(gen);
    } catch (error) {
      console.error(
        `[GTFSParser] Failed to discard staging generation ${gen}:`,
        error
      );
    }
  }

  async initializeEmpty(): Promise<void> {
    const activeGen = await this.gtfsDatabase.getActiveFeedGen();
    const stagingGen = activeGen + 1;
    const previousLabel = this.feedLabel;

    try {
      const pendingFeed: { [fileName: string]: GTFSFileData } = {};
      for (const filename of ALL_GTFS_FILES) {
        pendingFeed[filename] = {
          content: makeHeaderOnlyCSV(filename),
          data: [],
          errors: [],
        };
      }

      // Seed feed_info with a row whose keys match the schema so vt.update can
      // find it. Without a row, every field edit silently does nothing (the
      // virtual table update handler returns early when byId has no entry), and
      // on reload the patch replay has nothing to land on.
      pendingFeed['feed_info.txt'].data.push(
        Object.fromEntries(
          getFileHeaders('feed_info.txt').map((h) => [h, ''])
        ) as GTFSDatabaseRecord
      );

      this.feedLabel = 'New feed';
      await this.writeFeedBlobs(stagingGen, pendingFeed);
      // A fresh feed has no patches, so its blobs are current at version 0.
      await this.gtfsDatabase.commitFeedGeneration(stagingGen, {
        blobVersion: 0,
        networksMode: 'inline',
        feedSummary: this.computeFeedSummary(pendingFeed, this.feedLabel),
        locationsRow: null,
      });

      this.installFeed(pendingFeed);
      this.markFeedReplaced();
      this.retireGeneration(activeGen);
    } catch (error) {
      this.feedLabel = previousLabel;
      await this.discardStagingGeneration(stagingGen);
      console.error('[GTFSParser] Failed to create an empty feed:', error);
      throw error;
    }
  }

  /**
   * Run one whole import: worker-side download/unzip/parse/write, main-thread
   * hydration, then an atomic commit.
   *
   * The import stages under the next generation and only flips the pointer once
   * every row is written. Until then the live feed is untouched, so any throw
   * below rolls back to it by doing nothing to it.
   */
  private async importFeed(
    source: ImportSource,
    transfer: Transferable[],
    label: string
  ): Promise<{
    data: { [fileName: string]: GTFSFileData };
    unknownFiles: string[];
  }> {
    return this.runFeedOperation('load', 'Preparing...', (op) =>
      this.runImport(op, source, transfer, label)
    );
  }

  private async runImport(
    op: FeedOperation,
    source: ImportSource,
    transfer: Transferable[],
    label: string
  ): Promise<{
    data: { [fileName: string]: GTFSFileData };
    unknownFiles: string[];
  }> {
    const operation = op.key;
    const previousLabel = this.feedLabel;
    const activeGen = await this.gtfsDatabase.getActiveFeedGen();
    const stagingGen = activeGen + 1;
    let worker: Worker | null = null;

    try {
      this.feedLabel = label;

      // Settle the outgoing feed's pending edits before staging begins. They
      // belong to the generation being replaced, and a debounced flush that
      // fired after the commit would write the old rows under the new one.
      if (this.blobDirty.size > 0) {
        await this.persistDirtyBlobs();
      }

      // An import that died between its staging writes and its commit can have
      // left records under this generation. The worker writes chunk by chunk
      // rather than replacing a table wholesale, so clear the generation before
      // it starts instead of reading the leftovers back.
      await this.gtfsDatabase.deleteGeneration(stagingGen);
      // A cancel during the flush and the sweep above lands here: nothing has
      // been staged and the worker does not exist yet.
      op.throwIfAborted();

      const chunks = new ChunkQueue();

      worker = new Worker(
        new URL('../workers/gtfs-parser.worker.ts', import.meta.url),
        { type: 'module' }
      );
      const activeWorker = worker;

      // Set once the import has failed or been cancelled, so a prompt the user
      // answers afterwards cannot restart a terminated worker's watchdog.
      let aborted = false;
      let closeLargeFeedPrompt: (() => void) | null = null;

      // Nothing here touches live state: gtfsData, the virtual tables and the
      // active generation stay as they are until the commit below succeeds.
      const done = new Promise<WorkerDoneMessage>((resolve, reject) => {
        op.onAbort((error) => {
          aborted = true;
          closeLargeFeedPrompt?.();
          closeLargeFeedPrompt = null;
          activeWorker.terminate();
          // Both halves have to unwind: the hydration is waiting on the queue
          // and would otherwise never settle.
          chunks.fail(error);
          reject(error);
        });
        activeWorker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
          const msg = event.data;
          op.armWatchdog();
          if (msg.type === 'progress') {
            feedProgressIndicator.updateProgress(
              operation,
              msg.progress,
              msg.status
            );
          } else if (msg.type === 'oversize') {
            // The worker is parked before its first inflation. No deadline
            // while the prompt is open: the user takes as long as they take.
            op.clearWatchdog();
            feedProgressIndicator.updateProgress(
              operation,
              25,
              'Waiting for confirmation...'
            );
            void confirmLargeFeed(label, msg, (close) => {
              closeLargeFeedPrompt = close;
            }).then((accept) => {
              closeLargeFeedPrompt = null;
              if (aborted) {
                return;
              }
              if (!accept) {
                op.fail(new LoadCancelledError());
                return;
              }
              op.armWatchdog();
              activeWorker.postMessage({ type: 'proceed' });
            });
          } else if (msg.type === 'chunk') {
            chunks.push({ tableName: msg.tableName, json: msg.json });
          } else if (msg.type === 'done') {
            op.clearWatchdog();
            activeWorker.terminate();
            chunks.end();
            resolve(msg);
          } else if (msg.type === 'error') {
            op.fail(new Error(msg.message));
          }
        };
        activeWorker.onerror = (err) => {
          op.fail(new Error(err.message));
        };
      });

      feedProgressIndicator.updateProgress(
        operation,
        0,
        source.kind === 'url' ? 'Downloading feed...' : 'Reading file...'
      );
      op.armWatchdog();
      activeWorker.postMessage(
        {
          type: 'parse',
          gen: stagingGen,
          chunkRows: CONFIG.BLOB_CHUNK_ROWS,
          source,
        },
        transfer
      );

      // Hydration runs alongside the worker, consuming each chunk as it lands
      // and yielding between them. Nothing it builds touches live state.
      const [{ data: pendingFeed, indexes }, result] = await Promise.all([
        this.hydrateFeed(chunks),
        done,
      ]);

      // A GeoJSON file is one row holding a whole FeatureCollection. It gets no
      // blob chunks and no virtual table: it swaps inside the commit instead.
      for (const [fileName, rawContent] of Object.entries(
        result.locationsJson
      )) {
        pendingFeed[fileName] = {
          content: rawContent,
          data: [JSON.parse(rawContent) as GTFSDatabaseRecord],
          errors: [],
        };
      }
      for (const [fileName, errors] of Object.entries(result.tableErrors)) {
        if (pendingFeed[fileName]) {
          pendingFeed[fileName].errors = errors;
        }
      }

      // The worker's counts are what reached IndexedDB. A mismatch means a
      // chunk message was lost, which would commit a feed whose blobs and
      // memory disagree, so fail before the pointer moves.
      for (const [tableName, expected] of Object.entries(result.tableCounts)) {
        const hydrated = pendingFeed[`${tableName}.txt`]?.data.length ?? -1;
        if (hydrated !== expected) {
          throw new Error(
            `[GTFSParser] hydration lost rows for ${tableName}: wrote ${expected}, hydrated ${hydrated}`
          );
        }
      }

      const networksMode = this.normalizeNetworks(pendingFeed);
      // normalizeNetworks appends rows the hydration never saw, so their
      // incremental indexes are stale. Both tables are small: drop them and let
      // installFeed rebuild in one sweep.
      indexes.delete(this.getTableName(GTFS_TABLES.NETWORKS));
      indexes.delete(this.getTableName(GTFS_TABLES.ROUTE_NETWORKS));

      feedProgressIndicator.updateProgress(operation, 95, 'Saving feed...');
      // normalizeNetworks appends synthesized rows after the worker has already
      // written both tables, so their chunks are rewritten from the pending rows.
      for (const fileName of [
        GTFS_TABLES.NETWORKS,
        GTFS_TABLES.ROUTE_NETWORKS,
      ]) {
        await this.gtfsDatabase.putTableChunks(
          stagingGen,
          this.getTableName(fileName),
          serializeRowChunks(pendingFeed[fileName].data)
        );
      }
      if (Object.keys(result.passthroughFiles).length > 0) {
        await this.gtfsDatabase.savePassthroughFiles(
          stagingGen,
          result.passthroughFiles
        );
      }

      // A file the ZIP did not carry has no row to store. Committing a
      // placeholder would make an empty collection indistinguishable from one
      // the feed actually shipped.
      const locationsRow =
        pendingFeed[GTFS_TABLES.LOCATIONS_GEOJSON]?.data[0] ?? null;

      // A fresh import has no patches yet: its blobs are current at version 0.
      await this.gtfsDatabase.commitFeedGeneration(stagingGen, {
        blobVersion: 0,
        networksMode,
        feedSummary: this.computeFeedSummary(pendingFeed, this.feedLabel),
        locationsRow,
      });

      // Past the point of no return: the new feed is the stored feed.
      this.installFeed(pendingFeed, indexes);
      for (const [name, rawContent] of Object.entries(
        result.passthroughFiles
      )) {
        this.passthroughFiles.set(name, rawContent);
      }
      this.markFeedReplaced();
      this.retireGeneration(activeGen);

      feedProgressIndicator.updateProgress(operation, 100, 'Complete!');

      console.log('Loaded GTFS data to IndexedDB and memory:', this.gtfsData);
      return { data: this.gtfsData, unknownFiles: result.unknownFiles };
    } catch (error) {
      if (!(error instanceof LoadCancelledError)) {
        console.error('Error loading GTFS feed:', error);
      }
      this.feedLabel = previousLabel;
      await this.discardStagingGeneration(stagingGen);
      throw error;
    } finally {
      // Terminating twice is harmless; this covers the paths that threw before
      // or after the worker resolved its own promise.
      worker?.terminate();
    }
  }

  async parseFile(file: File | Blob): Promise<{
    data: { [fileName: string]: GTFSFileData };
    unknownFiles: string[];
  }> {
    const fileName = (file as File).name ?? '';
    console.log('Loading GTFS file:', fileName || 'blob');
    // Read here rather than in the worker: a File handle is transferable only
    // as its bytes, and this is the one main-thread read the import still does.
    const buffer = await file.arrayBuffer();
    return this.importFeed(
      { kind: 'buffer', buffer },
      [buffer],
      fileName ? fileName.replace(/\.zip$/i, '') : this.feedLabel
    );
  }

  /**
   * Collapse the two on-disk forms of network membership into one in-memory model.
   *
   * GTFS lets a feed name its networks either in `networks.txt` +
   * `route_networks.txt` or in a `routes.network_id` column, and forbids both at
   * once. The app always works from the two tables, so a feed that arrived in
   * the inline form is expanded into them here. The form it arrived in is
   * remembered so an unedited feed exports the way it came in.
   *
   * These are derived import state, not user edits, so they are written
   * directly rather than recorded as patches.
   *
   * Pure in the rows it touches: it appends into the pending feed's own arrays
   * and returns the mode instead of writing through virtual tables, so it can
   * run before the feed is live and its mode write can fold into the commit.
   */
  private normalizeNetworks(data: {
    [fileName: string]: GTFSFileData;
  }): NetworksMode {
    // Rows are appended in place, so a missing entry would silently swallow the
    // synthesized networks instead of expanding the feed's inline form.
    const rowsOf = (fileName: string): GTFSDatabaseRecord[] => {
      const entry = data[fileName];
      if (!entry) {
        throw new Error(`[Networks] pending feed has no ${fileName}`);
      }
      return entry.data;
    };
    const networks = rowsOf(GTFS_TABLES.NETWORKS);
    const routeNetworks = rowsOf(GTFS_TABLES.ROUTE_NETWORKS);
    const routes = rowsOf(GTFS_TABLES.ROUTES);

    if (networks.length > 0 || routeNetworks.length > 0) {
      console.log(
        `[Networks] feed uses networks.txt / route_networks.txt: ${networks.length} network(s), ${routeNetworks.length} assignment(s)`
      );

      // route_networks may name a network that networks.txt never defined.
      // The canonical model needs a row for it, or it is invisible everywhere.
      const defined = new Set(
        networks
          .map((n) => String(n.network_id ?? ''))
          .filter((id) => id !== '')
      );
      const undefinedIds = new Set<string>();
      for (const row of routeNetworks) {
        const id = String(row.network_id ?? '');
        if (id !== '' && !defined.has(id)) {
          undefinedIds.add(id);
        }
      }
      if (undefinedIds.size > 0) {
        console.warn(
          `[Networks] ${undefinedIds.size} network(s) referenced by route_networks.txt are missing from networks.txt, synthesizing them`
        );
        networks.push(
          ...[...undefinedIds].map((id) => ({
            network_id: id,
            network_name: '',
          }))
        );
      }

      const ignored = routes.filter(
        (r) => String(r.network_id ?? '').trim() !== ''
      ).length;
      if (ignored > 0) {
        console.warn(
          `[Networks] ignoring routes.network_id on ${ignored} route(s): the feed also defines networks in its own files`
        );
        notify.warning(
          `This feed defines networks in networks.txt or route_networks.txt and also sets network_id on ${ignored} route${ignored === 1 ? '' : 's'} in routes.txt. GTFS forbids both, so the routes.network_id values are ignored and will not be exported.`,
          { duration: 12000 }
        );
      }

      return 'files';
    }

    const ids = new Set<string>();
    const assignments: GTFSDatabaseRecord[] = [];
    for (const route of routes) {
      const networkId = String(route.network_id ?? '').trim();
      const routeId = String(route.route_id ?? '');
      if (networkId === '' || routeId === '') {
        continue;
      }
      ids.add(networkId);
      assignments.push({ network_id: networkId, route_id: routeId });
    }

    if (ids.size > 0) {
      console.log(
        `[Networks] expanding routes.network_id into ${ids.size} network(s) and ${assignments.length} assignment(s)`
      );
      networks.push(
        ...[...ids].map((id) => ({ network_id: id, network_name: '' }))
      );
      routeNetworks.push(...assignments);
    } else {
      console.log('[Networks] feed defines no networks');
    }

    return 'inline';
  }

  private getTableName(fileName: string): string {
    return fileName.replace('.txt', '').replace('.geojson', '');
  }

  async parseFromURL(rawUrl: string): Promise<{ unknownFiles: string[] }> {
    // `…/outer.zip#inner.zip` names a feed nested inside another archive (SEPTA
    // ships google_bus.zip and google_rail.zip in one release asset). The
    // fragment is never sent to the server, so it is stripped before fetching
    // and replayed as a descent once the outer archive is in hand. Both happen
    // in the worker: the main thread does no feed I/O.
    const { url, innerPaths } = splitInnerZipPath(rawUrl);
    console.log('[GTFSParser] Fetching GTFS from URL:', url, innerPaths);
    const label =
      url
        .split('/')
        .pop()
        ?.replace(/\.zip$/i, '') || url;
    const { unknownFiles } = await this.importFeed(
      { kind: 'url', url, innerPaths },
      [],
      label
    );
    return { unknownFiles };
  }

  async updateFileContent(fileName: string, content: string): Promise<void> {
    if (this.gtfsData[fileName]) {
      this.gtfsData[fileName].content = content;

      // Re-parse CSV if it's a text file
      if (fileName.endsWith('.txt')) {
        const parsed = Papa.parse(content, {
          header: true,
          skipEmptyLines: true,
        });
        const rows = processParsedData<GTFSDatabaseRecord>(
          parsed.data as Record<string, unknown>[]
        );
        this.gtfsData[fileName].data = rows;
        this.gtfsData[fileName].errors = parsed.errors;

        const tableName = this.getTableName(fileName);
        this.setupVirtual(tableName, rows);
        this.invalidateBlobForTable(tableName);
      } else if (fileName.endsWith('.geojson')) {
        // Handle GeoJSON updates
        this.gtfsData[fileName].data = JSON.parse(content);

        const tableName = this.getTableName(fileName);
        // Clear and re-insert GeoJSON data
        await this.gtfsDatabase.clearTable(tableName);

        const geoJsonData = JSON.parse(content);
        await this.gtfsDatabase.insertRows(tableName, [
          geoJsonData as GTFSDatabaseRecord,
        ]);
      }
    }
  }

  getFileContent(fileName: string): string {
    const fileData = this.gtfsData[fileName];
    if (!fileData) {
      return '';
    }

    // Return cached content if present
    if (fileData.content) {
      return fileData.content;
    }

    // Generate CSV from in-memory rows and cache it
    if (fileData.data.length > 0) {
      fileData.content = this.generateCSVFromRows(fileName, fileData.data);
      return fileData.content;
    }

    return fileData.content; // header-only CSV set by initialize()
  }

  // Method expected by Editor interface
  updateFileInMemory(fileName: string, content: string): void {
    if (this.gtfsData[fileName]) {
      this.gtfsData[fileName].content = content;

      // Re-parse CSV if it's a text file
      if (fileName.endsWith('.txt')) {
        const parsed = Papa.parse(content, {
          header: true,
          skipEmptyLines: true,
        });
        const data = processParsedData<GTFSDatabaseRecord>(
          parsed.data as Record<string, unknown>[]
        );
        this.gtfsData[fileName].data = data;
        this.gtfsData[fileName].errors = parsed.errors;
        const tableName = this.getTableName(fileName);
        this.setupVirtual(tableName, data);
        this.invalidateBlobForTable(tableName);
      }
    }
  }

  // Method expected by Editor interface
  async refreshRelatedTables(fileName: string): Promise<void> {
    // This could trigger relationship validation or cache refresh
    // For now, just update the database
    await this.updateFileContent(fileName, this.getFileContent(fileName));
  }

  async getFileData(fileName: string): Promise<GTFSDatabaseRecord[] | null> {
    // Try to get from IndexedDB first
    try {
      const tableName = this.getTableName(fileName);
      const rows = await this.gtfsDatabase.getAllRows(tableName);
      if (rows.length > 0) {
        return rows;
      }
    } catch (error) {
      console.warn(
        `Failed to get data from IndexedDB for ${fileName}, falling back to memory:`,
        error
      );
    }

    // Fallback to memory
    return this.gtfsData[fileName]?.data || null;
  }

  // Type-safe async file data retrieval
  async getFileDataTyped<T extends GTFSTableName>(
    fileName: `${T}.txt`
  ): Promise<GTFSTableMap[T][] | null> {
    const data = await this.getFileData(fileName);
    return data as GTFSTableMap[T][] | null;
  }

  // Synchronous version for backward compatibility (will use memory data)
  getFileDataSync(fileName: string): GTFSDatabaseRecord[] {
    return this.gtfsData[fileName]?.data ?? [];
  }

  // Directly replace the in-memory data array for a file (used by PatchManager)
  setInMemoryFileData(fileName: string, data: GTFSDatabaseRecord[]): void {
    if (!this.gtfsData[fileName]) {
      this.gtfsData[fileName] = { content: '', data: [], errors: [] };
    }
    this.gtfsData[fileName].data = data;
    this.gtfsData[fileName].content = '';
    const tableName = this.getTableName(fileName);
    if (fileName.endsWith('.txt')) {
      this.setupVirtual(tableName, data);
      this.invalidateBlobForTable(tableName);
    }
  }

  // Type-safe synchronous file data retrieval
  getFileDataSyncTyped<T extends GTFSTableName>(
    fileName: `${T}.txt`
  ): GTFSTableMap[T][];
  getFileDataSyncTyped<T>(fileName: string): T[];
  getFileDataSyncTyped<T>(fileName: string): T[] {
    return this.getFileDataSync(fileName) as T[];
  }

  getAllFileNames(): string[] {
    return Object.keys(this.gtfsData);
  }

  /**
   * Bucket the feed's files for the Files modal.
   *
   * Optional is the inverse of required rather than an explicit presence list:
   * the spec uses five presence values, and testing only for Optional and
   * Conditionally Required dropped Conditionally Forbidden files (networks.txt,
   * route_networks.txt) into the wrong bucket. `additional` is the non-spec
   * passthrough files, which are the only files that genuinely have no schema.
   */
  categorizeFiles(): {
    required: string[];
    optional: string[];
    additional: string[];
  } {
    const allFiles = this.getAllFileNames();
    const requiredFiles = GTFS_FILES.filter(
      (f) => f.presence === 'Required'
    ).map((f) => f.filename);

    return {
      required: allFiles.filter((f) => requiredFiles.includes(f)),
      optional: allFiles.filter(
        (f) => !requiredFiles.includes(f) && ALL_GTFS_FILES.includes(f)
      ),
      additional: this.getPassthroughFileNames(),
    };
  }

  getPassthroughFileNames(): string[] {
    return Array.from(this.passthroughFiles.keys());
  }

  getPassthroughContent(fileName: string): string | undefined {
    return this.passthroughFiles.get(fileName);
  }

  /**
   * Write a non-spec file back verbatim.
   *
   * These files have no table, no primary key and no schema, so there is
   * nothing for the patch system to describe: this is the one write path that
   * deliberately skips it, and edits here are not undoable.
   */
  async setPassthroughContent(
    fileName: string,
    rawContent: string
  ): Promise<void> {
    this.passthroughFiles.set(fileName, rawContent);
    await this.gtfsDatabase.savePassthroughFiles(
      await this.gtfsDatabase.getActiveFeedGen(),
      { [fileName]: rawContent }
    );
    console.log(
      '[GTFSParser] passthrough file edited (not patched):',
      fileName
    );
  }

  /**
   * Decide which of the two network forms this export writes.
   *
   * Naming a network is the thing that forces the files form: a name has
   * nowhere to live in a `routes.network_id` column. Otherwise a feed that
   * arrived as files goes back out as files, and everything else takes the
   * lighter inline form.
   */
  private async resolveNetworksExport(): Promise<{
    useFiles: boolean;
    networkByRoute: Map<string, string>;
  }> {
    const networks = await this.gtfsDatabase.getAllRows('networks');
    const routeNetworks = await this.gtfsDatabase.getAllRows('route_networks');
    const anyNamed = networks.some(
      (n) => String(n.network_name ?? '').trim() !== ''
    );
    const mode = await this.gtfsDatabase.getNetworksMode();
    const useFiles = anyNamed || mode === 'files';

    const networkByRoute = new Map<string, string>();
    for (const row of routeNetworks) {
      const routeId = String(row.route_id ?? '');
      const networkId = String(row.network_id ?? '');
      if (routeId !== '' && networkId !== '') {
        networkByRoute.set(routeId, networkId);
      }
    }

    console.log(
      `[Networks] exporting as ${useFiles ? 'networks.txt + route_networks.txt' : 'routes.network_id'} (mode ${mode}, ${anyNamed ? 'named' : 'unnamed'})`
    );
    return { useFiles, networkByRoute };
  }

  /**
   * Rewrite `routes.network_id` from the canonical tables, or strip it.
   *
   * The stored column is never read after import, so exporting it verbatim
   * would ship whatever the feed arrived with rather than what the user edited.
   * Dropping the key rather than blanking it keeps the column out of the CSV
   * entirely when no route is assigned, since the header is the union of keys.
   */
  private applyNetworkColumn(
    row: GTFSDatabaseRecord,
    useFiles: boolean,
    networkByRoute: Map<string, string>
  ): GTFSDatabaseRecord {
    const networkId = useFiles
      ? undefined
      : networkByRoute.get(String(row.route_id ?? ''));
    if (networkId !== undefined) {
      return { ...row, network_id: networkId };
    }
    const stripped = { ...row };
    delete stripped.network_id;
    return stripped;
  }

  /**
   * Format field value for export (ensures proper formatting, no scientific notation)
   */
  async exportAsZip() {
    try {
      // Ensure any pending blob edits are written before export
      await this.persistDirtyBlobs();

      // Get all available files from memory (for file list)
      const fileNames = Object.keys(this.gtfsData);

      const hasAnyRows = fileNames.some(
        (f) => (this.gtfsData[f]?.data.length ?? 0) > 0
      );
      if (!hasAnyRows) {
        throw new Error('No GTFS data to export');
      }

      const zip = new JSZip();
      const { useFiles, networkByRoute } = await this.resolveNetworksExport();

      for (const fileName of fileNames) {
        try {
          if (
            !useFiles &&
            (fileName === GTFS_TABLES.NETWORKS ||
              fileName === GTFS_TABLES.ROUTE_NETWORKS)
          ) {
            continue;
          }

          // Get data from IndexedDB first
          const tableName = this.getTableName(fileName);
          let rows = await this.gtfsDatabase.getAllRows(tableName);
          if (fileName === GTFS_TABLES.ROUTES) {
            rows = rows.map((row) =>
              this.applyNetworkColumn(row, useFiles, networkByRoute)
            );
          }

          // Skip header-only files: don't include empty tables in the export.
          if (
            rows.length === 0 &&
            (this.gtfsData[fileName]?.data.length ?? 0) === 0
          ) {
            continue;
          }

          if (rows.length > 0) {
            // Generate CSV content from in-memory/virtual-table data
            let csvContent = '';

            if (fileName.endsWith('.txt')) {
              csvContent = this.generateCSVFromRows(fileName, rows);
            } else if (fileName.endsWith('.geojson')) {
              // For GeoJSON, use the stored data directly
              csvContent = JSON.stringify(rows[0], null, 2);
            }

            zip.file(fileName, csvContent);
          } else {
            // Fallback: IDB empty but memory has rows, generate CSV from data

            console.warn(
              `No data in IndexedDB for ${fileName}, generating from memory`
            );
            zip.file(fileName, this.getFileContent(fileName));
          }
        } catch (dbError) {
          // Fallback to in-memory data if IndexedDB fails

          console.warn(
            `IndexedDB error for ${fileName}, generating from memory:`,
            dbError
          );
          zip.file(fileName, this.getFileContent(fileName));
        }
      }

      // Append passthrough files verbatim, no newline manipulation.
      for (const [fileName, rawContent] of this.passthroughFiles) {
        zip.file(fileName, rawContent);
      }

      return await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
    } catch (error) {
      console.error('Error exporting GTFS data:', error);
      throw error;
    }
  }

  getRoutesForStop(stop_id: string) {
    const routes = this.getFileDataSyncTyped(GTFS_TABLES.ROUTES);
    const trips = this.getFileDataSyncTyped(GTFS_TABLES.TRIPS);

    if (routes.length === 0 || trips.length === 0) {
      return [];
    }

    // Find trips that serve this stop (use in-memory index when available)
    const tripsAtStop = this.getStopTimesByStopId(stop_id).map(
      (st) => st.trip_id
    );
    if (tripsAtStop.length === 0) {
      return [];
    }

    // Find routes for those trips
    const route_ids = [
      ...new Set(
        trips
          .filter((trip) => tripsAtStop.includes(trip.trip_id))
          .map((trip) => trip.route_id)
      ),
    ];

    return routes.filter((route) => route_ids.includes(route.route_id));
  }

  /**
   * All stop_ids served by a route (via its trips' stop_times). Inverse of
   * getRoutesForStop; used for map spotlight highlighting.
   */
  getStopIdsForRoute(route_id: string): string[] {
    const trips = this.getFileDataSyncTyped(GTFS_TABLES.TRIPS);
    const tripIds = trips
      .filter((trip) => String(trip.route_id ?? '') === route_id)
      .map((trip) => trip.trip_id);

    const stop_ids = new Set<string>();
    for (const trip_id of tripIds) {
      for (const st of this.getStopTimesByTripId(trip_id)) {
        // Flex stop_times reference a zone or location group instead of a
        // stop, so stop_id is absent. Skip them rather than adding undefined.
        if (st.stop_id) {
          stop_ids.add(st.stop_id);
        }
      }
    }
    return [...stop_ids];
  }

  getWheelchairText(wheelchairBoarding: string) {
    switch (wheelchairBoarding) {
      case '1':
        return 'Accessible';
      case '2':
        return 'Not accessible';
      default:
        return 'Unknown';
    }
  }

  getRouteTypeText(routeType: string) {
    const types: { [key: string]: string } = {
      '0': 'Tram/Streetcar',
      '1': 'Subway/Metro',
      '2': 'Rail',
      '3': 'Bus',
      '4': 'Ferry',
      '5': 'Cable Tram',
      '6': 'Aerial Lift',
      '7': 'Funicular',
      '11': 'Trolleybus',
      '12': 'Monorail',
    };
    return types[routeType] || `Type ${routeType}`;
  }

  async getRoutesForStopAsync(stop_id: string) {
    const routes = await this.getFileDataTyped(GTFS_TABLES.ROUTES);
    const trips = await this.getFileDataTyped(GTFS_TABLES.TRIPS);

    if (!routes || !trips) {
      return [];
    }

    // Find trips that serve this stop (uses in-memory index)
    const tripsAtStop = this.getStopTimesByStopId(stop_id).map(
      (st) => st.trip_id
    );

    // Find routes for those trips
    const route_ids = [
      ...new Set(
        trips
          .filter((trip) => tripsAtStop.includes(trip.trip_id))
          .map((trip) => trip.route_id)
      ),
    ];

    return routes.filter((route) => route_ids.includes(route.route_id));
  }

  /**
   * Get the GTFS database instance for external use
   */
  getDatabase(): GTFSDatabase {
    return this.gtfsDatabase;
  }

  /**
   * Create a new stop and add it to the GTFS data
   */
  async createStop(stop: GTFSDatabaseRecord): Promise<void> {
    const fileName = GTFS_TABLES.STOPS;
    const tableName = this.getTableName(fileName);

    // Ensure stops.txt file data exists
    if (!this.gtfsData[fileName]) {
      this.gtfsData[fileName] = {
        content: '',
        data: [],
        errors: [],
      };
    }

    // Insert into database (virtual table handler keeps in-memory flat array in sync)
    await this.gtfsDatabase.insertRows(tableName, [stop]);

    // Record patch
    const stopId = String(stop.stop_id);
    await this.patchManager?.recordInsert(
      tableName,
      stopId,
      stop as Record<string, unknown>
    );

    // Update file content (regenerate CSV)
    this.updateStopsFileContent();

    console.log(`Stop ${stop.stop_id} created successfully`);
  }

  /**
   * Update stop coordinates and persist changes
   */
  async updateStopCoordinates(
    stopId: string,
    lat: number,
    lng: number
  ): Promise<void> {
    const fileName = GTFS_TABLES.STOPS;
    const tableName = this.getTableName(fileName);

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
    }

    // Validate coordinate ranges
    if (lat < -90 || lat > 90) {
      throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90`);
    }

    if (lng < -180 || lng > 180) {
      throw new Error(
        `Invalid longitude: ${lng}. Must be between -180 and 180`
      );
    }

    // Update in-memory data
    const stopsData = this.gtfsData[fileName];
    if (stopsData && stopsData.data) {
      const stopIndex = stopsData.data.findIndex(
        (stop) => stop.stop_id === stopId
      );
      if (stopIndex !== -1) {
        // Capture before state for patch
        const beforeRow = { ...stopsData.data[stopIndex] } as Record<
          string,
          unknown
        >;

        // Update in database (virtual table handler mutates the in-memory row in-place)
        await this.gtfsDatabase.updateRow(tableName, stopId, {
          stop_lat: lat.toString(),
          stop_lon: lng.toString(),
        });

        // Record patch
        const afterRow = { ...stopsData.data[stopIndex] } as Record<
          string,
          unknown
        >;
        await this.patchManager?.recordUpdate(
          tableName,
          stopId,
          beforeRow,
          afterRow
        );
      } else {
        throw new Error(`Stop ${stopId} not found in in-memory data`);
      }
    } else {
      throw new Error('Stops data not available in memory');
    }

    // Update file content (regenerate CSV)
    this.updateStopsFileContent();

    console.log(
      `Stop ${stopId} coordinates updated successfully: ${lat}, ${lng}`
    );
  }

  /**
   * Create a new pathway and add it to the GTFS data
   */
  async createPathway(pathway: GTFSDatabaseRecord): Promise<void> {
    const fileName = GTFS_TABLES.PATHWAYS;
    const tableName = this.getTableName(fileName);

    if (!this.gtfsData[fileName]) {
      this.gtfsData[fileName] = { content: '', data: [], errors: [] };
    }

    await this.gtfsDatabase.insertRows(tableName, [pathway]);

    const pathwayId = String(pathway.pathway_id);
    await this.patchManager?.recordInsert(
      tableName,
      pathwayId,
      pathway as Record<string, unknown>
    );

    this.updatePathwaysFileContent();
    console.log(`Pathway ${pathway.pathway_id} created successfully`);
  }

  /**
   * Update the pathways.txt file content from in-memory data
   */
  private updatePathwaysFileContent(): void {
    const fileName = GTFS_TABLES.PATHWAYS;
    const pathwaysData = this.gtfsData[fileName];

    if (!pathwaysData || !pathwaysData.data.length) {
      return;
    }

    const allFields = new Set<string>();
    pathwaysData.data.forEach((p) => {
      Object.keys(p).forEach((field) => allFields.add(field));
    });

    const fieldNames = Array.from(allFields);
    pathwaysData.content = Papa.unparse(
      {
        fields: fieldNames,
        data: pathwaysData.data,
      },
      { newline: '\n' }
    );
  }

  /**
   * Update the stops.txt file content from in-memory data
   */
  private updateStopsFileContent(): void {
    const fileName = GTFS_TABLES.STOPS;
    const stopsData = this.gtfsData[fileName];

    if (!stopsData || !stopsData.data.length) {
      return;
    }

    // Get all unique field names from the data
    const allFields = new Set<string>();
    stopsData.data.forEach((stop) => {
      Object.keys(stop).forEach((field) => allFields.add(field));
    });

    // Convert to CSV
    const fieldNames = Array.from(allFields);
    const csvContent = Papa.unparse(
      {
        fields: fieldNames,
        data: stopsData.data,
      },
      { newline: '\n' }
    );

    // Update in-memory content
    stopsData.content = csvContent;
  }
}
