/**
 * Fares v2 editor.
 *
 * A sidebar of the fares tables grouped by what they do, and one spec-driven
 * editable table in the content pane. Every table is rendered by
 * `editable-table.ts` straight from `src/gtfs-spec/`, so adding a table here is
 * an entry in `FARES_ENTRIES` rather than a renderer plus an add/edit modal.
 */

import { showModal } from './modal-utils.js';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableColumnOverride,
  type EditableTableConfig,
  type EditableTableDeps,
  type EditableTableExtraColumn,
} from './editable-table.js';
import { escapeHtml } from '../utils/escape-html.js';
import { specStoreName } from '../utils/spec-field-edit.js';
import {
  getEntityDisplay,
  getStopDisplay,
  renderOptionLabel,
} from '../utils/entity-display.js';
import { stopLocationType } from '../utils/area-hierarchy.js';
import { GTFS_TABLES } from '../types/gtfs.js';

export type FaresModalDeps = EditableTableDeps;

const INSTANCE_ID = 'fares-table';

type FaresGroup = 'Definitions' | 'Rules' | 'Geography';

interface FaresEntry {
  /** GTFS file name, also the sidebar entry id. */
  table: string;
  label: string;
  group: FaresGroup;
  /** Set while the table has no editor yet; the entry renders disabled. */
  pending?: boolean;
  emptyMessage: string;
  columnOverrides?: Record<string, EditableTableColumnOverride>;
  /** Built on every refresh, since these read other tables. */
  extraColumns?: (deps: FaresModalDeps) => Promise<EditableTableExtraColumn[]>;
  /** A line of explanation shown above the table. */
  note?: string;
  /** Extra markup shown below the table, rebuilt on every refresh. */
  detail?: (deps: FaresModalDeps) => Promise<string>;
}

/** How many routes each network has, keyed by `network_id`. */
async function countRoutesPerNetwork(
  deps: FaresModalDeps
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.ROUTE_NETWORKS)
  );
  for (const row of rows) {
    const id = String(row.network_id ?? '');
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** How many stops each area names directly, keyed by `area_id`. */
async function countStopsPerArea(
  deps: FaresModalDeps
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.STOP_AREAS)
  );
  for (const row of rows) {
    const id = String(row.area_id ?? '');
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * A collapsible list of the stops in each area.
 *
 * Only the explicit `stop_areas` rows are listed. A station's platforms are in
 * the area too, but listing them here would blur the distinction between what
 * the feed says and what the spec implies, so stations are labelled instead.
 */
async function renderAreaStopLists(deps: FaresModalDeps): Promise<string> {
  const areas = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.AREAS)
  );
  if (areas.length === 0) {
    return '';
  }
  const stopAreas = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.STOP_AREAS)
  );
  const stops = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.STOPS)
  );
  const stopById = new Map(stops.map((s) => [String(s.stop_id ?? ''), s]));

  const byArea = new Map<string, string[]>();
  for (const row of stopAreas) {
    const area_id = String(row.area_id ?? '');
    const stop_id = String(row.stop_id ?? '');
    const stop = stopById.get(stop_id);
    const label = stop
      ? renderOptionLabel(getStopDisplay(stop as Record<string, string>))
      : `${stop_id} (missing from stops.txt)`;
    const suffix =
      stop && stopLocationType(stop) === 1 ? ', and its platforms' : '';
    const list = byArea.get(area_id) ?? [];
    list.push(`${label}${suffix}`);
    byArea.set(area_id, list);
  }

  const sections = areas
    .map((area) => {
      const area_id = String(area.area_id ?? '');
      const labels = byArea.get(area_id) ?? [];
      const heading = renderOptionLabel(
        getEntityDisplay('areas', area as Record<string, string>)
      );
      const body =
        labels.length === 0
          ? '<li class="opacity-60">No stops assigned.</li>'
          : labels.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
      return `<details class="collapse collapse-arrow bg-base-200 rounded-box">
        <summary class="collapse-title text-sm py-2 min-h-0">${escapeHtml(heading)} (${labels.length})</summary>
        <div class="collapse-content"><ul class="text-xs space-y-1">${body}</ul></div>
      </details>`;
    })
    .join('');

  return `<div class="mt-4 space-y-1">
    <h3 class="text-sm font-semibold">Stops by area</h3>
    ${sections}
  </div>`;
}

