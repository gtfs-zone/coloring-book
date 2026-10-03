/**
 * On-demand (GTFS Flex) editor.
 *
 * Same shape as `fares-modal.ts`: a sidebar of tables grouped by what they do,
 * and one spec-driven editable table in the content pane. Booking rules and
 * location groups are ordinary `.txt` tables and are edited here; zones live in
 * locations.geojson, which has no CSV field table, so that pane is read-only
 * and links through to the zone browse page where the geometry is edited.
 */

import { showSidebarModal } from 'gtfs-zone-web-common/ui/sidebar-modal';
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
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { specStoreName } from '../utils/spec-field-edit';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display';
import { stopLocationType } from '../utils/area-hierarchy';
import {
  validateBookingRuleRow,
  validateLocationGroupId,
} from '../utils/flex-rules';
import {
  locationIdClash,
  readIdOwners,
  readNewLocationIdOwners,
  readZoneFeatures,
} from '../utils/location-id-owners';
import { GTFS_TABLES } from '../types/gtfs';
import { firstFreeId } from '../utils/inline-entity-creator';
import { t } from '../i18n/messages';

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

/**
 * Zones, read-only.
 *
 * Geometry editing stays on the zone page, which has the map and the geojson.io
 * round trip; this pane exists so the on-demand objects are all listed in one
 * place and so a zone is reachable from here.
 */
async function renderZonesPane(deps: OnDemandModalDeps): Promise<string> {
  const features = await readZoneFeatures(deps.gtfsDatabase);
  if (features.length === 0) {
    return emptyState(ZONES_ENTRY_ID, t('flex.zonesHint'));
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
    <thead><tr><th>location_id</th><th>${t('flex.name')}</th><th>${t('flex.geometry')}</th></tr></thead>
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
    title: t('flex.newZone'),
    fields: [
      {
        field: 'location_id',
        presence: 'Required',
        mono: true,
        placeholder: 'e.g. zone_north',
        value: firstFreeId('zone', taken.keys()),
      },
      {
        field: 'stop_name',
        label: t('flex.name'),
        presence: 'Optional',
        placeholder: t('flex.zoneNamePlaceholder'),
      },
    ],
    extraBody: renderGeojsonExchangeBlock({
      instanceId,
      featureJson: '',
      editUrl: blankMapUrl,
      title: t('flex.geometry'),
      rows: 8,
      placeholder:
        '{ "type": "Feature", "geometry": { "type": "Polygon", ... } }',
      hint: t('flex.geometryHint'),
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
        return t('flex.idRequired');
      }
      const clash = locationIdClash(taken, v.location_id);
      if (clash) {
        return clash;
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
      return fail(t('flex.needsPolygon', { type: String(geometry?.type) }));
    }
    if (geometry.coordinates.length === 0) {
      return fail(t('flex.emptyPolygon'));
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
    label: t('flex.bookingRules'),
    group: 'Booking',
    emptyMessage: emptyState(
      GTFS_TABLES.BOOKING_RULES,
      t('flex.bookingRulesHint')
    ),
    note: t('flex.bookingRulesNote'),
    columnOverrides: (deps) => ({
      prior_notice_service_id: { options: () => serviceOptions(deps) },
    }),
    validateRow: () => validateBookingRuleRow,
  },
  {
    table: GTFS_TABLES.LOCATION_GROUPS,
    label: t('flex.locationGroups'),
    group: 'Geography',
    emptyMessage: emptyState(
      GTFS_TABLES.LOCATION_GROUPS,
      t('flex.locationGroupsHint')
    ),
    note: t('flex.locationGroupsNote'),
    validateRow: (context) => (row) =>
      validateLocationGroupId(
        String(row.location_group_id ?? '').trim(),
        context.idOwners
      ),
    joinColumns: async (deps) => [
      await memberJoinColumn(deps, {
        label: t('fares.stops'),
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
    label: t('flex.zones'),
    group: 'Geography',
    emptyMessage: '',
    note: t('flex.zonesNote'),
    render: renderZonesPane,
  },
];

const GROUP_ORDER: OnDemandGroup[] = ['Booking', 'Geography'];

const INTRO = `${t('flex.intro')}
  <a href="https://gtfs.org/documentation/schedule/reference/#booking_rulestxt"
     target="_blank" rel="noopener noreferrer" class="link">${t('fares.reference')}</a>.`;

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
    const context: OnDemandContext = {
      idOwners: await readIdOwners(deps.gtfsDatabase),
    };
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
      return (await readZoneFeatures(deps.gtfsDatabase)).length;
    }
    return (await deps.gtfsDatabase.getAllRows(specStoreName(entry.table)))
      .length;
  };

  const createZone = async (close: () => void): Promise<void> => {
    const created = await promptNewZone(
      await readNewLocationIdOwners(deps.gtfsDatabase)
    );
    if (!created) {
      return;
    }
    await deps.onCreateZone(created);
    close();
    deps.onZoneClick(created.location_id);
  };

  installEditableTableHandlers(tableConfig);

  await showSidebarModal({
    title: t('flex.title'),
    intro: INTRO,
    groupOrder: GROUP_ORDER,
    groupLabel: (group) => t(`flex.group.${group as OnDemandGroup}`),
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
          ? { label: t('flex.newZone'), onClick: createZone }
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
