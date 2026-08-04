/**
 * Schedule Controller Module
 * Handles timetable view for routes showing aligned trips in a standard train schedule format
 * Accessed via Objects tab -> Route -> Service ID
 */

import { Stops } from '../types/gtfs-entities.js';
import { notify } from './notification-system';
import type { GTFSParser } from './gtfs-parser.js';
import { TimeFormatter } from '../utils/time-formatter.js';
import {
  TimetableDataProcessor,
  TimetableData,
} from './timetable-data-processor.js';
import { TimetableRenderer } from './timetable-renderer.js';
import { TimetableDatabase } from './timetable-database.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { patchUpdate } from '../utils/patch-utils.js';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display.js';
import { escapeHtml } from '../utils/escape-html.js';
import { showModal } from './modal-utils.js';

// Enhanced GTFS interfaces using standard GTFS property names

interface EnhancedTrip {
  // Shorthand properties
  id: string;
  headsign?: string;
  shortName?: string;
  // Original GTFS properties
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign?: string;
  trip_short_name?: string;
  direction_id?: string;
  block_id?: string;
  shape_id?: string;
  wheelchair_accessible?: string;
}

interface PatchManagerInterface {
  recordInsert(
    table: string,
    id: string,
    record: Record<string, unknown>
  ): Promise<void>;
  recordUpdate(
    table: string,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): Promise<void>;
  recordBatch(
    ops: Array<{
      table: string;
      id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>,
    label: string
  ): Promise<void>;
  recordBatchDelete(
    ops: Array<{ table: string; id: string; record: Record<string, unknown> }>,
    label: string
  ): Promise<void>;
  on(
    event: 'undo' | 'redo' | 'change' | 'jump',
    listener: (record?: unknown) => void
  ): void;
}

interface GTFSRelationships {
  getCalendarForService(service_id: string): Record<string, unknown> | null;
  getTripsForRoute(route_id: string): EnhancedTrip[];
  getTripsForRouteAsync(route_id: string): Promise<EnhancedTrip[]>;
  getStopTimesForTrip(trip_id: string): Record<string, unknown>[];
  getStopById(stop_id: string): Record<string, unknown> | null;
  getStopByIdAsync(stop_id: string): Promise<Record<string, unknown> | null>;
}

/**
 * Schedule Controller - Main orchestrator for timetable functionality
 *
 * Coordinates between specialized modules to provide schedule editing capabilities.
 * This class is responsible for:
 * - Time editing operations (linked/unlinked times)
 * - Schedule rendering coordination
 * - Database operations through TimetableDatabase
 * - Input state management and validation
 *
 * Follows the Enhanced GTFS Object pattern and FAIL HARD error handling policy.
 */
export class ScheduleController {
  private gtfsParser: GTFSParser;
  private patchManager: PatchManagerInterface | null = null;
  private dataProcessor: TimetableDataProcessor;
  private renderer: TimetableRenderer;
  private database: TimetableDatabase;

  // Current timetable state for refresh functionality
  private currentRouteId?: string;
  private currentServiceId?: string;
  private currentDirectionId?: string;

  // Tracks the last scroll position on the timetable's scroll container.
  // overflow-x-auto scrolls BOTH axes (CSS forces overflow-y to auto when
  // overflow-x is non-visible).  We cannot read from the DOM at edit time
  // because the browser resets both values during async DB awaits.
  public timetableScrollLeft = 0;
  public timetableScrollTop = 0;

  private deleteTripAbortController: AbortController | null = null;

  /**
   * Initialize ScheduleController with required dependencies
   *
   * @param gtfsRelationships - GTFS relationships manager for data queries
   * @param gtfsParser - GTFS parser with database access
   */
  constructor(gtfsRelationships: GTFSRelationships, gtfsParser: GTFSParser) {
    this.gtfsParser = gtfsParser;
    this.dataProcessor = new TimetableDataProcessor(
      gtfsRelationships,
      gtfsParser
    );
    this.renderer = new TimetableRenderer();
    this.database = new TimetableDatabase(gtfsParser);

    // Capture-phase scroll listener: fires synchronously when the user scrolls
    // the timetable, before any edit handlers run.  This is the only reliable
    // way to read scrollLeft, DOM reads inside async handlers always see 0.
    document.addEventListener(
      'scroll',
      (e) => {
        const target = e.target as HTMLElement;
        if (
          target?.classList.contains('overflow-x-auto') &&
          target.closest('#schedule-view')
        ) {
          this.timetableScrollLeft = target.scrollLeft;
          this.timetableScrollTop = target.scrollTop;
        }
      },
      { capture: true, passive: true }
    );

    this.installTimetablePickers();
  }