/**
 * Render a currency amount with the decimal places ISO 4217 gives its currency.
 *
 * Pure string padding: the stored value is a decimal string and float math on
 * money would round it.
 */
function formatCurrencyAmount(value: unknown, currency: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw === '' || !/^-?\d+(\.\d*)?$/.test(raw)) {
    return raw;
  }
  const code = String(currency ?? '').trim();
  if (code === '') {
    return raw;
  }
  let digits: number | undefined;
  try {
    digits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    return raw;
  }
  if (digits === undefined) {
    return raw;
  }
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length >= digits) {
    return digits === 0 ? whole : `${whole}.${fraction}`;
  }
  return `${whole}.${fraction.padEnd(digits, '0')}`;
}

const FARES_ENTRIES: FaresEntry[] = [
  {
    table: GTFS_TABLES.TIMEFRAMES,
    label: 'Timeframes',
    group: 'Definitions',
    pending: true,
    emptyMessage: 'No timeframes yet.',
  },
  {
    table: GTFS_TABLES.RIDER_CATEGORIES,
    label: 'Rider Categories',
    group: 'Definitions',
    emptyMessage:
      'No rider categories yet. Add one to price fares differently for, say, seniors or students.',
  },
  {
    table: GTFS_TABLES.FARE_MEDIA,
    label: 'Fare Media',
    group: 'Definitions',
    emptyMessage:
      'No fare media yet. Add one to describe how a fare is carried: a paper ticket, a transit card, a phone.',
  },
  {
    table: GTFS_TABLES.FARE_PRODUCTS,
    label: 'Fare Products',
    group: 'Definitions',
    emptyMessage: 'No fare products yet. Add one to give a fare a price.',
    columnOverrides: {
      amount: {
        format: (value, row) => formatCurrencyAmount(value, row.currency),
      },
    },
  },
  {
    table: GTFS_TABLES.FARE_LEG_RULES,
    label: 'Fare Leg Rules',
    group: 'Rules',
    pending: true,
    emptyMessage: 'No fare leg rules yet.',
  },
  {
    table: GTFS_TABLES.FARE_LEG_JOIN_RULES,
    label: 'Fare Leg Join Rules',
    group: 'Rules',
    pending: true,
    emptyMessage: 'No fare leg join rules yet.',
  },
  {
    table: GTFS_TABLES.FARE_TRANSFER_RULES,
    label: 'Fare Transfer Rules',
    group: 'Rules',
    pending: true,
    emptyMessage: 'No fare transfer rules yet.',
  },
  {
    table: GTFS_TABLES.AREAS,
    label: 'Areas',
    group: 'Geography',
    emptyMessage:
      'No areas yet. An area is the group of stops a fare leg rule starts or ends in.',
    note: 'Stops join an area on the stop page. A station in an area carries its platforms with it, unless a platform is assigned to an area of its own.',
    extraColumns: async (deps) => {
      const counts = await countStopsPerArea(deps);
      return [
        {
          label: 'Stops',
          render: (row) => String(counts.get(String(row.area_id ?? '')) ?? 0),
        },
      ];
    },
    detail: (deps) => renderAreaStopLists(deps),
  },
  {
    table: GTFS_TABLES.NETWORKS,
    label: 'Networks',
    group: 'Geography',
    emptyMessage:
      'No networks yet. A network is the group of routes a fare leg rule applies to.',
    note: 'Routes join a network on the route page. Giving a network a name makes the feed export networks.txt and route_networks.txt; an unnamed network is exported as a network_id column on routes.txt instead.',
    extraColumns: async (deps) => {
      const counts = await countRoutesPerNetwork(deps);
      return [
        {
          label: 'Routes',
          render: (row) =>
            String(counts.get(String(row.network_id ?? '')) ?? 0),
        },
      ];
    },
  },
];

const GROUP_ORDER: FaresGroup[] = ['Definitions', 'Rules', 'Geography'];

const PENDING_TITLE = 'Editing this table is coming in a later phase';

