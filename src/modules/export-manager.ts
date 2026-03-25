import { notifications } from './notification-system.js';
import type { GTFSParser } from './gtfs-parser.js';
import type { Editor } from './editor.js';

export interface ExportOptions {
  filename: string;
  format: 'zip' | 'json' | 'csv';
  includeOptionalFiles: boolean;
  validateBeforeExport: boolean;
  compression: 'none' | 'fast' | 'best';
}

export interface ExportCallbacks {
  onExportStart?: () => void;
  onExportComplete?: (filename: string, size: number) => void;
  onExportError?: (error: Error) => void;
  onValidationRequired?: () => Promise<boolean>;
}

export class ExportManager {
  private gtfsParser: GTFSParser;
  private editor: Editor;
  private callbacks: ExportCallbacks = {};

  // Default export options
  private defaultOptions: ExportOptions = {
    filename: 'gtfs-modified.zip',
    format: 'zip',
    includeOptionalFiles: true,
    validateBeforeExport: true,
    compression: 'fast',
  };

  constructor(gtfsParser: GTFSParser, editor: Editor) {
    this.gtfsParser = gtfsParser;
    this.editor = editor;
    this.setupEventListeners();
  }

  /**
   * Set callbacks for export events
   */
  public setCallbacks(callbacks: Partial<ExportCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Setup event listeners for export functionality
   */
  private setupEventListeners(): void {
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', this.handleExportClick.bind(this));
    }
  }

  /**
   * Handle export button click
   */
  private handleExportClick(): void {
    this.exportGTFS();
  }

  /**
   * Export GTFS data with specified options
   */
  public async exportGTFS(options: Partial<ExportOptions> = {}): Promise<void> {
    const finalOptions = { ...this.defaultOptions, ...options };
    let loadingNotificationId: string | null = null;

    try {
      // Check if there is any actual data to export (skip if only header-only files)
      if (
        !this.gtfsParser ||
        !this.gtfsParser
          .getAllFileNames()
          .some((f) => this.gtfsParser.getFileDataSync(f).length > 0)
      ) {
        notifications.showWarning(
          'No GTFS data to export. Please add some data first.'
        );
        return;
      }

      console.log('Exporting GTFS data with options:', finalOptions);

      // Validate before export if enabled
      if (
        finalOptions.validateBeforeExport &&
        this.callbacks.onValidationRequired
      ) {
        const isValid = await this.callbacks.onValidationRequired();
        if (!isValid) {
          notifications.showWarning(
            'GTFS data has validation errors. Export cancelled.'
          );
          return;
        }
      }

      // Notify export start
      if (this.callbacks.onExportStart) {
        this.callbacks.onExportStart();
      }

      // Show loading notification
      loadingNotificationId = notifications.showLoading(
        'Preparing GTFS export...'
      );

      // Save current file changes before export
      if (this.editor) {
        this.editor.saveCurrentFileChanges();
      }

      // Generate export based on format
      let blob: Blob;
      let filename: string;

      switch (finalOptions.format) {
        case 'zip':
          blob = await this.exportAsZip(finalOptions);
          filename = finalOptions.filename.endsWith('.zip')
            ? finalOptions.filename
            : `${finalOptions.filename}.zip`;
          break;
        case 'json':
          blob = await this.exportAsJSON(finalOptions);
          filename = finalOptions.filename.endsWith('.json')
            ? finalOptions.filename
            : `${finalOptions.filename}.json`;
          break;
        case 'csv':
          // For CSV, we'd need to implement a multi-file export or specific table export
          throw new Error('CSV export not yet implemented');
        default:
          throw new Error(`Unsupported export format: ${finalOptions.format}`);
      }

      // Download the file
      this.downloadBlob(blob, filename);

      // Notify completion
      if (this.callbacks.onExportComplete) {
        this.callbacks.onExportComplete(filename, blob.size);
      }

      // Remove loading notification and show success
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }

      const sizeText = this.formatFileSize(blob.size);
      notifications.showSuccess(
        `GTFS data exported successfully! (${sizeText})`
      );

      console.log(
        `✅ Successfully exported GTFS data: ${filename} (${sizeText})`
      );
    } catch (error) {
      console.error('Error exporting GTFS:', error);

      // Remove loading notification
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }

