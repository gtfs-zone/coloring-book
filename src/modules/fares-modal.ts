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
  type EditableTableJoinColumn,
} from './editable-table.js';
import type { OptionPickerItem } from './option-picker-modal.js';
import { escapeHtml } from '../utils/escape-html.js';
import { specStoreName } from '../utils/spec-field-edit.js';
import {
  getEntityDisplay,
  getStopDisplay,
  renderOptionLabel,
} from '../utils/entity-display.js';
import {
  formatDateRange,
  formatDaysOfWeek,
} from '../utils/entity-references.js';
import { stopLocationType } from '../utils/area-hierarchy.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import {
  validateFareLegJoinRuleRow,
  validateFareTransferRuleRow,
  validateTimeframeRow,
} from '../utils/fares-rules.js';
import { renderSpecDescription } from '../utils/spec-markup.js';
import { gtfsSpec } from '../gtfs-spec/index.js';
import { GTFS_TABLES } from '../types/gtfs.js';

export type FaresModalDeps = EditableTableDeps;

const INSTANCE_ID = 'fares-table';

type FaresGroup = 'Definitions' | 'Rules' | 'Geography';

interface FaresEntry {
  /** GTFS file name, also the sidebar entry id. */
  table: string;
  label: string;
  group: FaresGroup;
  /** Markup shown in place of the rows when the table is empty. */
  emptyMessage: string;
  /** Built per open, since the option sets read other tables. */
  columnOverrides?: (
    deps: FaresModalDeps
  ) => Record<string, EditableTableColumnOverride>;
  /** Conditional rules that span fields, checked before a row is written. */
  validateRow?: (row: Record<string, unknown>) => string | null;
  /** Built on every refresh, since these read other tables. */
  joinColumns?: (deps: FaresModalDeps) => Promise<EditableTableJoinColumn[]>;
  /** A line of explanation shown above the table. */
  note?: string;
}

/** The two columns of a join table, and how to label what it names. */
export interface MemberJoinSpec {
  /** Column header, e.g. "Stops". */
  label: string;
  memberTable: string;
  joinTable: string;
  /** The column of the join table matching the rendered row's id. */
  groupField: string;
  /** The column of the join table naming the member. */
  memberField: string;
  /** The picker's options, which may be narrower than the member table. */
  options: () => Promise<OptionPickerItem[]>;
  /** Appended to a member's label, e.g. to note implied platforms. */
  memberSuffix?: (member: Record<string, unknown>) => string;
}

/**
 * A table column listing the members a join table gives each row, editable
 * through the same multi-select the list columns use.
 *
 * Areas and Networks differ only in which tables they read, so both panes are
 * one call to this. The membership is read once per refresh; `apply` diffs the
 * picked set against it and writes the join table in a single patch.
 */