  /**
   * Delegated handlers for the stop and shape_id pickers in the timetable.
   *
   * Bound to `document` once, rather than to the timetable container on every
   * render: the container's innerHTML is replaced wholesale by several
   * different call sites, and re-binding after each of them was both easy to
   * forget and easy to leak.
   */
  private installTimetablePickers(): void {
    // The "add stop" select at the bottom of the table fills itself on first
    // interaction, see buildStopOptions for why it is not filled on render.
    document.addEventListener('focusin', (e) => {
      const stopSelect = (e.target as Element)?.closest?.(
        '#new-stop-select[data-stop-options="pending"]'
      ) as HTMLSelectElement | null;
      if (stopSelect) {
        void this.fillStopOptions(stopSelect, '');
        return;
      }

      const shapeSelect = (e.target as Element)?.closest?.(
        'select[data-shape-options="pending"]'
      ) as HTMLSelectElement | null;
      if (shapeSelect) {
        this.fillShapeOptions(shapeSelect);
      }
    });

    document.addEventListener('change', (e) => {
      const select = (e.target as Element)?.closest?.(
        '#new-stop-select'
      ) as HTMLSelectElement | null;
      if (select?.value) {
        void this.addStopFromSelector(select.value);
      }
    });

    document.addEventListener('click', (e) => {
      const btn = (e.target as Element)?.closest?.('.change-stop-btn');
      if (btn instanceof HTMLElement) {
        void this.openStopPicker(btn);
        return;
      }

      const span = (e.target as Element)?.closest?.('.time-span');
      if (span instanceof HTMLElement) {
        this.openTimeEditor(span);
      }
    });
  }

  /**
   * Swap a time cell's display span for a live input, on click.
   *
   * Mirrors openStopPicker: the input is built only for the cell the user
   * clicked. Committing restores the span synchronously (so at most one
   * input is ever live) and fires the database update in the background -
   * on success it arrives via the timetable's own refreshCurrentTimetable();
   * on validation failure the restored span still shows the pre-edit value,
   * which is correct since nothing was written.
   */
  private openTimeEditor(span: HTMLElement): void {
    if (document.querySelector('.time-input-live')) {
      return;
    }

    const { tripId, stopId, timeType, position, stopSequence } = span.dataset;
    if (
      !tripId ||
      !stopId ||
      (timeType !== 'arrival' && timeType !== 'departure')
    ) {
      return;
    }

    const originalText = span.textContent ?? '';
    const currentValue = originalText === '--:--:--' ? '' : originalText;

    const input = document.createElement('input');
    input.type = 'text';
    input.className =
      'time-input-live input input-xs w-20 text-center font-mono';
    input.value = currentValue;
    input.placeholder = '--:--:--';
    input.pattern =
      '^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$|^(2[4-9]|[3-9][0-9]):[0-5][0-9]:[0-5][0-9]$';
    input.title = 'Enter time in HH:MM:SS format';

    span.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const commit = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      const value = input.value;
      input.replaceWith(span);
      if (value !== currentValue) {
        void this.updateArrivalDepartureTime(
          tripId,
          stopId,
          timeType,
          value,
          position,
          stopSequence
        );
      }
    };
    const cancel = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.replaceWith(span);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
  }

  /**
   * Swap a row's stop label for a picker, on demand.
   *
   * The picker is built only for the row the user actually clicked. Rendering
   * one per row is what made this view unusable: a 70-stop bus route on a feed
   * with 10,000 stops emitted 721,000 `<option>` elements.
   */
  private async openStopPicker(btn: HTMLElement): Promise<void> {
    const oldStopId = btn.dataset.stopId;
    const cell = btn.parentElement;
    if (!oldStopId || !cell || cell.querySelector('select')) {
      return;
    }

    const label = cell.firstElementChild as HTMLElement | null;
    const select = document.createElement('select');
    select.className = 'select select-xs w-full font-medium';
    select.innerHTML = '<option value="">Loading...</option>';
    label?.classList.add('hidden');
    btn.classList.add('hidden');
    cell.prepend(select);

    await this.fillStopOptions(select, oldStopId);
    select.focus();

    const restore = (): void => {
      select.remove();
      label?.classList.remove('hidden');
      btn.classList.remove('hidden');
    };

    select.addEventListener('change', () => {
      const newStopId = select.value;
      restore();
      if (newStopId && newStopId !== oldStopId) {
        void this.changeStopAtRow(oldStopId, newStopId);
      }
    });
    select.addEventListener('blur', restore);
  }