      this.handleExportError(error as Error);
    }
  }

  /**
   * Export GTFS data as ZIP file
   */
  private async exportAsZip(_options: ExportOptions): Promise<Blob> {
    // Use the existing export functionality from gtfsParser
    return await this.gtfsParser.exportAsZip();
  }

  /**
   * Export GTFS data as JSON file
   */
  private async exportAsJSON(_options: ExportOptions): Promise<Blob> {
    const fileNames = this.gtfsParser.getAllFileNames();
    const gtfsData: { [filename: string]: unknown[] } = {};

    // Collect all file data
    for (const filename of fileNames) {
      const data = this.gtfsParser.getFileDataSync(filename);
      if (data.length > 0) {
        // Only include optional files if requested
        if (_options.includeOptionalFiles || this.isRequiredFile(filename)) {
          gtfsData[filename] = data;
        }
      }
    }

    // Create metadata
    const metadata = {
      exportedAt: new Date().toISOString(),
      source: 'edit.gtfs.zone',
      version: '1.0',
      format: 'json',
      options: _options,
    };

    const exportObject = {
      metadata,
      data: gtfsData,
    };

    const jsonString = JSON.stringify(exportObject, null, 2);
    return new Blob([jsonString], { type: 'application/json' });
  }

  /**
   * Check if a file is required according to GTFS specification
   */
  private isRequiredFile(filename: string): boolean {
    const requiredFiles = [
      'agency.txt',
      'routes.txt',
      'trips.txt',
      'stops.txt',
      'stop_times.txt',
    ];

    return requiredFiles.includes(filename);
  }

  /**
   * Download blob as file
   */
  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up object URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) {
      return '0 Bytes';
    }

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Handle export errors
   */
  private handleExportError(error: Error): void {
    let errorMessage = 'Failed to export GTFS data';

    if (error.message) {
      errorMessage += `: ${error.message}`;
    }

    // Show error notification with retry action
    notifications.showError(errorMessage, {
      actions: [
        {
          id: 'retry',
          label: 'Try Again',
          primary: true,
          handler: () => {
            this.exportGTFS();
          },
        },
        {
          id: 'save-changes',
          label: 'Save Current Changes',
          handler: () => {
            if (this.editor) {
              this.editor.saveCurrentFileChanges();
              notifications.showInfo('Current file changes saved');
            }
          },
        },
      ],
    });

    // Error callback
    if (this.callbacks.onExportError) {
      this.callbacks.onExportError(error);
    }
  }

  /**
   * Export specific GTFS table as CSV
   */
  public async exportTableAsCSV(filename: string): Promise<void> {
    try {
      const data = this.gtfsParser.getFileDataSync(filename);
      if (data.length === 0) {
        notifications.showWarning(`No data available for ${filename}`);
        return;
      }

      // Convert to CSV format
      const csvContent = this.convertToCSV(data);
      const blob = new Blob([csvContent], { type: 'text/csv' });

      // Download
      const csvFilename = filename.replace('.txt', '.csv');
      this.downloadBlob(blob, csvFilename);

      notifications.showSuccess(`Exported ${filename} as CSV`);
      console.log(`✅ Exported table: ${filename} as ${csvFilename}`);
    } catch (error) {
      console.error(`Error exporting ${filename} as CSV:`, error);
      notifications.showError(`Failed to export ${filename}: ${error.message}`);
    }
  }

  /**
   * Convert data array to CSV format
   */
  private convertToCSV(data: Record<string, unknown>[]): string {
    if (data.length === 0) {
      return '';
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);

    // Create CSV content
    let csv = headers.join(',') + '\n';

    // Add data rows
    data.forEach((row) => {
      const values = headers.map((header) => {
        const value = row[header] || '';
        // Escape commas and quotes in CSV
        if (
          typeof value === 'string' &&
          (value.includes(',') || value.includes('"'))
        ) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csv += values.join(',') + '\n';
    });

    return csv;
  }

  /**
   * Check if export is available (has data)
   */
  public canExport(): boolean {
    return (
      !!this.gtfsParser &&
      this.gtfsParser
        .getAllFileNames()
        .some((f) => this.gtfsParser.getFileDataSync(f).length > 0)
    );
  }

  /**
   * Get export statistics
   */
  public getExportStats(): { fileCount: number; totalRecords: number } {
    if (!this.gtfsParser) {
      return { fileCount: 0, totalRecords: 0 };
    }

    const fileNames = this.gtfsParser.getAllFileNames();
    let totalRecords = 0;

    for (const filename of fileNames) {
      const data = this.gtfsParser.getFileDataSync(filename);
      totalRecords += data.length;
    }

    return {
      fileCount: fileNames.length,
      totalRecords,
    };
  }

  /**
   * Cleanup event listeners
   */
  public destroy(): void {
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.removeEventListener('click', this.handleExportClick);
    }

    // Clear callbacks
    this.callbacks = {};

    console.log('🧹 Export manager destroyed');
  }
}
