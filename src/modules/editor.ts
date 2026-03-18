import { CONFIG } from '../config.js';
import Clusterize from 'clusterize.js';
import {
  getGTFSFieldDescription,
  createTooltip,
} from '../utils/zod-tooltip-helper.js';

interface GTFSParser {
  updateFileInMemory(fileName: string, content: string): void;
  getFileContent(fileName: string): string;
  getFileData(fileName: string): Promise<unknown[]>;
  updateFileContent(fileName: string, content: string): Promise<void>;
  gtfsDatabase: {
    updateRow(
      tableName: string,
      key: string,
      data: Record<string, unknown>
    ): Promise<void>;
    getNaturalKeyFields(tableName: string): string[];
    generateKey(tableName: string, data: Record<string, unknown>): string;
  };
  // Add other methods as needed
}

type CSVRow = Record<string, string | number | boolean>;

export class Editor {
  private currentFile: string | null = null;
  private tableData: CSVRow[] | null = null;
  private gtfsParser: GTFSParser | null = null;
  private clusterize: Clusterize | null = null;
  private headers: string[] = [];
  private pendingUpdates: Map<string, string | number | boolean> = new Map();
  private debounceTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = CONFIG.DEBOUNCE_DELAY;

  initialize(gtfsParser: GTFSParser): void {
    this.gtfsParser = gtfsParser;
  }

  async openFile(fileName: string): Promise<void> {
    if (!this.gtfsParser) {
      return;
    }

    const content = this.gtfsParser.getFileContent(fileName);
    if (!content) {
      return;
    }

    // Clear table data when switching to a new file
    this.tableData = null;

    // Update current file
    this.currentFile = fileName;
    const fileNameElement = document.getElementById('current-file-name');
    if (fileNameElement) {
      fileNameElement.textContent = fileName;
    }

    // Show table editor view
    const tableView = document.getElementById('table-editor-view');
    if (tableView) {
      tableView.classList.remove('hidden');
    }

    await this.buildTableEditor();
  }

  async closeEditor(): Promise<void> {
    // Flush any pending database updates
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    await this.flushPendingUpdates();

    // Clean up Clusterize instance
    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }

