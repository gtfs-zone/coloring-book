/**
 * On-demand (GTFS Flex) editor.
 *
 * Same shape as `fares-modal.ts`: a sidebar of tables grouped by what they do,
 * and one spec-driven editable table in the content pane. Booking rules and
 * location groups are ordinary `.txt` tables and are edited here; zones live in
 * locations.geojson, which has no CSV field table, so that pane is read-only
 * and links through to the zone browse page where the geometry is edited.
 */

import { showModal } from './modal-utils.js';
import { showHelpModal } from './help-modal.js';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableColumnOverride,
  type EditableTableConfig,
  type EditableTableDeps,
  type EditableTableJoinColumn,
} from './editable-table.js';
import { emptyState, memberJoinColumn, serviceOptions } from './fares-modal.js';
import type { OptionPickerItem } from './option-picker-modal.js';
import { escapeHtml } from '../utils/escape-html.js';
import { specStoreName } from '../utils/spec-field-edit.js';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display.js';
import { stopLocationType } from '../utils/area-hierarchy.js';
import {
  validateBookingRuleRow,
  validateLocationGroupId,
} from '../utils/flex-rules.js';
import { LOCATIONS_TABLE } from './zone-store.js';
import { GTFS_TABLES } from '../types/gtfs.js';

export interface OnDemandModalDeps extends EditableTableDeps {
  /** Opens a zone's browse page. The modal closes first. */
  onZoneClick: (location_id: string) => void;
  /**
   * Writes a new, empty-geometry zone into locations.geojson as one patch.
   * Lives outside this module because it needs the parser, not the database.
   */
  onCreateZone: (location_id: string, stop_name: string) => Promise<void>;
}

/** Which pane to open on, and which row to draw attention to. */
export interface OnDemandModalTarget {
  table?: string;
  rowKey?: string;
}

const INSTANCE_ID = 'on-demand-table';

/** locations.geojson is not a spec table; the Zones pane renders it by hand. */
const ZONES_ENTRY_ID = GTFS_TABLES.LOCATIONS_GEOJSON;

/** Footer of the Zones pane, shown whether or not the feed has any zones. */
const NEW_ZONE_BUTTON = `<div class="mt-3 flex gap-2 items-center">
  <button type="button" class="btn btn-sm btn-primary" data-new-zone>New zone</button>
  <button type="button" class="btn btn-sm btn-ghost" data-open-guide="on-demand">Guide</button>
</div>`;

type OnDemandGroup = 'Booking' | 'Geography';

/**
 * Cross-table facts a row validator needs, read once per refresh.
 *
 * `idOwners` maps every id claimed by `stops.txt` or locations.geojson to a
 * description of who owns it, for the shared-ID-namespace rule.
 */
interface OnDemandContext {
  idOwners: Map<string, string>;
}

interface OnDemandEntry {
  /** GTFS file name, also the sidebar entry id. */
  table: string;
  label: string;
  group: OnDemandGroup;
  /** Markup shown in place of the rows when the table is empty. */
  emptyMessage: string;
  /** Built per refresh, since the option sets read other tables. */
  columnOverrides?: (
    deps: OnDemandModalDeps
  ) => Record<string, EditableTableColumnOverride>;
  /** Built per refresh, since the cross-field rules read other tables. */
  validateRow?: (
    context: OnDemandContext
  ) => (row: Record<string, unknown>) => string | null;
  /** Built on every refresh, since these read other tables. */
  joinColumns?: (deps: OnDemandModalDeps) => Promise<EditableTableJoinColumn[]>;
  /** Replaces the editable table entirely, for tables the spec has no fields for. */
  render?: (deps: OnDemandModalDeps) => Promise<string>;
  /** A line of explanation shown above the table. */
  note?: string;
}

// ─── Picker option sets ───────────────────────────────────────────────────────

/**
 * The stops a location group may contain.
 *
 * The flex reference requires referenced locations to be stops/platforms, so
 * stations, entrances, nodes and boarding areas are not offered.
 */
async function groupStopOptions(
  deps: OnDemandModalDeps
): Promise<OptionPickerItem[]> {
  const rows = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.STOPS)
  );
  return rows
    .filter((row) => stopLocationType(row) === 0)
    .map((row) => ({
      value: String(row.stop_id ?? ''),
      primary: renderOptionLabel(getStopDisplay(row as Record<string, string>)),
      secondary: String(row.stop_id ?? ''),
    }));
}

