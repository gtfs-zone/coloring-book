import JSZip from 'jszip';
import Papa from 'papaparse';
import { CONFIG } from '../config.js';
import { GTFSDatabase, GTFSDatabaseRecord } from './gtfs-database.js';
import { GTFS_FILES, GTFSFilePresence, GTFS_TABLES } from '../types/gtfs.js';
import { feedProgressIndicator } from './feed-progress-indicator.js';
import {
  ALL_GTFS_FILES,
  makeHeaderOnlyCSV,
  getFileHeaders,
} from './gtfs-file-registry.js';
import type {
  WorkerDoneMessage,
  WorkerOutbound,
} from '../workers/gtfs-parser.worker.js';
import { GTFSTableMap, StopTimes } from '../types/gtfs-entities.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
interface GTFSFileData<T = GTFSDatabaseRecord> {
  content: string;
  data: T[];
  errors: Papa.ParseError[];
}

// Type-safe table name to entity type mapping
type GTFSTableName = keyof GTFSTableMap;

interface PatchManagerRef {
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
}

export class GTFSParser {
  private gtfsData: { [fileName: string]: GTFSFileData } = {};
  public gtfsDatabase: GTFSDatabase;
  private patchManager: PatchManagerRef | null = null;

  // In-memory index for stop_times stop_id lookups (used by synchronous getRoutesForStop)
  private stopTimesByStopId = new Map<string, StopTimes[]>();
  // Dirty-blob tracking for deferred persistence
  private blobDirty = new Set<string>();
  private blobPersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.gtfsData = {};
    this.gtfsDatabase = new GTFSDatabase();
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

