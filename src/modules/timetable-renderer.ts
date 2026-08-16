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
import { TimetableData, DirectionInfo } from './timetable-data-processor.js';
import { TimetableCellRenderer } from './timetable-cell-renderer.js';
import {
  generateFieldConfigsFromSchema,
  FieldConfig,
  renderFieldLabelContent,
} from '../utils/field-component.js';
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
    return `
      <div id="schedule-view" class="h-full flex flex-col">
        ${this.renderDirectionTabs(data)}
        ${this.renderTimetableContent(data, pendingRef)}
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
  public renderTimetableContent(
    data: TimetableData,
    pendingRef?: StopTimeRef
  ): string {
    // Always render the table structure, even when empty
    return `
      <div class="flex-1 overflow-x-auto">
        <table class="table table-xs table-pin-rows table-pin-cols" role="grid">
          ${this.renderTimetableHeader(data, !!pendingRef)}
          ${this.renderTimetableBody(data, pendingRef)}
        </table>
      </div>
    `;
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
  private renderTripPropertyRows(data: TimetableData): string {
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
          <th class="stop-name max-w-[320px] p-2 font-medium border-r border-base-300 bg-base-100">
            <div class="stop-name-text truncate">${renderFieldLabelContent(config)}</div>
          </th>
          ${cells}
          ${newTripCell}
        </tr>
      `;
      })
      .join('');

    return propertyRows;
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
  public renderTimetableHeader(
    data: TimetableData,
    _hasPendingStop: boolean
  ): string {
    const trips = data.trips;
    const tripHeaders = trips
      .map((trip) => {
        return `
          <td class="trip-header text-center min-w-[80px] p-2 text-xs font-mono">
            ${escapeHtml(trip.trip_id)}
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
          <td class="trip-header text-center min-w-[80px] p-2 text-xs">
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
      <td class="trip-header text-center min-w-[120px] p-2 text-xs">
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
          <th class="stop-header max-w-[320px] p-2 text-left bg-base-100">
            Stop
          </th>
          ${tripHeaders}
          ${newTripHeader}
        </tr>
        <tr class="z-[2]">
          <th class="stop-header max-w-[320px] p-2 text-left bg-base-100"></th>
          ${tripActionCells}
          <td class="trip-header text-center min-w-[120px] p-2 text-xs"></td>
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
    pendingRef?: StopTimeRef
  ): string {
    // The pending row (add-stop preview) is appended to data.stops but has no
    // row in the route sequence/graph, so it has no rail and no stats. Render a
    // plain label for it rather than indexing off the end of stopStats.
    if (index >= sequence.stops.length) {
      return this.renderPlainStopLabel(stop, pendingRef);
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
      <div class="min-w-0" style="padding-left:${width + 8}px">
        ${nameBlock}
      </div>
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
  private renderPlainStopLabel(stop: Stops, pendingRef?: StopTimeRef): string {
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
      <div class="flex items-stretch gap-2 min-w-0">
        ${nameBlock}
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
  public renderTimetableBody(
    data: TimetableData,
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
        const timeCells = data.trips
          .map((trip) => {
            // Use stopIndex as the key for all time lookups
            // stopIndex = position in the supersequence (same as position in data.stops array)
            // This handles duplicate stops correctly (e.g., circular routes)
            const stop_id = stop.stop_id;
            const supersequencePosition = stopIndex;

            const editableStopTime = trip.editableStopTimes?.get(
              supersequencePosition
            );
            const arrival_time =
              trip.arrival_times?.get(supersequencePosition) || undefined;
            const departure_time =
              trip.departure_times?.get(supersequencePosition) || undefined;

            return this.cellRenderer.renderStackedArrivalDepartureCell(
              trip.trip_id,
              stop_id,
              stopIndex,
              arrival_time || null,
              departure_time || null,
              editableStopTime,
              isPendingStop,
              isPendingFlex
            );
          })
          .join('');

        // Add empty cell for new trip column
        const newTripCell = '<td class="text-center p-2"></td>';

        // Hovering a row lights what it references on the map. A stop row
        // carries data-stop-id; a flex row carries data-flex-kind/data-flex-id,
        // the same pair the route diagram emits.
        const rowRef =
          sequence !== undefined && stopIndex < sequence.stops.length
            ? sequence.stops[stopIndex].ref
            : isPendingStop
              ? pendingRef
              : undefined;
        const isStopRow = rowRef === undefined || rowRef.kind === 'stop';
        const rowRefAttrs = isStopRow
          ? `data-stop-id="${escapeHtml(stop.stop_id)}"`
          : `data-flex-kind="${escapeHtml(rowRef!.kind)}" data-flex-id="${escapeHtml(rowRef!.id)}"`;

        return `
        <tr class="${rowClass}" role="row">
          <th
            class="stop-name ${STRIP_ROW_CLASS} max-w-[320px] py-0 px-2 pl-0 font-medium border-r border-base-300 bg-base-100"
            ${rowRefAttrs}
          >
            ${this.renderStopLabelCell(stop, stopIndex, graph as RouteGraph, sequence as RouteSequence, color, isPendingStop ? pendingRef : undefined)}
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
        <th class="stop-name max-w-[320px] p-2 border-r border-base-300 bg-base-100">
          <button
            class="add-stop-btn btn btn-ghost btn-sm w-full justify-start opacity-70 hover:opacity-100"
          >Add stop or zone...</button>
        </th>
        ${newStopTimeCells}
        <td class="text-center p-2"></td>
      </tr>
    `;

    // Add property rows before stop rows
    const propertyRows = this.renderTripPropertyRows(data);

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
