import { CONFIG } from '../config.js';
import Clusterize from 'clusterize.js';
import {
  getGTFSFieldDescription,
  createTooltip,
} from '../utils/zod-tooltip-helper.js';
import { renderSpecDescriptionPlain } from '../utils/spec-markup.js';
import {
  generateCompositeKeyFromRecord,
  getGTFSPrimaryKey,
} from '../utils/gtfs-primary-keys.js';

interface GTFSParser {
  updateFileInMemory(fileName: string, content: string): void;
  getFileContent(fileName: string): string;
  getFileData(fileName: string): Promise<unknown[] | null>;
  updateFileContent(fileName: string, content: string): Promise<void>;
  gtfsDatabase: {
    updateRow(
      tableName: string,
      key: string,
      data: Record<string, unknown>
    ): Promise<void>;
  };
  // Add other methods as needed
}

interface PatchManagerRef {
  recordUpdate(
    table: string,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): Promise<void>;
}

interface PendingUpdate {
  rowIndex: number;
  rowData: CSVRow;
  originalInput: HTMLInputElement | null;
}

type CSVRow = Record<string, string | number | boolean>;

export class Editor {
  private currentFile: string | null = null;
  private tableData: CSVRow[] | null = null;
  private gtfsParser: GTFSParser | null = null;
  private clusterize: Clusterize | null = null;
  private headers: string[] = [];
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private pendingBeforeRows: Map<number, CSVRow> = new Map();
  private patchManager: PatchManagerRef | null = null;
  private debounceTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = CONFIG.DEBOUNCE_DELAY;

  initialize(gtfsParser: GTFSParser): void {
    this.gtfsParser = gtfsParser;
  }

  setPatchManager(pm: PatchManagerRef): void {
    this.patchManager = pm;
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
    this.pendingBeforeRows.clear();
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
      if (!this.gtfsParser) {
        return;
      }
      const data = await this.gtfsParser.getFileData(this.currentFile);

      if (!data || data.length === 0) {
        if (tableContainer) {
          tableContainer.innerHTML =
            '<div class="p-4 text-center text-gray-500">No data available</div>';
        }
        return;
      }

      // Get headers from first row
      this.headers = Object.keys(data[0] as Record<string, unknown>);
      this.tableData = data as CSVRow[];

      // Determine which columns are PK fields (read-only)
      const tableName = this.currentFile.replace('.txt', '');
      const pkConfig = getGTFSPrimaryKey(tableName);
      let pkFields: Set<string>;
      if (pkConfig?.type === 'all_fields') {
        pkFields = new Set(this.headers);
      } else if (pkConfig?.type === 'none' || !pkConfig) {
        pkFields = new Set();
      } else {
        pkFields = new Set(pkConfig.fields);
      }

      // Create table container with proper structure for Clusterize.js
      if (tableContainer) {
        tableContainer.innerHTML = `
      <div class="clusterize-scroll" id="scrollArea">
        <table class="clusterize-table" id="table">
          <thead>
            <tr>
              ${this.headers
                .map((header) => {
                  const description = renderSpecDescriptionPlain(
                    getGTFSFieldDescription(this.currentFile || '', header)
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
        const lockIcon =
          '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
        const rows = (data as CSVRow[]).map((row: CSVRow, rowIndex: number) => {
          const cells = this.headers
            .map((header) => {
              const value = row[header] || '';
              if (pkFields.has(header)) {
                return `<td class="bg-base-200 opacity-70 px-2 select-text"><span class="font-mono text-sm flex items-center gap-1">${lockIcon}${this.escapeHtml(String(value))}</span></td>`;
              }
              return `<td><input type="text" value="${this.escapeHtml(String(value))}" data-row="${rowIndex}" data-col="${header}" /></td>`;
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

    // Capture before state for this row before any mutation
    if (!this.pendingBeforeRows.has(rowIndex)) {
      this.pendingBeforeRows.set(rowIndex, { ...this.tableData[rowIndex] });
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
    if (
      this.pendingUpdates.size === 0 ||
      !this.currentFile ||
      !this.gtfsParser
    ) {
      return;
    }

    try {
      const tableName = this.currentFile.replace('.txt', '');
      const updates = Array.from(this.pendingUpdates.values());

      // Track rows already patched to emit one patch per row
      const patchedRows = new Set<number>();

      // Perform batch updates to IndexedDB using natural keys
      for (const update of updates) {
        // Generate natural key for the row data
        const naturalKey = generateCompositeKeyFromRecord(
          tableName,
          update.rowData
        );

        await this.gtfsParser.gtfsDatabase.updateRow(
          tableName,
          naturalKey,
          update.rowData
        );

        // Record patch once per row (combining all column changes)
        if (this.patchManager && !patchedRows.has(update.rowIndex)) {
          patchedRows.add(update.rowIndex);
          const beforeRow = this.pendingBeforeRows.get(update.rowIndex);
          if (beforeRow && this.tableData) {
            const afterRow = {
              ...this.tableData[update.rowIndex],
            } as Record<string, unknown>;
            await this.patchManager.recordUpdate(
              tableName,
              naturalKey,
              beforeRow as Record<string, unknown>,
              afterRow
            );
          }
        }

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
      this.pendingBeforeRows.clear();

      console.log(`Saved ${updates.length} table cell updates to IndexedDB`);
    } catch (error) {
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
