/**
 * On-demand (GTFS Flex) editor.
 *
 * Same shape as `fares-modal.ts`: a sidebar of tables grouped by what they do,
 * and one spec-driven editable table in the content pane. Booking rules and
 * location groups are ordinary `.txt` tables and are edited here; zones live in
 * locations.geojson, which has no CSV field table, so that pane is read-only
 * and links through to the zone browse page where the geometry is edited.
 */

import { showSidebarModal } from 'interlocking/ui/sidebar-modal';
import {
  attachGeojsonExchangeHandlers,
  geojsonExchangeInput,
  pickLoneFeature,
  readIncomingFeature,
  renderGeojsonExchangeBlock,
  showGeojsonExchangeError,
} from './geojson-exchange';
import { encodeGeojsonIoUrl } from '../utils/geojson-io';
import { promptNewEntity } from './entity-form-modal';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableColumnOverride,
  type EditableTableConfig,
  type EditableTableDeps,
  type EditableTableJoinColumn,
} from './editable-table';
import { emptyState, memberJoinColumn, serviceOptions } from './fares-modal';
import type { OptionPickerItem } from './option-picker-modal';
import { escapeHtml } from 'interlocking/util/escape-html';
import { specStoreName } from '../utils/spec-field-edit';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display';
import { stopLocationType } from '../utils/area-hierarchy';
import {
  validateBookingRuleRow,
  validateLocationGroupId,
} from '../utils/flex-rules';
import { LOCATIONS_TABLE } from './zone-store';
import { GTFS_TABLES } from '../types/gtfs';

export interface OnDemandModalDeps extends EditableTableDeps {
  /** Opens a zone's browse page. The modal closes first. */
  onZoneClick: (location_id: string) => void;
  /**
   * Writes a new zone into locations.geojson as one patch. Lives outside this
   * module because it needs the parser, not the database.
   */
  onCreateZone: (zone: NewZone) => Promise<void>;
}