    const stringValue = String(value).trim();

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
        // For latitude/longitude, preserve 6 decimal places
        if (fieldName.includes('_lat') || fieldName.includes('_lon')) {
          return parseFloat(num.toFixed(6));
        }
        // For integers, remove decimal part
        if (Number.isInteger(num)) {
          return parseInt(stringValue, 10);
        }
        return num;
      }
    }

    // Return trimmed string for non-numeric fields
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
   * operate on the internal objects directly — the copies are only for callers.
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
    const fieldMaps = new Map<string, Map<string, GTFSDatabaseRecord[]>>();

    if (tableName === 'stop_times') {
      this.stopTimesByStopId.clear();
      fieldMaps.set('trip_id', new Map());
      fieldMaps.set('stop_id', this.stopTimesByStopId);
    } else if (tableName === 'trips') {
      fieldMaps.set('route_id', new Map());
      fieldMaps.set('service_id', new Map());
    } else if (tableName === 'agency') {
      fieldMaps.set('agency_id', new Map());
    } else if (tableName === 'routes') {
      fieldMaps.set('agency_id', new Map());
    }

    this.buildAndRegisterVirtual(tableName, data, fieldMaps);
  }

  /** Mark a table's blob as needing re-persistence and schedule a debounced flush. */
  invalidateBlobForTable(tableName: string): void {
    this.blobDirty.add(tableName);
    if (this.blobPersistTimer) {
      clearTimeout(this.blobPersistTimer);
    }
    this.blobPersistTimer = setTimeout(() => {
      this.blobPersistTimer = null;
      void this.persistDirtyBlobs();
    }, 3000);
  }

  /** Flush all dirty blobs to IDB immediately. Called before export and on demand. */
  async persistDirtyBlobs(): Promise<void> {
    if (this.blobPersistTimer) {
      clearTimeout(this.blobPersistTimer);
      this.blobPersistTimer = null;
    }
    for (const tableName of this.blobDirty) {
      const fileName = `${tableName}.txt`;
      const rows = this.gtfsData[fileName]?.data ?? [];
      if (rows.length === 0) {
        continue;
      }
      const csv = this.generateCSVFromRows(fileName, rows);
      await this.gtfsDatabase.saveTableBlob(tableName, csv);
    }
    this.blobDirty.clear();
  }

  /** Generate CSV text from an in-memory row array. */
  private generateCSVFromRows(
    fileName: string,
    rows: GTFSDatabaseRecord[]
  ): string {
    if (rows.length === 0) {
      return makeHeaderOnlyCSV(fileName);
    }
    const headers = Object.keys(rows[0]);
    return [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((h) => this.formatFieldForExport(h, row[h])).join(',')
      ),
    ].join('\n');
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

    // Overlay with real rows from blobs (if any exist).
    await this.restoreDataFromDatabase();
  }

  /**
   * Restore GTFS data from blobs stored in IndexedDB.
   * All .txt tables are blob-backed; .geojson files fall back to IDB rows.
   */
  async restoreDataFromDatabase(): Promise<void> {
    try {
      for (const filename of ALL_GTFS_FILES) {
        const tableName = this.getTableName(filename);
        try {
          if (filename.endsWith('.txt')) {
            const csv = await this.gtfsDatabase.getTableBlob(tableName);
            if (!csv) {
              continue;
            }
            const parsed = Papa.parse(csv, {
              header: true,
              skipEmptyLines: true,
            });
            const data = this.processParsedData(
              parsed.data as Record<string, unknown>[]
            );
            this.gtfsData[filename] = {
              content: '',
              data,
              errors: parsed.errors,
            };
            this.setupVirtual(tableName, data);

            console.log(
              `[GTFSParser] Restored ${tableName} from blob: ${data.length} rows`
            );
          } else if (filename.endsWith('.geojson')) {
            const rows = await this.gtfsDatabase.getAllRows(tableName);
            if (rows.length > 0) {
              this.gtfsData[filename] = { content: '', data: rows, errors: [] };
            }
          }
        } catch (err) {
          console.warn(`[GTFSParser] Failed to restore ${tableName}:`, err);
        }
      }
    } catch (error) {
      console.error('[GTFSParser] Failed to restore data:', error);
    }
  }

  async initializeEmpty(): Promise<void> {
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
    // initializeEmpty would clear the patches — losing all edits.
    const seedRow = Object.fromEntries(
      getFileHeaders('feed_info.txt').map((h) => [h, ''])
    ) as GTFSDatabaseRecord;
    await this.gtfsDatabase.insertRows('feed_info', [seedRow]);
    // Flush immediately so the seed blob is in IDB before any patch is recorded.
    // This guarantees that a quick refresh (before the 3-second debounce) still
    // has a row for patch replay to land on.
    await this.persistDirtyBlobs();
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
      await this.gtfsDatabase.clearDatabase();
      this.gtfsDatabase.clearVirtualTables();
      console.timeEnd('[GTFS] clearDatabase');

      // Spawn worker and transfer the buffer (zero-copy)
      const worker = new Worker(
        new URL('../workers/gtfs-parser.worker.ts', import.meta.url),
        { type: 'module' }
      );

      const { files: workerFiles, unknownFiles } =
        await new Promise<WorkerDoneMessage>((resolve, reject) => {
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
              fileResult.rawContent
            );
          }
          this.setupVirtual(tableName, fileResult.data);
        }
      }

      feedProgressIndicator.updateProgress(operation, 100, 'Complete!');
      feedProgressIndicator.finishLoading(operation);

      console.log('Loaded GTFS data to IndexedDB and memory:', this.gtfsData);
      console.timeEnd('[GTFS] parseFile total');
      return { data: this.gtfsData, unknownFiles };
    } catch (error) {
      console.error('Error loading GTFS file:', error);
      feedProgressIndicator.finishLoading(operation);
      throw error;
    }
  }

  private getTableName(fileName: string): string {
    return fileName.replace('.txt', '').replace('.geojson', '');
  }

  async parseFromURL(url: string): Promise<{ unknownFiles: string[] }> {
    const operation = 'parseFile';
    console.log('[GTFSParser] Fetching GTFS from URL:', url);
    feedProgressIndicator.startLoading(operation, 'Downloading feed...');
    let response: Response;
    try {
      response = await fetch(url);
    } catch (networkError) {
      feedProgressIndicator.finishLoading(operation);
      const msg =
        networkError instanceof TypeError
          ? `Network error — could not reach ${url}. Check your connection or whether the server allows cross-origin requests (CORS).`
          : `Fetch failed: ${networkError instanceof Error ? networkError.message : String(networkError)}`;

      console.error('[GTFSParser]', msg, networkError);
      throw new Error(msg);
    }

    if (!response.ok) {
      feedProgressIndicator.finishLoading(operation);
      const msg = `HTTP ${response.status} ${response.statusText} from ${url}`;

      console.error('[GTFSParser]', msg);
      throw new Error(msg);
    }

    const blob = await response.blob();
    feedProgressIndicator.updateProgress(operation, 5, 'Preparing...');
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

  categorizeFiles(): {
    required: string[];
    optional: string[];
    other: string[];
  } {
    const allFiles = this.getAllFileNames();
    const requiredFiles = GTFS_FILES.filter(
      (f) => f.presence === GTFSFilePresence.Required
    ).map((f) => f.filename);
    const optionalFiles = GTFS_FILES.filter(
      (f) =>
        f.presence === GTFSFilePresence.Optional ||
        f.presence === GTFSFilePresence.ConditionallyRequired
    ).map((f) => f.filename);

    return {
      required: allFiles.filter((f) => requiredFiles.includes(f)),
      optional: allFiles.filter((f) => optionalFiles.includes(f)),
      other: allFiles.filter(
        (f) => !requiredFiles.includes(f) && !optionalFiles.includes(f)
      ),
    };
  }

  /**
   * Format field value for export (ensures proper formatting, no scientific notation)
   */
  private formatFieldForExport(fieldName: string, value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    // Convert to string
    const stringValue = String(value);

    // For numeric fields, ensure proper formatting
    if (typeof value === 'number') {
      // Latitude/Longitude: always use 6 decimal places
      if (fieldName.includes('_lat') || fieldName.includes('_lon')) {
        return value.toFixed(6);
      }

      // Integers: no decimal point
      if (Number.isInteger(value)) {
        return String(value);
      }

      // Other floats: avoid scientific notation
      return value.toString();
    }

    return stringValue;
  }

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

      for (const fileName of fileNames) {
        try {
          // Get data from IndexedDB first
          const tableName = this.getTableName(fileName);
          const rows = await this.gtfsDatabase.getAllRows(tableName);

          // Skip header-only files — don't include empty tables in the export.
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
            // Fallback: IDB empty but memory has rows — generate CSV from data

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

      return await zip.generateAsync({ type: 'blob' });
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

  // Search functionality
  searchStops(query: string) {
    const stops = this.getFileDataSyncTyped(GTFS_TABLES.STOPS) || [];
    if (!query || query.trim().length < CONFIG.SEARCH_MIN_QUERY_LENGTH) {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();

    return stops
      .filter((stop) => {
        return (
          (stop.stop_name &&
            stop.stop_name.toLowerCase().includes(searchTerm)) ||
          (stop.stop_id && stop.stop_id.toLowerCase().includes(searchTerm)) ||
          (stop.stop_code &&
            stop.stop_code.toLowerCase().includes(searchTerm)) ||
          (stop.stop_desc && stop.stop_desc.toLowerCase().includes(searchTerm))
        );
      })
      .slice(0, CONFIG.SEARCH_RESULTS_LIMIT);
  }

  searchRoutes(query: string) {
    const routes = this.getFileDataSyncTyped(GTFS_TABLES.ROUTES) || [];
    if (!query || query.trim().length < CONFIG.SEARCH_MIN_QUERY_LENGTH) {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();

    return routes
      .filter((route) => {
        return (
          (route.route_short_name &&
            route.route_short_name.toLowerCase().includes(searchTerm)) ||
          (route.route_long_name &&
            route.route_long_name.toLowerCase().includes(searchTerm)) ||
          (route.route_id &&
            route.route_id.toLowerCase().includes(searchTerm)) ||
          (route.route_desc &&
            route.route_desc.toLowerCase().includes(searchTerm))
        );
      })
      .slice(0, CONFIG.SEARCH_RESULTS_LIMIT);
  }

  searchAll(query: string) {
    if (!query || query.trim().length < CONFIG.SEARCH_MIN_QUERY_LENGTH) {
      return { stops: [], routes: [] };
    }

    return {
      stops: this.searchStops(query),
      routes: this.searchRoutes(query),
    };
  }

  // Async versions of search methods that use IndexedDB
  async searchStopsAsync(query: string) {
    const stops = (await this.getFileDataTyped(GTFS_TABLES.STOPS)) || [];
    if (!query || query.trim().length < CONFIG.SEARCH_MIN_QUERY_LENGTH) {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();

    return stops
      .filter((stop) => {
        return (
          (stop.stop_name &&
            stop.stop_name.toLowerCase().includes(searchTerm)) ||
          (stop.stop_id && stop.stop_id.toLowerCase().includes(searchTerm)) ||
          (stop.stop_code &&
            stop.stop_code.toLowerCase().includes(searchTerm)) ||
          (stop.stop_desc && stop.stop_desc.toLowerCase().includes(searchTerm))
        );
      })
      .slice(0, CONFIG.SEARCH_RESULTS_LIMIT);
  }

  async searchRoutesAsync(query: string) {
    const routes = (await this.getFileDataTyped(GTFS_TABLES.ROUTES)) || [];
    if (!query || query.trim().length < CONFIG.SEARCH_MIN_QUERY_LENGTH) {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();

    return routes
      .filter((route) => {
        return (
          (route.route_short_name &&
            route.route_short_name.toLowerCase().includes(searchTerm)) ||
          (route.route_long_name &&
            route.route_long_name.toLowerCase().includes(searchTerm)) ||
          (route.route_id &&
            route.route_id.toLowerCase().includes(searchTerm)) ||
          (route.route_desc &&
            route.route_desc.toLowerCase().includes(searchTerm))
        );
      })
      .slice(0, CONFIG.SEARCH_RESULTS_LIMIT);
  }

  async searchAllAsync(query: string) {
    if (!query || query.trim().length < CONFIG.SEARCH_MIN_QUERY_LENGTH) {
      return { stops: [], routes: [] };
    }

    return {
      stops: await this.searchStopsAsync(query),
      routes: await this.searchRoutesAsync(query),
    };
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
    pathwaysData.content = Papa.unparse({
      fields: fieldNames,
      data: pathwaysData.data,
    });
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
    const csvContent = Papa.unparse({
      fields: fieldNames,
      data: stopsData.data,
    });

    // Update in-memory content
    stopsData.content = csvContent;
  }
}