// ─── Zones pane ───────────────────────────────────────────────────────────────

/** The stored FeatureCollection's features, or an empty list. */
async function readZoneFeatures(
  deps: OnDemandModalDeps
): Promise<GeoJSON.Feature[]> {
  const rows = await deps.gtfsDatabase.getAllRows(LOCATIONS_TABLE);
  const stored = rows[0] as Partial<GeoJSON.FeatureCollection> | undefined;
  return Array.isArray(stored?.features) ? stored.features : [];
}

/**
 * Zones, read-only.
 *
 * Geometry editing stays on the zone page, which has the map and the geojson.io
 * round trip; this pane exists so the on-demand objects are all listed in one
 * place and so a zone is reachable from here.
 */
async function renderZonesPane(deps: OnDemandModalDeps): Promise<string> {
  const features = await readZoneFeatures(deps);
  if (features.length === 0) {
    return `${emptyState(
      ZONES_ENTRY_ID,
      'A zone is an area a rider can be picked up in or dropped off in. Zones arrive by importing a feed with locations.geojson, or you can create an empty one here and draw it on its zone page.'
    )}${NEW_ZONE_BUTTON}`;
  }

  const rows = features
    .map((feature) => {
      const id = String(feature.id ?? '');
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const name = String(properties.stop_name ?? '');
      const geometry = String(feature.geometry?.type ?? 'none');
      return `<tr>
        <td class="font-mono text-xs">
          <button type="button" class="link link-primary" data-zone-id="${escapeHtml(id)}">${escapeHtml(id)}</button>
        </td>
        <td>${escapeHtml(name)}</td>
        <td class="text-xs text-base-content/70">${escapeHtml(geometry)}</td>
      </tr>`;
    })
    .join('');

  return `<table class="table table-sm">
    <thead><tr><th>location_id</th><th>Name</th><th>Geometry</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>${NEW_ZONE_BUTTON}`;
}

/**
 * Ask for the new zone's id and name.
 *
 * Validation runs inside the action so a clash is reported in place rather
 * than closing the modal and losing what was typed.
 */
