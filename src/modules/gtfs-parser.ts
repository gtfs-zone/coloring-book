import JSZip from 'jszip';
import Papa from 'papaparse';
import { CONFIG } from '../config.js';
import { GTFSDatabase, GTFSDatabaseRecord } from './gtfs-database.js';
import { GTFS_FILES, GTFS_TABLES } from '../types/gtfs.js';
import { feedProgressIndicator } from './feed-progress-indicator.js';
import { notify } from './notification-system.js';
import {
  ALL_GTFS_FILES,
  makeHeaderOnlyCSV,
  getFileHeaders,
} from './gtfs-file-registry.js';
import type {
  WorkerDoneMessage,
  WorkerDoneRestoreMessage,
  WorkerOutbound,
} from '../workers/gtfs-parser.worker.js';
import { GTFSTableMap, StopTimes } from '../types/gtfs-entities.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { splitInnerZipPath } from './feed-url-resolve.js';
import {
  downloadWithProgress,
  downloadPercent,
  formatBytes,
  LoadCancelledError,
} from './feed-download.js';

/**
 * One nested archive out of another. Fails loudly with the entries that *are*
 * there: a wrong `#inner.zip` is a typo the user can fix, and the list is the
 * only thing that tells them what to fix it to.
 */
async function extractInnerZip(outer: Blob, innerPath: string): Promise<Blob> {
  const zip = await JSZip.loadAsync(await outer.arrayBuffer());
  const entry = zip.file(innerPath);
  if (!entry) {
    const found = Object.keys(zip.files)
      .filter((name) => name.toLowerCase().endsWith('.zip'))
      .join(', ');
    throw new Error(
      `The archive has no entry "${innerPath}"${found ? ` — it contains ${found}` : ''}.`
    );
  }
  return entry.async('blob');
}

interface GTFSFileData<T = GTFSDatabaseRecord> {
  content: string;
  data: T[];
  errors: Papa.ParseError[];
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

