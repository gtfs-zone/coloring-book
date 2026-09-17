/**
 * The feed-level tables that have no page of their own.
 *
 * `transfers.txt`, `attributions.txt` and `translations.txt` are relations
 * between entities that already have pages rather than entities a user
 * navigates to, so they get one modal instead of three browse pages. Same shape
 * as `fares-modal.ts`: a sidebar of tables and one spec-driven editable table in
 * the content pane, so a table here is an entry in `FEED_DATA_ENTRIES` rather
 * than a bespoke renderer.
 *
 * Translations are editable here but are not yet applied to any displayed
 * label: that needs a display-language selector and a lookup inside
 * `utils/entity-display.ts`, which is its own piece of work.
 */

import { showSidebarModal } from 'interlocking/ui/sidebar-modal';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableColumnOverride,
  type EditableTableConfig,
  type EditableTableDeps,
} from './editable-table';
import { emptyState } from './fares-modal';
import { escapeHtml } from 'interlocking/util/escape-html';
import { specStoreName } from '../utils/spec-field-edit';
import { validateTransferRow } from '../utils/fares-rules';
import { gtfsSpec } from '../gtfs-spec/index';
import { GTFS_FIELD_SPECS, GTFS_TABLES } from '../types/gtfs';

export type FeedDataModalDeps = EditableTableDeps;

/** Which pane to open on, and which row to draw attention to. */
export interface FeedDataModalTarget {
  table?: string;
  rowKey?: string;
}

const INSTANCE_ID = 'feed-data-table';

interface FeedDataEntry {
  /** GTFS file name, also the sidebar entry id. */
  table: string;
  label: string;
  /** Markup shown in place of the rows when the table is empty. */
  emptyMessage: string;
  /** Built per refresh, since the suggestion sets read the spec and the feed. */
  columnOverrides?: (
    deps: FeedDataModalDeps
  ) => Record<string, EditableTableColumnOverride>;
  /** Conditional rules that span fields, checked before a row is written. */
  validateRow?: (row: Record<string, unknown>) => string | null;
  /** A line of explanation shown above the table. */
  note?: string;
  /** Anchor on the GTFS reference page, linked after the note. */
  docAnchor: string;
}

// ─── Cross-field rules ────────────────────────────────────────────────────────

function cell(row: Record<string, unknown>, field: string): string {
  return String(row[field] ?? '').trim();
}

/**
 * An attribution names at most one of an agency, a route or a trip; naming none
 * attributes the whole dataset.
 *
 * The reference also says at least one of the role flags should be `1`, but
 * that is a recommendation and enforcing it here would refuse every edit to an
 * imported row that carries no role. It is stated in the entry's note instead,
 * and the validator is where a feed-wide report of it belongs.
 */
export function validateAttributionRow(
  row: Record<string, unknown>
): string | null {
  const scopes = ['agency_id', 'route_id', 'trip_id'].filter(
    (field) => cell(row, field) !== ''
  );
  if (scopes.length > 1) {
    return `Only one of agency_id, route_id or trip_id may be set (found ${scopes.join(', ')})`;
  }
  return null;
}

/**
 * A translation names its target either by record or by value, never both.
 *
 * `feed_info` has a single row, so it has nothing to name and both referencing
 * forms are forbidden there.
 */
export function validateTranslationRow(
  row: Record<string, unknown>
): string | null {
  const tableName = cell(row, 'table_name');
  const recordId = cell(row, 'record_id');
  const recordSubId = cell(row, 'record_sub_id');
  const fieldValue = cell(row, 'field_value');

  if (tableName === 'feed_info') {
    for (const [field, value] of [
      ['record_id', recordId],
      ['record_sub_id', recordSubId],
      ['field_value', fieldValue],
    ]) {
      if (value !== '') {
        return `${field} is forbidden when table_name is feed_info`;
      }
    }
    return null;
  }

  if (recordId !== '' && fieldValue !== '') {
    return 'record_id and field_value are mutually exclusive: set one or the other';
  }
  if (recordId === '' && fieldValue === '') {
    return 'Either record_id or field_value is required';
  }
  if (recordSubId !== '' && recordId === '') {
    return 'record_sub_id requires record_id';
  }
  if (tableName === 'stop_times' && recordId !== '' && recordSubId === '') {
    return 'record_sub_id (the stop_sequence) is required when translating stop_times by record_id';
  }
  return null;
}

// ─── Suggestion sets ──────────────────────────────────────────────────────────

/** The field types the reference allows a translation to target. */
const TRANSLATABLE_TYPES = new Set(['Text', 'URL', 'Email', 'Phone number']);

/**
 * Every field name a translation could name, across every table `table_name`
 * allows.
 *
 * The right answer is the fields of the row's own `table_name`, but
 * `suggestions` is asked for the column, not for a row, so the union is what
 * can be offered. A suggestion is not a constraint, so a name that is wrong for
 * the row's table costs nothing beyond being ignored.
 */
function translatableFieldNames(): string[] {
  const tables =
    GTFS_FIELD_SPECS[GTFS_TABLES.TRANSLATIONS].table_name.enumValues?.map(
      (value) => `${String(value.value)}.txt`
    ) ?? [];
  const names = new Set<string>();
  for (const file of gtfsSpec.files) {
    if (!tables.includes(file.filename)) {
      continue;
    }
    for (const field of file.fields ?? []) {
      if (TRANSLATABLE_TYPES.has(field.type)) {
        names.add(field.name);
      }
    }
  }
  return [...names].sort();
}