    // Clear pending updates
    this.pendingUpdates.clear();
    this.currentFile = null;
  }

  clearEditor() {
    this.currentFile = null;

    // Clear table view
    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }
    this.tableData = null;
  }

  async buildTableEditor() {
    if (!this.currentFile) {
      return;
    }

    // Show loading state
    const tableContainer = document.getElementById('table-editor');
    if (tableContainer) {
      tableContainer.innerHTML =
        '<div class="p-4 text-center">Loading table data...</div>';
    }

    try {
      // Load data from IndexedDB
      const data = await this.gtfsParser.getFileData(this.currentFile);

      if (!data || data.length === 0) {
        if (tableContainer) {
          tableContainer.innerHTML =
            '<div class="p-4 text-center text-gray-500">No data available</div>';
        }
        return;
      }

      // Get headers from first row
      this.headers = Object.keys(data[0]);
      this.tableData = data;

      // Create table container with proper structure for Clusterize.js
      if (tableContainer) {
        tableContainer.innerHTML = `
      <div class="clusterize-scroll" id="scrollArea">
        <table class="clusterize-table" id="table">
          <thead>
            <tr>
              ${this.headers
                .map((header) => {
                  const description = getGTFSFieldDescription(
                    this.currentFile || '',
                    header
                  );
                  const headerText = this.escapeHtml(header);
                  return description
                    ? `<th>${createTooltip(headerText, description)}</th>`
                    : `<th>${headerText}</th>`;
                })
                .join('')}
            </tr>
          </thead>
          <tbody class="clusterize-content" id="contentArea">
          </tbody>
        </table>
      </div>
    `;

        // Generate row data for Clusterize.js
        const rows = data.map((row: CSVRow, rowIndex: number) => {
          const cells = this.headers
            .map((header) => {
              const value = row[header] || '';
              return `<td><input type="text" value="${this.escapeHtml(value)}" data-row="${rowIndex}" data-col="${header}" /></td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        });

        // Destroy existing Clusterize instance if it exists
        if (this.clusterize) {
          this.clusterize.destroy();
        }

        // Initialize Clusterize.js
        this.clusterize = new Clusterize({
          rows: rows,
          scrollId: 'scrollArea',
          contentId: 'contentArea',
          rows_in_block: CONFIG.CLUSTERIZE_ROWS_IN_BLOCK,
          blocks_in_cluster: CONFIG.CLUSTERIZE_BLOCKS_IN_CLUSTER,
          tag: 'tr', // Table row tag
        });

        // Add event delegation for input changes since rows are dynamically created
        const scrollArea = document.getElementById('scrollArea');
        if (scrollArea) {
          scrollArea.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target && target.tagName === 'INPUT' && target.dataset.row) {
              this.updateTableCell(target);
            }
          });

          // Add input event for real-time updates
          scrollArea.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (target && target.tagName === 'INPUT' && target.dataset.row) {
              this.updateTableCell(target);
            }
          });
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error building table editor:', error);
      if (tableContainer) {
        tableContainer.innerHTML =
          '<div class="p-4 text-center text-red-500">Error loading table data</div>';
      }
    }
  }

  updateTableCell(input: HTMLInputElement): void {
    const rowStr = input.dataset.row;
    const col = input.dataset.col;
    const value = input.value;

    if (!rowStr || !col || !this.tableData || !this.currentFile) {
      return;
    }

    const rowIndex = parseInt(rowStr);
    if (!this.tableData[rowIndex]) {
      return;
    }

    // Update local table data immediately for UI responsiveness
    this.tableData[rowIndex][col] = value;

    // Add visual indicator that changes are pending
    input.classList.add('pending-save');

    // Store the pending update
    const updateKey = `${rowIndex}-${col}`;
    this.pendingUpdates.set(updateKey, {
      rowIndex,
      rowData: { ...this.tableData[rowIndex] },
      originalInput: input,
    });

    // Debounce the database write
    this.debounceDatabaseUpdate();
  }

  async saveCurrentFileChanges() {
    if (!this.currentFile || !this.gtfsParser) {
      return;
    }

    await this.flushPendingUpdates();
  }

  private debounceDatabaseUpdate(): void {
    // Clear existing timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    // Set new timeout
    this.debounceTimeout = setTimeout(async () => {
      await this.flushPendingUpdates();
    }, this.DEBOUNCE_DELAY);
  }

  private async flushPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0 || !this.currentFile) {
      return;
    }

    try {
      const tableName = this.currentFile.replace('.txt', 's');
      const updates = Array.from(this.pendingUpdates.values());

      // Perform batch updates to IndexedDB using natural keys
      for (const update of updates) {
        // Generate natural key for the row data
        const naturalKey = this.gtfsParser.gtfsDatabase.generateKey(
          tableName,
          update.rowData
        );

        await this.gtfsParser.gtfsDatabase.updateRow(
          tableName,
          naturalKey,
          update.rowData
        );

        // Remove pending indicator
        if (update.originalInput) {
          update.originalInput.classList.remove('pending-save');
          update.originalInput.classList.add('saved');

          // Remove saved indicator after a short delay
          setTimeout(() => {
            if (update.originalInput) {
              update.originalInput.classList.remove('saved');
            }
          }, 1000);
        }
      }

      // Clear pending updates
      this.pendingUpdates.clear();

      // eslint-disable-next-line no-console
      console.log(`Saved ${updates.length} table cell updates to IndexedDB`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error saving table updates to IndexedDB:', error);

      // Mark all pending inputs as having errors
      this.pendingUpdates.forEach((update) => {
        if (update.originalInput) {
          update.originalInput.classList.remove('pending-save');
          update.originalInput.classList.add('save-error');
        }
      });
    }
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getCurrentFile() {
    return this.currentFile;
  }
}
