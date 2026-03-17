import Papa from 'papaparse';
import { CONFIG } from '../config.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { placeholder } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import Clusterize from 'clusterize.js';
import {
  getGTFSFieldDescription,
  createTooltip,
} from '../utils/zod-tooltip-helper.js';

// Types for CodeMirror streaming
interface StreamParser {
  match(pattern: string | RegExp): string | null;
  next(): string;
  eol(): boolean;
}

interface TokenState {
  lineStart: boolean;
  firstLine: boolean;
}

interface GTFSParser {
  updateFileInMemory(fileName: string, content: string): void;
  refreshRelatedTables(fileName: string): Promise<void>;
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

// Simple Mathematica-inspired syntax highlighting for CSV
const csvMathematicaMode = {
  name: 'csv-mathematica',
  startState: function () {
    return { lineStart: true, firstLine: true };
  },
  token: function (stream: StreamParser, state: TokenState) {
    // Handle quoted strings first
    if (stream.match(/"[^"]*"/)) {
      return 'string'; // Quoted values as strings (green)
    }

    // Handle numbers (integers and floats)
    if (stream.match(/\b\d+\.?\d*\b/)) {
      return 'number'; // Numbers (orange/red)
    }

    // Handle commas
    if (stream.match(/,/)) {
      return 'operator'; // Commas as operators
    }

    // Handle headers on first line
    if (state.firstLine && stream.match(/[A-Za-z][A-Za-z0-9_]*/)) {
      return 'keyword'; // Headers as keywords (blue)
    }

    // Handle IDs and identifiers
    if (stream.match(/[A-Za-z][A-Za-z0-9_]*/)) {
      return 'variable'; // Regular text as variables
    }

    // Reset firstLine at end of first line
    if (stream.eol() && state.firstLine) {
      state.firstLine = false;
    }

    // Default - consume one character
    if (!stream.eol()) {
      stream.next();
    }
    return null;
  },
};

export class Editor {
  private editor: HTMLElement | null = null;
  private editorView: EditorView | null = null;
  private editorElementId: string;
  private currentFile: string | null = null;
  private isTableView: boolean = false;
  private tableData: CSVRow[] | null = null;
  private gtfsParser: GTFSParser | null = null;
  private viewPreference: 'code' | 'table';
  private clusterize: Clusterize | null = null;
  private headers: string[] = [];
  private pendingUpdates: Map<string, string | number | boolean> = new Map();
  private debounceTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = CONFIG.DEBOUNCE_DELAY;
  private lastTextModified: number = 0;
  private lastTableModified: number = 0;

  constructor(editorElementId: string = 'simple-editor') {
    this.editorElementId = editorElementId;
    this.viewPreference = this.loadViewPreference();
  }

