/**
 * Database Fallback Manager
 * Handles IndexedDB support detection, error recovery, and graceful fallbacks
 */
import { GTFSDatabaseRecord } from './gtfs-database.js';
import { loadingStateManager } from './loading-state-manager.js';
import { showModal } from './modal-utils.js';

export interface BrowserCapabilities {
  indexedDB: boolean;
  serviceWorker: boolean;
  localStorage: boolean;
  storageQuota: number | null;
  browserInfo: {
    name: string;
    version: string;
    isPrivate: boolean;
  };
}

export class DatabaseFallbackManager {
  private capabilities: BrowserCapabilities | null = null;
  private fallbackData: { [tableName: string]: GTFSDatabaseRecord[] } = {};
  private isUsingFallback: boolean = false;
  private warningShown: boolean = false;

  constructor() {
    this.detectCapabilities();
  }

  /**
   * Detect browser capabilities and limitations
   */
  async detectCapabilities(): Promise<BrowserCapabilities> {
    if (this.capabilities) {
      return this.capabilities;
    }

    const capabilities: BrowserCapabilities = {
      indexedDB: this.checkIndexedDBSupport(),
      serviceWorker: 'serviceWorker' in navigator,
      localStorage: this.checkLocalStorageSupport(),
      storageQuota: await this.getStorageQuota(),
      browserInfo: this.getBrowserInfo(),
    };

    // Check for private/incognito mode
    capabilities.browserInfo.isPrivate = await this.detectPrivateMode();

    this.capabilities = capabilities;

    // Show warnings if needed
    if (!capabilities.indexedDB) {
      this.showIndexedDBUnsupportedWarning();
    } else if (capabilities.browserInfo.isPrivate) {
      this.showPrivateModeWarning();
    } else if (
      capabilities.storageQuota &&
      capabilities.storageQuota < 50 * 1024 * 1024
    ) {
      this.showLowStorageWarning(capabilities.storageQuota);
    }

    return capabilities;
  }

  /**
   * Check if IndexedDB is supported
   */
  private checkIndexedDBSupport(): boolean {
    try {
      return (
        'indexedDB' in window &&
        window.indexedDB !== null &&
        typeof window.indexedDB.open === 'function'
      );
    } catch (error) {
      console.warn('IndexedDB support check failed:', error);
      return false;
    }
  }

