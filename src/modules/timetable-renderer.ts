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
import { renderTrashIcon } from './modal-utils.js';

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
  public availableShapeIds: string[] = [];

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
   * @param pendingStopId - Optional ID of pending stop being added (for styling)
   * @returns HTML string for the complete timetable view
   */
  public renderTimetableHTML(
    data: TimetableData,
    pendingStopId?: string
  ): string {
    return `
      <div id="schedule-view" class="h-full flex flex-col">
        ${this.renderDirectionTabs(data)}
        ${this.renderTimetableContent(data, pendingStopId)}
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
   * @param pendingStopId - Optional ID of pending stop being added (for styling)
   * @returns HTML string for the main timetable content area
   */
  public renderTimetableContent(
    data: TimetableData,
    pendingStopId?: string
  ): string {
    // Always render the table structure, even when empty
    return `
      <div class="flex-1 overflow-x-auto">
        <table class="table table-xs table-pin-rows table-pin-cols">
          ${this.renderTimetableHeader(data, !!pendingStopId)}
          ${this.renderTimetableBody(data, pendingStopId)}
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
          <th class="stop-name min-w-[200px] p-2 font-medium border-r border-base-300 bg-base-100">
            <div class="stop-name-text">${renderFieldLabelContent(config)}</div>
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
   * Render individual property cell with appropriate input type
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
    const value = trip[config.field] ?? '';
    const inputId = `trip-prop-${trip_id}-${config.field}`;

    if (config.field === 'shape_id') {
      const optionsHtml = [
        `<option value=""${value === '' ? ' selected' : ''}>— none —</option>`,
        ...this.availableShapeIds.map((sid) => {
          const selected = String(value) === sid ? ' selected' : '';
          return `<option value="${escapeHtml(sid)}"${selected}>${escapeHtml(sid)}</option>`;
        }),
      ].join('');
      return `
        <td class="text-center p-2">
          <select
            id="${inputId}"
            class="select select-xs w-full"
            data-trip-id="${trip_id}"
            data-field="${config.field}"
            data-table="trips.txt"
            onchange="gtfsEditor.scheduleController.updateTripProperty('${trip_id}', '${config.field}', this.value)">
            ${optionsHtml}
          </select>
        </td>
      `;
    } else if (config.type === 'select' && config.options) {
      const optionsHtml = [
        '<option value="">-</option>',
        ...config.options.map((opt) => {
          const selected =
            String(value) === String(opt.value) ? 'selected' : '';
          return `<option value="${escapeHtml(String(opt.value))}" ${selected}>${escapeHtml(opt.label)}</option>`;
        }),
      ].join('');

      return `
        <td class="text-center p-2">
          <select
            id="${inputId}"
            class="select select-xs w-full"
            data-trip-id="${trip_id}"
            data-field="${config.field}"
            data-table="trips.txt"
            onchange="gtfsEditor.scheduleController.updateTripProperty('${trip_id}', '${config.field}', this.value)">
            ${optionsHtml}
          </select>
        </td>
      `;
    } else if (config.type === 'number') {
      return `
        <td class="text-center p-2">
          <input
            id="${inputId}"
            type="number"
            class="input input-xs w-full text-center"
            data-trip-id="${trip_id}"
            data-field="${config.field}"
            data-table="trips.txt"
            value="${escapeHtml(String(value))}"
            onchange="gtfsEditor.scheduleController.updateTripProperty('${trip_id}', '${config.field}', this.value)" />
        </td>
      `;
    } else {
      // text input
      return `
        <td class="text-center p-2">
          <input
            id="${inputId}"
            type="text"
            class="input input-xs w-full text-center"
            data-trip-id="${trip_id}"
            data-field="${config.field}"
            data-table="trips.txt"
            value="${escapeHtml(String(value))}"
            placeholder="${escapeHtml(config.label)}"
            onchange="gtfsEditor.scheduleController.updateTripProperty('${trip_id}', '${config.field}', this.value)" />
        </td>
      `;
    }
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
        const tripStops = data.stops.filter((_, i) => trip.stopTimes.has(i));
        const brouterUrl = buildBrouterUrl(
          tripStops,
          data.route.route_type ?? ''
        );
        const brouterLink = brouterUrl
          ? `<a href="${brouterUrl}" target="_blank" rel="noopener" class="btn btn-xs btn-outline mt-1" title="Open in brouter">-&gt;</a>`
          : '';
        return `
          <td class="trip-header text-center min-w-[80px] p-2 text-xs font-mono">
            ${escapeHtml(trip.trip_id)}
            <button class="btn btn-xs btn-error btn-outline delete-trip-btn mt-1" data-trip-id="${escapeHtml(trip.trip_id)}" title="Delete">${renderTrashIcon('h-3 w-3')}</button>
            ${brouterLink}
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
          <th class="stop-header min-w-[200px] p-2 text-left bg-base-100">
            Stop
          </th>
          ${tripHeaders}
          ${newTripHeader}
        </tr>
      </thead>
    `;
  }

  /**
   * Render one stop row's label cell.
   *
   * This used to be a `<select>` listing every stop in the feed, repeated in
   * every row — 226,556 `<option>` nodes for the MBTA Red Line and 721,000 for
   * a 70-stop bus route, which was the single largest cost in the view. The
   * label is now static text; the picker is built once, on demand, when the
   * swap button is clicked (see ScheduleController.openStopPicker).
   *
   * @param stop - The stop this row represents
   * @returns HTML string for the row's stop label cell
   */
  private renderStopLabelCell(stop: Stops): string {
    const label = renderCardLabel(
      getStopDisplay(stop as unknown as Record<string, string>)
    );
    return `
      <div class="flex items-center gap-1 min-w-0">
        <span class="flex-1 min-w-0 truncate">${label}</span>
        <button
          class="btn btn-ghost btn-xs px-1 opacity-40 hover:opacity-100 change-stop-btn"
          data-stop-id="${escapeHtml(stop.stop_id)}"
          title="Change stop"
        >&lt;-&gt;</button>
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
   * @param pendingStopId - Optional ID of pending stop being added (for styling)
   * @returns HTML string for the table body
   */
  public renderTimetableBody(
    data: TimetableData,
    pendingStopId?: string
  ): string {
    if (!data.stops || !data.trips) {
      return '<tbody></tbody>';
    }

    console.log(
      `[TimetableRenderer] rendering ${data.stops.length} stops x ${data.trips.length} trips`
    );

    const rows = data.stops
      .map((stop, stopIndex) => {
        const isPendingStop =
          pendingStopId !== undefined &&
          stop.stop_id === pendingStopId &&
          stopIndex === data.stops.length - 1;
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
              arrival_time || null,
              departure_time || null,
              editableStopTime,
              supersequencePosition
            );
          })
          .join('');

        // Add empty cell for new trip column
        const newTripCell = '<td class="text-center p-2"></td>';

        return `
        <tr class="${rowClass}">
          <th class="stop-name p-2 font-medium border-r border-base-300 bg-base-100">
            ${this.renderStopLabelCell(stop)}
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
        <th class="stop-name p-2 border-r border-base-300 bg-base-100">
          <!-- Options are filled in on first interaction, not on render: the
               feed can hold tens of thousands of stops. -->
          <select class="select select-sm w-full" id="new-stop-select" data-stop-options="pending">
            <option value="">Add stop...</option>
          </select>
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
   * Determines the best display name for a direction tab.
   * Uses headsign if available, falls back to formatted direction ID.
   *
   * @param direction - Direction info with ID and optional headsign
   * @returns Human-readable direction name for display
   */
  private getDirectionDisplayName(direction: DirectionInfo): string {
    if (direction.tripCount === 0) {
      return `Direction ${direction.id}: No trips`;
    }
    if (direction.lastStopName) {
      return `Direction ${direction.id}: To ${direction.lastStopName}`;
    }
    return `Direction ${direction.id}`;
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