export async function memberJoinColumn(
  deps: FaresModalDeps,
  spec: MemberJoinSpec
): Promise<EditableTableJoinColumn> {
  const joinStore = specStoreName(spec.joinTable);
  const joins = await deps.gtfsDatabase.getAllRows(joinStore);
  const members = await deps.gtfsDatabase.getAllRows(
    specStoreName(spec.memberTable)
  );
  const memberById = new Map(
    members.map((m) => [String(m[spec.memberField] ?? ''), m])
  );

  const byGroup = new Map<string, { value: string; label: string }[]>();
  for (const row of joins) {
    const group_id = String(row[spec.groupField] ?? '');
    const member_id = String(row[spec.memberField] ?? '');
    const member = memberById.get(member_id);
    const label = member
      ? renderOptionLabel(
          getEntityDisplay(
            specStoreName(spec.memberTable),
            member as Record<string, string>
          )
        ) + (spec.memberSuffix?.(member) ?? '')
      : `${member_id} (missing from ${spec.memberTable})`;
    const list = byGroup.get(group_id) ?? [];
    list.push({ value: member_id, label });
    byGroup.set(group_id, list);
  }

  return {
    label: spec.label,
    spec: { tableName: spec.joinTable, field: spec.memberField },
    options: spec.options,
    values: (row) => byGroup.get(String(row[spec.groupField] ?? '')) ?? [],
    apply: async (row, picked) => {
      const group_id = String(row[spec.groupField] ?? '');
      const current = new Set(
        (byGroup.get(group_id) ?? []).map((m) => m.value)
      );
      const wanted = new Set(picked.filter((value) => value !== ''));
      const removed = [...current].filter((value) => !wanted.has(value));
      const added = [...wanted].filter((value) => !current.has(value));
      if (removed.length === 0 && added.length === 0) {
        return;
      }

      const record = (member_id: string) => ({
        [spec.groupField]: group_id,
        [spec.memberField]: member_id,
      });
      const deletes = removed.map((member_id) => {
        const row = record(member_id);
        return {
          op: 'delete' as const,
          table: joinStore,
          id: generateCompositeKeyFromRecord(joinStore, row),
          record: row,
        };
      });
      const inserts = added.map((member_id) => {
        const row = record(member_id);
        return {
          op: 'insert' as const,
          table: joinStore,
          id: generateCompositeKeyFromRecord(joinStore, row),
          record: row,
        };
      });

      console.log(
        `[JoinColumn] ${joinStore} for ${group_id} (-${deletes.length} +${inserts.length})`
      );
      for (const entry of deletes) {
        await deps.gtfsDatabase.deleteRow(joinStore, entry.id);
      }
      if (inserts.length > 0) {
        await deps.gtfsDatabase.insertRows(
          joinStore,
          inserts.map((entry) => entry.record)
        );
      }
      await deps.patchManager.recordBatchMixed(
        [...deletes, ...inserts],
        `Edit ${spec.label.toLowerCase()} on ${spec.joinTable}`
      );
    },
  };
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

// ─── Picker option sets ───────────────────────────────────────────────────────

/**
 * Networks, read from the canonical `networks` table.
 *
 * The spec types these fields as referencing `routes.network_id` **or**
 * `networks.network_id`, but the app normalizes both on-disk forms to
 * `networks` at import, so the one table is the complete list under either.
 */
async function networkOptions(
  deps: FaresModalDeps
): Promise<OptionPickerItem[]> {
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.NETWORKS)
  );
  return rows
    .filter((row) => String(row.network_id ?? '') !== '')
    .map((row) => ({
      value: String(row.network_id),
      primary: renderOptionLabel(
        getEntityDisplay('networks', row as Record<string, string>)
      ),
      secondary: String(row.network_id),
    }));
}

/** Every route, for the Networks pane's membership column. */
async function routeOptions(deps: FaresModalDeps): Promise<OptionPickerItem[]> {
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.ROUTES)
  );
  return rows
    .filter((row) => String(row.route_id ?? '') !== '')
    .map((row) => ({
      value: String(row.route_id),
      primary: renderOptionLabel(
        getEntityDisplay('routes', row as Record<string, string>)
      ),
      secondary: String(row.route_id),
    }));
}

/** Stops a fare rule may name: stops and stations only, per the reference. */
async function fareStopOptions(
  deps: FaresModalDeps
): Promise<OptionPickerItem[]> {
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.STOPS)
  );
  return rows
    .filter((row) => {
      const type = stopLocationType(row);
      return type === 0 || type === 1;
    })
    .map((row) => ({
      value: String(row.stop_id ?? ''),
      primary: renderOptionLabel(getStopDisplay(row as Record<string, string>)),
      secondary: String(row.stop_id ?? ''),
    }));
}

/**
 * One option per fare product id.
 *
 * `fare_products` is keyed on the id together with the rider category and the
 * media, so the same id legitimately appears on several rows; a rule names the
 * id, not the row.
 */
async function fareProductOptions(
  deps: FaresModalDeps
): Promise<OptionPickerItem[]> {
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.FARE_PRODUCTS)
  );
  const seen = new Map<string, OptionPickerItem>();
  for (const row of rows) {
    const id = String(row.fare_product_id ?? '');
    if (id === '' || seen.has(id)) {
      continue;
    }
    const name = String(row.fare_product_name ?? '');
    seen.set(id, { value: id, primary: name ? `${name} (${id})` : id });
  }
  return [...seen.values()];
}

/** One option per distinct `timeframe_group_id`, which names a set of rows. */
async function timeframeGroupOptions(
  deps: FaresModalDeps
): Promise<OptionPickerItem[]> {
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.TIMEFRAMES)
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.timeframe_group_id ?? '');
    if (id !== '') {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts].map(([id, count]) => ({
    value: id,
    primary: id,
    secondary: `${count} timeframe${count === 1 ? '' : 's'}`,
  }));
}

