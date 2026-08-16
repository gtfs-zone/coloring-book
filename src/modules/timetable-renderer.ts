/**
 * Timetable Renderer Module
 * Handles HTML generation for timetable views and schedule headers
 */

import {
  Routes,
  Stops,
  Calendar,
  CalendarDates,
} from '../types/gtfs-entities.js';
import {
  TimetableData,
  DirectionInfo,
  AlignedTrip,
  TripFrequency,
} from './timetable-data-processor.js';
import { TimetableCellRenderer } from './timetable-cell-renderer.js';
import {
  generateFieldConfigsFromSchema,
  FieldConfig,
  renderFieldLabelContent,
  renderSpecFieldLabelContent,
} from '../utils/field-component.js';
import {
  StopTimeFieldMode,
  visibleStopTimeFields,
} from './timetable-fields.js';
import { describeFrequency } from '../utils/frequency-rules.js';
import { TimeFormatter } from '../utils/time-formatter.js';
import { getEnumOptions } from '../types/gtfs-enums.js';
import { TripsSchema, GTFS_TABLES } from '../types/gtfs.js';
import { getStopDisplay, renderCardLabel } from '../utils/entity-display.js';
import { escapeHtml } from '../utils/escape-html.js';
import { formatIssueValue, isDanglingReference } from './feed-issues.js';
import { renderTrashIcon, renderRouteWaypointsIcon } from './modal-utils.js';
import { routeColor } from '../utils/route-colors.js';
import {
  railCell,
  rowPaths,
  RowDot,
  endpointThreshold,
  isEndpoint,
  gutterWidth,
  STRIP_ROW_CLASS,
} from './route-strip.js';
import { RouteSequence } from './route-sequence.js';
import { RouteGraph } from './route-graph.js';
import type { StopTimeRef } from '../types/gtfs-flex.js';

function getBrouterProfile(routeType: string | number): string {
  const t = Number(routeType);
  if ([0, 1, 2, 12].includes(t)) {
    return 'rail';
  }
  if (t === 4) {
    return 'river';
  }
  return 'car-fast';
}