  /**
   * Cached `<option>` markup for every stop in the feed.
   *
   * Built at most once per feed and reused by both pickers. Cleared by
   * invalidateCaches when the stops table changes.
   */
  private stopOptionsHtml: string | null = null;

  /** Cached `<option>` markup for every shape_id in the feed. */
  private shapeOptionsHtml: string | null = null;

  /**
   * Cached `TimetableData` keyed by `route_id|service_id|direction_id`.
   *
   * `generateTimetableData` redoes SCS alignment across every trip on the
   * route; most navigation within the same route/service/direction (tab
   * switches, cell edits that call refreshCurrentTimetable) doesn't need
   * that recomputed. Cleared by invalidateCaches on any patch event.
   */
  private timetableDataCache = new Map<string, TimetableData>();

  private timetableDataCacheKey(
    route_id: string,
    service_id: string,
    direction_id: string
  ): string {
    return `${route_id}|${service_id}|${direction_id}`;
  }

  /** Drop the cached picker options and timetable data; call after any edit that could change them. */
  public invalidateCaches(): void {
    this.stopOptionsHtml = null;
    this.shapeOptionsHtml = null;
    this.timetableDataCache.clear();
    this.dataProcessor.invalidateRouteSource();
  }

  private async fillStopOptions(
    select: HTMLSelectElement,
    selectedStopId: string
  ): Promise<void> {
    if (this.stopOptionsHtml === null) {
      const stops = await this.gtfsParser.gtfsDatabase.queryRows('stops', {});
      console.log(
        `[ScheduleController] building stop picker options for ${stops.length} stops`
      );
      this.stopOptionsHtml = stops
        .map(
          (stop) =>
            `<option value="${escapeHtml(stop.stop_id)}">${escapeHtml(
              renderOptionLabel(
                getStopDisplay(stop as unknown as Record<string, string>)
              )
            )}</option>`
        )
        .join('');
    }

    const placeholder = selectedStopId
      ? '<option value="">Change stop...</option>'
      : '<option value="">Add stop...</option>';
    select.innerHTML = placeholder + this.stopOptionsHtml;
    select.value = selectedStopId;
    select.dataset.stopOptions = 'ready';
  }

  /**
   * Fill a trip-property `shape_id` select with the full shape_id list.
   *
   * The trip's current value is already rendered by TimetableRenderer, so
   * `value` survives this swap even if it is a dangling reference not
   * present in `getShapeIds()`.
   */
  private fillShapeOptions(select: HTMLSelectElement): void {
    const shapeIds = this.gtfsParser.getShapeIds();
    if (this.shapeOptionsHtml === null) {
      console.log(
        `[ScheduleController] building shape picker options for ${shapeIds.length} shapes`
      );
      this.shapeOptionsHtml = shapeIds
        .map(
          (sid) =>
            `<option value="${escapeHtml(sid)}">${escapeHtml(sid)}</option>`
        )
        .join('');
    }

    const currentValue = select.value;
    // A dangling shape_id (not in getShapeIds()) is not in the cached list;
    // keep it as an extra option so filling the picker cannot silently blank
    // the trip's real value.
    const danglingOptionHtml =
      currentValue && !shapeIds.includes(currentValue)
        ? `<option value="${escapeHtml(currentValue)}">${escapeHtml(currentValue)}</option>`
        : '';
    select.innerHTML =
      '<option value="">- none -</option>' +
      this.shapeOptionsHtml +
      danglingOptionHtml;
    select.value = currentValue;
    select.dataset.shapeOptions = 'ready';
  }

  /** Reset tracked scroll when navigating to a different timetable. */
  resetTimetableScroll(): void {
    this.timetableScrollLeft = 0;
    this.timetableScrollTop = 0;
  }

  setPatchManager(pm: PatchManagerInterface): void {
    this.patchManager = pm;

    // The picker option markup and TimetableData are cached across renders,
    // so any edit has to drop them. Rebuilding is cheap and only happens on
    // the next render/picker-open.
    for (const event of ['change', 'undo', 'redo', 'jump'] as const) {
      pm.on(event, () => this.invalidateCaches());
    }
  }