/** Services from both `calendar` and `calendar_dates`, labelled by their days. */
export async function serviceOptions(
  deps: FaresModalDeps
): Promise<OptionPickerItem[]> {
  const options = new Map<string, OptionPickerItem>();
  const calendar = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.CALENDAR)
  );
  for (const row of calendar) {
    const id = String(row.service_id ?? '');
    if (id === '' || options.has(id)) {
      continue;
    }
    const range = formatDateRange(row);
    options.set(id, {
      value: id,
      primary: id,
      secondary: [formatDaysOfWeek(row), range].filter(Boolean).join(', '),
    });
  }
  const dates = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.CALENDAR_DATES)
  );
  for (const row of dates) {
    const id = String(row.service_id ?? '');
    if (id === '' || options.has(id)) {
      continue;
    }
    options.set(id, { value: id, primary: id, secondary: 'Specific dates' });
  }
  return [...options.values()];
}

/** The leg group ids already in use, offered as autocomplete on a free ID. */
async function legGroupSuggestions(deps: FaresModalDeps): Promise<string[]> {
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.FARE_LEG_RULES)
  );
  const ids = new Set<string>();
  for (const row of rows) {
    const id = String(row.leg_group_id ?? '');
    if (id !== '') {
      ids.add(id);
    }
  }
  return [...ids];
}

// ─── Empty states ─────────────────────────────────────────────────────────────

/**
 * What the table is for, taken from the reference's own description.
 *
 * Only the first paragraph: the rule tables' descriptions continue into the
 * full matching algorithm, which belongs in the column tooltips rather than in
 * an empty state.
 */
export function emptyState(table: string, hint: string): string {
  const spec = gtfsSpec.files.find((file) => file.filename === table);
  const intro = (spec?.description ?? '')
    .split('\n')[0]
    .replace(/(\s*<br\s*\/?>)+\s*$/i, '');
  return `<div class="max-w-prose space-y-2 py-2">
    <div>${renderSpecDescription(intro)}</div>
    <p>${escapeHtml(hint)}</p>
  </div>`;
}

