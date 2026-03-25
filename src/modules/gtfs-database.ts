import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { GTFS_FILES } from '../types/gtfs.js';
import { CONFIG } from '../config.js';
import { databaseFallbackManager } from './database-fallback-manager.js';
import { PatchRecord, SnapshotRecord } from '../types/patch.js';
import {
  Agency,
  Routes,
  Stops,
  Trips,
  StopTimes,
  Calendar,
  CalendarDates,
  Shapes,
  Frequencies,
  Transfers,
  FeedInfo,
  FareAttributes,
  FareRules,
  GTFSTableMap,
} from '../types/gtfs-entities.js';
import {
  getNaturalKeyField,
  isNaturalKey,
  generateCompositeKeyFromRecord,
  parseCompositeKey,
  getPrimaryKeyFields,
  isCompositeKey,
} from '../utils/gtfs-primary-keys.js';
import { TimeFormatter } from '../utils/time-formatter.js';

// Keep for backwards compatibility and dynamic operations
export interface GTFSDatabaseRecord {
  id?: number; // Auto-increment primary key
  [key: string]: string | number | boolean | undefined; // Dynamic fields based on CSV columns
}

// Database schema interface for idb with natural GTFS keys
export interface GTFSDBSchema extends DBSchema {
  // Core GTFS tables with natural primary keys
  agencies: {
    key: string; // agency_id
    value: Agency;
  };
  routes: {
    key: string; // route_id
    value: Routes;
  };
  stops: {
    key: string; // stop_id
    value: Stops;
  };
  trips: {
    key: string; // trip_id
    value: Trips;
  };
  stop_times: {
    key: string; // Composite: trip_id + ":" + stop_sequence
    value: StopTimes;
  };
  calendar: {
    key: string; // service_id
    value: Calendar;
  };
  calendar_dates: {
    key: string; // Composite: service_id + ":" + date
    value: CalendarDates;
  };
  shapes: {
    key: string; // shape_id
    value: Shapes;
  };
  frequencies: {
    key: string; // trip_id (frequencies can have multiple records per trip)
    value: Frequencies;
  };
  transfers: {
    key: string; // from_stop_id (primary key per GTFS spec)
    value: Transfers;
  };
  feed_info: {
    key: string; // Single record file, use fixed key "feed_info"
    value: FeedInfo;
  };
  fare_attributes: {
    key: string; // fare_id
    value: FareAttributes;
  };
  fare_rules: {
    key: string; // fare_id
    value: FareRules;
  };
  locations: {
    key: string; // location_id
    value: GTFSDatabaseRecord; // Keep as generic for now since no specific schema exists
  };
  // Patch history stores
  patches: {
    key: number; // autoIncrement version
    value: PatchRecord;
  };
  snapshots: {
    key: number; // last patch version included in this snapshot
    value: SnapshotRecord;
  };
  // Version pointer store
  meta: {
    key: string;
    value: { key: string; currentVersion: number; headVersion: number };
  };
}

export class GTFSDatabase {
  private db: IDBPDatabase<GTFSDBSchema> | null = null;
  private fallbackDB: {
    initialize(): Promise<void>;
    insertRows(tableName: string, rows: GTFSDatabaseRecord[]): Promise<void>;
    getAllRows(tableName: string): Promise<GTFSDatabaseRecord[]>;
    getDatabaseStats(): Promise<{
      tables: Record<string, number>;
      size: number;
    }>;
    clearTable(tableName: string): Promise<void>;
    clearDatabase(): Promise<void>;
    compactDatabase(): Promise<void>;
  } | null = null;
  private readonly dbName = CONFIG.DB_NAME;
  private readonly dbVersion = CONFIG.DB_VERSION;
  private isUsingFallback = false;

  constructor() {}