// ─── Entries ──────────────────────────────────────────────────────────────────

const FEED_DATA_ENTRIES: FeedDataEntry[] = [
  {
    table: GTFS_TABLES.TRANSFERS,
    label: 'Transfers',
    emptyMessage: emptyState(
      GTFS_TABLES.TRANSFERS,
      'Add one to override how a connection between two stops is treated: to make it timed, to give it a minimum time, or to rule it out.'
    ),
    note: 'Transfer types 4 and 5 link two trips of the same vehicle and name trips instead of stops. A transfer from a station applies to all of its child stops.',
    docAnchor: 'transferstxt',
    columnOverrides: () => ({
      from_stop_id: { widthClass: 'min-w-48' },
      to_stop_id: { widthClass: 'min-w-48' },
    }),
    validateRow: validateTransferRow,
  },
  {
    table: GTFS_TABLES.ATTRIBUTIONS,
    label: 'Attributions',
    emptyMessage: emptyState(
      GTFS_TABLES.ATTRIBUTIONS,
      'Add one to credit an organization for the dataset, or for one agency, route or trip in it.'
    ),
    note: 'Leave agency_id, route_id and trip_id empty to attribute the whole dataset; setting one scopes the attribution to it. At least one of is_producer, is_operator and is_authority should be 1.',
    docAnchor: 'attributionstxt',
    columnOverrides: () => ({
      organization_name: { widthClass: 'min-w-48' },
    }),
    validateRow: validateAttributionRow,
  },
  {
    table: GTFS_TABLES.TRANSLATIONS,
    label: 'Translations',
    emptyMessage: emptyState(
      GTFS_TABLES.TRANSLATIONS,
      'Add one per translated value. Name what to translate either by record_id, or by field_value to translate every field holding that exact value.'
    ),
    note: 'Translations are stored and exported, but are not yet applied to labels shown in the app. record_id is the first field of the named table’s primary key; it is not checked against that table, since which table it names varies per row.',
    docAnchor: 'translationstxt',
    columnOverrides: () => ({
      field_name: {
        suggestions: () => Promise.resolve(translatableFieldNames()),
      },
      translation: { widthClass: 'min-w-48' },
      field_value: { widthClass: 'min-w-48' },
    }),
    validateRow: validateTranslationRow,
  },
];

/** The note plus its reference link, as the scaffold's raw-HTML note. */
function entryNote(entry: FeedDataEntry): string | undefined {
  if (!entry.note) {
    return undefined;
  }
  return `${escapeHtml(entry.note)}
    <a href="https://gtfs.org/documentation/schedule/reference/#${escapeHtml(entry.docAnchor)}"
       target="_blank" rel="noopener noreferrer" class="link">GTFS reference</a>.`;
}

const INTRO = `Feed-level tables that describe the rest of the feed rather than
  adding anything to the map: the connections between stops, who the data is
  attributed to, and the translations of its text.`;

export async function showFeedDataModal(
  deps: FeedDataModalDeps,
  target: FeedDataModalTarget = {}
): Promise<void> {
  // Consumed by the first pane render only: a later tab change must not re-scroll.
  let pendingRowKey = target.rowKey;

  // Filled in by the scaffold; the table's own callbacks re-render through it.
  const refreshRef = { refresh: async (): Promise<void> => {} };

  const tableConfig: EditableTableConfig = {
    instanceId: INSTANCE_ID,
    tableName: FEED_DATA_ENTRIES[0].table,
    rows: [],
    deps,
    emptyMessage: FEED_DATA_ENTRIES[0].emptyMessage,
    onInsert: () => void refreshRef.refresh(),
    onRowsChanged: () => void refreshRef.refresh(),
    onDelete: () => void refreshRef.refresh(),
  };

  const renderPane = async (entry: FeedDataEntry): Promise<string> => {
    tableConfig.tableName = entry.table;
    tableConfig.emptyMessage = entry.emptyMessage;
    tableConfig.columnOverrides = entry.columnOverrides?.(deps);
    tableConfig.validateRow = entry.validateRow;
    tableConfig.rows = await deps.gtfsDatabase.getAllRows(
      specStoreName(entry.table)
    );
    return renderEditableTable(tableConfig);
  };

  installEditableTableHandlers(tableConfig);

  await showSidebarModal({
    title: 'Feed Data',
    intro: INTRO,
    initialId: target.table,
    refreshRef,
    entries: FEED_DATA_ENTRIES.map((entry) => ({
      id: entry.table,
      label: entry.label,
      note: entryNote(entry),
      count: async () =>
        (await deps.gtfsDatabase.getAllRows(specStoreName(entry.table))).length,
      renderPane: () => renderPane(entry),
    })),
    onPaneRendered: (paneEl) => {
      if (!pendingRowKey) {
        return;
      }
      const row = paneEl.querySelector(
        `[data-et-row="${CSS.escape(pendingRowKey)}"]`
      );
      const rowKey = pendingRowKey;
      pendingRowKey = undefined;
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: 'center' });
        row.classList.add('bg-primary/10');
      } else {
        console.warn(`[FeedData] no row for ${rowKey}`);
      }
    },
  });

  uninstallEditableTableHandlers(INSTANCE_ID);
}
