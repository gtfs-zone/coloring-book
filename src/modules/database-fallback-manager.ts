/**
 * Database Fallback Manager
 * Handles IndexedDB support detection and error recovery.
 */
import { feedProgressIndicator } from 'interlocking/modules/feed-progress-indicator';
import { notify } from 'interlocking/modules/notification-system';
import { showModal } from 'interlocking/modules/modal-utils';
import { deleteDatabaseWithTimeout } from '../utils/idb-request';
import { buildExportFilename } from '../utils/export-filename';

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
  // Memoizes the in-flight run, not just the result: the constructor starts
  // one and boot asks for another before it settles, and two concurrent runs
  // race each other over the private-mode probe database.
  private detection: Promise<BrowserCapabilities> | null = null;
  private closeConnection: (() => void) | null = null;

  constructor() {
    void this.detectCapabilities();
  }

  /**
   * Register how to close the app's own database connection, so the reset path
   * can release it instead of blocking the delete on it.
   */
  setConnectionCloser(close: () => void): void {
    this.closeConnection = close;
  }

  /**
   * Detect browser capabilities and limitations
   */
  detectCapabilities(): Promise<BrowserCapabilities> {
    if (this.capabilities) {
      return Promise.resolve(this.capabilities);
    }
    if (!this.detection) {
      this.detection = this.runDetection();
    }
    return this.detection;
  }

  private async runDetection(): Promise<BrowserCapabilities> {
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
      return new Promise((resolve) => {
        const request = indexedDB.open('__gtfs_zone_private_test__', 1);

        request.onerror = () => resolve(true);
        request.onsuccess = () => {
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
   * Get current capabilities
   */
  getCapabilities(): BrowserCapabilities | null {
    return this.capabilities;
  }

  /**
   * Show a database error modal with error details and recovery options.
   * Optionally accepts an export function: when provided, an "Export & Clear" button is shown.
   */
  showDatabaseError(
    error: Error | unknown,
    context: string,
    exportFn?: () => Promise<Blob | null>
  ): void {
    const err =
      error instanceof Error
        ? error
        : new Error(String(error || 'Unknown error'));

    console.error(`Database error in ${context}:`, err);

    const stack = err.stack ?? 'No stack trace available';
    const body = `
      <p class="mb-2">A database error occurred during <strong>${context}</strong>.</p>
      <div class="rounded bg-base-200 px-3 py-2 font-mono text-sm mb-3">
        <span class="text-error font-bold">${err.name}</span>: ${err.message || 'Unknown error'}
      </div>
      <details class="text-xs">
        <summary class="cursor-pointer text-base-content/60 hover:text-base-content">Stack trace (for developers)</summary>
        <pre class="mt-2 overflow-x-auto whitespace-pre-wrap bg-base-200 p-2 rounded">${stack}</pre>
      </details>
    `;

    const actions: {
      label: string;
      className: string;
      onClick: () => Promise<void>;
    }[] = [];

    if (exportFn) {
      actions.push({
        label: 'Export & Clear',
        className: 'btn-primary',
        onClick: async () => {
          const blob = await exportFn();
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Recovery path: the DB is being cleared, so no feed identity.
            a.download = buildExportFilename();
            a.click();
            URL.revokeObjectURL(url);
          }
          await this.resetDatabase();
        },
      });
    }

    actions.push({
      label: 'Clear & Reload',
      className: 'btn-error',
      onClick: async () => {
        await this.resetDatabase();
      },
    });

    void showModal({ title: 'Database Error', body, actions });
  }

  /**
   * Show database reset confirmation dialog
   */
  showDatabaseResetDialog(): void {
    void showModal({
      title: 'Reset Database',
      body: 'This will permanently delete all stored GTFS data. Make sure to export any important data before proceeding.',
      enterAction: 0,
      escapeAction: 1,
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
   * Reset the database completely.
   *
   * Deleting is blocked while any connection to the database is open, and a
   * blocked delete stays queued: until it runs, every later request on that
   * database, including the version probe on the next page load, waits behind
   * it without firing a single event. So this closes our own connection first,
   * and never reports success or reloads on a delete that has not happened.
   */
  private async resetDatabase(): Promise<void> {
    feedProgressIndicator.startLoading('reset', 'Resetting database...');
    try {
      this.closeConnection?.();

      const outcome = await deleteDatabaseWithTimeout('GTFSZoneDB');

      if (outcome === 'deleted') {
        notify.success('Database reset successfully. Reloading page...');
        setTimeout(() => window.location.reload(), 1500);
        return;
      }

      if (outcome === 'blocked') {
        // The delete runs on its own the moment the last connection closes, so
        // the reload is held until it does rather than landing on a wedge.
        void showModal({
          title: 'Close the other tabs',
          body: 'Another GTFS.zone tab still has the database open, so it cannot be reset. Close every other GTFS.zone tab, then reload this page to finish the reset.',
          enterAction: 0,
          actions: [
            {
              label: 'Reload',
              className: 'btn-primary',
              onClick: async () => {
                window.location.reload();
              },
            },
          ],
        });
        return;
      }

      notify.error(
        'Failed to reset database. Please clear browser data manually.'
      );
    } catch (error) {
      notify.error(
        'Failed to reset database. Please clear browser data manually.'
      );

      console.error('Database reset failed:', error);
    } finally {
      feedProgressIndicator.finishLoading('reset');
    }
  }
}

// Global singleton instance
export const databaseFallbackManager = new DatabaseFallbackManager();