  /**
   * Initialize database connection and create tables
   */
  async initialize(): Promise<void> {
    try {
      // Check browser capabilities first
      const capabilities = await databaseFallbackManager.detectCapabilities();

      if (!capabilities.indexedDB) {
        // eslint-disable-next-line no-console
        console.warn('IndexedDB not supported, using fallback storage');
        this.fallbackDB = databaseFallbackManager.createFallbackDatabase();
        this.isUsingFallback = true;
        await this.fallbackDB.initialize();
        return;
      }

      // Try to initialize IndexedDB
      this.db = await openDB<GTFSDBSchema>(this.dbName, this.dbVersion, {
        upgrade: (db, oldVersion, newVersion, _transaction) => {
          // eslint-disable-next-line no-console
          console.log(
            `Upgrading database from version ${oldVersion} to ${newVersion}`
          );

          if (oldVersion < 3) {
            // Migration to version 3: Switch to natural GTFS primary keys
            // Clear existing data as we're changing the key structure
            // eslint-disable-next-line no-console
            console.log(
              'Migrating to natural GTFS primary keys - clearing existing data'
            );

            // Delete all existing object stores
            const existingStores = Array.from(db.objectStoreNames);
            existingStores.forEach((storeName) => {
              db.deleteObjectStore(storeName);
            });
          }

          if (oldVersion < 4) {
            // Migration to version 4: add patch history stores
            if (!db.objectStoreNames.contains('patches')) {
              db.createObjectStore('patches', {
                keyPath: 'version',
                autoIncrement: true,
              });
            }
            if (!db.objectStoreNames.contains('snapshots')) {
              db.createObjectStore('snapshots', { keyPath: 'version' });
            }
          }

          if (oldVersion < 5) {
            if (!db.objectStoreNames.contains('meta')) {
              db.createObjectStore('meta', { keyPath: 'key' });
            }
          }

          if (oldVersion < 6) {
            // Remove the non-GTFS project metadata store.
            // All-files-always-registered makes it unnecessary.
            // Cast to IDBDatabase for the deletion since 'project' is no longer in the schema.
            const rawDb = db as unknown as IDBDatabase;
            if (rawDb.objectStoreNames.contains('project')) {
              rawDb.deleteObjectStore('project');
            }
          }

          // Create tables for all possible GTFS files with natural key schema
          const allFiles = GTFS_FILES.map((file) => file.filename);

          allFiles.forEach((fileName) => {
            const tableName = this.getTableName(fileName);
            if (!db.objectStoreNames.contains(tableName)) {
              const keyPath = this.getNaturalKeyPath(tableName);
              const store = db.createObjectStore(tableName, {
                keyPath: keyPath,
                autoIncrement: false, // No auto-increment for natural keys
              });
              // Add indexes for commonly queried fields
              this.addIndexesForTable(store, tableName);
            }
          });

          // eslint-disable-next-line no-console
          console.log('Database schema migration completed');
        },
        blocked: () => {
          databaseFallbackManager.showDatabaseError(
            new Error('Database blocked by another tab'),
            'initialization'
          );
        },
      });

      // eslint-disable-next-line no-console
      console.log('GTFSDatabase initialized successfully');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize GTFSDatabase:', error);

      // Handle different types of errors
      if (error.name === 'VersionError' || error.name === 'InvalidStateError') {
        databaseFallbackManager.showDatabaseError(error, 'initialization');
      } else {
        // Fall back to memory storage
        // eslint-disable-next-line no-console
        console.warn('Falling back to memory storage due to IndexedDB error');
        this.fallbackDB = databaseFallbackManager.createFallbackDatabase();
        this.isUsingFallback = true;
        await this.fallbackDB.initialize();
      }
    }
  }

  /**
   * Convert filename to table name (remove .txt extension, handle special cases)
   */
  private getTableName(fileName: string): string {
    return fileName.replace('.txt', '').replace('.geojson', '');
  }

  /**
   * Get the natural key path for a table (used for object store creation)
   * Now uses the official GTFS specification for primary key determination
   */
  private getNaturalKeyPath(tableName: string): string | null {
    // Use the official GTFS specification to determine if this table has a natural key
    if (isNaturalKey(tableName)) {
      return getNaturalKeyField(tableName);
    }

    // All other tables (composite keys, all-fields keys, etc.) use out-of-line keys
    return null;
  }

  /**
   * Generate composite key for entities with multiple primary key fields
   */
  private generateCompositeKey(
    tableName: string,
    record: GTFSDatabaseRecord
  ): string {
    try {
      const key = generateCompositeKeyFromRecord(tableName, record);
      console.log(
        `DEBUG: Generated key "${key}" for ${tableName} record using GTFS spec`
      );
      return key;
    } catch (error) {
      console.error(`ERROR: Failed to generate key for ${tableName}:`, error);
      console.error('Record:', record);
      throw error;
    }
  }

  /**
   * Parse composite key back into components using GTFS specification
   */
  private parseCompositeKeyFromString(
    tableName: string,
    key: string
  ): Record<string, string> {
    return parseCompositeKey(tableName, key);
  }

  /**
   * Check if a table uses composite keys
   */
  private hasCompositeKey(tableName: string): boolean {
    return isCompositeKey(tableName);
  }

  /**
   * Get composite key fields for a table using GTFS specification
   */
  private getCompositeKeyFields(tableName: string): string[] {
    return getPrimaryKeyFields(tableName);
  }

  /**
   * Get the active database instance (IndexedDB or fallback)
   */
  private getActiveDB(): GTFSDatabase | typeof this.fallbackDB {
    return this.isUsingFallback ? this.fallbackDB : this;
  }

  /**
   * Check if using fallback mode
   */
  isInFallbackMode(): boolean {
    return this.isUsingFallback;
  }