  initialize(gtfsParser: GTFSParser): void {
    this.gtfsParser = gtfsParser;

    // Initialize CodeMirror editor
    this.editor = document.getElementById(this.editorElementId);
    if (!this.editor) {
      return;
    }

    // Create CodeMirror editor instance
    const startState = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        StreamLanguage.define(csvMathematicaMode),
        placeholder('Select a file from the sidebar to edit its content...'),
        // Track text changes for conflict detection
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.lastTextModified = Date.now();
          }
        }),
        // Use a light theme by default, could add theme switching later
        EditorView.theme({
          '&': {
            fontSize: '14px',
            height: '100%',
          },
          '.cm-content': {
            padding: '10px',
          },
          '.cm-focused': {
            outline: 'none',
          },
          '.cm-placeholder': {
            color: '#999',
            fontSize: '14px',
          },
        }),
      ],
    });

    // Clear the container and create CodeMirror view
    this.editor.innerHTML = '';
    this.editorView = new EditorView({
      state: startState,
      parent: this.editor,
    });

    // Initialize toggle state
    this.updateToggleLabels();

    // Initially hide toggle until a file is opened
    const viewToggle = document.getElementById('view-toggle-checkbox');
    if (viewToggle && viewToggle.parentElement) {
      viewToggle.parentElement.style.display = 'none';
    }
  }

  loadViewPreference(): 'code' | 'table' {
    try {
      return window.localStorage.getItem('gtfs-editor-view-preference') ===
        'table'
        ? 'table'
        : 'code';
    } catch {
      return 'code'; // Default to text view
    }
  }

  saveViewPreference(isTableView: boolean): void {
    try {
      window.localStorage.setItem(
        'gtfs-editor-view-preference',
        isTableView ? 'table' : 'text'
      );
    } catch {
      // Ignore localStorage errors
    }
  }

  updateToggleLabels(): void {
    const textOption = document.querySelector('.toggle-text.text-option');
    const tableOption = document.querySelector('.toggle-text.table-option');

    if (textOption && tableOption) {
      if (this.isTableView) {
        textOption.classList.remove('active');
        tableOption.classList.add('active');
      } else {
        textOption.classList.add('active');
        tableOption.classList.remove('active');
      }
    }
  }

  // Helper methods for CodeMirror
  setEditorValue(content: string): void {
    if (this.editorView) {
      this.editorView.dispatch({
        changes: {
          from: 0,
          to: this.editorView.state.doc.length,
          insert: content,
        },
      });
    }
  }

  getEditorValue(): string {
    return this.editorView ? this.editorView.state.doc.toString() : '';
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

    // Determine if file can be viewed as table (CSV files)
    const canShowTable = fileName.endsWith('.txt');
    const viewToggle = document.getElementById('view-toggle-checkbox');

    if (canShowTable) {
      // Show toggle and set to saved preference
      if (viewToggle && viewToggle.parentElement) {
        viewToggle.parentElement.style.display = 'flex';
        if (this.viewPreference === 'table') {
          await this.switchToTableView();
        } else {
          this.switchToTextView();
        }
      }
    } else {
      // Hide toggle and switch to text view
      if (viewToggle && viewToggle.parentElement) {
        viewToggle.parentElement.style.display = 'none';
      }
      this.switchToTextView();
    }

    // Update editor content
    this.setEditorValue(this.gtfsParser.getFileContent(fileName));
  }

  async closeEditor(): Promise<void> {
    // Save current changes
    await this.saveCurrentFileChanges();

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
    // Clear the editor content
    this.setEditorValue('');
    this.currentFile = null;

    // Clear table view
    if (this.clusterize) {
      this.clusterize.destroy();
      this.clusterize = null;
    }
    this.tableData = null;

    // Switch to text view
    this.switchToTextView();
  }

  switchToTextView() {
    this.isTableView = false;
    this.viewPreference = 'code';
    this.saveViewPreference(false);

    // Update toggle state
    const viewToggle = document.getElementById(
      'view-toggle-checkbox'
    ) as HTMLInputElement;
    if (viewToggle) {
      viewToggle.checked = false;
    }

    // Update text labels
    this.updateToggleLabels();

    // Show text editor, hide table editor
    const textView = document.getElementById('text-editor-view');
    const tableView = document.getElementById('table-editor-view');

    if (textView) {
      textView.classList.remove('hidden');
    }
    if (tableView) {
      tableView.classList.add('hidden');
    }

    // Conflict detection: sync table to text if table was modified more recently
    if (this.tableData && this.lastTableModified > this.lastTextModified) {
      this.syncTableToText();
    }
  }

  async switchToTableView() {
    if (!this.currentFile) {
      return;
    }

    this.isTableView = true;
    this.viewPreference = 'table';
    this.saveViewPreference(true);

    // Update toggle state
    const viewToggle = document.getElementById(
      'view-toggle-checkbox'
    ) as HTMLInputElement;
    if (viewToggle) {
      viewToggle.checked = true;
    }

    // Update text labels
    this.updateToggleLabels();

    // Show table editor, hide text editor
    const textView = document.getElementById('text-editor-view');
    const tableView = document.getElementById('table-editor-view');

    if (textView) {
      textView.classList.add('hidden');
    }
    if (tableView) {
      tableView.classList.remove('hidden');
    }

    // Conflict detection: if text was modified more recently, warn and update table
    if (this.lastTextModified > this.lastTableModified) {
      await this.syncTextToTable();
    }

    // Build table
    await this.buildTableEditor();
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
    this.lastTableModified = Date.now();

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

  syncTableToText() {
    if (!this.tableData) {
      return;
    }

    // Convert table data back to CSV
    const csv = Papa.unparse(this.tableData);
    this.setEditorValue(csv);
    this.lastTextModified = Date.now();

    // Update the parser's data
    if (this.gtfsParser && this.currentFile) {
      this.gtfsParser.updateFileContent(this.currentFile, csv);
    }
  }

  async syncTextToTable() {
    if (!this.currentFile || !this.editorView) {
      return;
    }

    try {
      const content = this.getEditorValue();

      // Parse CSV content
      const parseResult = Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
      });

      if (parseResult.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          'CSV parsing errors when syncing text to table:',
          parseResult.errors
        );
      }

      // Update table data
      this.tableData = parseResult.data;
      this.lastTableModified = Date.now();

      // Update IndexedDB with parsed data
      if (this.gtfsParser) {
        await this.gtfsParser.updateFileContent(this.currentFile, content);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error syncing text to table:', error);
    }
  }

  async saveCurrentFileChanges() {
    if (!this.currentFile || !this.gtfsParser) {
      return;
    }

    if (this.isTableView && this.tableData) {
      // Save from table - flush any pending updates first
      await this.flushPendingUpdates();
      this.syncTableToText();
    } else if (this.editorView) {
      // Save from CodeMirror editor - parse content and update IndexedDB
      const content = this.getEditorValue();
      await this.gtfsParser.updateFileContent(this.currentFile, content);
    }
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
