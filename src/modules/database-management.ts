/**
 * Database Management Interface
 * Provides user-facing tools for database management, backup, and recovery
 */
import { GTFSDatabase } from './gtfs-database.js';
import { databaseFallbackManager } from './database-fallback-manager.js';
import { loadingStateManager } from './loading-state-manager.js';

export interface DatabaseBackup {
  version: string;
  timestamp: string;
  metadata: {
    tables: { [tableName: string]: number };
    totalRecords: number;
    databaseSize: number;
    browserInfo: {
      name: string;
      version: string;
      userAgent: string;
    };
  };
  data: { [tableName: string]: Record<string, string | number | boolean>[] };
}

export class DatabaseManagement {
  private database: GTFSDatabase;

  constructor(database: GTFSDatabase) {
    this.database = database;
  }

  /**
   * Show database management interface
   */
  showManagementInterface(): void {
    const modal = document.createElement('div');
    modal.id = 'database-management-modal';
    modal.className = 'modal modal-open';
    modal.innerHTML = `
      <div class="modal-box max-w-4xl">
        <h3 class="font-bold text-lg mb-4">🗄️ Database Management</h3>

        <!-- Database Status -->
        <div class="mb-6">
          <h4 class="font-semibold mb-2">Database Status</h4>
          <div id="database-status" class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="stat bg-base-200 rounded">
              <div class="stat-title">Storage Mode</div>
              <div class="stat-value text-sm" id="storage-mode">Loading...</div>
            </div>
            <div class="stat bg-base-200 rounded">
              <div class="stat-title">Total Records</div>
              <div class="stat-value text-sm" id="total-records">Loading...</div>
            </div>
            <div class="stat bg-base-200 rounded">
              <div class="stat-title">Database Size</div>
              <div class="stat-value text-sm" id="database-size">Loading...</div>
            </div>
          </div>
        </div>

        <!-- Table Information -->
        <div class="mb-6">
          <h4 class="font-semibold mb-2">Table Information</h4>
          <div class="overflow-x-auto">
            <table class="table table-compact w-full">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Records</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="table-info">
                <tr><td colspan="3" class="text-center">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Management Actions -->
        <div class="mb-6">
          <h4 class="font-semibold mb-2">Management Actions</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

            <!-- Backup Section -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h5 class="card-title text-sm">Backup & Export</h5>
                <p class="text-sm opacity-70">Create backups and export data</p>
                <div class="card-actions">
                  <button class="btn btn-sm btn-primary" id="create-backup">Create Backup</button>
                  <button class="btn btn-sm btn-outline" id="export-csv">Export CSV</button>
                </div>
              </div>
            </div>

            <!-- Recovery Section -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h5 class="card-title text-sm">Recovery & Import</h5>
                <p class="text-sm opacity-70">Restore from backup or import data</p>
                <div class="card-actions">
                  <button class="btn btn-sm btn-secondary" id="restore-backup">Restore Backup</button>
                  <input type="file" id="backup-file-input" class="hidden" accept=".json">
                </div>
              </div>
            </div>

            <!-- Maintenance Section -->
            <div class="card bg-base-200">
              <div class="card-body">
                <h5 class="card-title text-sm">Maintenance</h5>
                <p class="text-sm opacity-70">Database optimization and cleanup</p>
                <div class="card-actions">
                  <button class="btn btn-sm btn-info" id="compact-database">Compact Database</button>
                  <button class="btn btn-sm btn-outline" id="check-integrity">Check Integrity</button>
                </div>
              </div>
            </div>

            <!-- Reset Section -->
            <div class="card bg-error text-error-content">
              <div class="card-body">
                <h5 class="card-title text-sm">Danger Zone</h5>
                <p class="text-sm opacity-70">Destructive operations</p>
                <div class="card-actions">
                  <button class="btn btn-sm btn-error" id="reset-database">Reset Database</button>
                  <button class="btn btn-sm btn-outline btn-error" id="clear-cache">Clear Cache</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Browser Information -->
        <div class="mb-4">
          <details class="collapse collapse-arrow bg-base-200">
            <summary class="collapse-title text-sm font-medium">Browser & Compatibility Information</summary>
            <div class="collapse-content">
              <div id="browser-info" class="text-sm space-y-2">
                Loading browser information...
              </div>
            </div>
          </details>
        </div>

        <div class="modal-action">
          <button class="btn btn-outline" id="close-management">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Load initial data
    this.loadDatabaseStatus();
    this.loadBrowserInfo();
    this.attachEventListeners(modal);
  }

  /**
   * Load and display database status
   */
  private async loadDatabaseStatus(): Promise<void> {
    try {
      const stats = await this.database.getDatabaseStats();
      // Get capabilities but not currently used in this context
      // const capabilities = databaseFallbackManager.getCapabilities();

      // Update status displays
      const storageModeEl = document.getElementById('storage-mode');
      const totalRecordsEl = document.getElementById('total-records');
      const databaseSizeEl = document.getElementById('database-size');

      if (storageModeEl) {
        storageModeEl.textContent = 'IndexedDB';
        storageModeEl.className = 'stat-value text-sm text-success';
      }

      if (totalRecordsEl) {
        const totalRecords = Object.values(stats.tables).reduce(
          (sum, count) => sum + count,
          0
        );
        totalRecordsEl.textContent = totalRecords.toLocaleString();
      }

      if (databaseSizeEl) {
        const sizeMB = Math.round((stats.size / (1024 * 1024)) * 100) / 100;
        databaseSizeEl.textContent = `${sizeMB} MB`;
      }

      // Update table information
      this.loadTableInfo(stats.tables);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load database status:', error);
      const statusEl = document.getElementById('database-status');
      if (statusEl) {
        statusEl.innerHTML =
          '<div class="alert alert-error">Failed to load database status</div>';
      }
    }
  }

  /**
   * Load table information
   */
  private loadTableInfo(tables: { [tableName: string]: number }): void {
    const tableInfoEl = document.getElementById('table-info');
    if (!tableInfoEl) {
      return;
    }

    const tableRows = Object.entries(tables)
      .filter(([_tableName, count]) => count > 0)
      .map(
        ([tableName, count]) => `
        <tr>
          <td>${tableName}</td>
          <td>${count.toLocaleString()}</td>
          <td>
            <button class="btn btn-xs btn-outline" onclick="dbManagement.clearTable('${tableName}')">Clear</button>
            <button class="btn btn-xs btn-ghost" onclick="dbManagement.exportTable('${tableName}')">Export</button>
          </td>
        </tr>
      `
      )
      .join('');

    tableInfoEl.innerHTML =
      tableRows ||
      '<tr><td colspan="3" class="text-center opacity-60">No data tables found</td></tr>';
  }

  /**
   * Load browser information
   */
  private async loadBrowserInfo(): Promise<void> {
    const capabilities = await databaseFallbackManager.detectCapabilities();
    const browserInfoEl = document.getElementById('browser-info');

    if (!browserInfoEl) {
      return;
    }

    const quotaMB = capabilities.storageQuota
      ? Math.round(capabilities.storageQuota / (1024 * 1024))
      : 'Unknown';

    browserInfoEl.innerHTML = `
      <div><strong>Browser:</strong> ${capabilities.browserInfo.name} ${capabilities.browserInfo.version}</div>
      <div><strong>IndexedDB Support:</strong> ${capabilities.indexedDB ? '✅ Yes' : '❌ No'}</div>
      <div><strong>LocalStorage Support:</strong> ${capabilities.localStorage ? '✅ Yes' : '❌ No'}</div>
      <div><strong>Service Worker Support:</strong> ${capabilities.serviceWorker ? '✅ Yes' : '❌ No'}</div>
      <div><strong>Storage Quota:</strong> ${quotaMB} MB</div>
      <div><strong>Private Mode:</strong> ${capabilities.browserInfo.isPrivate ? '⚠️ Yes' : '✅ No'}</div>
    `;
  }

  /**
   * Attach event listeners to management interface
   */
  private attachEventListeners(modal: HTMLElement): void {
    const closeBtn = modal.querySelector(
      '#close-management'
    ) as HTMLButtonElement;
    closeBtn?.addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Backup actions
    modal
      .querySelector('#create-backup')
      ?.addEventListener('click', () => this.createBackup());
    modal
      .querySelector('#export-csv')
      ?.addEventListener('click', () => this.exportCSV());

    // Recovery actions
    modal.querySelector('#restore-backup')?.addEventListener('click', () => {
      const fileInput = modal.querySelector(
        '#backup-file-input'
      ) as HTMLInputElement;
      fileInput?.click();
    });

    const fileInput = modal.querySelector(
      '#backup-file-input'
    ) as HTMLInputElement;
    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.restoreBackup(file);
      }
    });

    // Maintenance actions
    modal
      .querySelector('#compact-database')
      ?.addEventListener('click', () => this.compactDatabase());
    modal
      .querySelector('#check-integrity')
      ?.addEventListener('click', () => this.checkIntegrity());

    // Danger zone actions
    modal
      .querySelector('#reset-database')
      ?.addEventListener('click', () => this.resetDatabase());
    modal
      .querySelector('#clear-cache')
      ?.addEventListener('click', () => this.clearCache());
  }

  /**
   * Create a full database backup
   */
  async createBackup(): Promise<void> {
    try {
      loadingStateManager.startLoading('backup', 'Creating database backup...');

      const stats = await this.database.getDatabaseStats();
      const capabilities = databaseFallbackManager.getCapabilities();

      const backup: DatabaseBackup = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        metadata: {
          tables: stats.tables,
          totalRecords: Object.values(stats.tables).reduce(
            (sum, count) => sum + count,
            0
          ),
          databaseSize: stats.size,
          browserInfo: capabilities?.browserInfo,
        },
        data: {},
      };

      // Export all table data
      for (const [tableName, count] of Object.entries(stats.tables)) {
        if (count > 0) {
          loadingStateManager.updateProgress(
            'backup',
            50,
            `Exporting ${tableName}...`
          );
          backup.data[tableName] = await this.database.getAllRows(tableName);
        }
      }

      // Create download
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

      loadingStateManager.finishLoading('backup');
      loadingStateManager.showSuccess('Database backup created successfully');
    } catch (error) {
      loadingStateManager.finishLoading('backup');
      loadingStateManager.showError(
        `Failed to create backup: ${error.message}`
      );
      // eslint-disable-next-line no-console
      console.error('Backup creation failed:', error);
    }
  }

  /**
   * Restore database from backup file
   */
  async restoreBackup(file: File): Promise<void> {
    try {
      loadingStateManager.startLoading(
        'restore',
        'Restoring database from backup...'
      );

      const content = await file.text();
      const backup: DatabaseBackup = JSON.parse(content);

      // Validate backup format
      if (!backup.version || !backup.data) {
        throw new Error('Invalid backup file format');
      }

      // Clear existing database
      loadingStateManager.updateProgress(
        'restore',
        20,
        'Clearing existing data...'
      );
      await this.database.clearDatabase();

      // Restore data
      // Progress tracking - could be used for UI updates
      // const progress = 20;
      const tableCount = Object.keys(backup.data).length;
      let currentTable = 0;

      for (const [tableName, rows] of Object.entries(backup.data)) {
        currentTable++;
        const tableProgress = 20 + (70 * currentTable) / tableCount;
        loadingStateManager.updateProgress(
          'restore',
          tableProgress,
          `Restoring ${tableName}...`
        );

        if (Array.isArray(rows) && rows.length > 0) {
          // Remove ID fields from backup data (will be auto-generated)
          const cleanRows = rows.map(({ id: _id, ...row }) => row);
          await this.database.insertRows(tableName, cleanRows);
        }
      }

      loadingStateManager.finishLoading('restore');
      loadingStateManager.showSuccess(
        'Database restored successfully. Reloading page...'
      );

      // Reload page after successful restore
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      loadingStateManager.finishLoading('restore');
      loadingStateManager.showError(
        `Failed to restore backup: ${error.message}`
      );
      // eslint-disable-next-line no-console
      console.error('Backup restoration failed:', error);
    }
  }

  /**
   * Export all data as CSV files in a ZIP
   */
  async exportCSV(): Promise<void> {
    try {
      loadingStateManager.startLoading('export', 'Preparing CSV export...');

      // Import JSZip dynamically (assuming it's available)
      const JSZip = (window as Record<string, unknown>).JSZip;
      if (!JSZip) {
        throw new Error('JSZip not available for CSV export');
      }

      const zip = new JSZip();
      const stats = await this.database.getDatabaseStats();

      // Progress tracking - could be used for UI updates
      // const progress = 0;
      const tableCount = Object.values(stats.tables).filter(
        (count) => count > 0
      ).length;
      let currentTable = 0;

      for (const [tableName, count] of Object.entries(stats.tables)) {
        if (count > 0) {
          currentTable++;
          const tableProgress = (90 * currentTable) / tableCount;
          loadingStateManager.updateProgress(
            'export',
            tableProgress,
            `Exporting ${tableName}.csv...`
          );

          const rows = await this.database.getAllRows(tableName);
          const csv = this.convertToCSV(rows);
          zip.file(`${tableName}.csv`, csv);
        }
      }

      loadingStateManager.updateProgress(
        'export',
        95,
        'Generating ZIP file...'
      );
      const blob = await zip.generateAsync({ type: 'blob' });

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gtfs-zone-export-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      loadingStateManager.finishLoading('export');
      loadingStateManager.showSuccess('CSV export completed successfully');
    } catch (error) {
      loadingStateManager.finishLoading('export');
      loadingStateManager.showError(`Failed to export CSV: ${error.message}`);
      // eslint-disable-next-line no-console
      console.error('CSV export failed:', error);
    }
  }

  /**
   * Convert data rows to CSV format
   */
  private convertToCSV(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) {
      return '';
    }

    // Get headers (excluding auto-generated id field)
    const headers = Object.keys(rows[0]).filter((key) => key !== 'id');

    // Create CSV content
    const csvRows = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            if (value === null || value === undefined) {
              return '';
            }
            if (
              typeof value === 'string' &&
              (value.includes(',') ||
                value.includes('\n') ||
                value.includes('"'))
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(',')
      ),
    ];

    return csvRows.join('\n');
  }

  /**
   * Compact the database
   */
  async compactDatabase(): Promise<void> {
    try {
      await this.database.compactDatabase();
      this.loadDatabaseStatus(); // Refresh status
    } catch (error) {
      loadingStateManager.showError(
        `Database compaction failed: ${error.message}`
      );
    }
  }

  /**
   * Check database integrity
   */
  async checkIntegrity(): Promise<void> {
    try {
      loadingStateManager.startLoading(
        'integrity',
        'Checking database integrity...'
      );

      const stats = await this.database.getDatabaseStats();
      let issues = 0;

      // Check each table
      for (const [tableName, count] of Object.entries(stats.tables)) {
        if (count > 0) {
          loadingStateManager.updateProgress(
            'integrity',
            50,
            `Checking ${tableName}...`
          );

          try {
            const rows = await this.database.getAllRows(tableName);
            if (rows.length !== count) {
              issues++;
              // eslint-disable-next-line no-console
              console.warn(
                `Table ${tableName}: expected ${count} rows, found ${rows.length}`
              );
            }
          } catch (error) {
            issues++;
            // eslint-disable-next-line no-console
            console.error(`Table ${tableName}: integrity check failed:`, error);
          }
        }
      }

      loadingStateManager.finishLoading('integrity');

      if (issues === 0) {
        loadingStateManager.showSuccess('Database integrity check passed');
      } else {
        loadingStateManager.showError(
          `Database integrity check found ${issues} issue(s)`
        );
      }
    } catch (error) {
      loadingStateManager.finishLoading('integrity');
      loadingStateManager.showError(`Integrity check failed: ${error.message}`);
    }
  }

  /**
   * Reset the entire database
   */
  private resetDatabase(): void {
    databaseFallbackManager.showDatabaseResetDialog();
  }

  /**
   * Clear browser cache
   */
  private async clearCache(): Promise<void> {
    try {
      // Clear localStorage
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('gtfs_zone')) {
          localStorage.removeItem(key);
        }
      });

      // Clear sessionStorage
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith('gtfs_zone')) {
          sessionStorage.removeItem(key);
        }
      });

      loadingStateManager.showSuccess('Cache cleared successfully');
    } catch (error) {
      loadingStateManager.showError(`Failed to clear cache: ${error.message}`);
    }
  }

  /**
   * Clear a specific table
   */
  async clearTable(tableName: string): Promise<void> {
    try {
      await this.database.clearTable(tableName);
      this.loadDatabaseStatus(); // Refresh status
      loadingStateManager.showSuccess(
        `Table ${tableName} cleared successfully`
      );
    } catch (error) {
      loadingStateManager.showError(
        `Failed to clear table ${tableName}: ${error.message}`
      );
    }
  }

  /**
   * Export a specific table
   */
  async exportTable(tableName: string): Promise<void> {
    try {
      const rows = await this.database.getAllRows(tableName);
      const csv = this.convertToCSV(rows);

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableName}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      loadingStateManager.showSuccess(
        `Table ${tableName} exported successfully`
      );
    } catch (error) {
      loadingStateManager.showError(
        `Failed to export table ${tableName}: ${error.message}`
      );
    }
  }
}

// Make functions available globally for onclick handlers
declare global {
  interface Window {
    dbManagement: DatabaseManagement;
  }
}