const FARES_ENTRIES: FaresEntry[] = [
  {
    table: GTFS_TABLES.TIMEFRAMES,
    label: 'Timeframes',
    group: 'Definitions',
    emptyMessage: emptyState(
      GTFS_TABLES.TIMEFRAMES,
      'Add one row per interval. Rows sharing a timeframe_group_id form one group, which a fare leg rule can then name.'
    ),
    columnOverrides: (deps) => ({
      service_id: { options: () => serviceOptions(deps) },
    }),
    validateRow: validateTimeframeRow,
  },
  {
    table: GTFS_TABLES.RIDER_CATEGORIES,
    label: 'Rider Categories',
    group: 'Definitions',
    emptyMessage: emptyState(
      GTFS_TABLES.RIDER_CATEGORIES,
      'Add one to price fares differently for, say, seniors or students.'
    ),
  },
  {
    table: GTFS_TABLES.FARE_MEDIA,
    label: 'Fare Media',
    group: 'Definitions',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_MEDIA,
      'Add one to describe how a fare is carried: a paper ticket, a transit card, a phone.'
    ),
  },
  {
    table: GTFS_TABLES.FARE_PRODUCTS,
    label: 'Fare Products',
    group: 'Definitions',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_PRODUCTS,
      'Add one to give a fare a price.'
    ),
    columnOverrides: () => ({
      fare_media_id: { list: true },
      amount: {
        format: (value, row) => formatCurrencyAmount(value, row.currency),
      },
    }),
  },
  {
    table: GTFS_TABLES.FARE_LEG_RULES,
    label: 'Fare Leg Rules',
    group: 'Rules',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_LEG_RULES,
      'Add one to say which fare product pays for a leg. An empty network or area matches everything the other rules do not name.'
    ),
    columnOverrides: (deps) => ({
      leg_group_id: { suggestions: () => legGroupSuggestions(deps) },
      network_id: { options: () => networkOptions(deps) },
      from_area_id: { list: true },
      to_area_id: { list: true },
      from_timeframe_group_id: { options: () => timeframeGroupOptions(deps) },
      to_timeframe_group_id: { options: () => timeframeGroupOptions(deps) },
      fare_product_id: { options: () => fareProductOptions(deps) },
    }),
  },
  {
    table: GTFS_TABLES.FARE_LEG_JOIN_RULES,
    label: 'Fare Leg Join Rules',
    group: 'Rules',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_LEG_JOIN_RULES,
      'Add one to make two legs across a transfer price as a single leg.'
    ),
    note: 'The stop fields go together: name both, or neither. Only stops and stations may be named.',
    columnOverrides: (deps) => ({
      from_network_id: { options: () => networkOptions(deps), list: true },
      to_network_id: { options: () => networkOptions(deps), list: true },
      from_stop_id: { options: () => fareStopOptions(deps), list: true },
      to_stop_id: { options: () => fareStopOptions(deps), list: true },
    }),
    validateRow: validateFareLegJoinRuleRow,
  },
  {
    table: GTFS_TABLES.FARE_TRANSFER_RULES,
    label: 'Fare Transfer Rules',
    group: 'Rules',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_TRANSFER_RULES,
      'Add one to price the transfer between two leg groups.'
    ),
    note: 'A fare transfer rule defined from from_leg_group_id to to_leg_group_id does not apply in the reverse direction. The duration fields go together: set both, or neither.',
    columnOverrides: (deps) => ({
      from_leg_group_id: { list: true },
      to_leg_group_id: { list: true },
      fare_product_id: { options: () => fareProductOptions(deps) },
    }),
    validateRow: validateFareTransferRuleRow,
  },
  {
    table: GTFS_TABLES.AREAS,
    label: 'Areas',
    group: 'Geography',
    emptyMessage: emptyState(
      GTFS_TABLES.AREAS,
      'An area is the group of stops a fare leg rule starts or ends in.'
    ),
    note: 'Stops join an area here or on the stop page. A station in an area carries its platforms with it, unless a platform is assigned to an area of its own; only the stops named directly are listed.',
    joinColumns: async (deps) => [
      await memberJoinColumn(deps, {
        label: 'Stops',
        memberTable: GTFS_TABLES.STOPS,
        joinTable: GTFS_TABLES.STOP_AREAS,
        groupField: 'area_id',
        memberField: 'stop_id',
        options: () => fareStopOptions(deps),
        memberSuffix: (stop) =>
          stopLocationType(stop) === 1 ? ', and its platforms' : '',
      }),
    ],
  },
  {
    table: GTFS_TABLES.NETWORKS,
    label: 'Networks',
    group: 'Geography',
    emptyMessage: emptyState(
      GTFS_TABLES.NETWORKS,
      'A network is the group of routes a fare leg rule applies to.'
    ),
    note: 'Routes join a network here or on the route page. Giving a network a name makes the feed export networks.txt and route_networks.txt; an unnamed network is exported as a network_id column on routes.txt instead.',
    joinColumns: async (deps) => [
      await memberJoinColumn(deps, {
        label: 'Routes',
        memberTable: GTFS_TABLES.ROUTES,
        joinTable: GTFS_TABLES.ROUTE_NETWORKS,
        groupField: 'network_id',
        memberField: 'route_id',
        options: () => routeOptions(deps),
      }),
    ],
  },
];

const GROUP_ORDER: FaresGroup[] = ['Definitions', 'Rules', 'Geography'];

function renderSidebar(
  activeTable: string,
  counts: Map<string, number>
): string {
  const groups = GROUP_ORDER.map((group) => {
    const items = FARES_ENTRIES.filter((entry) => entry.group === group)
      .map((entry) => {
        const count = counts.get(entry.table) ?? 0;
        const badge = `<span class="badge badge-sm badge-ghost ml-auto">${count}</span>`;
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
  let activeEntry = FARES_ENTRIES[0];

  const tableConfig: EditableTableConfig = {
    instanceId: INSTANCE_ID,
    tableName: activeEntry.table,
    rows: [],
    deps,
    emptyMessage: activeEntry.emptyMessage,
    columnOverrides: activeEntry.columnOverrides?.(deps),
    validateRow: activeEntry.validateRow,
    onInsert: () => void refresh(),
    onRowsChanged: () => void refresh(),
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
    tableConfig.columnOverrides = activeEntry.columnOverrides?.(deps);
    tableConfig.validateRow = activeEntry.validateRow;
    tableConfig.joinColumns = activeEntry.joinColumns
      ? await activeEntry.joinColumns(deps)
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
    sidebarEl.innerHTML = renderSidebar(activeEntry.table, counts);
    paneEl.innerHTML = note + (await renderEditableTable(tableConfig));
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
