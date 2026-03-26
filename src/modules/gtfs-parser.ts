import JSZip from 'jszip';
import Papa from 'papaparse';
import { CONFIG } from '../config.js';
import { GTFSDatabase, GTFSDatabaseRecord } from './gtfs-database.js';
import { GTFS_FILES, GTFSFilePresence, GTFS_TABLES } from '../types/gtfs.js';
import { loadingStateManager } from './loading-state-manager.js';
import {
  ALL_GTFS_FILES,
  makeHeaderOnlyCSV,
  isSupportedFile,
} from './gtfs-file-registry.js';
import { GTFSTableMap, StopTimes } from '../types/gtfs-entities.js';
import { parseCompositeKey } from '../utils/gtfs-primary-keys.js';

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

  // In-memory indexes for large tables (stop_times)
  private stopTimesByTripId = new Map<string, StopTimes[]>();
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

  // ===== Large-table (blob-backed) infrastructure =====

  /** Build trip_id and stop_id indexes over the stop_times flat array. */
  private buildStopTimeIndexes(rows: StopTimes[]): void {
    this.stopTimesByTripId.clear();
    this.stopTimesByStopId.clear();
    for (const st of rows) {
      const tripId = String(st.trip_id);
      let byT = this.stopTimesByTripId.get(tripId);
      if (!byT) {
        byT = [];
        this.stopTimesByTripId.set(tripId, byT);
      }
      byT.push(st);

      const stopId = String(st.stop_id);
      let byS = this.stopTimesByStopId.get(stopId);
      if (!byS) {
        byS = [];
        this.stopTimesByStopId.set(stopId, byS);
      }
      byS.push(st);
    }
  }

  /**
   * Register stop_times as a virtual table in GTFSDatabase.
   * Must be called AFTER gtfsData['stop_times.txt'].data is set and indexes are built.
   * Re-registration is idempotent — updates the active closure to the current array.
   */
  private registerStopTimesAsVirtual(): void {
    const flat = this.gtfsData['stop_times.txt']!.data as StopTimes[];
    const byTrip = this.stopTimesByTripId;
    const byStop = this.stopTimesByStopId;

    this.gtfsDatabase.registerVirtualTable('stop_times', {
      getAll: () => flat,

      query: (filter) => {
        if (!filter) {
          return flat;
        }
        if (filter.trip_id !== undefined) {
          const results = byTrip.get(String(filter.trip_id)) ?? [];
          if (filter.stop_id !== undefined) {
            const sid = String(filter.stop_id);
            return results.filter((r) => String(r.stop_id) === sid);
          }
          return results;
        }
        if (filter.stop_id !== undefined) {
          return byStop.get(String(filter.stop_id)) ?? [];
        }
        // Fallback: linear scan for any other filter
        return flat.filter((r) =>
          Object.entries(filter).every(
            ([k, v]) => (r as Record<string, unknown>)[k] === v
          )
        );
      },

      insert: (rows) => {
        for (const row of rows) {
          const st = row as StopTimes;
          // Guard against double-insert (PatchManager may have already pushed)
          if (!flat.includes(st)) {
            flat.push(st);
          }

          const tripId = String(st.trip_id);
          let byT = byTrip.get(tripId);
          if (!byT) {
            byT = [];
            byTrip.set(tripId, byT);
          }
          if (!byT.includes(st)) {
            byT.push(st);
          }

          const stopId = String(st.stop_id);
          let byS = byStop.get(stopId);
          if (!byS) {
            byS = [];
            byStop.set(stopId, byS);
          }
          if (!byS.includes(st)) {
            byS.push(st);
          }
        }
        this.invalidateBlobForTable('stop_times');
      },

      update: (key, delta) => {
        const parsed = parseCompositeKey('stop_times', key);
        const tripId = String(parsed.trip_id);
        const seq = String(parsed.stop_sequence);
        // Find via byTrip (reliable even after PatchManager's in-place update)
        const byTripArr = byTrip.get(tripId);
        if (byTripArr) {
          const idx = byTripArr.findIndex(
            (r) => String(r.stop_sequence) === seq
          );
          if (idx !== -1) {
            Object.assign(byTripArr[idx], delta); // idempotent if already applied
            // Rebuild stop index if stop_id changed
            if (delta.stop_id !== undefined) {
              this.stopTimesByStopId.clear();
              for (const r of flat) {
                const sid = String(r.stop_id);
                let byS = this.stopTimesByStopId.get(sid);
                if (!byS) {
                  byS = [];
                  this.stopTimesByStopId.set(sid, byS);
                }
                byS.push(r);
              }
            }
          }
        }
        this.invalidateBlobForTable('stop_times');
      },

      delete: (key) => {
        const parsed = parseCompositeKey('stop_times', key);
        const tripId = String(parsed.trip_id);
        const seq = String(parsed.stop_sequence);

        // Remove from byTrip and byStop (may still be there even after PatchManager splice)
        const byTripArr = byTrip.get(tripId);
        if (byTripArr) {
          const idx = byTripArr.findIndex(
            (r) => String(r.stop_sequence) === seq
          );
          if (idx !== -1) {
            const removed = byTripArr.splice(idx, 1)[0];
            const byStopArr = byStop.get(String(removed.stop_id));
            if (byStopArr) {
              const i = byStopArr.indexOf(removed);
              if (i !== -1) {
                byStopArr.splice(i, 1);
              }
            }
          }
        }
        // Also remove from flat if still present (PatchManager may have already removed it)
        const flatIdx = flat.findIndex(
          (r) => String(r.trip_id) === tripId && String(r.stop_sequence) === seq
        );
        if (flatIdx !== -1) {
          flat.splice(flatIdx, 1);
        }
        this.invalidateBlobForTable('stop_times');
      },

      replace: (oldKeys, newRows) => {
        // Delete old records
        for (const key of oldKeys) {
          const parsed = parseCompositeKey('stop_times', key);
          const tripId = String(parsed.trip_id);
          const seq = String(parsed.stop_sequence);
          const byTripArr = byTrip.get(tripId);
          if (byTripArr) {
            const idx = byTripArr.findIndex(
              (r) => String(r.stop_sequence) === seq
            );
            if (idx !== -1) {
              const removed = byTripArr.splice(idx, 1)[0];
              const byStopArr = byStop.get(String(removed.stop_id));
              if (byStopArr) {
                const i = byStopArr.indexOf(removed);
                if (i !== -1) {
                  byStopArr.splice(i, 1);
                }
              }
              const fi = flat.indexOf(removed);
              if (fi !== -1) {
                flat.splice(fi, 1);
              }
            }
          }
        }
        // Insert new records
        for (const row of newRows) {
          const st = row as StopTimes;
          if (!flat.includes(st)) {
            flat.push(st);
          }
          const tripId = String(st.trip_id);
          let byT = byTrip.get(tripId);
          if (!byT) {
            byT = [];
            byTrip.set(tripId, byT);
          }
          if (!byT.includes(st)) {
            byT.push(st);
          }
          const stopId = String(st.stop_id);
          let byS = byStop.get(stopId);
          if (!byS) {
            byS = [];
            byStop.set(stopId, byS);
          }
          if (!byS.includes(st)) {
            byS.push(st);
          }
        }
        this.invalidateBlobForTable('stop_times');
      },

      clear: () => {
        flat.splice(0, flat.length);
        byTrip.clear();
        byStop.clear();
        this.invalidateBlobForTable('stop_times');
      },
    });
  }

  /** Mark a large table's blob as needing re-persistence and schedule a debounced flush. */
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
      await this.gtfsDatabase.saveLargeTableBlob(tableName, csv);
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

  /** Fast stop_times lookup by trip_id (uses in-memory index when available). */
  getStopTimesByTripId(trip_id: string): StopTimes[] {
    if (this.stopTimesByTripId.size > 0) {
      return this.stopTimesByTripId.get(trip_id) ?? [];
    }
    return this.getFileDataSyncTyped(GTFS_TABLES.STOP_TIMES).filter(
      (st) => st.trip_id === trip_id
    );
  }

  /** Fast stop_times lookup by stop_id (uses in-memory index when available). */
  getStopTimesByStopId(stop_id: string): StopTimes[] {
    if (this.stopTimesByStopId.size > 0) {
      return this.stopTimesByStopId.get(stop_id) ?? [];
    }
    return this.getFileDataSyncTyped(GTFS_TABLES.STOP_TIMES).filter(
      (st) => st.stop_id === stop_id
    );
  }

  async initialize(): Promise<void> {
    await this.gtfsDatabase.initialize();

    // Invariant: all 31 GTFS files are always in gtfsData from this point forward.
    for (const filename of ALL_GTFS_FILES) {
      this.gtfsData[filename] = {
        content: makeHeaderOnlyCSV(filename),
        data: [],
        errors: [],
      };
    }

    // Overlay with real rows from IndexedDB (if any exist).
    await this.restoreDataFromDatabase();
  }

  /**
   * Restore GTFS data from IndexedDB into memory cache
   * This is needed when the page is refreshed and we lose the in-memory data
   */
  async restoreDataFromDatabase(): Promise<void> {
    try {
      // Restore large tables from raw CSV blobs (fast re-parse instead of getAllRows)
      for (const tableName of CONFIG.LARGE_TABLES) {
        try {
          const csv = await this.gtfsDatabase.getLargeTableBlob(tableName);
          if (!csv) {
            continue;
          }
          const fileName = `${tableName}.txt`;
          const parsed = Papa.parse(csv, {
            header: true,
            skipEmptyLines: true,
          });
          const data = this.processParsedData(
            parsed.data as Record<string, unknown>[]
          );
          this.gtfsData[fileName] = {
            content: '',
            data,
            errors: parsed.errors,
          };
          if (tableName === 'stop_times') {
            this.buildStopTimeIndexes(data as StopTimes[]);
            this.registerStopTimesAsVirtual();
          }
          // eslint-disable-next-line no-console
          console.log(
            `[GTFSParser] Restored ${tableName} from blob: ${data.length} rows`
          );
        } catch (blobError) {
          console.warn(
            `[GTFSParser] Failed to restore ${tableName} from blob:`,
            blobError
          );
        }
      }

      const stats = await this.gtfsDatabase.getDatabaseStats();

      if (!stats?.tables) {
        console.log(
          '[GTFSParser] No valid database stats found, keeping header-only baseline'
        );
        return;
      }

      console.log(
        '[GTFSParser] Restoring data from IndexedDB...',
        stats.tables
      );

      // Overlay any tables that have rows on top of the header-only baseline.
      for (const [tableName, count] of Object.entries(stats.tables)) {
        // Large tables are handled via blobs above
        if (CONFIG.LARGE_TABLES.has(tableName)) {
          continue;
        }

        if (count === 0) {
          continue;
        }

        const fileName = tableName.endsWith('.txt')
          ? tableName
          : `${tableName}.txt`;

        try {
          const data = await this.gtfsDatabase.getAllRows(tableName);

          if (data && data.length > 0) {
            this.gtfsData[fileName] = {
              content: '',
              data: data,
              errors: [],
            };
          }
        } catch (tableError) {
          console.warn(
            `[GTFSParser] Failed to restore table ${tableName}:`,
            tableError
          );
        }
      }

      console.log(
        '[GTFSParser] Data restored from IndexedDB:',
        Object.keys(this.gtfsData)
      );
    } catch (error) {
      console.error(
        '[GTFSParser] Failed to restore data from IndexedDB:',
        error
      );
    }
  }

  async initializeEmpty(): Promise<void> {
    // Clear existing data from database
    await this.gtfsDatabase.clearDatabase();

    for (const filename of ALL_GTFS_FILES) {
      const content = makeHeaderOnlyCSV(filename);
      this.gtfsData[filename] = { content, data: [], errors: [] };
    }
  }

  async parseFile(
    file: File | Blob
  ): Promise<{ [fileName: string]: GTFSFileData }> {
    const operation = 'parseFile';

    try {
      // eslint-disable-next-line no-console
      console.log('Loading GTFS file:', (file as File).name || 'blob');
      // eslint-disable-next-line no-console
      console.time('[GTFS] parseFile total');

      // Start loading indicator
      loadingStateManager.startLoading(operation, 'Loading GTFS file...');

      // Clear existing data from database
      loadingStateManager.updateProgress(
        operation,
        10,
        'Clearing existing data...'
      );
      // eslint-disable-next-line no-console
      console.time('[GTFS] clearDatabase');
      await this.gtfsDatabase.clearDatabase();
      // eslint-disable-next-line no-console
      console.timeEnd('[GTFS] clearDatabase');

      loadingStateManager.updateProgress(
        operation,
        20,
        'Extracting ZIP file...'
      );
      // eslint-disable-next-line no-console
      console.time('[GTFS] zip extraction');
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(file);
      // eslint-disable-next-line no-console
      console.timeEnd('[GTFS] zip extraction');

      // Parse all text files in the ZIP
      const files = Object.keys(zipContent.files).filter(
        (name) => name.endsWith('.txt') || name.endsWith('.geojson')
      );

      this.gtfsData = {};
      const unknownFiles: string[] = [];
      const totalFiles = files.length;

      for (let i = 0; i < files.length; i++) {
        const fileName = files[i];

        if (!isSupportedFile(fileName)) {
          unknownFiles.push(fileName);
          continue;
        }
        const progress = 20 + 60 * (i / totalFiles); // 20-80% for file processing

        loadingStateManager.updateProgress(
          operation,
          progress,
          `Processing ${fileName}...`
        );
        // eslint-disable-next-line no-console
        console.time(`[GTFS] file: ${fileName}`);
        const fileContent = await zipContent.files[fileName].async('text');

        if (fileName.endsWith('.txt')) {
          // Parse CSV files
          const parsed = Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
          });

          // Process parsed data with type coercion
          const processedData = this.processParsedData(
            parsed.data as Record<string, unknown>[]
          );

          // Store rows in memory; content is generated on demand by getFileContent.
          this.gtfsData[fileName] = {
            content: '',
            data: processedData,
            errors: parsed.errors,
          };

          const tableName = this.getTableName(fileName);

          if (processedData.length > 0) {
            if (CONFIG.LARGE_TABLES.has(tableName)) {
              // Large table: store raw CSV blob instead of per-row IDB insert
              loadingStateManager.updateProgress(
                operation,
                progress + 5,
                `Saving ${fileName} blob (${processedData.length} records)...`
              );
              await this.gtfsDatabase.saveLargeTableBlob(
                tableName,
                fileContent
              );
              if (tableName === 'stop_times') {
                this.buildStopTimeIndexes(processedData as StopTimes[]);
                this.registerStopTimesAsVirtual();
              }
            } else {
              loadingStateManager.updateProgress(
                operation,
                progress + 5,
                `Storing ${fileName} (${processedData.length} records)...`
              );
              // eslint-disable-next-line no-console
              console.time(`[GTFS] insertRows: ${fileName}`);
              await this.gtfsDatabase.insertRows(tableName, processedData);
              // eslint-disable-next-line no-console
              console.timeEnd(`[GTFS] insertRows: ${fileName}`);
            }
          }
        } else if (fileName.endsWith('.geojson')) {
          // Handle GeoJSON files
          const geoJsonData = JSON.parse(fileContent);
          this.gtfsData[fileName] = {
            content: fileContent,
            data: geoJsonData,
            errors: [],
          };

          // Store GeoJSON in IndexedDB as well
          const tableName = this.getTableName(fileName);
          await this.gtfsDatabase.insertRows(tableName, [
            geoJsonData as GTFSDatabaseRecord,
          ]);
        }
        // eslint-disable-next-line no-console
        console.timeEnd(`[GTFS] file: ${fileName}`);
      }

      if (unknownFiles.length > 0) {
        loadingStateManager.showWarning(
          `Ignoring unknown files: ${unknownFiles.join(', ')}`
        );
      }

      // Ensure all 31 GTFS files are registered — fill in header-only for those not in the ZIP.
      for (const filename of ALL_GTFS_FILES) {
        if (!this.gtfsData[filename]) {
          this.gtfsData[filename] = {
            content: makeHeaderOnlyCSV(filename),
            data: [],
            errors: [],
          };
        }
      }

      loadingStateManager.updateProgress(operation, 90, 'Finalizing...');
      loadingStateManager.updateProgress(operation, 100, 'Complete!');
      loadingStateManager.finishLoading(operation);
      loadingStateManager.showSuccess(
        `Successfully loaded ${files.length} GTFS files`
      );

      // eslint-disable-next-line no-console
      console.log('Loaded GTFS data to IndexedDB and memory:', this.gtfsData);
      // eslint-disable-next-line no-console
      console.timeEnd('[GTFS] parseFile total');
      return this.gtfsData;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading GTFS file:', error);
      loadingStateManager.finishLoading(operation);
      loadingStateManager.showError(
        `Failed to load GTFS file: ${error.message}`
      );
      throw error;
    }
  }

  private getTableName(fileName: string): string {
    return fileName.replace('.txt', '').replace('.geojson', '');
  }

  async parseFromURL(url: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[GTFSParser] Fetching GTFS from URL:', url);
    let response: Response;
    try {
      response = await fetch(url);
    } catch (networkError) {
      const msg =
        networkError instanceof TypeError
          ? `Network error — could not reach ${url}. Check your connection or whether the server allows cross-origin requests (CORS).`
          : `Fetch failed: ${networkError instanceof Error ? networkError.message : String(networkError)}`;
      // eslint-disable-next-line no-console
      console.error('[GTFSParser]', msg, networkError);
      throw new Error(msg);
    }

    if (!response.ok) {
      const msg = `HTTP ${response.status} ${response.statusText} from ${url}`;
      // eslint-disable-next-line no-console
      console.error('[GTFSParser]', msg);
      throw new Error(msg);
    }

    // eslint-disable-next-line no-console
    console.log('[GTFSParser] Download complete, parsing ZIP...');
    const blob = await response.blob();
    await this.parseFile(blob);
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

        if (CONFIG.LARGE_TABLES.has(tableName)) {
          // Large table: update memory + schedule blob persist, skip IDB rows
          if (tableName === 'stop_times') {
            this.buildStopTimeIndexes(rows as StopTimes[]);
            this.registerStopTimesAsVirtual();
          }
          this.invalidateBlobForTable(tableName);
        } else {
          // Clear existing rows for this table
          await this.gtfsDatabase.clearTable(tableName);
          // Insert new rows with type coercion, matching the import path
          if (rows.length > 0) {
            await this.gtfsDatabase.insertRows(tableName, rows);
          }
        }
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
      const headers = Object.keys(fileData.data[0]);
      fileData.content = [
        headers.join(','),
        ...fileData.data.map((row) =>
          headers.map((h) => this.formatFieldForExport(h, row[h])).join(',')
        ),
      ].join('\n');
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
        this.gtfsData[fileName].data = parsed.data;
        this.gtfsData[fileName].errors = parsed.errors;
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
      // eslint-disable-next-line no-console
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
    // Rebuild indexes and re-register virtual table so closures point at the new array
    const tableName = this.getTableName(fileName);
    if (tableName === 'stop_times') {
      this.buildStopTimeIndexes(data as StopTimes[]);
      this.registerStopTimesAsVirtual();
      this.invalidateBlobForTable('stop_times');
    } else if (CONFIG.LARGE_TABLES.has(tableName)) {
      this.invalidateBlobForTable(tableName);
    }
  }

  // Type-safe synchronous file data retrieval
  getFileDataSyncTyped<T extends GTFSTableName>(
    fileName: `${T}.txt`
  ): GTFSTableMap[T][] {
    return this.getFileDataSync(fileName) as GTFSTableMap[T][];
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
            // Generate CSV content from IndexedDB data
            let csvContent = '';

            if (fileName.endsWith('.txt')) {
              const headers = Object.keys(rows[0]);
              csvContent = [
                headers.join(','),
                ...rows.map((row) =>
                  headers
                    .map((header) =>
                      this.formatFieldForExport(header, row[header])
                    )
                    .join(',')
                ),
              ].join('\n');
            } else if (fileName.endsWith('.geojson')) {
              // For GeoJSON, use the stored data directly
              csvContent = JSON.stringify(rows[0], null, 2);
            }

            zip.file(fileName, csvContent);
          } else {
            // Fallback: IDB empty but memory has rows — generate CSV from data
            // eslint-disable-next-line no-console
            console.warn(
              `No data in IndexedDB for ${fileName}, generating from memory`
            );
            zip.file(fileName, this.getFileContent(fileName));
          }
        } catch (dbError) {
          // Fallback to in-memory data if IndexedDB fails
          // eslint-disable-next-line no-console
          console.warn(
            `IndexedDB error for ${fileName}, generating from memory:`,
            dbError
          );
          zip.file(fileName, this.getFileContent(fileName));
        }
      }

      return await zip.generateAsync({ type: 'blob' });
    } catch (error) {
      // eslint-disable-next-line no-console
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
    const stopTimes = await this.getFileDataTyped(GTFS_TABLES.STOP_TIMES);

    if (!routes || !trips || !stopTimes) {
      return [];
    }

    // Find trips that serve this stop
    const tripsAtStop = stopTimes
      .filter((st) => st.stop_id === stop_id)
      .map((st) => st.trip_id);

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

    // Add stop to in-memory data
    this.gtfsData[fileName].data.push(stop);

    // Insert into database
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

        // Update coordinates in memory
        stopsData.data[stopIndex].stop_lat = lat.toString();
        stopsData.data[stopIndex].stop_lon = lng.toString();

        // Update in database
        const updateData = {
          stop_lat: lat.toString(),
          stop_lon: lng.toString(),
        };
        await this.gtfsDatabase.updateRow(tableName, stopId, updateData);

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