/** What the New zone modal collects. The geometry is required, as in the spec. */
export interface NewZone {
  location_id: string;
  stop_name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/** Which pane to open on, and which row to draw attention to. */
export interface OnDemandModalTarget {
  table?: string;
  rowKey?: string;
}

const INSTANCE_ID = 'on-demand-table';

/** locations.geojson is not a spec table; the Zones pane renders it by hand. */
const ZONES_ENTRY_ID = GTFS_TABLES.LOCATIONS_GEOJSON;

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
    return emptyState(
      ZONES_ENTRY_ID,
      'A zone is an area a rider can be picked up in or dropped off in. Zones arrive by importing a feed with locations.geojson, or you can draw one in geojson.io and create it here.'
    );
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
  </table>`;
}

/**
 * Ask for the new zone's id, name and geometry.
 *
 * Validation runs inside the action so a clash is reported in place rather
 * than closing the modal and losing what was typed. `taken` maps every id
 * already claimed across the shared ID namespace to who owns it, so a zone
 * cannot be created that the validator would immediately flag.
 */
async function promptNewZone(
  taken: Map<string, string>
): Promise<NewZone | null> {
  const instanceId = 'new-zone-geometry';
  const blankMapUrl = await encodeGeojsonIoUrl({
    type: 'FeatureCollection',
    features: [],
  });
  let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;

  // locations.geojson is a GeoJSON file the reference defines no field table
  // for, so presence is stated here rather than read from the spec layer.
  const values = await promptNewEntity({
    title: 'New zone',
    fields: [
      {
        field: 'location_id',
        presence: 'Required',
        mono: true,
        placeholder: 'e.g. zone_north',
      },
      {
        field: 'stop_name',
        label: 'Name',
        presence: 'Optional',
        placeholder: 'e.g. North service area',
      },
    ],
    extraBody: renderGeojsonExchangeBlock({
      instanceId,
      featureJson: '',
      editUrl: blankMapUrl,
      title: 'Geometry',
      rows: 8,
      placeholder:
        '{ "type": "Feature", "geometry": { "type": "Polygon", ... } }',
      hint: 'Draw the zone in geojson.io, then Share and paste the link here. A Polygon or MultiPolygon Feature, or a FeatureCollection holding one, works too.',
    }),
    onMount: () => {
      attachGeojsonExchangeHandlers(document, {
        instanceId,
        logPrefix: '[OnDemandModal] new zone',
        pick: pickLoneFeature,
      });
    },
    validate: async (v) => {
      if (v.location_id === '') {
        return 'location_id is required.';
      }
      const owner = taken.get(v.location_id);
      if (owner) {
        return `"${v.location_id}" is already used as ${owner}; the ID must be unique across stops.txt, locations.geojson and location_groups.txt.`;
      }
      geometry = await readNewZoneGeometry(instanceId);
      // readNewZoneGeometry reports into the exchange block's own error slot.
      return geometry ? null : '';
    },
  });

  if (!values || !geometry) {
    return null;
  }
  return {
    location_id: values.location_id,
    stop_name: values.stop_name,
    geometry,
  };
}

/**
 * The geometry typed into the New zone modal's exchange block.
 *
 * Reports its own failure in the block's error slot and returns null, so the
 * modal stays open with what the user pasted still in it.
 */
async function readNewZoneGeometry(
  instanceId: string
): Promise<GeoJSON.Polygon | GeoJSON.MultiPolygon | null> {
  const input = geojsonExchangeInput(document, instanceId);
  const fail = (message: string): null => {
    showGeojsonExchangeError(document, instanceId, message);
    return null;
  };
  try {
    const feature = await readIncomingFeature(
      input?.value ?? '',
      pickLoneFeature
    );
    const geometry = feature.geometry as GeoJSON.Geometry | null;
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') {
      return fail(
        `A zone needs a Polygon or MultiPolygon, got ${String(geometry?.type)}.`
      );
    }
    if (geometry.coordinates.length === 0) {
      return fail('That polygon has no coordinates. Draw the zone first.');
    }
    return geometry;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
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

/**
 * Every id a new zone may not take.
 *
 * `readIdOwners` covers stops and existing zones, which is all the location
 * group validator may see (it must not flag a row against its own id). A new
 * zone is checked against the whole namespace, so the location groups go on top.
 */
async function readNewZoneIdOwners(
  deps: OnDemandModalDeps
): Promise<Map<string, string>> {
  const owners = await readIdOwners(deps);
  const groups = await deps.gtfsDatabase.getAllRows(
    specStoreName(GTFS_TABLES.LOCATION_GROUPS)
  );
  for (const group of groups) {
    const id = String(group.location_group_id ?? '').trim();
    if (id !== '' && !owners.has(id)) {
      owners.set(id, 'a location_groups.txt location_group_id');
    }
  }
  return owners;
}

const INTRO = `On-demand service (GTFS Flex): the rules a rider books under, the
  groups of stops they can be served at, and the zones they can be served in. A
  trip becomes on-demand in its timetable, by giving a stop_time a pickup and
  drop-off window instead of an arrival and departure.
  <a href="https://gtfs.org/documentation/schedule/reference/#booking_rulestxt"
     target="_blank" rel="noopener noreferrer" class="link">GTFS reference</a>.`;

export async function showOnDemandModal(
  deps: OnDemandModalDeps,
  target: OnDemandModalTarget = {}
): Promise<void> {
  // Consumed by the first pane render only: a later tab change must not re-scroll.
  let pendingRowKey = target.rowKey;

  // Filled in by the scaffold; the table's own callbacks re-render through it.
  const refreshRef = { refresh: async (): Promise<void> => {} };

  const tableConfig: EditableTableConfig = {
    instanceId: INSTANCE_ID,
    // A real spec table, not the active entry's: the Zones pane has no field
    // specs, and renderPane sets this before anything is rendered anyway.
    tableName: GTFS_TABLES.BOOKING_RULES,
    rows: [],
    deps,
    emptyMessage: '',
    onInsert: () => void refreshRef.refresh(),
    onRowsChanged: () => void refreshRef.refresh(),
    onDelete: () => void refreshRef.refresh(),
  };

  const renderPane = async (entry: OnDemandEntry): Promise<string> => {
    if (entry.render) {
      return entry.render(deps);
    }
    const context: OnDemandContext = { idOwners: await readIdOwners(deps) };
    tableConfig.tableName = entry.table;
    tableConfig.emptyMessage = entry.emptyMessage;
    tableConfig.columnOverrides = entry.columnOverrides?.(deps);
    tableConfig.validateRow = entry.validateRow?.(context);
    tableConfig.joinColumns = entry.joinColumns
      ? await entry.joinColumns(deps)
      : undefined;
    tableConfig.rows = await deps.gtfsDatabase.getAllRows(
      specStoreName(entry.table)
    );
    return renderEditableTable(tableConfig);
  };

  const countEntry = async (entry: OnDemandEntry): Promise<number> => {
    if (entry.table === ZONES_ENTRY_ID) {
      return (await readZoneFeatures(deps)).length;
    }
    return (await deps.gtfsDatabase.getAllRows(specStoreName(entry.table)))
      .length;
  };

  const createZone = async (close: () => void): Promise<void> => {
    const created = await promptNewZone(await readNewZoneIdOwners(deps));
    if (!created) {
      return;
    }
    await deps.onCreateZone(created);
    close();
    deps.onZoneClick(created.location_id);
  };

  installEditableTableHandlers(tableConfig);

  await showSidebarModal({
    title: 'On-Demand',
    intro: INTRO,
    groupOrder: GROUP_ORDER,
    initialId: target.table,
    refreshRef,
    entries: ON_DEMAND_ENTRIES.map((entry) => ({
      id: entry.table,
      label: entry.label,
      group: entry.group,
      note: entry.note ? escapeHtml(entry.note) : undefined,
      guidePage: entry.table === ZONES_ENTRY_ID ? 'on-demand' : undefined,
      primaryAction:
        entry.table === ZONES_ENTRY_ID
          ? { label: 'New zone', onClick: createZone }
          : undefined,
      count: () => countEntry(entry),
      renderPane: () => renderPane(entry),
    })),
    onPaneRendered: (paneEl, close) => {
      paneEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-zone-id]'
        );
        const location_id = btn?.dataset.zoneId;
        if (!location_id) {
          return;
        }
        close();
        deps.onZoneClick(location_id);
      });

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
        console.warn(`[OnDemand] no row for ${rowKey}`);
      }
    },
  });

  uninstallEditableTableHandlers(INSTANCE_ID);
}