  constructor() {
    this.gtfsData = {};
    this.gtfsDatabase = new GTFSDatabase();

    // A reload can outrun the 3-second debounce. Flush when the page is
    // hidden, which fires before a refresh or a tab close.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.blobDirty.size > 0) {
        console.log('[GTFSParser] Page hidden with dirty blobs, flushing');
        void this.persistDirtyBlobs();
      }
    });
  }

  setPatchManager(pm: PatchManagerRef): void {
    this.patchManager = pm;
  }

  /**
   * Parse and coerce field values based on GTFS field types
   */
  private parseFieldValue(fieldName: string, value: string): string | number {
    // Handle empty values
    if (value === null || value === undefined || value === '') {
      return '';
    }

    const stringValue = String(value);

    // Detect field type from field name
    let shouldBeNumeric = false;

    // Numeric fields
    if (
      fieldName.includes('_lat') ||
      fieldName.includes('_lon') ||
      fieldName === 'stop_lat' ||
      fieldName === 'stop_lon' ||
      fieldName === 'shape_pt_lat' ||
      fieldName === 'shape_pt_lon' ||
      fieldName === 'shape_dist_traveled' ||
      fieldName.includes('_sequence') ||
      fieldName === 'direction_id' ||
      fieldName === 'location_type' ||
      fieldName === 'wheelchair_boarding' ||
      fieldName === 'wheelchair_accessible' ||
      fieldName === 'bikes_allowed' ||
      fieldName === 'pickup_type' ||
      fieldName === 'drop_off_type' ||
      fieldName === 'payment_method' ||
      fieldName === 'transfers' ||
      fieldName === 'transfer_duration' ||
      fieldName === 'route_type' ||
      fieldName === 'route_sort_order' ||
      fieldName === 'continuous_pickup' ||
      fieldName === 'continuous_drop_off' ||
      fieldName === 'exception_type' ||
      fieldName.includes('_type')
    ) {
      shouldBeNumeric = true;
    }

    // Parse numeric values
    if (shouldBeNumeric && stringValue !== '') {
      const num = parseFloat(stringValue);
      if (!isNaN(num)) {
        // For integers, remove decimal part
        if (Number.isInteger(num)) {
          return parseInt(stringValue, 10);
        }
        return num;
      }
    }

    return stringValue;
  }

  /**
   * Process parsed CSV data to apply type coercion
   */
  private processParsedData(
    data: Record<string, unknown>[]
  ): GTFSDatabaseRecord[] {
    return data.map((row) => {
      const processedRow: GTFSDatabaseRecord = {};
      for (const [fieldName, value] of Object.entries(row)) {
        processedRow[fieldName] = this.parseFieldValue(
          fieldName,
          value as string
        );
      }
      return processedRow;
    });
  }

  // ===== Blob-backed virtual table infrastructure =====

  /**
   * Build and register a virtual table handler for any GTFS table.
   * All mutations maintain the byId Map and any provided field-level Maps.
   * For stop_times: pass this.stopTimesByStopId as the 'stop_id' fieldMap so it
   * stays accessible for the synchronous getRoutesForStop path.
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
  private buildAndRegisterVirtual(
    tableName: string,
    flat: GTFSDatabaseRecord[],
    fieldMaps: Map<string, Map<string, GTFSDatabaseRecord[]>> = new Map()
  ): void {
    const byId = new Map<string, GTFSDatabaseRecord>();

    const addToBucket = (
      map: Map<string, GTFSDatabaseRecord[]>,
      val: string,
      row: GTFSDatabaseRecord
    ): void => {
      let bucket = map.get(val);
      if (!bucket) {
        bucket = [];
        map.set(val, bucket);
      }
      if (!bucket.includes(row)) {
        bucket.push(row);
      }
    };

    const removeFromBucket = (
      map: Map<string, GTFSDatabaseRecord[]>,
      val: string,
      row: GTFSDatabaseRecord
    ): void => {
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
    };

    // Single-pass: populate byId and all fieldMaps
    for (const row of flat) {
      const key = generateCompositeKeyFromRecord(
        tableName,
        row as Record<string, unknown>
      );
      byId.set(key, row);
      for (const [field, map] of fieldMaps) {
        const val = String((row as Record<string, unknown>)[field] ?? '');
        addToBucket(map, val, row);
      }
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
          byId.set(key, row);
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
          byId.delete(key);
          byId.set(newKey, row);
        }
        this.invalidateBlobForTable(tableName);
      },

      delete: (key) => {
        const row = byId.get(key);
        if (!row) {
          return;
        } // already removed by PatchManager
        byId.delete(key);
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
          byId.delete(k);
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
          byId.set(key, row);
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
   * Set up fieldMaps for tables that need indexed queries, then call buildAndRegisterVirtual.
   * For stop_times, the stop_id Map is kept as a class field for synchronous lookups.
   */
  private setupVirtual(tableName: string, data: GTFSDatabaseRecord[]): void {
    // Rebinding a table's rows invalidates anything memoized off them. Boot
    // reads the shape ids for the navbar badge before the feed is restored,
    // and an empty cached array is truthy, so without this the ids stay empty
    // for the whole session.
    if (tableName === 'shapes') {
      this.shapeIdsCache = null;
    }

    const fieldMaps = new Map<string, Map<string, GTFSDatabaseRecord[]>>();

    if (tableName === 'stop_times') {
      this.stopTimesByStopId.clear();
      this.stopTimesByTripId.clear();
      fieldMaps.set('trip_id', this.stopTimesByTripId);
      fieldMaps.set('stop_id', this.stopTimesByStopId);
    } else if (tableName === 'trips') {
      this.tripsByRouteId.clear();
      fieldMaps.set('route_id', this.tripsByRouteId);
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

    this.buildAndRegisterVirtual(tableName, data, fieldMaps);
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

    for (const tableName of pending) {
      const fileName = `${tableName}.txt`;
      const rows = this.gtfsData[fileName]?.data ?? [];
      try {
        // An emptied table is written as `[]` rather than skipped: skipping
        // leaves the pre-delete blob on disk and the rows come back on reload.
        await this.gtfsDatabase.saveTableBlob(tableName, JSON.stringify(rows));
      } catch (error) {
        // Keep it dirty so the next flush retries, and do not stamp a version
        // that claims this table was written.
        this.blobDirty.add(tableName);
        console.error(
          `[GTFSParser] Failed to persist ${tableName} blob:`,
          error
        );
        throw error;
      }
    }

    // Record the version at which blobs were last fully flushed.
    if (v !== undefined) {
      await this.gtfsDatabase.setBlobVersion(v);
    }
    await this.writeFeedSummary();
  }

  /**
   * Describe the stored feed in the meta store, next to the blobs it describes.
   *
   * Written on every flush rather than on import, so an edited feed's counts
   * never drift from the rows the boot screen would restore.
   */
  private async writeFeedSummary(): Promise<void> {
    const rows = (fileName: string) => this.gtfsData[fileName]?.data ?? [];
    const firstValue = (fileName: string, field: string): string => {
      const value = rows(fileName)[0]?.[field];
      return typeof value === 'string' ? value.trim() : '';
    };
    const name =
      firstValue('feed_info.txt', 'feed_publisher_name') ||
      firstValue('agency.txt', 'agency_name') ||
      this.feedLabel ||
      'Untitled feed';
    await this.gtfsDatabase.setFeedSummary({
      name,
      routes: rows('routes.txt').length,
      stops: rows('stops.txt').length,
      trips: rows('trips.txt').length,
      updatedAt: Date.now(),
    });
    console.log(`[GTFSParser] feed summary written: ${name}`);
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
    for (const filename of ALL_GTFS_FILES) {
      this.gtfsData[filename] = {
        content: makeHeaderOnlyCSV(filename),
        data: [],
        errors: [],
      };
      if (filename.endsWith('.txt')) {
        const tableName = this.getTableName(filename);
        this.setupVirtual(tableName, []);
      }
    }
  }

  /**
   * Restore GTFS data from blobs stored in IndexedDB.
   * All .txt tables are blob-backed; .geojson files fall back to IDB rows.
   * Blob reads are parallelized; JSON parsing runs in a worker to stay off the main thread.
   */
  async restoreDataFromDatabase(): Promise<void> {
    try {
      const txtFiles = ALL_GTFS_FILES.filter((f) => f.endsWith('.txt'));
      const geojsonFiles = ALL_GTFS_FILES.filter((f) => f.endsWith('.geojson'));

      // Parallel IDB reads for all .txt blob tables
      const blobEntries = await Promise.all(
        txtFiles.map(async (filename) => {
          const tableName = this.getTableName(filename);
          const json = await this.gtfsDatabase.getTableBlob(tableName);
          return { filename, tableName, json };
        })
      );

      // GeoJSON tables fall back to per-row IDB reads (they're tiny)
      for (const filename of geojsonFiles) {
        try {
          const tableName = this.getTableName(filename);
          const rows = await this.gtfsDatabase.getAllRows(tableName);
          if (rows.length > 0) {
            this.gtfsData[filename] = { content: '', data: rows, errors: [] };
          }
        } catch (err) {
          console.warn(`[GTFSParser] Failed to restore ${filename}:`, err);
        }
      }

      const populated = blobEntries.filter(
        (e): e is { filename: string; tableName: string; json: string } =>
          e.json !== null && e.json.length > 0
      );

      if (populated.length === 0) {
        return;
      }

      // Parse JSON blobs in the worker to keep main thread free
      const worker = new Worker(
        new URL('../workers/gtfs-parser.worker.ts', import.meta.url),
        { type: 'module' }
      );

      const tables = await new Promise<WorkerDoneRestoreMessage['tables']>(
        (resolve, reject) => {
          worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
            const msg = event.data;
            if (msg.type === 'progress') {
              feedProgressIndicator.updateProgress(
                'boot',
                5 + (msg.progress / 100) * 50,
                msg.status
              );
            } else if (msg.type === 'done-restore') {
              worker.terminate();
              resolve(msg.tables);
            } else if (msg.type === 'error') {
              worker.terminate();
              reject(new Error(msg.message));
            }
          };
          worker.onerror = (err) => {
            worker.terminate();
            reject(new Error(err.message));
          };
          worker.postMessage({
            type: 'restore',
            blobs: populated.map(({ tableName, json }) => ({
              tableName,
              json,
            })),
          });
        }
      );

      // Apply results on the main thread: set gtfsData and re-register virtual tables.
      // The shared-array invariant requires that gtfsData[filename].data and the flat
      // array passed to setupVirtual are the same reference.
      for (const { filename, tableName, json } of populated) {
        const rows = tables[tableName];
        if (rows) {
          const isLarge = json.length > 1_000_000;
          if (CONFIG.DEBUG_BOOT && isLarge) {
            console.time(`[boot] setupVirtual ${tableName}`);
          }
          this.gtfsData[filename] = { content: '', data: rows, errors: [] };
          this.setupVirtual(tableName, rows);
          if (CONFIG.DEBUG_BOOT && isLarge) {
            console.timeEnd(`[boot] setupVirtual ${tableName}`);
          }
          console.log(
            `[GTFSParser] Restored ${tableName} from blob: ${rows.length} rows${isLarge ? ` (${(json.length / 1_000_000).toFixed(1)} MB)` : ''}`
          );
        }
      }
      // Restore passthrough files into the in-memory map.
      const ptFiles = await this.gtfsDatabase.getAllPassthroughFiles();
      this.passthroughFiles.clear();
      for (const [fileName, rawContent] of Object.entries(ptFiles)) {
        this.passthroughFiles.set(fileName, rawContent);
      }
      if (this.passthroughFiles.size > 0) {
        console.log(
          `[GTFSParser] Restored ${this.passthroughFiles.size} passthrough file(s)`
        );
      }
    } catch (error) {
      console.error('[GTFSParser] Failed to restore data:', error);
    }
  }

  /**
   * Reset all in-memory feed state before wiping IndexedDB for a new/replacement feed.
   *
   * Cancels any pending debounced blob write first: without this, a write scheduled
   * by an edit to the *previous* feed can fire after clearDatabase() empties
   * file_blobs, re-writing stale rows for whichever table it targeted (since it
   * reads gtfsData, which at that point still holds the old feed's rows). This is
   * a real bug fixed here, not just defensive cleanup.
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

  async initializeEmpty(): Promise<void> {
    this.resetInMemoryFeedState();
    this.feedLabel = 'New feed';
    await this.gtfsDatabase.clearDatabase();
    this.gtfsDatabase.clearVirtualTables();

    for (const filename of ALL_GTFS_FILES) {
      const content = makeHeaderOnlyCSV(filename);
      // Use the same array for gtfsData.data and the virtual table's flat array.
      // If they diverge, persistDirtyBlobs reads a stale empty array and never
      // saves blobs, so edits are lost on refresh.
      const data: GTFSDatabaseRecord[] = [];
      this.gtfsData[filename] = { content, data, errors: [] };
      if (filename.endsWith('.txt')) {
        this.setupVirtual(this.getTableName(filename), data);
      }
    }

    // Seed feed_info with a row whose keys match the schema so vt.update can
    // find it. Without a row, every field edit silently does nothing (the virtual
    // table update handler returns early when byId has no entry). On reload the
    // patch replay would also fail, hasExistingRows would be false, and
    // initializeEmpty would clear the patches, losing all edits.
    const seedRow = Object.fromEntries(
      getFileHeaders('feed_info.txt').map((h) => [h, ''])
    ) as GTFSDatabaseRecord;
    await this.gtfsDatabase.insertRows('feed_info', [seedRow]);
    // Flush immediately so the seed blob is in IDB before any patch is recorded.
    // This guarantees that a quick refresh (before the 3-second debounce) still
    // has a row for patch replay to land on. Fresh DB has no patches yet, version 0.
    await this.persistDirtyBlobs(0);

    this.markFeedReplaced();
  }

  async parseFile(
    file: File | Blob,
    alreadyStarted = false
  ): Promise<{
    data: { [fileName: string]: GTFSFileData };
    unknownFiles: string[];
  }> {
    const operation = 'parseFile';

    try {
      console.log('Loading GTFS file:', (file as File).name || 'blob');
      console.time('[GTFS] parseFile total');

      const fileName = (file as File).name;
      if (fileName) {
        this.feedLabel = fileName.replace(/\.zip$/i, '');
      }

      if (!alreadyStarted) {
        feedProgressIndicator.startLoading(operation, 'Reading file...');
      }

      // Convert File/Blob to ArrayBuffer for zero-copy transfer to worker
      const buffer = await file.arrayBuffer();

      feedProgressIndicator.updateProgress(
        operation,
        10,
        'Clearing existing data...'
      );

      console.time('[GTFS] clearDatabase');
      this.resetInMemoryFeedState();
      await this.gtfsDatabase.clearDatabase();
      this.gtfsDatabase.clearVirtualTables();
      console.timeEnd('[GTFS] clearDatabase');

      // Spawn worker and transfer the buffer (zero-copy)
      const worker = new Worker(
        new URL('../workers/gtfs-parser.worker.ts', import.meta.url),
        { type: 'module' }
      );

      const {
        files: workerFiles,
        unknownFiles,
        passthroughFiles,
      } = await new Promise<WorkerDoneMessage>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
          const msg = event.data;
          if (msg.type === 'progress') {
            feedProgressIndicator.updateProgress(
              operation,
              msg.progress,
              msg.status
            );
          } else if (msg.type === 'done') {
            worker.terminate();
            resolve(msg);
          } else if (msg.type === 'error') {
            worker.terminate();
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(new Error(err.message));
        };
        worker.postMessage({ type: 'parse', buffer }, [buffer]);
      });

      // Apply worker results on the main thread: set up virtual tables and persist blobs
      this.gtfsData = {};
      for (const [fileName, fileResult] of Object.entries(workerFiles)) {
        if (fileResult.isGeoJSON) {
          const geoJsonData = fileResult.data[0] ?? {};
          this.gtfsData[fileName] = {
            content: fileResult.rawContent,
            data: fileResult.data,
            errors: [],
          };
          const tableName = this.getTableName(fileName);
          await this.gtfsDatabase.insertRows(tableName, [
            geoJsonData as GTFSDatabaseRecord,
          ]);
        } else {
          this.gtfsData[fileName] = {
            content: '',
            data: fileResult.data,
            errors: fileResult.errors,
          };
          const tableName = this.getTableName(fileName);
          if (fileResult.data.length > 0) {
            await this.gtfsDatabase.saveTableBlob(
              tableName,
              JSON.stringify(fileResult.data)
            );
          }
          this.setupVirtual(tableName, fileResult.data);
        }
      }

      // Save and cache passthrough files (unrecognized .txt files from the ZIP).
      this.passthroughFiles.clear();
      if (Object.keys(passthroughFiles).length > 0) {
        await this.gtfsDatabase.savePassthroughFiles(passthroughFiles);
        for (const [fileName, rawContent] of Object.entries(passthroughFiles)) {
          this.passthroughFiles.set(fileName, rawContent);
        }
      }

      await this.normalizeNetworks();

      // A fresh import has no patches yet: blobs are current at version 0.
      // Flushing here also persists whatever normalizeNetworks synthesized.
      await this.persistDirtyBlobs(0);

      feedProgressIndicator.updateProgress(operation, 100, 'Complete!');
      feedProgressIndicator.finishLoading(operation);

      console.log('Loaded GTFS data to IndexedDB and memory:', this.gtfsData);
      console.timeEnd('[GTFS] parseFile total');
      // Success path only: a throw leaves the previous feed's caches invalid
      // but there is no new feed to announce, and boot's fallback re-announces.
      this.markFeedReplaced();
      return { data: this.gtfsData, unknownFiles };
    } catch (error) {
      console.error('Error loading GTFS file:', error);
      feedProgressIndicator.finishLoading(operation);
      throw error;
    }
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
   */
  private async normalizeNetworks(): Promise<void> {
    const networks = this.gtfsData[GTFS_TABLES.NETWORKS]?.data ?? [];
    const routeNetworks = this.gtfsData[GTFS_TABLES.ROUTE_NETWORKS]?.data ?? [];
    const routes = this.gtfsData[GTFS_TABLES.ROUTES]?.data ?? [];

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
        await this.gtfsDatabase.insertRows(
          'networks',
          [...undefinedIds].map((id) => ({ network_id: id, network_name: '' }))
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

      await this.gtfsDatabase.setNetworksMode('files');
      return;
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
      await this.gtfsDatabase.insertRows(
        'networks',
        [...ids].map((id) => ({ network_id: id, network_name: '' }))
      );
      await this.gtfsDatabase.insertRows('route_networks', assignments);
    } else {
      console.log('[Networks] feed defines no networks');
    }

    await this.gtfsDatabase.setNetworksMode('inline');
  }

  private getTableName(fileName: string): string {
    return fileName.replace('.txt', '').replace('.geojson', '');
  }

  async parseFromURL(rawUrl: string): Promise<{ unknownFiles: string[] }> {
    const operation = 'parseFile';
    // `…/outer.zip#inner.zip` names a feed nested inside another archive (SEPTA
    // ships google_bus.zip and google_rail.zip in one release asset). The
    // fragment is never sent to the server, so it is stripped before fetching
    // and replayed as a descent once the outer archive is in hand.
    const { url, innerPaths } = splitInnerZipPath(rawUrl);
    console.log('[GTFSParser] Fetching GTFS from URL:', url, innerPaths);
    this.feedLabel =
      url
        .split('/')
        .pop()
        ?.replace(/\.zip$/i, '') || url;
    // Cancel aborts the fetch only. Once the bytes are in hand the parse runs
    // to completion, since ingestion into the database has no rollback path.
    const controller = new AbortController();
    feedProgressIndicator.startLoading(operation, 'Downloading feed...', {
      onCancel: () => controller.abort(),
    });

    let blob: Blob;
    try {
      blob = await downloadWithProgress(url, {
        signal: controller.signal,
        onProgress: (loaded, total) => {
          const percent = downloadPercent(loaded, total);
          feedProgressIndicator.updateProgress(
            operation,
            percent ?? 0,
            total
              ? `Downloading feed, ${formatBytes(loaded)} of ${formatBytes(total)}`
              : `Downloading feed, ${formatBytes(loaded)}`
          );
        },
      });
    } catch (error) {
      feedProgressIndicator.finishLoading(operation);
      if (!(error instanceof LoadCancelledError)) {
        console.error('[GTFSParser] Download failed:', error);
      }
      throw error;
    }
    // The same operation key covers the parse, which cannot be aborted.
    feedProgressIndicator.clearCancel(operation);

    feedProgressIndicator.updateProgress(operation, 100, 'Preparing...');

    for (const innerPath of innerPaths) {
      console.log('[GTFSParser] Descending into nested archive:', innerPath);
      try {
        blob = await extractInnerZip(blob, innerPath);
      } catch (error) {
        feedProgressIndicator.finishLoading(operation);
        throw error;
      }
    }

    console.log('[GTFSParser] Download complete, parsing ZIP...');
    const { unknownFiles } = await this.parseFile(blob, true);
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
        const rows = this.processParsedData(
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
        const data = this.processParsedData(
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
    await this.gtfsDatabase.savePassthroughFiles({ [fileName]: rawContent });
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