function buildBrouterUrl(
  stops: Stops[],
  routeType: string | number
): string | null {
  // Flex rows contribute a synthetic stop with no coordinates (and are not in
  // trip.stopTimes at all), so they drop out here and never become waypoints.
  const geocoded = stops.filter(
    (s) =>
      s.stop_lat !== null &&
      s.stop_lat !== undefined &&
      s.stop_lon !== null &&
      s.stop_lon !== undefined
  );
  if (geocoded.length < 2) {
    return null;
  }

  const lats = geocoded.map((s) => parseFloat(s.stop_lat as string));
  const lons = geocoded.map((s) => parseFloat(s.stop_lon as string));
  const centerLat = (lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(4);
  const centerLon = (lons.reduce((a, b) => a + b, 0) / lons.length).toFixed(4);
  const lonlats = geocoded
    .map(
      (s) =>
        `${parseFloat(s.stop_lon as string).toFixed(6)},${parseFloat(s.stop_lat as string).toFixed(6)}`
    )
    .join(';');
  const profile = getBrouterProfile(routeType);
  return `https://brouter.de/brouter-web/#map=12/${centerLat}/${centerLon}/standard&lonlats=${lonlats}&profile=${profile}`;
}

/** Width of one trip column, and of the field-label sub-column, in rem. */
const TRIP_COLUMN_REM = 11;
const LABEL_COLUMN_REM = 10;

/**
 * The one decision the whole render shares: which stop_times sub-rows every
 * cell shows. Computed once in renderTimetableHTML and threaded down rather
 * than recomputed per cell, so the grid cannot end up ragged.
 */
interface RenderContext {
  mode: StopTimeFieldMode;
  fields: readonly string[];
  /** Used and All show the frozen field-label sub-column; Compact does not. */
  showLabels: boolean;
}

/**
 * Timetable Renderer - HTML generation for schedule views
 *
 * This class is responsible for:
 * - Generating complete timetable HTML structure
 * - Rendering schedule headers with route/service information
 * - Creating direction tabs for multi-direction routes
 * - Coordinating with TimetableCellRenderer for time cells
 * - Handling error states and empty data scenarios
 *
 * Uses DaisyUI classes for consistent styling.
 */
export class TimetableRenderer {
  private cellRenderer: TimetableCellRenderer;

  constructor() {
    this.cellRenderer = new TimetableCellRenderer();
  }
  /**
   * Render complete timetable HTML structure
   *
   * Main entry point for generating full timetable views.
   * Combines header, direction tabs, and content into a cohesive layout.
   *
   * @param data - Complete timetable data including route, service, stops, and trips
   * @param pendingRef - Optional ref of the pending row being added (for styling)
   * @returns HTML string for the complete timetable view
   */
  public renderTimetableHTML(
    data: TimetableData,
    pendingRef?: StopTimeRef
  ): string {
    const mode = data.stopTimeFieldMode ?? 'compact';
    const ctx: RenderContext = {
      mode,
      fields: visibleStopTimeFields(mode, data.trips),
      showLabels: mode !== 'compact',
    };

    // Compact swaps a cell's two time sub-rows for the two window fields, so
    // every cell renders exactly this many spans whatever its row references.
    // resolveNeighbour reads this to step between cells.
    const perCell = mode === 'compact' ? 2 : ctx.fields.length;

    return `
      <div id="schedule-view" class="h-full flex flex-col" data-fields-per-cell="${perCell}">
        ${this.renderDirectionTabs(data)}
        ${this.renderModeSwitch(mode)}
        ${this.renderTimetableContent(data, ctx, pendingRef)}
      </div>
    `;
  }

  /**
   * The Compact / Used / All switch over the stop_times sub-rows.
   *
   * One global mode rather than per-row expansion: the grid has to stay
   * rectangular for the keyboard navigation and the fixed column width to work.
   */
  private renderModeSwitch(mode: StopTimeFieldMode): string {
    const button = (
      value: StopTimeFieldMode,
      label: string,
      title: string
    ): string => `
      <button
        type="button"
        class="stop-time-mode-btn btn btn-xs join-item${value === mode ? ' btn-active' : ''}"
        data-mode="${value}"
        title="${escapeHtml(title)}"
      >${label}</button>
    `;

    return `
      <div class="flex items-center gap-2 border-b border-base-300 px-2 py-1">
        <span class="text-xs opacity-60">stop_times fields</span>
        <div class="join">
          ${button('compact', 'Compact', 'Arrival and departure only (the pickup/drop-off window on an on-demand row).')}
          ${button('used', 'Used', 'Every stop_times field that is used on this route and direction.')}
          ${button('all', 'All', 'Every editable stop_times field, in spec order.')}
        </div>
      </div>
    `;
  }

  /**
   * Render schedule header with route and service information
   *
   * Creates the top section with route name, service ID, and service properties.
   * Displays route name (short + long name if available) and service period.
   *
   * @param route - GTFS route entity with naming information
   * @param service - Calendar or CalendarDates entity with service details
   * @returns HTML string for the schedule header section
   */
  public renderScheduleHeader(
    route: Routes,
    service: Calendar | CalendarDates
  ): string {
    const routeName = route.route_short_name
      ? `${route.route_short_name}${route.route_long_name ? ' - ' + route.route_long_name : ''}`
      : route.route_long_name || route.route_id;

    const serviceName = service.service_id;

    return `
      <div class="border-b border-base-300">
        <div class="p-4">
          <h2 class="text-lg font-semibold">
            ${routeName} - ${serviceName}
          </h2>
          <p class="text-sm opacity-70">
            Timetable View
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Render direction tabs navigation
   *
   * Creates tab navigation for multi-direction routes.
   * Hides tabs if only one or no directions are available.
   * Highlights the currently selected direction.
   *
   * @param data - Timetable data containing available directions
   * @returns HTML string for direction tabs or empty string if not needed
   */
  public renderDirectionTabs(data: TimetableData): string {
    const directions = data.availableDirections || [];

    const selectedDirectionId =
      data.selectedDirectionId ||
      (directions.length > 0 ? directions[0].id : '0');

    const tabsHTML = directions
      .map((direction: DirectionInfo) => {
        const isActive = direction.id === selectedDirectionId;
        const activeClass = isActive ? 'tab-active' : '';
        const dimClass = direction.tripCount === 0 ? 'opacity-40' : '';

        return `
          <a class="tab ${activeClass} ${dimClass}"
             onclick="gtfsEditor.navigateToTimetable('${data.route.route_id}', '${data.service.service_id}', '${direction.id}')">
            ${this.getDirectionDisplayName(direction)}
          </a>
        `;
      })
      .join('');

    return `
      <div class="border-b border-base-300">
        <div class="tabs tabs-border p-2 flex items-center">
          ${tabsHTML}
        </div>
      </div>
    `;
  }

  /**
   * Render main timetable content
   *
   * Generates the main timetable table with stops and trip columns.
   * Handles empty states when no direction is selected.
   * Creates responsive table with sticky headers and scrolling.
   *
   * @param data - Complete timetable data with trips and stops
   * @param pendingRef - Optional ref of the pending row being added (for styling)
   * @returns HTML string for the main timetable content area
   */
  private renderTimetableContent(
    data: TimetableData,
    ctx: RenderContext,
    pendingRef?: StopTimeRef
  ): string {
    // Always render the table structure, even when empty.
    //
    // `table-fixed` plus an explicit width on every column in the header row is
    // what keeps a trip column exactly TRIP_COLUMN_REM wide however long a
    // booking rule id or a headsign is. `w-auto` overrides DaisyUI's
    // `width: 100%`, which would otherwise stretch the columns whenever the
    // trips do not already fill the viewport.
    return `
      <div class="flex-1 overflow-x-auto">
        <table class="table table-xs table-fixed w-auto table-pin-rows table-pin-cols" role="grid">
          ${this.renderTimetableHeader(data, ctx)}
          ${this.renderTimetableBody(data, ctx, pendingRef)}
        </table>
      </div>
    `;
  }

  /** The frozen first column's width: wider when the field labels are shown. */
  private labelColumnStyle(ctx: RenderContext): string {
    return `width:${ctx.showLabels ? 20 + LABEL_COLUMN_REM : 20}rem`;
  }

  /**
   * Generate trip property field configurations from TripsSchema
   * Filters out non-editable fields (route_id, service_id, trip_id)
   *
   * @param sampleTrip - Sample trip object for getting current values
   * @returns Array of field configurations for trip properties
   */
  private generateTripPropertyConfigs(
    sampleTrip: Record<string, unknown>
  ): FieldConfig[] {
    // Generate all field configs from TripsSchema
    const allConfigs = generateFieldConfigsFromSchema(
      TripsSchema,
      sampleTrip as Record<string, string | number | undefined>,
      GTFS_TABLES.TRIPS
    );

    // Filter out fields that shouldn't be editable in the timetable
    // route_id and service_id are fixed (timetable is already filtered by these)
    // trip_id is the primary key
    const editableConfigs = allConfigs.filter(
      (config) => !['route_id', 'service_id', 'trip_id'].includes(config.field)
    );

    return editableConfigs;
  }

  /**
   * Render trip property rows at the top of the timetable
   * Properties are displayed as rows with labels in the first column
   * and input fields in each trip column
   *
   * @param data - Complete timetable data including trips
   * @returns HTML string for trip property rows
   */
  private renderTripPropertyRows(
    data: TimetableData,
    ctx: RenderContext
  ): string {
    const trips = data.trips;

    if (trips.length === 0) {
      return '';
    }

    // Use first trip as sample to get property configs
    const sampleTrip = trips[0];
    const propertyConfigs = this.generateTripPropertyConfigs(
      sampleTrip as unknown as Record<string, unknown>
    );

    // Render each property as a row
    const propertyRows = propertyConfigs
      .map((config) => {
        const cells = trips
          .map((trip) => {
            return this.renderPropertyCell(
              trip as unknown as Record<string, unknown>,
              config
            );
          })
          .join('');

        // Add empty cell for "New Trip" column
        const newTripCell = '<td class="text-center p-2"></td>';

        return `
        <tr class="trip-property-row" data-property="${config.field}">
          <th class="stop-name p-2 font-medium border-r border-base-300 bg-base-100" style="${this.labelColumnStyle(ctx)}">
            <div class="stop-name-text truncate">${renderFieldLabelContent(config)}</div>
          </th>
          ${cells}
          ${newTripCell}
        </tr>
      `;
      })
      .join('');

    return propertyRows + this.renderFrequencyBand(data, ctx);
  }

  /**
   * The frequencies.txt band: two rows per headway period, sharing the trip
   * columns and the frozen label column with the trip property rows above.
   *
   * A headway period is four fields on one trip, so it is edited exactly like a
   * trip property: a click-to-edit span per field, no modal. The band's height
   * is set by whichever displayed trip has the most periods; trips with fewer
   * show `-` in the slots they do not have, because a period is created by the
   * `+` row and never by typing into a blank slot.
   *
   * The spans are `.freq-span`, deliberately *not* `.time-span`: timeCellRows
   * selects rows containing `.time-span`, and pulling these rows into the
   * stop-time grid would break resolveNeighbour's per-cell index arithmetic
   * against rows with a different span count.
   */
  private renderFrequencyBand(data: TimetableData, ctx: RenderContext): string {
    const trips = data.trips;
    const bandSize = trips.reduce(
      (max, trip) => Math.max(max, trip.frequencies.length),
      0
    );

    const labelCell = (label: string, muted = false): string => `
      <th class="stop-name p-2 font-medium border-r border-base-300 bg-base-100" style="${this.labelColumnStyle(ctx)}">
        <div class="stop-name-text truncate${muted ? ' opacity-60 font-normal' : ''}">${label}</div>
      </th>
    `;
    const spacerCell = '<td class="text-center p-2"></td>';

    const addButton = (trip: AlignedTrip, label: string): string => `
      <td class="text-center p-2">
        <button
          type="button"
          class="freq-add btn btn-xs btn-ghost"
          data-trip-id="${escapeHtml(trip.trip_id)}"
          title="Add a headway period to ${escapeHtml(trip.trip_id)}"
        >${label}</button>
      </td>
    `;

    // Nothing headway-based on this route and direction: one row so a trip can
    // still be converted, and nothing else added to the layout.
    if (bandSize === 0) {
      const cells = trips
        .map((trip) => addButton(trip, '+ frequency'))
        .join('');
      return `
        <tr class="frequency-row" data-freq-index="empty">
          ${labelCell('frequencies')}
          ${cells}
          ${spacerCell}
        </tr>
      `;
    }

    let rows = '';
    for (let i = 0; i < bandSize; i++) {
      const windowCells = trips
        .map((trip) => {
          const period = trip.frequencies[i];
          if (!period) {
            return `<td class="text-center p-2"><span class="block h-6 leading-6 opacity-40">-</span><span class="block h-6"></span></td>`;
          }
          return `
            <td class="text-center p-2">
              ${this.renderFrequencySpan(period, 'start_time', 'time')}
              ${this.renderFrequencySpan(period, 'end_time', 'time')}
            </td>
          `;
        })
        .join('');

      const headwayCells = trips
        .map((trip) => {
          const period = trip.frequencies[i];
          if (!period) {
            return `<td class="text-center p-2"><span class="block h-6 leading-6 opacity-40">-</span><span class="block h-6"></span></td>`;
          }
          return `
            <td class="text-center p-2">
              ${this.renderFrequencySpan(period, 'headway_secs', 'number')}
              <div class="flex items-center gap-1">
                ${this.renderFrequencySpan(period, 'exact_times', 'enum', 'flex-1 min-w-0')}
                <button
                  type="button"
                  class="freq-delete btn btn-ghost btn-xs px-1 text-error"
                  data-trip-id="${escapeHtml(period.trip_id)}"
                  data-start-time="${escapeHtml(period.start_time)}"
                  title="Delete this headway period"
                >&#10005;</button>
              </div>
            </td>
          `;
        })
        .join('');

      rows += `
        <tr class="frequency-row" data-freq-index="${i}">
          ${labelCell(`frequency ${i + 1}`)}
          ${windowCells}
          ${spacerCell}
        </tr>
        <tr class="frequency-row" data-freq-index="${i}">
          ${labelCell('headway', true)}
          ${headwayCells}
          ${spacerCell}
        </tr>
      `;
    }

    const addRow = `
      <tr class="frequency-row" data-freq-index="add">
        ${labelCell('+ period', true)}
        ${trips.map((trip) => addButton(trip, '+')).join('')}
        ${spacerCell}
      </tr>
    `;

    return rows + addRow;
  }

  /**
   * One field of one headway period, click-to-edit like a trip property.
   *
   * `data-start-time` is the record's *current* start_time, i.e. its composite
   * key. Editing start_time re-keys the record, so this attribute is stale the
   * moment such an edit commits - the controller re-renders before any further
   * click can address the old key.
   */
  private renderFrequencySpan(
    period: TripFrequency,
    field: 'start_time' | 'end_time' | 'headway_secs' | 'exact_times',
    kind: 'time' | 'number' | 'enum',
    extraClasses = ''
  ): string {
    const value = String(period[field] ?? '');

    let display: string;
    let title: string = field;
    let muted = false;
    if (kind === 'time') {
      display = value ? TimeFormatter.formatTimeWithSeconds(value) : '--:--:--';
    } else if (field === 'headway_secs') {
      display = value || '-';
      const secs = /^\d+$/.test(value) ? parseInt(value, 10) : null;
      if (secs !== null) {
        title = `${field} - ${secs % 60 === 0 ? `${secs / 60} minutes` : `${secs} seconds`}`;
      }
    } else {
      // Empty exact_times is equivalent to 0 per the spec, so it is shown as 0
      // rather than as a blank - muted, since the file itself carries nothing.
      const effective = value === '' ? '0' : value;
      const option = (getEnumOptions('exact_times') ?? []).find(
        (opt) => String(opt.value) === effective
      );
      display = option ? `${effective} - ${option.label}` : effective;
      muted = value === '';
      title = value === '' ? `${field} - empty, equivalent to 0` : field;
    }

    return `
      <span
        class="freq-span block h-6 leading-6 truncate font-mono text-xs cursor-pointer rounded px-1 hover:bg-base-200${muted ? ' opacity-60' : ''} ${extraClasses}"
        data-trip-id="${escapeHtml(period.trip_id)}"
        data-start-time="${escapeHtml(period.start_time)}"
        data-field="${field}"
        data-field-kind="${kind}"
        data-value="${escapeHtml(value)}"
        title="${escapeHtml(title)}"
      >${escapeHtml(display)}</span>
    `;
  }

  /**
   * Generate human-readable label from snake_case field name
   */
  /**
   * Render individual property cell as a clickable text span
   *
   * Mirrors the time-cell click-to-edit pattern: a static span carries the
   * data the delegated handler in ScheduleController needs to swap it for
   * the right editor (inline input, inline enum menu, or the searchable
   * shape_id modal) on click. See installTimetablePickers.
   *
   * @param trip - Trip object containing the property value
   * @param config - Field configuration for this property
   * @returns HTML string for the property cell
   */
  private renderPropertyCell(
    trip: Record<string, unknown>,
    config: FieldConfig
  ): string {
    const trip_id = trip.trip_id as string;
    const rawValue = trip[config.field];
    const value =
      rawValue === null || rawValue === undefined ? '' : String(rawValue);

    let fieldKind: 'text' | 'number' | 'enum' | 'shape';
    let display: string;

    if (config.field === 'shape_id') {
      fieldKind = 'shape';
      display = value;
    } else if (config.type === 'select' && config.options) {
      fieldKind = 'enum';
      const option = config.options.find((opt) => String(opt.value) === value);
      display = option ? option.label : '';
    } else if (config.type === 'number') {
      fieldKind = 'number';
      display = value;
    } else {
      fieldKind = 'text';
      display = value;
    }

    // A reference no record matches reads as an error. It stays clickable, so
    // the picker (which offers the current value back) can repoint it.
    const dangling = isDanglingReference('trips.txt', config.field, value);
    const danglingAttrs = dangling
      ? ` title="${escapeHtml(`No record with ${config.field} ${formatIssueValue(value)} exists`)}"`
      : '';

    return `
      <td class="text-center p-2">
        <span${danglingAttrs}
          class="trip-prop-span inline-block max-w-full truncate cursor-pointer rounded px-1 hover:bg-base-200${dangling ? ' text-error font-semibold' : ''}"
          data-trip-id="${trip_id}"
          data-field="${config.field}"
          data-table="trips.txt"
          data-field-kind="${fieldKind}"
          data-value="${escapeHtml(value)}"
        >${escapeHtml(display) || '-'}</span>
      </td>
    `;
  }

  /**
   * Render timetable header with trip columns
   *
   * Creates table header row with stop column and trip columns.
   * Uses trip headsign, short name, or truncated trip ID for display.
   * Makes header sticky for better scrolling experience.
   * Includes "Add Stop" button in the stop column header.
   *
   * @param data - Complete timetable data including trips, route, and service
   * @param hasPendingStop - Whether there's a pending stop being added
   * @returns HTML string for the table header
   */
  private renderTimetableHeader(
    data: TimetableData,
    ctx: RenderContext
  ): string {
    const trips = data.trips;
    const columnStyle = `width:${TRIP_COLUMN_REM}rem`;
    const tripHeaders = trips
      .map((trip) => {
        // A frequency-based trip's stop_times are a template: the badge is what
        // says so, without a second display mode for the cells themselves.
        const badge =
          trip.frequencies.length > 0
            ? `<span
                 class="badge badge-xs badge-outline badge-info ml-1 align-middle"
                 title="${escapeHtml(trip.frequencies.map((f) => describeFrequency(f as unknown as Record<string, unknown>)).join('; '))}"
               >~ &times;${trip.frequencies.length}</span>`
            : '';
        return `
          <td class="trip-header text-center p-2 text-xs font-mono" style="${columnStyle}">
            <span class="inline-block max-w-full truncate align-middle" title="${escapeHtml(trip.trip_id)}">${escapeHtml(trip.trip_id)}</span>${badge}
          </td>
        `;
      })
      .join('');

    const tripActionCells = trips
      .map((trip) => {
        const tripStops = data.stops.filter((_, i) => trip.stopTimes.has(i));
        const brouterUrl = buildBrouterUrl(
          tripStops,
          data.route.route_type ?? ''
        );
        const brouterLink = brouterUrl
          ? `<a href="${brouterUrl}" target="_blank" rel="noopener" class="btn btn-xs btn-outline" title="Open in brouter">${renderRouteWaypointsIcon('h-3 w-3')}</a>`
          : '';
        return `
          <td class="trip-header text-center p-2 text-xs" style="${columnStyle}">
            <div class="flex items-center justify-center gap-1">
              <button class="btn btn-xs btn-error btn-outline delete-trip-btn" data-trip-id="${escapeHtml(trip.trip_id)}" title="Delete">${renderTrashIcon('h-3 w-3')}</button>
              ${brouterLink}
            </div>
          </td>
        `;
      })
      .join('');

    // Always add a "new trip" column on the right
    const newTripHeader = `
      <td class="trip-header text-center p-2 text-xs" style="${columnStyle}">
        <input
          type="text"
          class="input input-xs w-full text-center"
          placeholder="New trip ID..."
          id="new-trip-input"
          onchange="gtfsEditor.scheduleController.createTripFromInput(this.value)"
        />
      </td>
    `;

    return `
      <thead>
        <tr class="z-[2]">
          <th class="stop-header p-2 text-left bg-base-100" style="${this.labelColumnStyle(ctx)}">
            Stop
          </th>
          ${tripHeaders}
          ${newTripHeader}
        </tr>
        <tr class="z-[2]">
          <th class="stop-header p-2 text-left bg-base-100"></th>
          ${tripActionCells}
          <td class="trip-header text-center p-2 text-xs"></td>
        </tr>
      </thead>
    `;
  }

  /**
   * Render one stop row's rail + label cell.
   *
   * The rail is the strip visualisation: an SVG of the route's branch
   * geometry for this row, laid under the stop label and swap button. No
   * vehicle chips sit in the gaps in coloring-book (that is test-track's
   * concern), so every row is a plain stop row with no lead-in/lead-out
   * extension needed.
   *
   * The label itself used to come from a `<select>` listing every stop in the
   * feed, repeated in every row (226,556 `<option>` nodes for the MBTA Red
   * Line and 721,000 for a 70-stop bus route), which was the single largest
   * cost in the view. The label is now static text; clicking it opens the
   * searchable stop picker modal (see ScheduleController.openStopPicker).
   *
   * @param stop - The stop this row represents
   * @param index - The stop's position in the route sequence / graph
   * @param graph - The route's lane layout
   * @param sequence - The route's canonical stop order and per-stop stats
   * @param color - The route's rail color
   * @returns HTML string for the row's rail + stop label cell
   */
  private renderStopLabelCell(
    stop: Stops,
    index: number,
    graph: RouteGraph,
    sequence: RouteSequence,
    color: string,
    ctx: RenderContext,
    pendingRef?: StopTimeRef
  ): string {
    // The pending row (add-stop preview) is appended to data.stops but has no
    // row in the route sequence/graph, so it has no rail and no stats. Render a
    // plain label for it rather than indexing off the end of stopStats.
    if (index >= sequence.stops.length) {
      return this.renderPlainStopLabel(stop, ctx, pendingRef);
    }

    const stats = sequence.stopStats[index];
    const threshold = endpointThreshold(sequence.totalTrips);
    const endpoint = isEndpoint(stats, threshold);
    const revisit = sequence.stops[index].occurrence;
    const ref = sequence.stops[index].ref;
    // A flex row references a location group or zone, which has no stop to
    // focus, so its rail stays non-interactive.
    const isStop = ref.kind === 'stop';

    const dot: RowDot = {
      kind: endpoint ? 'solid' : 'open',
      lane: graph.rows[index].lane,
    };
    const rail = railCell(
      color,
      graph.laneCount,
      rowPaths(graph, index, { kind: 'stop', leadIn: false, leadOut: false }),
      dot,
      isStop
        ? { stop_id: stop.stop_id, title: 'Focus this stop on the map' }
        : {}
    );

    const revisitHtml =
      revisit > 0
        ? `<span class="opacity-50 text-xs ml-1">(visit ${revisit + 1})</span>`
        : '';

    // The rail is absolutely positioned so it fills the full row height,
    // however tall the trip time cells make the row. A percentage height on a
    // normal-flow child of a table cell does not resolve, but the stop <th> is
    // `position: sticky` (from table-pin-cols), so it is a containing block and
    // `inset-y-0` resolves to the whole cell. The label clears the rail with a
    // left pad of the rail width plus the usual gap.
    const width = gutterWidth(graph.laneCount);
    const title = `Served by ${stats.serves} of ${sequence.totalTrips} trips`;
    const nameBlock = isStop
      ? this.renderStopNameBlock(stop, revisitHtml, title)
      : this.renderFlexNameBlock(stop, ref, revisitHtml, title);
    return `
      <div class="absolute top-0 -bottom-px left-0">${rail}</div>
      <div class="flex items-start gap-2 min-w-0" style="padding-left:${width + 8}px">
        <div class="min-w-0 flex-1 self-center">${nameBlock}</div>
        ${this.renderFieldLabelColumn(ctx)}
      </div>
    `;
  }

  /**
   * The frozen column of stop_times field names, one per sub-row.
   *
   * Alignment is by construction, not by measurement: every label and every
   * cell span is exactly `h-6`, and the column's top padding matches the time
   * cells' `p-2`. Do not add JS height syncing here.
   */
  private renderFieldLabelColumn(ctx: RenderContext): string {
    if (!ctx.showLabels) {
      return '';
    }
    const labels = ctx.fields
      .map(
        (field) =>
          `<div class="h-6 leading-6 truncate">${renderSpecFieldLabelContent('stop_times.txt', field, field)}</div>`
      )
      .join('');
    return `
      <div
        class="stop-time-field-labels shrink-0 py-2 text-right font-mono text-xs opacity-60"
        style="width:${LABEL_COLUMN_REM}rem"
      >${labels}</div>
    `;
  }

  /**
   * The stop name over its stop_id. The name span is the click target for the
   * stop picker (`data-stop-id`); the id line below is the real stop/platform
   * id carried in this row of the schedule, shown so the operator can tell
   * apart same-named stops.
   */
  private renderStopNameBlock(
    stop: Stops,
    revisitHtml: string,
    title: string
  ): string {
    const label = renderCardLabel(
      getStopDisplay(stop as unknown as Record<string, string>)
    );
    return `
      <div class="flex flex-col justify-center min-w-0 flex-1" title="${title}">
        <span
          class="stop-label-span min-w-0 truncate cursor-pointer rounded px-1 hover:bg-base-200"
          data-stop-id="${escapeHtml(stop.stop_id)}"
          title="Change stop"
        >${label}${revisitHtml}</span>
        <span class="stop-id-line text-xs opacity-50 font-mono truncate px-1">${escapeHtml(stop.stop_id)}</span>
      </div>
    `;
  }

  /**
   * The label for an on-demand row: a location group or an on-demand zone.
   *
   * Deliberately does not go through `getStopDisplay` - that helper is
   * documented as stops-only (it formats child stops as `Name (stop_id)`), and
   * a zone has no parent_station concept. The name comes pre-resolved on the
   * synthetic row built by TimetableDataProcessor. There is no `data-stop-id`
   * here, so clicking the label does not open the stop picker: repointing a
   * flex row at a different zone is not a stop swap. It opens the zone or
   * location group's own browse page instead.
   */
  private renderFlexNameBlock(
    stop: Stops,
    ref: StopTimeRef,
    revisitHtml: string,
    title: string
  ): string {
    const kindLabel = ref.kind === 'location_group' ? 'Group' : 'Zone';
    const openLabel =
      ref.kind === 'location_group'
        ? 'Open this location group'
        : 'Open this zone';
    return `
      <div class="flex flex-col justify-center min-w-0 flex-1" title="${title}">
        <span
          class="flex-label-span min-w-0 truncate cursor-pointer rounded px-1 hover:bg-base-200 flex items-center gap-1"
          data-flex-kind="${escapeHtml(ref.kind)}"
          data-flex-id="${escapeHtml(ref.id)}"
          title="${openLabel}"
        >
          <span class="badge badge-xs badge-info badge-outline shrink-0">${kindLabel}</span>
          <span class="truncate">${escapeHtml(String(stop.stop_name ?? ref.id))}</span>
          ${revisitHtml}
        </span>
        <span class="stop-id-line text-xs opacity-50 font-mono truncate px-1">${escapeHtml(ref.id)}</span>
      </div>
    `;
  }

  /**
   * A label with no rail, for the pending add-row preview.
   *
   * A pending zone or location group gets the same flex name block (kind badge,
   * no stop picker) a saved on-demand row gets, so the preview reads as the row
   * it is about to become.
   */
  private renderPlainStopLabel(
    stop: Stops,
    ctx: RenderContext,
    pendingRef?: StopTimeRef
  ): string {
    const nameBlock =
      pendingRef !== undefined && pendingRef.kind !== 'stop'
        ? this.renderFlexNameBlock(
            stop,
            pendingRef,
            '',
            'Pending on-demand row'
          )
        : this.renderStopNameBlock(stop, '', 'Pending stop');
    return `
      <div class="flex items-start gap-2 min-w-0">
        <div class="min-w-0 flex-1 self-center">${nameBlock}</div>
        ${this.renderFieldLabelColumn(ctx)}
      </div>
    `;
  }

  /**
   * Render timetable body with stops and trip time cells
   *
   * Creates table body with one row per stop and time cells for each trip.
   * Delegates cell rendering to TimetableCellRenderer for consistency.
   * Uses stop position as the key for time lookups.
   *
   * @param data - Complete timetable data with stops, trips, and time mappings
   * @param pendingRef - Optional ref of the pending row being added (for styling)
   * @returns HTML string for the table body
   */
  private renderTimetableBody(
    data: TimetableData,
    ctx: RenderContext,
    pendingRef?: StopTimeRef
  ): string {
    if (!data.stops || !data.trips) {
      return '<tbody></tbody>';
    }

    console.log(
      `[TimetableRenderer] rendering ${data.stops.length} stops x ${data.trips.length} trips`
    );

    const graph = data.graph;
    const sequence = data.sequence;
    if (data.stops.length > 0 && (!graph || !sequence)) {
      throw new Error(
        '[TimetableRenderer] stops present without a route graph/sequence - generateTimetableData should always produce both alongside stops'
      );
    }
    const color = routeColor(data.route.route_id, data.route.route_color);

    const rows = data.stops
      .map((stop, stopIndex) => {
        const isPendingStop =
          pendingRef !== undefined &&
          stop.stop_id === pendingRef.id &&
          stopIndex === data.stops.length - 1;
        // A pending zone or location group row edits a window, not an
        // arrival/departure pair, so its cells render like a saved flex row.
        const isPendingFlex = isPendingStop && pendingRef!.kind !== 'stop';
        const rowClass = isPendingStop
          ? 'opacity-60 border-dashed border-2 border-warning'
          : '';

        // What the whole row references, independent of any one trip. Hovering
        // a row lights this on the map, and it is also what decides whether a
        // trip's cell here is a window cell or an arrival/departure cell - a
        // zone row is a zone row on every trip, including the ones with no
        // stop_time at this position.
        const rowRef =
          sequence !== undefined && stopIndex < sequence.stops.length
            ? sequence.stops[stopIndex].ref
            : isPendingStop
              ? pendingRef
              : undefined;
        const isStopRow = rowRef === undefined || rowRef.kind === 'stop';
        const rowRefAttrs = isStopRow
          ? `data-stop-id="${escapeHtml(stop.stop_id)}"`
          : `data-flex-kind="${escapeHtml(rowRef.kind)}" data-flex-id="${escapeHtml(rowRef.id)}"`;

        const timeCells = data.trips
          .map((trip) => {
            // Use stopIndex as the key for all time lookups
            // stopIndex = position in the supersequence (same as position in data.stops array)
            // This handles duplicate stops correctly (e.g., circular routes)
            const editableStopTime = trip.editableStopTimes?.get(stopIndex);
            const stopSequence = editableStopTime?.stop_sequence ?? '';
            return this.cellRenderer.renderStopTimeCell({
              trip_id: trip.trip_id,
              stop_id: stop.stop_id,
              stopIndex,
              fields: ctx.fields,
              mode: ctx.mode,
              editableStopTime,
              isFirstStop:
                stopSequence !== '' && stopSequence === trip.firstStopSequence,
              isLastStop:
                stopSequence !== '' && stopSequence === trip.lastStopSequence,
              isPendingRow: isPendingStop,
              isPendingFlex,
              rowRef,
              frequencyOrigin:
                trip.frequencies.length > 0 ? trip.firstDepartureTime : null,
            });
          })
          .join('');

        // Add empty cell for new trip column
        const newTripCell = '<td class="text-center p-2"></td>';

        return `
        <tr class="${rowClass}" role="row">
          <th
            class="stop-name ${STRIP_ROW_CLASS} py-0 px-2 pl-0 font-medium border-r border-base-300 bg-base-100"
            style="${this.labelColumnStyle(ctx)}"
            ${rowRefAttrs}
          >
            ${this.renderStopLabelCell(stop, stopIndex, graph as RouteGraph, sequence as RouteSequence, color, ctx, isPendingStop ? pendingRef : undefined)}
          </th>
          ${timeCells}
          ${newTripCell}
        </tr>
      `;
      })
      .join('');

    // Add new stop row at the bottom
    const newStopTimeCells = data.trips
      .map(() => '<td class="text-center p-2"></td>')
      .join('');
    const newStopRow = `
      <tr>
        <th class="stop-name p-2 border-r border-base-300 bg-base-100" style="${this.labelColumnStyle(ctx)}">
          <button
            class="add-stop-btn btn btn-ghost btn-sm w-full justify-start opacity-70 hover:opacity-100"
          >Add stop or zone...</button>
        </th>
        ${newStopTimeCells}
        <td class="text-center p-2"></td>
      </tr>
    `;

    // Add property rows (and the frequency band) before stop rows
    const propertyRows = this.renderTripPropertyRows(data, ctx);

    return `<tbody>${propertyRows}${rows}${newStopRow}</tbody>`;
  }

  /**
   * Get display name for direction
   *
   * `direction.name` is already the dominant trip_headsign (or a terminal
   * stop / bare direction id fallback) from directionsForRoute - no further
   * formatting needed here.
   *
   * @param direction - Direction info with ID and label
   * @returns Human-readable direction name for display
   */
  private getDirectionDisplayName(direction: DirectionInfo): string {
    if (direction.tripCount === 0) {
      return `${direction.name}: No trips`;
    }
    return direction.name;
  }

  /**
   * Render error HTML
   *
   * Creates consistent error display for failed operations.
   * Centers error message with appropriate styling.
   *
   * @param message - Error message to display to user
   * @returns HTML string for error state
   */
  public renderErrorHTML(message: string): string {
    return `
      <div class="flex-1 flex items-center justify-center">
        <div class="text-center text-error">
          <p class="font-medium">Error</p>
          <p class="text-sm mt-2">${message}</p>
        </div>
      </div>
    `;
  }
}
