import JSZip from 'jszip';
import Papa from 'papaparse';
import { CONFIG } from '../config.js';
import { GTFSDatabase, GTFSDatabaseRecord } from './gtfs-database.js';
import { GTFS_FILES, GTFSFilePresence, GTFS_TABLES } from '../types/gtfs.js';
import { loadingStateManager } from './loading-state-manager.js';
import { ALL_GTFS_FILES, makeHeaderOnlyCSV } from './gtfs-file-registry.js';
import { GTFSTableMap } from '../types/gtfs-entities.js';

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
        if (count === 0) {
          continue;
        }

        const fileName = tableName.endsWith('.txt')
          ? tableName
          : `${tableName}.txt`;

        try {
          const data = await this.gtfsDatabase.getAllRows(tableName);

          if (data && data.length > 0) {
            const headers = Object.keys(data[0]);
            const csvContent = [
              headers.join(','),
              ...data.map((row: GTFSDatabaseRecord) =>
                headers.map((header) => row[header] || '').join(',')
              ),
            ].join('\n');

            this.gtfsData[fileName] = {
              content: csvContent,
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

    // eslint-disable-next-line no-console
    console.log('[new-feed] initializeEmpty() start');
    for (const filename of ALL_GTFS_FILES) {
      const content = makeHeaderOnlyCSV(filename);
      this.gtfsData[filename] = { content, data: [], errors: [] };
    }
    // eslint-disable-next-line no-console
    console.log('[new-feed] initializeEmpty() done', {
      keys: Object.keys(this.gtfsData),
    });
  }

  async parseFile(
    file: File | Blob
  ): Promise<{ [fileName: string]: GTFSFileData }> {
    const operation = 'parseFile';

    try {
      // eslint-disable-next-line no-console
      console.log('Loading GTFS file:', (file as File).name || 'blob');

      // Start loading indicator
      loadingStateManager.startLoading(operation, 'Loading GTFS file...');

      // Clear existing data from database
      loadingStateManager.updateProgress(
        operation,
        10,
        'Clearing existing data...'
      );
      await this.gtfsDatabase.clearDatabase();

      loadingStateManager.updateProgress(
        operation,
        20,
        'Extracting ZIP file...'
      );
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(file);

      // Parse all text files in the ZIP
      const files = Object.keys(zipContent.files).filter(
        (name) => name.endsWith('.txt') || name.endsWith('.geojson')
      );

      this.gtfsData = {};
      const totalFiles = files.length;

      for (let i = 0; i < files.length; i++) {
        const fileName = files[i];
        const progress = 20 + 60 * (i / totalFiles); // 20-80% for file processing

        loadingStateManager.updateProgress(
          operation,
          progress,
          `Processing ${fileName}...`
        );
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

          // Store in memory for compatibility
          this.gtfsData[fileName] = {
            content: fileContent,
            data: processedData,
            errors: parsed.errors,
          };

          // Store in IndexedDB
          const tableName = this.getTableName(fileName);
          if (processedData.length > 0) {
            loadingStateManager.updateProgress(
              operation,
              progress + 5,
              `Storing ${fileName} (${processedData.length} records)...`
            );
            await this.gtfsDatabase.insertRows(tableName, processedData);
          }
        } else if (fileName.endsWith('.geojson')) {
          // Handle GeoJSON files
          this.gtfsData[fileName] = {
            content: fileContent,
            data: JSON.parse(fileContent),
            errors: [],
          };

          // Store GeoJSON in IndexedDB as well
          const tableName = this.getTableName(fileName);
          const geoJsonData = JSON.parse(fileContent);
          await this.gtfsDatabase.insertRows(tableName, [
            geoJsonData as GTFSDatabaseRecord,
          ]);
        }
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

  // Type-safe helper to get table name as GTFSTableName
  private getTypedTableName(fileName: string): GTFSTableName | null {
    const tableName = this.getTableName(fileName);
    // Check if the table name is a valid GTFS entity type
    if (tableName in ({} as GTFSTableMap)) {
      return tableName as GTFSTableName;
    }
    return null;
  }

  // Type-safe parsing method that returns properly typed entities
  private parseCSVWithType<T extends keyof GTFSTableMap>(
    content: string,
    _tableName: T
  ): { data: GTFSTableMap[T][]; errors: Papa.ParseError[] } {
    const parsed = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
    });

    return {
      data: parsed.data as GTFSTableMap[T][],
      errors: parsed.errors,
    };
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
        this.gtfsData[fileName].data = parsed.data;
        this.gtfsData[fileName].errors = parsed.errors;

        // Update IndexedDB with new data
        const tableName = this.getTableName(fileName);

        // Clear existing rows for this table
        await this.gtfsDatabase.clearTable(tableName);

        // Insert new rows
        const rows = parsed.data as GTFSDatabaseRecord[];
        if (rows.length > 0) {
          await this.gtfsDatabase.insertRows(tableName, rows);
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
    return this.gtfsData[fileName]?.content || '';
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
  getFileDataSync(fileName: string): GTFSDatabaseRecord[] | null {
    return this.gtfsData[fileName]?.data || null;
  }

  // Directly replace the in-memory data array for a file (used by PatchManager)
  setInMemoryFileData(fileName: string, data: GTFSDatabaseRecord[]): void {
    if (!this.gtfsData[fileName]) {
      this.gtfsData[fileName] = { content: '', data: [], errors: [] };
    }
    this.gtfsData[fileName].data = data;
  }

  // Type-safe synchronous file data retrieval
  getFileDataSyncTyped<T extends GTFSTableName>(
    fileName: `${T}.txt`
  ): GTFSTableMap[T][] | null {
    const data = this.getFileDataSync(fileName);
    return data as GTFSTableMap[T][] | null;
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
            // Fallback to memory content if IndexedDB is empty but memory has rows
            // eslint-disable-next-line no-console
            console.warn(
              `No data in IndexedDB for ${fileName}, using memory content`
            );
            zip.file(fileName, this.gtfsData[fileName].content);
          }
        } catch (dbError) {
          // Fallback to memory content if IndexedDB fails
          // eslint-disable-next-line no-console
          console.warn(
            `IndexedDB error for ${fileName}, using memory content:`,
            dbError
          );
          zip.file(fileName, this.gtfsData[fileName].content);
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
    const stopTimes = this.getFileDataSyncTyped(GTFS_TABLES.STOP_TIMES);

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