function renderSidebar(
  activeTable: string,
  counts: Map<string, number>
): string {
  const groups = GROUP_ORDER.map((group) => {
    const items = FARES_ENTRIES.filter((entry) => entry.group === group)
      .map((entry) => {
        const count = counts.get(entry.table) ?? 0;
        const badge = `<span class="badge badge-sm badge-ghost ml-auto">${count}</span>`;
        if (entry.pending) {
          return `<li class="menu-disabled">
            <span title="${PENDING_TITLE}">${escapeHtml(entry.label)}${badge}</span>
          </li>`;
        }
        return `<li>
          <button
            type="button"
            data-fares-entry="${escapeHtml(entry.table)}"
            class="${entry.table === activeTable ? 'menu-active' : ''}"
          >${escapeHtml(entry.label)}${badge}</button>
        </li>`;
      })
      .join('');
    return `<li class="menu-title">${group}</li>${items}`;
  }).join('');

  return `<ul class="menu menu-sm bg-base-200 rounded-box w-52 shrink-0">${groups}</ul>`;
}

export async function showFaresModal(deps: FaresModalDeps): Promise<void> {
  let activeEntry =
    FARES_ENTRIES.find((entry) => !entry.pending) ?? FARES_ENTRIES[0];

  const tableConfig: EditableTableConfig = {
    instanceId: INSTANCE_ID,
    tableName: activeEntry.table,
    rows: [],
    deps,
    emptyMessage: activeEntry.emptyMessage,
    columnOverrides: activeEntry.columnOverrides,
    onInsert: () => void refresh(),
    onDelete: () => void refresh(),
  };

  const readCounts = async (): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    for (const entry of FARES_ENTRIES) {
      const rows = await deps.gtfsDatabase.getAllRows(
        specStoreName(entry.table)
      );
      counts.set(entry.table, rows.length);
    }
    return counts;
  };

  const refresh = async (): Promise<void> => {
    const counts = await readCounts();
    tableConfig.tableName = activeEntry.table;
    tableConfig.emptyMessage = activeEntry.emptyMessage;
    tableConfig.columnOverrides = activeEntry.columnOverrides;
    tableConfig.extraColumns = activeEntry.extraColumns
      ? await activeEntry.extraColumns(deps)
      : undefined;
    tableConfig.rows = await deps.gtfsDatabase.getAllRows(
      specStoreName(activeEntry.table)
    );

    const sidebarEl = document.getElementById('fares-sidebar');
    const paneEl = document.getElementById('fares-pane');
    if (!sidebarEl || !paneEl) {
      return;
    }
    const note = activeEntry.note
      ? `<p class="text-xs text-base-content/60 mb-2">${escapeHtml(activeEntry.note)}</p>`
      : '';
    const detail = activeEntry.detail ? await activeEntry.detail(deps) : '';
    sidebarEl.innerHTML = renderSidebar(activeEntry.table, counts);
    paneEl.innerHTML = note + (await renderEditableTable(tableConfig)) + detail;
  };

  const body = `
    <p class="text-xs text-base-content/60 mb-3">
      Fares v2: the products a rider can buy, the rules that price a journey out
      of them, and the geography those rules refer to. Fares v1
      (<code>fare_attributes.txt</code>, <code>fare_rules.txt</code>) is not
      edited here: open those tables in the file viewer.
      <a href="https://gtfs.org/documentation/schedule/reference/#fare_productstxt"
         target="_blank" rel="noopener noreferrer" class="link">GTFS reference</a>.
    </p>
    <div class="flex gap-4 items-start">
      <div id="fares-sidebar" class="shrink-0"></div>
      <div id="fares-pane" class="flex-1 min-w-0"></div>
    </div>
  `;

  installEditableTableHandlers(tableConfig);

  await showModal({
    title: 'Fares',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-6xl w-11/12',
    onMount: (_close) => {
      void refresh();

      document
        .getElementById('fares-sidebar')
        ?.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
            '[data-fares-entry]'
          );
          const table = btn?.dataset.faresEntry;
          if (!table || table === activeEntry.table) {
            return;
          }
          const entry = FARES_ENTRIES.find((c) => c.table === table);
          if (!entry) {
            return;
          }
          activeEntry = entry;
          void refresh();
        });
    },
  });

  uninstallEditableTableHandlers(INSTANCE_ID);
}