  /**
   * Handle database errors - FAIL HARD, NO FALLBACKS
   */
  private handleDatabaseError(error: unknown, operation: string): never {
    // Convert unknown error to Error object
    const err = error instanceof Error ? error : new Error(String(error));

    // eslint-disable-next-line no-console
    console.error(`CRITICAL DATABASE ERROR in ${operation}:`, err);
    console.error('Stack trace:', err.stack);

    // Enhanced constraint error debugging
    if (err.name === 'ConstraintError' || err.message?.includes('constraint')) {
      console.error('CONSTRAINT ERROR DETAILS:');
      console.error('  Error name:', err.name);
      console.error('  Error message:', err.message);
      console.error('  Operation:', operation);

      // Try to provide more context about what kind of constraint failed
      if (
        err.message?.includes('duplicate') ||
        err.message?.includes('unique')
      ) {
        console.error(
          '  → This appears to be a DUPLICATE KEY constraint violation'
        );
        console.error(
          '  → Check for duplicate primary keys or unique constraints'
        );
      } else if (err.message?.includes('not satisfied')) {
        console.error('  → This appears to be a GENERAL CONSTRAINT violation');
        console.error(
          '  → Could be missing required fields, invalid data types, or key constraints'
        );
      }
    }

    // Show error to user and fail hard
    databaseFallbackManager.showDatabaseError(err, operation);
    throw err;
  }