  // ===== PUBLIC EDITING METHODS =====

  /**
   * Update arrival or departure time for a specific stop in a trip
   *
   * Updates either arrival_time or departure_time independently.
   * Validates arrival <= departure constraint before saving.
   * Handles empty input by clearing the specified time field.
   * Renumbers stop sequences based on arrival times after update.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param timeType - Which time field to update ('arrival' or 'departure')
   * @param newTime - New time value or empty string to clear
   * @throws {Error} When validation fails or database update fails
   */
  public async updateArrivalDepartureTime(
    trip_id: string,
    stop_id: string,
    timeType: 'arrival' | 'departure',
    newTime: string,
    supersequencePosition?: string,
    stopSequence?: string
  ): Promise<void> {
    try {
      const field = timeType === 'arrival' ? 'arrival_time' : 'departure_time';
      const isClear = !newTime.trim();

      // Capture before-state using stop_sequence for unambiguous lookup on loop routes
      const beforeRow = await this.database.getStopTime(
        trip_id,
        stop_id,
        stopSequence
      );
      const beforeFieldValue = (beforeRow as Record<string, unknown> | null)?.[
        field
      ];
      const beforeKey = beforeRow
        ? generateCompositeKeyFromRecord(
            'stop_times',
            beforeRow as unknown as Record<string, unknown>
          )
        : null;

      let castedTime: string | null = null;
      if (!isClear) {
        castedTime = TimeFormatter.castTimeToHHMMSS(newTime);

        const validation =
          await this.database.validateArrivalDepartureConstraint(
            trip_id,
            stop_id,
            timeType,
            castedTime
          );
        if (!validation.isValid) {
          this.showTimeError(
            trip_id,
            stop_id,
            validation.errorMessage || 'Invalid time'
          );
          return;
        }
      }

      await this.database.updateStopTimeInDatabase(
        trip_id,
        stop_id,
        castedTime,
        timeType
      );
      console.log(
        isClear
          ? `Cleared ${timeType} time for ${trip_id}/${stop_id}`
          : `Updated ${timeType} time for ${trip_id}/${stop_id} from ${newTime} to ${castedTime}`
      );

      if (!isClear) {
        this.clearPendingStopIfMatches(stop_id);
      }

      // Renumber stop_sequence to match the (possibly changed) time order,
      // then locate this same row's new sequence via its pre-renumber key.
      const renumberMap =
        await this.database.renumberStopSequencesByTime(trip_id);
      const afterStopSequence = beforeKey
        ? renumberMap.get(beforeKey)
        : undefined;
      const afterStopTime = await this.database.getStopTime(
        trip_id,
        stop_id,
        afterStopSequence
      );

      this.patchTimeCellDom(
        trip_id,
        stop_id,
        supersequencePosition,
        timeType,
        castedTime ? TimeFormatter.formatTimeWithSeconds(castedTime) : '',
        afterStopSequence
      );

      if (beforeRow && afterStopTime && this.patchManager) {
        const afterKey = generateCompositeKeyFromRecord(
          'stop_times',
          afterStopTime as unknown as Record<string, unknown>
        );
        await this.patchManager.recordUpdate(
          'stop_times',
          afterKey,
          { [field]: beforeFieldValue },
          { [field]: (afterStopTime as Record<string, unknown>)[field] }
        );
      }
    } catch (error) {
      console.error('Failed to update arrival/departure time:', error);
      this.showTimeError(trip_id, stop_id, 'Failed to save time change');
    }
  }

  /**
   * Update a single time cell's spans after a commit, instead of re-rendering
   * the whole table.
   *
   * The edited span's text is set directly; both spans on the row (arrival
   * and departure share one stop_time record) get their `data-stop-sequence`
   * refreshed so the next edit's before/after lookup stays correct even
   * after a renumber.
   */
  private patchTimeCellDom(
    trip_id: string,
    stop_id: string,
    supersequencePosition: string | undefined,
    timeType: 'arrival' | 'departure',
    displayValue: string,
    newStopSequence: string | undefined
  ): void {
    const positionSelector = supersequencePosition
      ? `[data-position="${supersequencePosition}"]`
      : '';

    const editedSpan = document.querySelector(
      `.time-span[data-trip-id="${trip_id}"][data-stop-id="${stop_id}"][data-time-type="${timeType}"]${positionSelector}`
    ) as HTMLElement | null;
    if (editedSpan) {
      editedSpan.textContent = displayValue || '--:--:--';
    }

    if (newStopSequence === undefined) {
      return;
    }
    const rowSpans = document.querySelectorAll(
      `.time-span[data-trip-id="${trip_id}"][data-stop-id="${stop_id}"]${positionSelector}`
    );
    rowSpans.forEach((el) => {
      (el as HTMLElement).dataset.stopSequence = newStopSequence;
    });
  }