  /**
   * Check if localStorage is supported
   */
  private checkLocalStorageSupport(): boolean {
    try {
      const testKey = '__gtfs_zone_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available storage quota
   */
  private async getStorageQuota(): Promise<number | null> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        return estimate.quota || null;
      } catch (error) {
        console.warn('Storage quota detection failed:', error);
      }
    }
    return null;
  }

  /**
   * Get browser information
   */
  private getBrowserInfo(): {
    name: string;
    version: string;
    isPrivate: boolean;
  } {
    const userAgent = navigator.userAgent;
    let name = 'Unknown';
    let version = 'Unknown';

    if (userAgent.includes('Chrome')) {
      name = 'Chrome';
      const match = userAgent.match(/Chrome\/(\d+)/);
      version = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Firefox')) {
      name = 'Firefox';
      const match = userAgent.match(/Firefox\/(\d+)/);
      version = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Safari')) {
      name = 'Safari';
      const match = userAgent.match(/Version\/(\d+)/);
      version = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Edge')) {
      name = 'Edge';
      const match = userAgent.match(/Edge\/(\d+)/);
      version = match ? match[1] : 'Unknown';
    }

    return { name, version, isPrivate: false };
  }

  /**
   * Detect private/incognito mode
   */
  private async detectPrivateMode(): Promise<boolean> {
    try {
      // Try to create a small IndexedDB to detect private mode
      return new Promise((resolve) => {
        const request = indexedDB.open('__gtfs_zone_private_test__', 1);

        request.onerror = () => resolve(true);
        request.onsuccess = () => {
          // Clean up
          const db = request.result;
          db.close();
          indexedDB.deleteDatabase('__gtfs_zone_private_test__');
          resolve(false);
        };

        // Timeout fallback
        setTimeout(() => resolve(false), 1000);
      });
    } catch {
      return true;
    }
  }

  /**
   * Show IndexedDB unsupported warning
   */
  private showIndexedDBUnsupportedWarning(): void {
    if (this.warningShown) {
      return;
    }
    this.warningShown = true;

    const modal = document.createElement('div');
    modal.className = 'modal modal-open';
    modal.innerHTML = `
      <div class="modal-box">
        <h3 class="font-bold text-lg text-error">⚠️ Limited Browser Support</h3>
        <div class="py-4">
          <p class="mb-3">Your browser doesn't support IndexedDB, which is required for handling large GTFS files efficiently.</p>
          <div class="alert alert-warning">
            <div>
              <strong>Limitations:</strong>
              <ul class="list-disc list-inside mt-2">
                <li>Files larger than 10MB may cause performance issues</li>
                <li>Data will not persist between browser sessions</li>
                <li>Some features may be unavailable</li>
              </ul>
            </div>
          </div>
          <p class="mt-3"><strong>Recommended browsers:</strong> Chrome 23+, Firefox 10+, Safari 7+, Edge 12+</p>
        </div>
        <div class="modal-action">
          <button class="btn btn-primary" id="continue-anyway">Continue Anyway</button>
          <button class="btn btn-outline" id="learn-more">Learn More</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const continueBtn = modal.querySelector(
      '#continue-anyway'
    ) as HTMLButtonElement;
    const learnMoreBtn = modal.querySelector(
      '#learn-more'
    ) as HTMLButtonElement;

    continueBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
      this.isUsingFallback = true;
    });

    learnMoreBtn.addEventListener('click', () => {
      window.open('https://caniuse.com/indexeddb', '_blank');
    });
  }

  /**
   * Show private mode warning
   */
  private showPrivateModeWarning(): void {
    if (this.warningShown) {
      return;
    }
    this.warningShown = true;

    const notification = document.createElement('div');
    notification.className =
      'alert alert-warning fixed top-20 left-4 right-4 z-50 shadow-lg';
    notification.innerHTML = `
      <div>
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.996-.833-2.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <div>
          <strong>Private/Incognito Mode Detected</strong>
          <div class="text-sm">Data persistence may be limited. Consider using regular browsing mode for better experience.</div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="this.parentElement.parentElement.remove()">✕</button>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 10000);
  }

  /**
   * Show low storage warning
   */
  private showLowStorageWarning(quota: number): void {
    const quotaMB = Math.round(quota / (1024 * 1024));
    console.warn(`Low storage quota detected: ${quotaMB}MB`);

    const notification = document.createElement('div');
    notification.className =
      'alert alert-info fixed top-20 left-4 right-4 z-50 shadow-lg';
    notification.innerHTML = `
      <div>
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <strong>Limited Storage Available</strong>
          <div class="text-sm">Available storage: ~${quotaMB}MB. Large GTFS files may not load properly.</div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="this.parentElement.parentElement.remove()">✕</button>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 8000);
  }

  /**
   * Create a fallback database interface that uses memory storage
   */
  createFallbackDatabase(): FallbackDatabase {
    this.isUsingFallback = true;
    return new FallbackDatabase(this);
  }

  /**
   * Check if currently using fallback mode
   */
  isInFallbackMode(): boolean {
    return this.isUsingFallback;
  }

  /**
   * Get current capabilities
   */
  getCapabilities(): BrowserCapabilities | null {
    return this.capabilities;
  }

  /**
   * Store data in fallback storage
   */
  setFallbackData(tableName: string, data: GTFSDatabaseRecord[]): void {
    this.fallbackData[tableName] = data;
  }

  /**
   * Get data from fallback storage
   */
  getFallbackData(tableName: string): GTFSDatabaseRecord[] {
    return this.fallbackData[tableName] || [];
  }

  /**
   * Clear all fallback data
   */
  clearFallbackData(): void {
    this.fallbackData = {};
  }

  /**
   * Show database error with recovery options
   */
  showDatabaseError(error: Error | unknown, context: string): void {
    // Convert to proper Error object if needed
    const err =
      error instanceof Error
        ? error
        : new Error(String(error || 'Unknown error'));

    console.error(`Database error in ${context}:`, err);
    console.error('Stack trace:', err.stack);

    let errorMessage = 'Database operation failed';
    let recoveryOptions: Array<{ label: string; action: () => void }> = [];

    // Categorize error types
    if (err.name === 'QuotaExceededError' || err.message?.includes('quota')) {
      errorMessage =
        'Storage quota exceeded. The GTFS file is too large for available storage.';
      recoveryOptions = [
        {
          label: 'Clear Database',
          action: () => this.showDatabaseResetDialog(),
        },
        {
          label: 'Use Memory Mode',
          action: () => this.switchToFallbackMode(),
        },
      ];
    } else if (
      err.name === 'InvalidStateError' ||
      err.message?.includes('corrupt')
    ) {
      errorMessage = 'Database appears to be corrupted.';
      recoveryOptions = [
        {
          label: 'Reset Database',
          action: () => this.showDatabaseResetDialog(),
        },
        {
          label: 'Download Backup',
          action: () => this.downloadDatabaseBackup(),
        },
      ];
    } else if (err.name === 'VersionError') {
      errorMessage =
        'Database version conflict detected. This may happen when using multiple tabs.';
      recoveryOptions = [
        {
          label: 'Reload Page',
          action: () => window.location.reload(),
        },
      ];
    } else {
      errorMessage = `Database error: ${err.message || err.name || 'Unknown error'}`;
      recoveryOptions = [
        {
          label: 'Try Again',
          action: () => window.location.reload(),
        },
        {
          label: 'Use Memory Mode',
          action: () => this.switchToFallbackMode(),
        },
      ];
    }

    void showModal({
      title: 'Database Error',
      body: errorMessage,
      actions: recoveryOptions.map((opt) => ({
        label: opt.label,
        className: 'btn-outline',
        onClick: async () => opt.action(),
      })),
    });
  }

  /**
   * Switch to fallback mode
   */
  private switchToFallbackMode(): void {
    this.isUsingFallback = true;
    loadingStateManager.showError(
      'Switched to memory-only mode. Data will not persist between sessions.'
    );
    window.location.reload();
  }

  /**
   * Show database reset dialog
   */
  private showDatabaseResetDialog(): void {
    void showModal({
      title: 'Reset Database',
      body: 'This will permanently delete all stored GTFS data. Make sure to export any important data before proceeding.',
      actions: [
        {
          label: 'Reset Database',
          className: 'btn-error',
          onClick: async () => {
            await this.resetDatabase();
          },
        },
        {
          label: 'Cancel',
          className: 'btn-outline',
          onClick: async () => {},
        },
      ],
    });
  }

  /**
   * Reset the database completely
   */
  private async resetDatabase(): Promise<void> {
    try {
      loadingStateManager.startLoading('reset', 'Resetting database...');

      // Delete the database
      await new Promise<void>((resolve, reject) => {
        const deleteReq = indexedDB.deleteDatabase('GTFSZoneDB');
        deleteReq.onsuccess = () => resolve();
        deleteReq.onerror = () => reject(deleteReq.error);
        deleteReq.onblocked = () => {
          console.warn('Database deletion blocked - other tabs may be open');
          resolve(); // Continue anyway
        };
      });

      loadingStateManager.finishLoading('reset');
      loadingStateManager.showSuccess(
        'Database reset successfully. Reloading page...'
      );

      // Reload page after brief delay
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      loadingStateManager.finishLoading('reset');
      loadingStateManager.showError(
        'Failed to reset database. Please clear browser data manually.'
      );
      console.error('Database reset failed:', error);
    }
  }

  /**
   * Download database backup (fallback data)
   */
  private downloadDatabaseBackup(): void {
    try {
      const backup = {
        timestamp: new Date().toISOString(),
        data: this.fallbackData,
        metadata: {
          browser: this.capabilities?.browserInfo,
          capabilities: this.capabilities,
        },
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gtfs-zone-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      loadingStateManager.showSuccess(
        'Database backup downloaded successfully'
      );
    } catch (error) {
      loadingStateManager.showError('Failed to create database backup');
      console.error('Backup creation failed:', error);
    }
  }
}

/**
 * Fallback database implementation using memory storage
 */
class FallbackDatabase {
  private manager: DatabaseFallbackManager;

  constructor(manager: DatabaseFallbackManager) {
    this.manager = manager;
  }

  async initialize(): Promise<void> {
    console.log('Using fallback memory storage');
  }

  async clearDatabase(): Promise<void> {
    this.manager.clearFallbackData();
  }

  async insertRows(
    tableName: string,
    rows: GTFSDatabaseRecord[]
  ): Promise<void> {
    const existingData = this.manager.getFallbackData(tableName);
    const newData = [...existingData, ...rows];
    this.manager.setFallbackData(tableName, newData);
  }

  async getRow(
    tableName: string,
    key: string
  ): Promise<GTFSDatabaseRecord | undefined> {
    const data = this.manager.getFallbackData(tableName);
    const keyPath = this.getNaturalKeyPath(tableName);

    if (keyPath) {
      // Simple natural key lookup
      return data.find((row) => row[keyPath] === key);
    } else {
      // Composite key lookup - key should be a composite key string
      return data.find(
        (row) => this.generateCompositeKey(tableName, row) === key
      );
    }
  }

  async updateRow(
    tableName: string,
    key: string,
    data: Partial<GTFSDatabaseRecord>
  ): Promise<void> {
    const tableData = this.manager.getFallbackData(tableName);
    const keyPath = this.getNaturalKeyPath(tableName);

    let index = -1;
    if (keyPath) {
      // Simple natural key lookup
      index = tableData.findIndex((row) => row[keyPath] === key);
    } else {
      // Composite key lookup
      index = tableData.findIndex(
        (row) => this.generateCompositeKey(tableName, row) === key
      );
    }

    if (index >= 0) {
      tableData[index] = { ...tableData[index], ...data };
      this.manager.setFallbackData(tableName, tableData);
    }
  }

  async getAllRows(tableName: string): Promise<GTFSDatabaseRecord[]> {
    return this.manager.getFallbackData(tableName);
  }

  /**
   * Get the natural key path for a table (copied from GTFSDatabase)
   */
  private getNaturalKeyPath(tableName: string): string | null {
    switch (tableName) {
      case 'agency':
        return 'agency_id';
      case 'routes':
        return 'route_id';
      case 'stops':
        return 'stop_id';
      case 'trips':
        return 'trip_id';
      case 'calendar':
        return 'service_id';
      case 'shapes':
        return 'shape_id';
      case 'fare_attributes':
        return 'fare_id';
      case 'fare_rules':
        return 'fare_id';
      case 'locations':
        return 'location_id';
      // Composite key tables use out-of-line keys
      case 'stop_times':
      case 'calendar_dates':
      case 'frequencies':
      case 'transfers':
      case 'feed_info':
        return null; // Out-of-line keys for composite/special cases
      default:
        return null; // Default to out-of-line keys for unknown tables
    }
  }

  /**
   * Generate composite key for tables that need it (copied from GTFSDatabase)
   */
  private generateCompositeKey(
    tableName: string,
    row: GTFSDatabaseRecord
  ): string {
    switch (tableName) {
      case 'stop_times':
        return `${row.trip_id}:${row.stop_sequence}`;
      case 'calendar_dates':
        return `${row.service_id}:${row.date}`;
      case 'frequencies':
        return `${row.trip_id}:${row.start_time}`;
      case 'transfers':
        return row.from_stop_id as string; // Simple key
      case 'feed_info':
        return 'project'; // Fixed key for single-record table
      default: {
        // For tables with simple natural keys, fall back to first meaningful field
        const keyPath = this.getNaturalKeyPath(tableName);
        return keyPath ? (row[keyPath] as string) : 'unknown';
      }
    }
  }

  async queryRows(
    tableName: string,
    filter?: { [key: string]: string | number | boolean }
  ): Promise<GTFSDatabaseRecord[]> {
    const data = this.manager.getFallbackData(tableName);
    if (!filter) {
      return data;
    }

    return data.filter((row) => {
      return Object.entries(filter).every(([key, value]) => {
        return row[key] === value;
      });
    });
  }

  async clearTable(tableName: string): Promise<void> {
    this.manager.setFallbackData(tableName, []);
  }

  close(): void {
    // No-op for memory storage
  }

  async getDatabaseStats(): Promise<{
    size: number;
    tables: { [tableName: string]: number };
  }> {
    const tables: { [tableName: string]: number } = {};
    let totalRecords = 0;

    // Count records in fallback data
    Object.keys(this.manager['fallbackData']).forEach((tableName) => {
      const count = this.manager.getFallbackData(tableName).length;
      tables[tableName] = count;
      totalRecords += count;
    });

    return {
      size: totalRecords * 512, // Rough estimate
      tables,
    };
  }

  async compactDatabase(): Promise<void> {
    console.log('Compaction not needed for memory storage');
  }

  async bulkUpdateRows(
    tableName: string,
    updates: Array<{ id: number; data: Partial<GTFSDatabaseRecord> }>
  ): Promise<void> {
    for (const update of updates) {
      await this.updateRow(tableName, update.id, update.data);
    }
  }

  async searchAllTables(
    searchTerm: string,
    limit: number = 100
  ): Promise<{ [tableName: string]: GTFSDatabaseRecord[] }> {
    const results: { [tableName: string]: GTFSDatabaseRecord[] } = {};
    const searchLower = searchTerm.toLowerCase();

    const searchTables = ['agencies', 'routes', 'stops', 'trips'];

    for (const tableName of searchTables) {
      const data = this.manager.getFallbackData(tableName);
      const matches = data
        .filter((row) => {
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

    return results;
  }

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
}

// Global singleton instance
export const databaseFallbackManager = new DatabaseFallbackManager();
