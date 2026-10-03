/**
 * Fares v2 editor.
 *
 * A sidebar of the fares tables grouped by what they do, and one spec-driven
 * editable table in the content pane. Every table is rendered by
 * `editable-table.ts` straight from `src/gtfs-spec/`, so adding a table here is
 * an entry in `FARES_ENTRIES` rather than a renderer plus an add/edit modal.
 */

import { showSidebarModal } from 'gtfs-zone-web-common/ui/sidebar-modal';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableColumnOverride,
  type EditableTableConfig,
  type EditableTableDeps,
  type EditableTableJoinColumn,
} from './editable-table';
import type { OptionPickerItem } from './option-picker-modal';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { specStoreName } from '../utils/spec-field-edit';
import {
  getEntityDisplay,
  getStopDisplay,
  renderOptionLabel,
} from '../utils/entity-display';
import { formatDateRange, formatDaysOfWeek } from '../utils/entity-references';
import { stopLocationType } from '../utils/area-hierarchy';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import {
  validateFareLegJoinRuleRow,
  validateFareTransferRuleRow,
  validateTimeframeRow,
} from '../utils/fares-rules';
import { renderSpecDescription } from 'gtfs-zone-web-common/gtfs/spec-markup';
import { gtfsSpec } from '../gtfs-spec/index';
import { GTFS_TABLES } from '../types/gtfs';
import { t } from '../i18n/messages';

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
      : t('fares.missingMember', { id: member_id, table: spec.memberTable });
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
        t('fares.editMembers', {
          label: spec.label.toLowerCase(),
          table: spec.joinTable,
        })
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
    options.set(id, {
      value: id,
      primary: id,
      secondary: t('fares.specificDates'),
    });
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
    label: t('fares.timeframes'),
    group: 'Definitions',
    emptyMessage: emptyState(GTFS_TABLES.TIMEFRAMES, t('fares.timeframesHint')),
    columnOverrides: (deps) => ({
      service_id: { options: () => serviceOptions(deps) },
    }),
    validateRow: validateTimeframeRow,
  },
  {
    table: GTFS_TABLES.RIDER_CATEGORIES,
    label: t('fares.riderCategories'),
    group: 'Definitions',
    emptyMessage: emptyState(
      GTFS_TABLES.RIDER_CATEGORIES,
      t('fares.riderCategoriesHint')
    ),
  },
  {
    table: GTFS_TABLES.FARE_MEDIA,
    label: t('fares.media'),
    group: 'Definitions',
    emptyMessage: emptyState(GTFS_TABLES.FARE_MEDIA, t('fares.mediaHint')),
  },
  {
    table: GTFS_TABLES.FARE_PRODUCTS,
    label: t('fares.products'),
    group: 'Definitions',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_PRODUCTS,
      t('fares.productsHint')
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
    label: t('fares.legRules'),
    group: 'Rules',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_LEG_RULES,
      t('fares.legRulesHint')
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
    label: t('fares.legJoinRules'),
    group: 'Rules',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_LEG_JOIN_RULES,
      t('fares.legJoinRulesHint')
    ),
    note: t('fares.legJoinRulesNote'),
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
    label: t('fares.transferRules'),
    group: 'Rules',
    emptyMessage: emptyState(
      GTFS_TABLES.FARE_TRANSFER_RULES,
      t('fares.transferRulesHint')
    ),
    note: t('fares.transferRulesNote'),
    columnOverrides: (deps) => ({
      from_leg_group_id: { list: true },
      to_leg_group_id: { list: true },
      fare_product_id: { options: () => fareProductOptions(deps) },
    }),
    validateRow: validateFareTransferRuleRow,
  },
  {
    table: GTFS_TABLES.AREAS,
    label: t('fares.areas'),
    group: 'Geography',
    emptyMessage: emptyState(GTFS_TABLES.AREAS, t('fares.areasHint')),
    note: t('fares.areasNote'),
    joinColumns: async (deps) => [
      await memberJoinColumn(deps, {
        label: t('fares.stops'),
        memberTable: GTFS_TABLES.STOPS,
        joinTable: GTFS_TABLES.STOP_AREAS,
        groupField: 'area_id',
        memberField: 'stop_id',
        options: () => fareStopOptions(deps),
        memberSuffix: (stop) =>
          stopLocationType(stop) === 1 ? t('fares.andPlatforms') : '',
      }),
    ],
  },
  {
    table: GTFS_TABLES.NETWORKS,
    label: t('fares.networks'),
    group: 'Geography',
    emptyMessage: emptyState(GTFS_TABLES.NETWORKS, t('fares.networksHint')),
    note: t('fares.networksNote'),
    joinColumns: async (deps) => [
      await memberJoinColumn(deps, {
        label: t('fares.routes'),
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

const INTRO = `${t('fares.intro', {
  files: '<code>fare_attributes.txt</code>, <code>fare_rules.txt</code>',
})}
  <a href="https://gtfs.org/documentation/schedule/reference/#fare_productstxt"
     target="_blank" rel="noopener noreferrer" class="link">${t('fares.reference')}</a>.`;

export async function showFaresModal(deps: FaresModalDeps): Promise<void> {
  // Filled in by the scaffold; the table's own callbacks re-render through it.
  const refreshRef = { refresh: async (): Promise<void> => {} };

  const tableConfig: EditableTableConfig = {
    instanceId: INSTANCE_ID,
    tableName: FARES_ENTRIES[0].table,
    rows: [],
    deps,
    emptyMessage: FARES_ENTRIES[0].emptyMessage,
    onInsert: () => void refreshRef.refresh(),
    onRowsChanged: () => void refreshRef.refresh(),
    onDelete: () => void refreshRef.refresh(),
  };

  const renderPane = async (entry: FaresEntry): Promise<string> => {
    tableConfig.tableName = entry.table;
    tableConfig.emptyMessage = entry.emptyMessage;
    tableConfig.columnOverrides = entry.columnOverrides?.(deps);
    tableConfig.validateRow = entry.validateRow;
    tableConfig.joinColumns = entry.joinColumns
      ? await entry.joinColumns(deps)
      : undefined;
    tableConfig.rows = await deps.gtfsDatabase.getAllRows(
      specStoreName(entry.table)
    );
    return renderEditableTable(tableConfig);
  };

  installEditableTableHandlers(tableConfig);

  await showSidebarModal({
    title: t('fares.title'),
    intro: INTRO,
    groupOrder: GROUP_ORDER,
    groupLabel: (group) => t(`fares.group.${group as FaresGroup}`),
    refreshRef,
    entries: FARES_ENTRIES.map((entry) => ({
      id: entry.table,
      label: entry.label,
      group: entry.group,
      guidePage: 'fares',
      note: entry.note ? escapeHtml(entry.note) : undefined,
      count: async () =>
        (await deps.gtfsDatabase.getAllRows(specStoreName(entry.table))).length,
      renderPane: () => renderPane(entry),
    })),
  });

  uninstallEditableTableHandlers(INSTANCE_ID);
}