  /**
   * Add appropriate indexes for each table type
   */
  private addIndexesForTable(store: IDBObjectStore, tableName: string): void {
    switch (tableName) {
      case 'agency':
        // agency_id is now the primary key, no need for separate index
        store.createIndex('agency_name', 'agency_name', { unique: false });
        store.createIndex('agency_url', 'agency_url', { unique: false });
        break;
      case 'routes':
        // route_id is now the primary key, no need for separate index
        store.createIndex('agency_id', 'agency_id', { unique: false });
        store.createIndex('route_short_name', 'route_short_name', {
          unique: false,
        });
        store.createIndex('route_long_name', 'route_long_name', {
          unique: false,
        });
        store.createIndex('route_type', 'route_type', { unique: false });
        store.createIndex('route_color', 'route_color', { unique: false });
        break;
      case 'stops':
        // stop_id is now the primary key, no need for separate index
        store.createIndex('stop_name', 'stop_name', { unique: false });
        store.createIndex('stop_code', 'stop_code', { unique: false });
        store.createIndex('location_type', 'location_type', { unique: false });
        store.createIndex('parent_station', 'parent_station', {
          unique: false,
        });
        // Compound index for geographic searches
        store.createIndex('lat_lon', ['stop_lat', 'stop_lon'], {
          unique: false,
        });
        break;
      case 'trips':
        // trip_id is now the primary key, no need for separate index
        store.createIndex('route_id', 'route_id', { unique: false });
        store.createIndex('service_id', 'service_id', { unique: false });
        store.createIndex('trip_headsign', 'trip_headsign', { unique: false });
        store.createIndex('direction_id', 'direction_id', { unique: false });
        store.createIndex('shape_id', 'shape_id', { unique: false });
        break;
      case 'stop_times':
        store.createIndex('trip_id', 'trip_id', { unique: false });
        store.createIndex('stop_id', 'stop_id', { unique: false });
        store.createIndex('stop_sequence', 'stop_sequence', { unique: false });
        store.createIndex('arrival_time', 'arrival_time', { unique: false });
        store.createIndex('departure_time', 'departure_time', {
          unique: false,
        });
        // Compound indexes for common queries
        store.createIndex('trip_sequence', ['trip_id', 'stop_sequence'], {
          unique: false,
        });
        break;
      case 'calendar':
        // service_id is now the primary key, no need for separate index
        store.createIndex('start_date', 'start_date', { unique: false });
        store.createIndex('end_date', 'end_date', { unique: false });
        break;
      case 'calendar_dates':
        store.createIndex('service_id', 'service_id', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('exception_type', 'exception_type', {
          unique: false,
        });
        break;
      case 'shapes':
        // shape_id is now the primary key, no need for separate index
        store.createIndex('shape_pt_sequence', 'shape_pt_sequence', {
          unique: false,
        });
        // Compound index for shape rendering (still useful for ordering)
        store.createIndex('shape_sequence', ['shape_id', 'shape_pt_sequence'], {
          unique: false,
        });
        break;
      case 'frequencies':
        store.createIndex('trip_id', 'trip_id', { unique: false });
        store.createIndex('start_time', 'start_time', { unique: false });
        store.createIndex('end_time', 'end_time', { unique: false });
        break;
      case 'transfers':
        // from_stop_id is now the primary key, no need for separate index
        store.createIndex('to_stop_id', 'to_stop_id', { unique: false });
        store.createIndex('transfer_type', 'transfer_type', { unique: false });
        break;
      case 'feed_info':
        store.createIndex('feed_publisher_name', 'feed_publisher_name', {
          unique: false,
        });
        store.createIndex('feed_lang', 'feed_lang', { unique: false });
        break;
      case 'fare_attributes':
        // fare_id is now the primary key, no need for separate index
        store.createIndex('agency_id', 'agency_id', { unique: false });
        break;
      case 'fare_rules':
        // fare_id is now the primary key, no need for separate index
        store.createIndex('route_id', 'route_id', { unique: false });
        break;
      case 'locations':
        // location_id is now the primary key, no need for separate index
        store.createIndex('location_name', 'location_name', { unique: false });
        break;
    }
  }

  /**
   * Clear entire database when loading new GTFS file
   */
  async clearDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction(
        Array.from(this.db.objectStoreNames),
        'readwrite'
      );

      // Clear all object stores
      for (const storeName of this.db.objectStoreNames) {
        await transaction.objectStore(storeName).clear();
      }

      await transaction.done;
      // eslint-disable-next-line no-console
      console.log('Database cleared successfully');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to clear database:', error);
      throw error;
    }
  }

  /**
   * Create tables dynamically based on uploaded GTFS files
   */
  async createTablesFromGTFS(fileNames: string[]): Promise<void> {
    // Tables are created during database initialization
    // This method is for future extensibility if we need dynamic table creation
    // eslint-disable-next-line no-console
    console.log('Tables available for files:', fileNames);
  }

  /**
   * Bulk insert CSV rows as records with optimized batching (generic version)
   */
  async insertRows<T extends keyof GTFSTableMap>(
    tableName: T,
    rows: GTFSTableMap[T][]
  ): Promise<void>;
  /**
   * Bulk insert CSV rows as records with optimized batching (legacy version)
   */
  async insertRows(
    tableName: string,
    rows: GTFSDatabaseRecord[]
  ): Promise<void>;
  async insertRows(
    tableName: string,
    rows: GTFSDatabaseRecord[]
  ): Promise<void> {
    if (this.isUsingFallback) {
      return await this.fallbackDB.insertRows(tableName, rows);
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const BATCH_SIZE = 1000; // Optimal batch size for IndexedDB

    try {
      // Process in batches for better performance and memory usage
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await this.insertBatch(tableName, batch);
      }

      // eslint-disable-next-line no-console
      console.log(
        `Inserted ${rows.length} rows into ${tableName} in ${Math.ceil(rows.length / BATCH_SIZE)} batches`
      );
    } catch (error) {
      this.handleDatabaseError(error, 'insertRows');
    }
  }

  /**
   * Insert a single batch of rows within one transaction
   * Updated: Better error handling for null errors
   */
  private async insertBatch(
    tableName: string,
    rows: GTFSDatabaseRecord[]
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    console.log(`DEBUG: Inserting batch for ${tableName}, ${rows.length} rows`);

    const transaction = this.db.transaction(tableName, 'readwrite');
    const store = transaction.objectStore(tableName);
    const keyPath = this.getNaturalKeyPath(tableName);

    console.log(`DEBUG: Table ${tableName} keyPath:`, keyPath);

    // Insert all rows in this batch with appropriate keys
    const promises = rows.map((row, index) => {
      try {
        if (keyPath) {
          // Simple natural key - use the field as key
          const keyValue = row[keyPath];
          console.log(
            `DEBUG: ${tableName} row ${index} - using natural key "${keyPath}" = "${keyValue}"`
          );
          if (!keyValue) {
            console.error(
              `ERROR: ${tableName} row ${index} missing required key field "${keyPath}":`,
              row
            );
            throw new Error(
              `Missing required key field "${keyPath}" in row ${index}`
            );
          }
          return store.add(row);
        } else {
          // Composite key or special case - generate key
          const key = this.generateCompositeKey(tableName, row);
          console.log(
            `DEBUG: ${tableName} row ${index} - generated composite key: "${key}"`
          );
          return store.add(row, key);
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : String(error || 'Unknown error');
        console.error(
          `ERROR: Failed to prepare ${tableName} row ${index} for insertion: ${errorMsg}`,
          row
        );
        const err = error instanceof Error ? error : new Error(errorMsg);
        throw err;
      }
    });

    try {
      await Promise.all(promises);
      await transaction.done;
      console.log(`DEBUG: Successfully inserted batch for ${tableName}`);
    } catch (error) {
      // Convert null/undefined errors to proper Error objects
      const errorMsg =
        error instanceof Error
          ? error.message
          : String(error || 'Unknown error');
      const err =
        error instanceof Error
          ? error
          : new Error(`Batch insertion failed for ${tableName}: ${errorMsg}`);
      console.error(
        `ERROR: Batch insertion failed for ${tableName}: ${errorMsg}`
      );
      console.error('First few rows in failed batch:', rows.slice(0, 3));
      throw err;
    }
  }

  /**
   * Replace rows in database (delete old records and insert new ones in single transaction)
   * Useful when primary key fields need to be updated
   */
  async replaceRows<T extends keyof GTFSTableMap>(
    tableName: T,
    oldKeys: string[],
    newRows: GTFSTableMap[T][]
  ): Promise<void>;
  async replaceRows(
    tableName: string,
    oldKeys: string[],
    newRows: GTFSDatabaseRecord[]
  ): Promise<void>;
  async replaceRows(
    tableName: string,
    oldKeys: string[],
    newRows: GTFSDatabaseRecord[]
  ): Promise<void> {
    if (this.isUsingFallback) {
      // Fallback: delete and insert separately
      for (const key of oldKeys) {
        await this.fallbackDB.deleteRow(tableName, key);
      }
      return await this.fallbackDB.insertRows(tableName, newRows);
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction(tableName, 'readwrite');
      const store = transaction.objectStore(tableName);
      const keyPath = this.getNaturalKeyPath(tableName);

      // Delete old records
      const deletePromises = oldKeys.map((key) => store.delete(key));
      await Promise.all(deletePromises);

      // Insert new records
      const insertPromises = newRows.map((row, index) => {
        if (keyPath) {
          const keyValue = row[keyPath];
          if (!keyValue) {
            throw new Error(
              `Missing required key field "${keyPath}" in replacement row ${index}`
            );
          }
          return store.add(row);
        } else {
          const key = this.generateCompositeKey(tableName, row);
          return store.add(row, key);
        }
      });
      await Promise.all(insertPromises);

      await transaction.done;

      console.log(
        `Replaced ${oldKeys.length} rows with ${newRows.length} rows in ${tableName}`
      );
    } catch (error) {
      console.error(`Failed to replace rows in ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve single record by natural key (generic version)
   */
  async getRow<T extends keyof GTFSTableMap>(
    tableName: T,
    key: string
  ): Promise<GTFSTableMap[T] | undefined>;
  /**
   * Retrieve single record by natural key (legacy version)
   */
  async getRow(
    tableName: string,
    key: string
  ): Promise<GTFSDatabaseRecord | undefined>;
  async getRow(
    tableName: string,
    key: string
  ): Promise<GTFSDatabaseRecord | undefined> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      return await this.db.get(tableName, key);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get row ${key} from ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Update single record with natural key
   */
  async updateRow(
    tableName: string,
    key: string,
    data: Partial<GTFSDatabaseRecord>
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const existing = await this.getRow(tableName, key);
      if (!existing) {
        throw new Error(`Record ${key} not found in ${tableName}`);
      }

      const updated = { ...existing, ...data };
      const keyPath = this.getNaturalKeyPath(tableName);

      if (keyPath) {
        await this.db.put(tableName, updated);
      } else {
        await this.db.put(tableName, updated, key);
      }

      // eslint-disable-next-line no-console
      console.log(`Updated row ${key} in ${tableName}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to update row ${key} in ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Get all records from table (generic version)
   */
  async getAllRows<T extends keyof GTFSTableMap>(
    tableName: T
  ): Promise<GTFSTableMap[T][]>;
  /**
   * Get all records from table (legacy version)
   */
  async getAllRows(tableName: string): Promise<GTFSDatabaseRecord[]>;
  async getAllRows(tableName: string): Promise<GTFSDatabaseRecord[]> {
    if (this.isUsingFallback) {
      return await this.fallbackDB.getAllRows(tableName);
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      return await this.db.getAll(tableName);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get all rows from ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Filtered queries for search/navigation (generic version)
   */
  async queryRows<T extends keyof GTFSTableMap>(
    tableName: T,
    filter?: { [key: string]: string | number | boolean }
  ): Promise<GTFSTableMap[T][]>;
  /**
   * Filtered queries for search/navigation (legacy version)
   */
  async queryRows(
    tableName: string,
    filter?: { [key: string]: string | number | boolean }
  ): Promise<GTFSDatabaseRecord[]>;
  async queryRows(
    tableName: string,
    filter?: { [key: string]: string | number | boolean }
  ): Promise<GTFSDatabaseRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      if (!filter) {
        return this.getAllRows(tableName);
      }

      // Try to use indexes for better performance
      const filterKeys = Object.keys(filter);
      const transaction = this.db.transaction(tableName, 'readonly');
      const store = transaction.objectStore(tableName);

      // Check if we have an index for the first filter key
      const indexName = filterKeys[0];
      if (store.indexNames.contains(indexName)) {
        const index = store.index(indexName);
        const results = await index.getAll(filter[indexName]);

        // Apply additional filters if needed
        if (filterKeys.length > 1) {
          const remainingFilter = { ...filter };
          delete remainingFilter[indexName];
          return results.filter((row) => {
            return Object.entries(remainingFilter).every(([key, value]) => {
              return row[key] === value;
            });
          });
        }

        return results;
      }

      // Fallback to full table scan
      const allRows = await this.getAllRows(tableName);
      return allRows.filter((row) => {
        return Object.entries(filter).every(([key, value]) => {
          return row[key] === value;
        });
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to query rows from ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Delete single record by natural key
   */
  async deleteRow(tableName: string, key: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction(tableName, 'readwrite');
      await transaction.objectStore(tableName).delete(key);
      await transaction.done;
      // eslint-disable-next-line no-console
      console.log(`Deleted row ${key} from ${tableName}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to delete row ${key} from ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple records by natural keys
   */
  async deleteRows(tableName: string, keys: string[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const BATCH_SIZE = 500; // Batch size for deletions

    try {
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        await this.deleteBatch(tableName, batch);
      }

      // eslint-disable-next-line no-console
      console.log(
        `Deleted ${keys.length} rows from ${tableName} in ${Math.ceil(keys.length / BATCH_SIZE)} batches`
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to delete rows from ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Delete a single batch of rows within one transaction
   */
  private async deleteBatch(tableName: string, keys: string[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const transaction = this.db.transaction(tableName, 'readwrite');
    const store = transaction.objectStore(tableName);

    const promises = keys.map((key) => store.delete(key));
    await Promise.all(promises);
    await transaction.done;
  }

  /**
   * Clear specific table
   */
  async clearTable(tableName: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction(tableName, 'readwrite');
      await transaction.objectStore(tableName).clear();
      await transaction.done;
      // eslint-disable-next-line no-console
      console.log(`Cleared table ${tableName}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to clear table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Bulk update multiple rows with transaction batching
   */
  async bulkUpdateRows(
    tableName: string,
    updates: Array<{ key: string; data: Partial<GTFSDatabaseRecord> }>
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const BATCH_SIZE = 500; // Smaller batch size for updates

    try {
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        await this.updateBatch(tableName, batch);
      }

      // eslint-disable-next-line no-console
      console.log(
        `Updated ${updates.length} rows in ${tableName} in ${Math.ceil(updates.length / BATCH_SIZE)} batches`
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to bulk update rows in ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Update a single batch of rows within one transaction
   */
  private async updateBatch(
    tableName: string,
    updates: Array<{ key: string; data: Partial<GTFSDatabaseRecord> }>
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const transaction = this.db.transaction(tableName, 'readwrite');
    const store = transaction.objectStore(tableName);
    const keyPath = this.getNaturalKeyPath(tableName);

    const promises = updates.map(async ({ key, data }) => {
      const existing = await store.get(key);
      if (existing) {
        const updated = { ...existing, ...data };
        if (keyPath) {
          return store.put(updated);
        } else {
          return store.put(updated, key);
        }
      }
    });

    await Promise.all(promises);
    await transaction.done;
  }

  /**
   * Get database storage usage statistics
   */
  async getDatabaseStats(): Promise<{
    size: number;
    tables: { [tableName: string]: number };
  }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const tables: { [tableName: string]: number } = {};
      let totalRecords = 0;

      // Count records in each table
      for (const tableName of this.db.objectStoreNames) {
        const count = await this.db.count(tableName);
        tables[tableName] = count;
        totalRecords += count;
      }

      // Estimate storage size (rough calculation)
      const estimatedSize = totalRecords * 1024; // 1KB per record estimate

      return {
        size: estimatedSize,
        tables,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get database stats:', error);
      throw error;
    }
  }

  /**
   * Compact database by removing unused space (requires recreation)
   */
  async compactDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // eslint-disable-next-line no-console
      console.log('Starting database compaction...');

      // Get all data from current database
      const backup: { [tableName: string]: GTFSDatabaseRecord[] } = {};
      for (const tableName of this.db.objectStoreNames) {
        backup[tableName] = await this.getAllRows(tableName);
      }

      // Close current database
      this.db.close();

      // Delete the database
      await new Promise<void>((resolve, reject) => {
        const deleteReq = indexedDB.deleteDatabase(this.dbName);
        deleteReq.onsuccess = () => resolve();
        deleteReq.onerror = () => reject(deleteReq.error);
      });

      // Reinitialize database
      await this.initialize();

      // Restore all data
      for (const [tableName, rows] of Object.entries(backup)) {
        if (rows.length > 0) {
          // Data is already in the correct format with natural keys
          await this.insertRows(tableName, rows);
        }
      }

      // eslint-disable-next-line no-console
      console.log('Database compaction completed');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Database compaction failed:', error);
      throw error;
    }
  }

  /**
   * Search across multiple fields using indexes
   */
  async searchAllTables(
    searchTerm: string,
    limit: number = 100
  ): Promise<{ [tableName: string]: GTFSDatabaseRecord[] }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const results: { [tableName: string]: GTFSDatabaseRecord[] } = {};
    const searchLower = searchTerm.toLowerCase();

    try {
      // Search in key tables with name fields
      const searchTables = ['agencies', 'routes', 'stops', 'trips'];

      for (const tableName of searchTables) {
        if (this.db.objectStoreNames.contains(tableName)) {
          const allRows = await this.getAllRows(tableName);
          const matches = allRows
            .filter((row) => {
              // Search in name fields
              const searchFields = this.getSearchableFields(tableName);
              return searchFields.some((field) => {
                const value = row[field];
                return (
                  value && value.toString().toLowerCase().includes(searchLower)
                );
              });
            })
            .slice(0, limit);

          if (matches.length > 0) {
            results[tableName] = matches;
          }
        }
      }

      return results;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Search failed:', error);
      throw error;
    }
  }

  /**
   * Get searchable fields for a table
   */
  private getSearchableFields(tableName: string): string[] {
    switch (tableName) {
      case 'agencies':
        return ['agency_name', 'agency_id'];
      case 'routes':
        return ['route_short_name', 'route_long_name', 'route_id'];
      case 'stops':
        return ['stop_name', 'stop_id', 'stop_code'];
      case 'trips':
        return ['trip_headsign', 'trip_id'];
      default:
        return [];
    }
  }

  // ===== TIMETABLE EDITING CRUD OPERATIONS =====

  /**
   * Insert a new trip record
   */
  async insertTrip(tripData: GTFSDatabaseRecord): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction('trips', 'readwrite');
      const store = transaction.objectStore('trips');
      const trip_id = tripData.trip_id as string;
      await store.add(tripData);
      await transaction.done;
      console.log(`Inserted new trip with ID ${trip_id}`);
      return trip_id;
    } catch (error) {
      console.error('Failed to insert trip:', error);
      throw error;
    }
  }

  /**
   * Update a trip record
   */
  async updateTrip(
    trip_id: string,
    tripData: Partial<GTFSDatabaseRecord>
  ): Promise<void> {
    await this.updateRow('trips', trip_id, tripData);
  }

  /**
   * Delete a trip and all its stop_times
   */
  async deleteTrip(trip_id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction(
        ['trips', 'stop_times'],
        'readwrite'
      );

      // Delete trip record
      await transaction.objectStore('trips').delete(trip_id);

      // Delete all stop_times for this trip
      const stopTimesStore = transaction.objectStore('stop_times');
      const stopTimesIndex = stopTimesStore.index('trip_id');
      const stopTimesCursor = await stopTimesIndex.openCursor(trip_id);

      while (stopTimesCursor) {
        await stopTimesCursor.delete();
        await stopTimesCursor.continue();
      }

      await transaction.done;
      console.log(`Deleted trip ${trip_id} and its stop_times`);
    } catch (error) {
      console.error(`Failed to delete trip ${trip_id}:`, error);
      throw error;
    }
  }

  /**
   * Duplicate a trip with new trip_id
   */
  async duplicateTrip(
    originalTripId: string,
    newTripId: string,
    timeOffset: number = 0
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction(
        ['trips', 'stop_times'],
        'readwrite'
      );

      // Get original trip
      const tripsStore = transaction.objectStore('trips');
      const tripsIndex = tripsStore.index('trip_id');
      const originalTrip = await tripsIndex.get(originalTripId);

      if (!originalTrip) {
        throw new Error(`Trip ${originalTripId} not found`);
      }

      // Create new trip record
      const newTrip = { ...originalTrip, trip_id: newTripId };
      await tripsStore.add(newTrip);

      // Get and duplicate stop_times
      const stopTimesStore = transaction.objectStore('stop_times');
      const stopTimesIndex = stopTimesStore.index('trip_id');
      const stopTimesCursor = await stopTimesIndex.openCursor(originalTripId);

      while (stopTimesCursor) {
        const originalStopTime = stopTimesCursor.value;
        const newStopTime = { ...originalStopTime, trip_id: newTripId };

        // Apply time offset if specified
        if (timeOffset !== 0) {
          if (newStopTime.arrival_time) {
            newStopTime.arrival_time = TimeFormatter.addMinutesToTime(
              newStopTime.arrival_time as string,
              timeOffset
            );
          }
          if (newStopTime.departure_time) {
            newStopTime.departure_time = TimeFormatter.addMinutesToTime(
              newStopTime.departure_time as string,
              timeOffset
            );
          }
        }

        // Generate composite key for stop_times
        const compositeKey = this.generateCompositeKey(
          'stop_times',
          newStopTime
        );
        await stopTimesStore.add(newStopTime, compositeKey);
        await stopTimesCursor.continue();
      }

      await transaction.done;
      console.log(`Duplicated trip ${originalTripId} as ${newTripId}`);
    } catch (error) {
      console.error(`Failed to duplicate trip ${originalTripId}:`, error);
      throw error;
    }
  }

  /**
   * Bulk update stop_times for a trip
   */
  async bulkUpdateStopTimes(
    trip_id: string,
    stopTimeUpdates: Array<{
      stop_id: string;
      stop_sequence: number;
      arrival_time?: string;
      departure_time?: string;
      isSkipped?: boolean;
    }>
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction('stop_times', 'readwrite');
      const store = transaction.objectStore('stop_times');
      const index = store.index('trip_id');

      // Get all existing stop_times for this trip
      const existingStopTimes = await index.getAll(trip_id);

      // Create a map for quick lookup
      const existingMap = new Map(
        existingStopTimes.map((st) => [`${st.stop_id}_${st.stop_sequence}`, st])
      );

      for (const update of stopTimeUpdates) {
        const key = `${update.stop_id}_${update.stop_sequence}`;
        const existing = existingMap.get(key);

        if (existing) {
          // Update existing record
          const updated = { ...existing };
          if (update.arrival_time !== undefined) {
            updated.arrival_time = update.arrival_time;
          }
          if (update.departure_time !== undefined) {
            updated.departure_time = update.departure_time;
          }
          if (update.isSkipped) {
            // Mark as skipped by removing times
            updated.arrival_time = '';
            updated.departure_time = '';
          }
          await store.put(updated);
        } else if (!update.isSkipped) {
          // Insert new stop_time if not skipped
          const newStopTime: GTFSDatabaseRecord = {
            trip_id: trip_id,
            stop_id: update.stop_id,
            stop_sequence: update.stop_sequence,
            arrival_time: update.arrival_time || '',
            departure_time: update.departure_time || update.arrival_time || '',
            pickup_type: 0,
            drop_off_type: 0,
          };
          const compositeKey = this.generateCompositeKey(
            'stop_times',
            newStopTime
          );
          await store.add(newStopTime, compositeKey);
        }
      }

      await transaction.done;
      console.log(`Bulk updated stop_times for trip ${trip_id}`);
    } catch (error) {
      console.error(
        `Failed to bulk update stop_times for trip ${trip_id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Update service/calendar record
   */
  async updateService(
    service_id: string,
    serviceData: Partial<GTFSDatabaseRecord>
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction('calendar', 'readwrite');
      const store = transaction.objectStore('calendar');
      const index = store.index('service_id');
      const existing = await index.get(service_id);

      if (existing) {
        const updated = { ...existing, ...serviceData };
        await store.put(updated);
        console.log(`Updated service ${service_id}`);
      } else {
        // Create new service record
        const newService = { ...serviceData, service_id: service_id };
        await store.add(newService);
        console.log(`Created new service ${service_id}`);
      }

      await transaction.done;
    } catch (error) {
      console.error(`Failed to update service ${service_id}:`, error);
      throw error;
    }
  }

  /**
   * Check referential integrity before deletion
   */
  async checkTripReferences(trip_id: string): Promise<{
    canDelete: boolean;
    blockingReferences: string[];
  }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const blockingReferences: string[] = [];

    try {
      // Check stop_times
      const stopTimes = await this.queryRows('stop_times', {
        trip_id: trip_id,
      });
      if (stopTimes.length > 0) {
        blockingReferences.push(`${stopTimes.length} stop_times records`);
      }

      // Check frequencies
      const frequencies = await this.queryRows('frequencies', {
        trip_id: trip_id,
      });
      if (frequencies.length > 0) {
        blockingReferences.push(`${frequencies.length} frequencies records`);
      }

      return {
        canDelete: blockingReferences.length === 0,
        blockingReferences,
      };
    } catch (error) {
      console.error(`Failed to check references for trip ${trip_id}:`, error);
      return {
        canDelete: false,
        blockingReferences: ['Error checking references'],
      };
    }
  }

  // ===== PATCH HISTORY OPERATIONS =====

  /**
   * Append a patch to the history log. Returns the assigned version number.
   */
  async appendPatch(patch: Omit<PatchRecord, 'version'>): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const version = await this.db.add('patches', patch as PatchRecord);
    return version as number;
  }

  /**
   * Get all patches with a version greater than the given version.
   */
  async getPatchesAfter(version: number): Promise<PatchRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const range = IDBKeyRange.lowerBound(version, true); // exclusive
    return this.db.getAll('patches', range);
  }

  /**
   * Get the most recent snapshot, or undefined if none exists.
   */
  async getLatestSnapshot(): Promise<SnapshotRecord | undefined> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const cursor = await this.db
      .transaction('snapshots')
      .store.openCursor(null, 'prev');
    return cursor?.value;
  }

  /**
   * Persist a snapshot. version should equal the last patch version included.
   */
  async saveSnapshot(record: SnapshotRecord): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    await this.db.put('snapshots', record);
  }

  /**
   * Return the total number of patches stored.
   */
  async getPatchCount(): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db.count('patches');
  }

  /**
   * Get the current and head version pointers from the meta store.
   */
  async getVersions(): Promise<{
    currentVersion: number;
    headVersion: number;
  }> {
    if (!this.db) {
      return { currentVersion: 0, headVersion: 0 };
    }
    const entry = await this.db.get('meta', 'versions');
    return entry
      ? { currentVersion: entry.currentVersion, headVersion: entry.headVersion }
      : { currentVersion: 0, headVersion: 0 };
  }

  /**
   * Persist the current and head version pointers.
   */
  async setVersions(
    currentVersion: number,
    headVersion: number
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    await this.db.put('meta', { key: 'versions', currentVersion, headVersion });
  }

  /**
   * Delete all patches with a version greater than the given version.
   */
  async deletePatchesAfter(version: number): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const range = IDBKeyRange.lowerBound(version, true); // exclusive
    const tx = this.db.transaction('patches', 'readwrite');
    let cursor = await tx.store.openCursor(range);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  /**
   * Get a single patch by its version number.
   */
  async getPatch(version: number): Promise<PatchRecord | undefined> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db.get('patches', version);
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