  /**
   * Update trip property (headsign, direction_id, wheelchair_accessible, etc.)
   *
   * Updates a single property on a trip record.
   * Handles type conversion for enum and number fields.
   * Shows an error notification on failure; success is handled by the patch-manager change event.
   *
   * @param trip_id - GTFS trip identifier
   * @param field - Property name (e.g., 'trip_headsign', 'direction_id')
   * @param newValue - New value for the property
   */
  public async updateTripProperty(
    trip_id: string,
    field: string,
    newValue: string
  ): Promise<void> {
    try {
      // Type conversion based on field
      let processedValue: string | number | null = newValue;

      // Enum fields that should be numbers
      if (
        ['direction_id', 'wheelchair_accessible', 'bikes_allowed'].includes(
          field
        )
      ) {
        processedValue = newValue ? parseInt(newValue, 10) : null;
      } else if (newValue === '') {
        // Empty string becomes null for optional fields
        processedValue = null;
      }

      // Capture before value from in-memory data
      const allTrips = this.gtfsParser.getFileDataSync('trips.txt');
      const currentTrip = allTrips.find((t) => t.trip_id === trip_id) as
        | Record<string, unknown>
        | undefined;
      const storedValue = currentTrip?.[field] ?? null;
      const before = { [field]: storedValue };

      // No-op guard: skip if value is unchanged
      if (processedValue === storedValue) {
        return;
      }

      // Update database
      await patchUpdate(
        this.gtfsParser.gtfsDatabase,
        this.patchManager,
        'trips',
        trip_id,
        before,
        { [field]: processedValue }
      );

      console.log(
        `Updated trip property ${field} for ${trip_id} to:`,
        processedValue
      );
    } catch (error) {
      console.error('Failed to update trip property:', error);
      notify.show(`Failed to update ${field} for trip ${trip_id}`, 'error', {
        duration: 5000,
      });
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Show time validation error to user
   *
   * Displays error notification and logs error details to console.
   * Used for validation failures and database operation errors.
   *
   * @param trip_id - GTFS trip identifier for context
   * @param stop_id - GTFS stop identifier for context
   * @param message - Error message to display to user
   */
  private showTimeError(
    trip_id: string,
    stop_id: string,
    message: string
  ): void {
    console.error(`Time error for ${trip_id}/${stop_id}: ${message}`);
    notify.error(`Invalid time format: ${message}`, {
      duration: 5000,
    });
  }

  /**
   * Render schedule HTML for a specific route and service
   *
   * Main public API method for generating timetable views.
   * Handles direction selection, data processing, and HTML generation.
   * Returns error HTML if data processing fails.
   * Stores current state for refresh functionality.
   *
   * @param route_id - GTFS route identifier
   * @param service_id - GTFS service identifier (calendar or calendar_dates)
   * @param direction_id - Optional GTFS direction identifier for filtering
   * @returns Promise resolving to HTML string for the timetable
   */
  async renderSchedule(
    route_id: string,
    service_id: string,
    direction_id?: string
  ): Promise<string> {
    try {
      console.log(
        `[ScheduleController] renderSchedule route=${route_id} service=${service_id} direction=${direction_id ?? '(default)'}`
      );

      // Store current state for refresh functionality
      this.currentRouteId = route_id;
      this.currentServiceId = service_id;

      // Get all available directions for this route and service, busiest first
      const availableDirections =
        await this.dataProcessor.getAvailableDirectionsAsync(
          route_id,
          service_id
        );

      // Use provided direction_id or the busiest direction as default
      const selectedDirection =
        direction_id ?? availableDirections[0]?.id ?? '0';
      this.currentDirectionId = selectedDirection;

      const cacheKey = this.timetableDataCacheKey(
        route_id,
        service_id,
        selectedDirection
      );
      let cached = this.timetableDataCache.get(cacheKey);
      if (!cached) {
        cached = await this.dataProcessor.generateTimetableData(
          route_id,
          service_id,
          selectedDirection
        );
        this.timetableDataCache.set(cacheKey, cached);
      }
      // Copy before mutating: the cached object is reused by later renders.
      const timetableData: TimetableData = {
        ...cached,
        stops: [...cached.stops],
      };

      // Add direction information to timetable data
      timetableData.availableDirections = availableDirections;
      timetableData.selectedDirectionId = selectedDirection;

      // Add pending stop to the end of the stops array (UI only, not in database)
      if (this.pendingStop) {
        timetableData.stops.push({
          stop_id: this.pendingStop.stop_id,
          stop_name: this.pendingStop.stop_name,
        } as Stops);
      }

      return this.renderer.renderTimetableHTML(
        timetableData,
        this.pendingStop?.stop_id
      );
    } catch (error) {
      console.error('Error rendering schedule:', error);
      return this.renderer.renderErrorHTML('Failed to generate schedule view');
    }
  }

  /**
   * Refresh the current timetable view
   *
   * Re-renders the timetable using the stored route/service/direction state.
   * Used after edits to reflect updated stop sequences and times.
   * No-op if no timetable is currently displayed.
   */
  async refreshCurrentTimetable(): Promise<void> {
    if (!this.currentRouteId || !this.currentServiceId) {
      console.log('No current timetable to refresh');
      return;
    }

    console.log('Refreshing timetable:', {
      route_id: this.currentRouteId,
      service_id: this.currentServiceId,
      direction_id: this.currentDirectionId,
    });

    // Use the value tracked by the scroll listener, the DOM is unreliable here
    // because the browser resets scrollLeft during every async DB await.
    const savedScrollLeft = this.timetableScrollLeft;
    const savedScrollTop = this.timetableScrollTop;

    const html = await this.renderSchedule(
      this.currentRouteId,
      this.currentServiceId,
      this.currentDirectionId
    );

    // Update the timetable container
    const container = document.getElementById('schedule-view');
    if (container) {
      container.innerHTML = html;
      const newScrollDiv =
        container.querySelector<HTMLElement>('.overflow-x-auto');
      if (newScrollDiv) {
        if (savedScrollLeft > 0) {
          newScrollDiv.scrollLeft = savedScrollLeft;
        }
        if (savedScrollTop > 0) {
          newScrollDiv.scrollTop = savedScrollTop;
        }
      }

      if (this.deleteTripAbortController) {
        this.deleteTripAbortController.abort();
      }
      this.deleteTripAbortController = new AbortController();
      container.addEventListener(
        'click',
        async (e) => {
          const btn = (e.target as Element).closest('.delete-trip-btn');
          if (!btn) {
            return;
          }
          const trip_id = btn.getAttribute('data-trip-id');
          if (trip_id) {
            await this.handleDeleteTrip(trip_id);
          }
        },
        { signal: this.deleteTripAbortController.signal }
      );
    }
  }

  // Track pending stop that hasn't been saved to database yet
  private pendingStop?: {
    stop_id: string;
    stop_name: string;
  };

  /**
   * Clear pending stop after first time is entered
   * Called automatically when a time is successfully saved
   */
  private clearPendingStopIfMatches(stop_id: string): void {
    if (this.pendingStop && this.pendingStop.stop_id === stop_id) {
      console.log(`Clearing pending stop ${stop_id} - time has been saved`);
      this.pendingStop = undefined;
    }
  }

  /**
   * Create a new trip from the input field
   *
   * Called when user types a trip ID in the always-visible new trip input.
   * Saves trip to database immediately with no stop_times.
   *
   * @param trip_id - User-entered trip ID
   */
  public async createTripFromInput(trip_id: string): Promise<void> {
    const trimmedId = trip_id.trim();

    // Clear the input first
    const inputElement = document.getElementById(
      'new-trip-input'
    ) as HTMLInputElement;
    if (inputElement) {
      inputElement.value = '';
    }

    if (!trimmedId) {
      // Empty input, just ignore
      return;
    }

    try {
      if (!this.currentRouteId || !this.currentServiceId) {
        notify.error('No timetable loaded');
        return;
      }

      // Validate trip_id
      const validation = await this.validateTripId(trimmedId);
      if (!validation.isValid) {
        notify.error(validation.errorMessage || 'Invalid trip ID');
        return;
      }

      // Save trip to database immediately (no pending state)
      const tripData = {
        trip_id: trimmedId,
        route_id: this.currentRouteId,
        service_id: this.currentServiceId,
        shape_id: '',
        ...(this.currentDirectionId && {
          direction_id: parseInt(this.currentDirectionId),
        }),
      };

      await this.gtfsParser.gtfsDatabase.insertRows('trips', [tripData]);
      await this.patchManager?.recordInsert(
        'trips',
        trimmedId,
        tripData as Record<string, unknown>
      );
      console.log('Trip saved to database:', tripData);

      // Refresh the timetable to show the new trip column
      await this.refreshCurrentTimetable();
    } catch (error) {
      console.error('Failed to create trip:', error);
      notify.error('Failed to create trip');
    }
  }

  /**
   * Validate trip ID uniqueness
   *
   * Checks if a trip_id already exists in the trips table.
   *
   * @param trip_id - Trip ID to validate
   * @returns Promise resolving to validation result
   */
  private async validateTripId(trip_id: string): Promise<{
    isValid: boolean;
    errorMessage?: string;
  }> {
    try {
      const existingTrips = await this.gtfsParser.gtfsDatabase.queryRows(
        'trips',
        {
          trip_id,
        }
      );

      if (existingTrips.length > 0) {
        return {
          isValid: false,
          errorMessage: 'Trip ID already exists, please choose another',
        };
      }

      return { isValid: true };
    } catch (error) {
      console.error('Error validating trip ID:', error);
      return {
        isValid: false,
        errorMessage: 'Failed to validate trip ID',
      };
    }
  }

  /**
   * Add a stop from the selector
   *
   * Called when user selects a stop from the always-visible new stop dropdown.
   * Sets the stop as "pending" - it will only be saved to DB when user enters a time.
   *
   * @param stop_id - Selected stop ID
   */
  public async addStopFromSelector(stop_id: string): Promise<void> {
    if (!stop_id) {
      return;
    }

    try {
      if (!this.currentRouteId || !this.currentServiceId) {
        console.error('No current timetable to add stop to');
        return;
      }

      // Get stop details
      const stops = await this.gtfsParser.gtfsDatabase.queryRows('stops', {
        stop_id,
      });

      if (stops.length === 0) {
        notify.error('Stop not found');
        return;
      }

      const stop = stops[0];

      // Set as pending stop (NOT saved to database yet)
      this.pendingStop = {
        stop_id: stop.stop_id,
        stop_name: stop.stop_name || stop.stop_id,
      };

      console.log(`Set pending stop: ${stop.stop_id} - ${stop.stop_name}`);

      // Reset the selector
      const selectElement = document.getElementById(
        'new-stop-select'
      ) as HTMLSelectElement;
      if (selectElement) {
        selectElement.value = '';
      }

      notify.success(`Stop added. Enter a time for at least one trip to save.`);

      // Refresh the timetable to show the new pending stop row
      await this.refreshCurrentTimetable();
    } catch (error) {
      console.error('Failed to add stop to timetable:', error);
      notify.error('Failed to add stop to timetable');
    }
  }

  /**
   * Change the stop represented by a timetable row
   *
   * Updates the stop_id for every stop_times record in the current direction
   * that references oldStopId, replacing it with newStopId. Recorded as a single
   * batch undo/redo entry.
   *
   * @param oldStopId - The stop being replaced
   * @param newStopId - The new stop to assign
   */
  public async changeStopAtRow(
    oldStopId: string,
    newStopId: string
  ): Promise<void> {
    if (oldStopId === newStopId) {
      return;
    }

    if (!this.currentRouteId || !this.currentServiceId) {
      console.error(
        '[ScheduleController] changeStopAtRow: no timetable loaded'
      );
      return;
    }

    if (!this.patchManager) {
      console.error('[ScheduleController] changeStopAtRow: no patch manager');
      return;
    }

    if (this.currentDirectionId === undefined) {
      console.error(
        '[ScheduleController] changeStopAtRow: no direction selected'
      );
      return;
    }

    try {
      const data = await this.dataProcessor.generateTimetableData(
        this.currentRouteId,
        this.currentServiceId,
        this.currentDirectionId
      );

      const ops: Array<{
        table: string;
        id: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }> = [];

      for (const trip of data.trips) {
        const stopTimes = await this.gtfsParser.gtfsDatabase.queryRows(
          'stop_times',
          { trip_id: trip.trip_id, stop_id: oldStopId }
        );

        for (const record of stopTimes) {
          const id = generateCompositeKeyFromRecord(
            'stop_times',
            record as Record<string, unknown>
          );
          ops.push({
            table: 'stop_times',
            id,
            before: { stop_id: oldStopId },
            after: { stop_id: newStopId },
          });
        }
      }

      if (ops.length === 0) {
        console.warn(
          `[ScheduleController] changeStopAtRow: no stop_times found for stop ${oldStopId}`
        );
        notify.error('No stop times reference that stop in this direction');
        return;
      }

      const [oldStopRows, newStopRows] = await Promise.all([
        this.gtfsParser.gtfsDatabase.queryRows('stops', { stop_id: oldStopId }),
        this.gtfsParser.gtfsDatabase.queryRows('stops', { stop_id: newStopId }),
      ]);
      const oldName = oldStopRows[0]?.stop_name || oldStopId;
      const newName = newStopRows[0]?.stop_name || newStopId;
      const routeLabel =
        data.route.route_short_name ||
        data.route.route_long_name ||
        data.route.route_id;
      const label = `Changed stop "${oldName}" -> "${newName}" (Route ${routeLabel}, Direction ${this.currentDirectionId})`;

      await this.patchManager.recordBatch(ops, label);

      await this.refreshCurrentTimetable();
    } catch (error) {
      console.error('[ScheduleController] changeStopAtRow failed:', error);
      notify.error('Failed to change stop');
    }
  }

  async handleDeleteTrip(trip_id: string): Promise<void> {
    const db = this.gtfsParser.gtfsDatabase;
    const pm = this.patchManager;
    if (!pm) {
      console.warn(
        '[ScheduleController] handleDeleteTrip: missing patchManager'
      );
      return;
    }

    const trips = await db.queryRows('trips', { trip_id });
    const trip = trips[0] as Record<string, unknown> | undefined;
    if (!trip) {
      console.warn(
        '[ScheduleController] handleDeleteTrip: trip not found',
        trip_id
      );
      return;
    }

    const stopTimes = (await db.queryRows('stop_times', { trip_id })) as Record<
      string,
      unknown
    >[];

    const doDelete = async () => {
      const stopTimeKeys = stopTimes.map((st) =>
        generateCompositeKeyFromRecord('stop_times', st)
      );
      if (stopTimeKeys.length > 0) {
        await db.deleteRows('stop_times', stopTimeKeys);
      }
      await db.deleteRow('trips', trip_id);

      const ops = [
        ...stopTimes.map((st) => ({
          table: 'stop_times',
          id: generateCompositeKeyFromRecord('stop_times', st),
          record: st,
        })),
        { table: 'trips', id: trip_id, record: trip },
      ];
      const label =
        stopTimes.length > 0
          ? `Delete trip ${trip_id} + ${stopTimes.length} stop_time${stopTimes.length !== 1 ? 's' : ''}`
          : `Delete trip ${trip_id}`;
      await pm.recordBatchDelete(ops, label);

      console.log(
        `[ScheduleController] Deleted trip ${trip_id}${stopTimes.length > 0 ? ` and ${stopTimes.length} stop_times` : ''}`
      );
      await this.refreshCurrentTimetable();
    };

    if (stopTimes.length === 0) {
      await showModal({
        title: 'Delete trip?',
        body: `<p>Delete trip <strong>${trip_id}</strong>? This cannot be undone without undo.</p>`,
        enterAction: 1,
        escapeAction: 0,
        actions: [
          { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
          { label: 'Delete trip', className: 'btn-error', onClick: doDelete },
        ],
      });
      return;
    }

    await showModal({
      title: 'Trip has stop times',
      body: `<p>Trip <strong>${trip_id}</strong> has <strong>${stopTimes.length} stop_time${stopTimes.length !== 1 ? 's' : ''}</strong>.</p>
             <p class="mt-3">Deleting this trip will also remove all its stop times (reversible via undo).</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
        {
          label: `Delete trip + ${stopTimes.length} stop_time${stopTimes.length !== 1 ? 's' : ''}`,
          className: 'btn-error',
          onClick: doDelete,
        },
      ],
    });
  }

  // Note: Old getSortedStops method removed - now handled directly by enhanced SCS
  // All rendering methods moved to TimetableRenderer and TimetableCellRenderer modules
}