async function promptNewZone(
  taken: Set<string>
): Promise<{ location_id: string; stop_name: string } | null> {
  let created: { location_id: string; stop_name: string } | null = null;

  await showModal({
    title: 'New zone',
    body: `
      <div class="space-y-3">
        <p class="text-base-content/60 text-sm">
          The zone is created with no geometry. Draw it on its zone page, in
          geojson.io or by pasting GeoJSON.
        </p>
        <fieldset class="fieldset">
          <label class="label" for="new-zone-id">location_id</label>
          <input id="new-zone-id" class="input w-full" type="text" placeholder="e.g. zone_north" />
          <label class="label" for="new-zone-name">Name (optional)</label>
          <input id="new-zone-name" class="input w-full" type="text" placeholder="e.g. North service area" />
          <p id="new-zone-error" class="text-error text-sm hidden"></p>
        </fieldset>
      </div>
    `,
    escapeAction: 1,
    enterAction: 0,
    onMount: () => document.getElementById('new-zone-id')?.focus(),
    actions: [
      {
        label: 'Create',
        className: 'btn-primary',
        onClick: () => {
          const idEl = document.getElementById(
            'new-zone-id'
          ) as HTMLInputElement | null;
          const nameEl = document.getElementById(
            'new-zone-name'
          ) as HTMLInputElement | null;
          const errorEl = document.getElementById('new-zone-error');
          const location_id = idEl?.value.trim() ?? '';

          const showError = (msg: string) => {
            if (errorEl) {
              errorEl.textContent = msg;
              errorEl.classList.remove('hidden');
            }
            return true as const;
          };

          if (location_id === '') {
            return showError('location_id is required.');
          }
          if (taken.has(location_id)) {
            return showError(`"${location_id}" is already taken.`);
          }

          created = { location_id, stop_name: nameEl?.value.trim() ?? '' };
          return;
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
  });

  return created;
}

// ─── Entries ──────────────────────────────────────────────────────────────────

const ON_DEMAND_ENTRIES: OnDemandEntry[] = [
  {
    table: GTFS_TABLES.BOOKING_RULES,
    label: 'Booking Rules',
    group: 'Booking',
    emptyMessage: emptyState(
      GTFS_TABLES.BOOKING_RULES,
      'Add one to say how far in advance a rider has to book, and how. A stop_time then names it as its pickup or drop-off rule.'
    ),
    note: 'Which prior-notice fields apply depends on booking_type: real time (0) takes none, same-day (1) takes a duration in minutes, prior day (2) takes a last day and time.',
    columnOverrides: (deps) => ({
      prior_notice_service_id: { options: () => serviceOptions(deps) },
    }),
    validateRow: () => validateBookingRuleRow,
  },
  {
    table: GTFS_TABLES.LOCATION_GROUPS,
    label: 'Location Groups',
    group: 'Geography',
    emptyMessage: emptyState(
      GTFS_TABLES.LOCATION_GROUPS,
      'A location group is the set of stops a rider may request pickup or drop off at. Add one, then join its stops in the Stops column.'
    ),
    note: 'Stops join a location group here or on the location group page. A location_group_id shares one ID namespace with stops.stop_id and locations.geojson id, so it may not collide with either.',
    validateRow: (context) => (row) =>
      validateLocationGroupId(
        String(row.location_group_id ?? '').trim(),
        context.idOwners
      ),
    joinColumns: async (deps) => [
      await memberJoinColumn(deps, {
        label: 'Stops',
        memberTable: GTFS_TABLES.STOPS,
        joinTable: GTFS_TABLES.LOCATION_GROUP_STOPS,
        groupField: 'location_group_id',
        memberField: 'stop_id',
        options: () => groupStopOptions(deps),
      }),
    ],
  },
  {
    table: ZONES_ENTRY_ID,
    label: 'Zones',
    group: 'Geography',
    emptyMessage: '',
    note: 'The zone list is read-only here. Open a zone to see its geometry and edit it in geojson.io.',
    render: renderZonesPane,
  },
];

const GROUP_ORDER: OnDemandGroup[] = ['Booking', 'Geography'];

function renderSidebar(
  activeTable: string,
  counts: Map<string, number>
): string {
  const groups = GROUP_ORDER.map((group) => {
    const items = ON_DEMAND_ENTRIES.filter((entry) => entry.group === group)
      .map((entry) => {
        const count = counts.get(entry.table) ?? 0;
        const badge = `<span class="badge badge-sm badge-ghost ml-auto">${count}</span>`;
        return `<li>
          <button
            type="button"
            data-on-demand-entry="${escapeHtml(entry.table)}"
            class="${entry.table === activeTable ? 'menu-active' : ''}"
          >${escapeHtml(entry.label)}${badge}</button>
        </li>`;
      })
      .join('');
    return `<li class="menu-title">${group}</li>${items}`;
  }).join('');

  return `<ul class="menu menu-sm bg-base-200 rounded-box w-52 shrink-0">${groups}</ul>`;
}

/** Every id already claimed by stops.txt or locations.geojson, and by which. */
async function readIdOwners(
  deps: OnDemandModalDeps
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  const stops = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.STOPS)
  );
  for (const stop of stops) {
    const id = String(stop.stop_id ?? '').trim();
    if (id !== '') {
      owners.set(id, 'a stops.txt stop_id');
    }
  }
  for (const feature of await readZoneFeatures(deps)) {
    const id = String(feature.id ?? '').trim();
    if (id !== '') {
      owners.set(id, 'a locations.geojson id');
    }
  }
  return owners;
}

export async function showOnDemandModal(
  deps: OnDemandModalDeps,
  target: OnDemandModalTarget = {}
): Promise<void> {
  let activeEntry =
    ON_DEMAND_ENTRIES.find((entry) => entry.table === target.table) ??
    ON_DEMAND_ENTRIES[0];
  // Consumed by the first refresh only: a later tab change must not re-scroll.
  let pendingRowKey = target.rowKey;

  const tableConfig: EditableTableConfig = {
    instanceId: INSTANCE_ID,
    // A real spec table, not activeEntry.table: the Zones pane has no field
    // specs, and refresh() sets this before anything is rendered anyway.
    tableName: GTFS_TABLES.BOOKING_RULES,
    rows: [],
    deps,
    emptyMessage: '',
    onInsert: () => void refresh(),
    onRowsChanged: () => void refresh(),
    onDelete: () => void refresh(),
  };

  const readCounts = async (): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    for (const entry of ON_DEMAND_ENTRIES) {
      if (entry.table === ZONES_ENTRY_ID) {
        counts.set(entry.table, (await readZoneFeatures(deps)).length);
        continue;
      }
      const rows = await deps.gtfsDatabase.getAllRows(
        specStoreName(entry.table)
      );
      counts.set(entry.table, rows.length);
    }
    return counts;
  };

  const refresh = async (): Promise<void> => {
    const counts = await readCounts();
    const sidebarEl = document.getElementById('on-demand-sidebar');
    const paneEl = document.getElementById('on-demand-pane');
    if (!sidebarEl || !paneEl) {
      return;
    }

    let paneHtml: string;
    if (activeEntry.render) {
      paneHtml = await activeEntry.render(deps);
    } else {
      const context: OnDemandContext = { idOwners: await readIdOwners(deps) };
      tableConfig.tableName = activeEntry.table;
      tableConfig.emptyMessage = activeEntry.emptyMessage;
      tableConfig.columnOverrides = activeEntry.columnOverrides?.(deps);
      tableConfig.validateRow = activeEntry.validateRow?.(context);
      tableConfig.joinColumns = activeEntry.joinColumns
        ? await activeEntry.joinColumns(deps)
        : undefined;
      tableConfig.rows = await deps.gtfsDatabase.getAllRows(
        specStoreName(activeEntry.table)
      );
      paneHtml = await renderEditableTable(tableConfig);
    }

    const note = activeEntry.note
      ? `<p class="text-xs text-base-content/60 mb-2">${escapeHtml(activeEntry.note)}</p>`
      : '';
    sidebarEl.innerHTML = renderSidebar(activeEntry.table, counts);
    paneEl.innerHTML = note + paneHtml;

    if (pendingRowKey) {
      const row = paneEl.querySelector(
        `[data-et-row="${CSS.escape(pendingRowKey)}"]`
      );
      pendingRowKey = undefined;
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: 'center' });
        row.classList.add('bg-primary/10');
      } else {
        console.warn(
          `[OnDemand] no ${activeEntry.table} row for ${target.rowKey}`
        );
      }
    }
  };

  const body = `
    <p class="text-xs text-base-content/60 mb-3">
      On-demand service (GTFS Flex): the rules a rider books under, the groups of
      stops they can be served at, and the zones they can be served in. A trip
      becomes on-demand in its timetable, by giving a stop_time a pickup and
      drop-off window instead of an arrival and departure.
      <a href="https://gtfs.org/documentation/schedule/reference/#booking_rulestxt"
         target="_blank" rel="noopener noreferrer" class="link">GTFS reference</a>.
    </p>
    <div class="flex gap-4 items-start">
      <div id="on-demand-sidebar" class="shrink-0"></div>
      <div id="on-demand-pane" class="flex-1 min-w-0"></div>
    </div>
  `;

  installEditableTableHandlers(tableConfig);

  await showModal({
    title: 'On-Demand',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-6xl w-11/12',
    onMount: (close) => {
      void refresh();

      document
        .getElementById('on-demand-sidebar')
        ?.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
            '[data-on-demand-entry]'
          );
          const table = btn?.dataset.onDemandEntry;
          if (!table || table === activeEntry.table) {
            return;
          }
          const entry = ON_DEMAND_ENTRIES.find((c) => c.table === table);
          if (!entry) {
            return;
          }
          activeEntry = entry;
          void refresh();
        });

      document
        .getElementById('on-demand-pane')
        ?.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;

          if (target.closest('[data-open-guide]')) {
            void showHelpModal('on-demand');
            return;
          }

          if (target.closest('[data-new-zone]')) {
            void (async () => {
              const taken = new Set(
                (await readZoneFeatures(deps)).map((f) => String(f.id ?? ''))
              );
              const created = await promptNewZone(taken);
              if (!created) {
                return;
              }
              await deps.onCreateZone(created.location_id, created.stop_name);
              close();
              deps.onZoneClick(created.location_id);
            })();
            return;
          }

          const btn = target.closest<HTMLButtonElement>('[data-zone-id]');
          const location_id = btn?.dataset.zoneId;
          if (!location_id) {
            return;
          }
          close();
          deps.onZoneClick(location_id);
        });
    },
  });

  uninstallEditableTableHandlers(INSTANCE_ID);
}
