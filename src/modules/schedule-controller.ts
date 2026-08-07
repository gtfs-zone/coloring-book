/**
 * Schedule Controller Module
 * Handles timetable view for routes showing aligned trips in a standard train schedule format
 * Accessed via Objects tab -> Route -> Service ID
 */

import { Stops, StopTimes } from '../types/gtfs-entities.js';
import { notify } from './notification-system';
import type { GTFSParser } from './gtfs-parser.js';
import { TimeFormatter } from '../utils/time-formatter.js';
import {
  TimetableDataProcessor,
  TimetableData,
} from './timetable-data-processor.js';
import { TimetableRenderer } from './timetable-renderer.js';
import { TimetableDatabase, StopTimeEditPlan } from './timetable-database.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { patchUpdate } from '../utils/patch-utils.js';
import { getStopDisplay } from '../utils/entity-display.js';
import { openInlineEditor, openInlineMenu } from '../utils/inline-edit.js';
import { showModal } from './modal-utils.js';
import {
  showOptionPickerModal,
  OptionPickerItem,
} from './option-picker-modal.js';
import { getEnumOptions } from '../types/gtfs-enums.js';

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
  recordBatchMixed(
    ops: Array<
      | {
          op: 'insert';
          table: string;
          id: string;
          record: Record<string, unknown>;
        }
      | {
          op: 'delete';
          table: string;
          id: string;
          record: Record<string, unknown>;
        }
      | {
          op: 'update';
          table: string;
          id: string;
          before: Record<string, unknown>;
          after: Record<string, unknown>;
        }
    >,
    label?: string
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
 * Field-level diff of two versions of the same row, or null when they match.
 * Both sides are returned so the caller can hand them straight to a patch.
 */
function changedFields(
  before: StopTimes,
  after: StopTimes
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const prev = before as unknown as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  const beforeChanges: Record<string, unknown> = {};
  const afterChanges: Record<string, unknown> = {};

  for (const field of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (prev[field] !== next[field]) {
      beforeChanges[field] = prev[field] ?? null;
      afterChanges[field] = next[field] ?? null;
    }
  }

  return Object.keys(afterChanges).length === 0
    ? null
    : { before: beforeChanges, after: afterChanges };
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
    document.addEventListener('click', (e) => {
      const stopLabel = (e.target as Element)?.closest?.('.stop-label-span');
      if (stopLabel instanceof HTMLElement) {
        void this.openStopPicker(stopLabel);
        return;
      }

      const addStopBtn = (e.target as Element)?.closest?.('.add-stop-btn');
      if (addStopBtn instanceof HTMLElement) {
        void this.openAddStopPicker();
        return;
      }

      const span = (e.target as Element)?.closest?.('.time-span');
      if (span instanceof HTMLElement) {
        this.openTimeEditor(span);
        return;
      }

      const propSpan = (e.target as Element)?.closest?.('.trip-prop-span');
      if (propSpan instanceof HTMLElement) {
        this.handleTripPropClick(propSpan);
        return;
      }

      const deleteBtn = (e.target as Element)?.closest?.('.delete-trip-btn');
      const tripId = deleteBtn?.getAttribute('data-trip-id');
      if (tripId) {
        void this.handleDeleteTrip(tripId);
      }
    });
  }

  /**
   * Swap a time cell's display span for a live input, on click.
   *
   * Mirrors openStopPicker: the input is built only for the cell the user
   * clicked. Committing restores the span synchronously (so at most one
   * input is ever live) and fires the database update in the background -
   * on success the table is redrawn by the patch:change listener; on
   * validation failure the restored span still shows the pre-edit value,
   * which is correct since nothing was written.
   */
  private openTimeEditor(span: HTMLElement): void {
    const { tripId, stopId, timeType, stopSequence, pending } = span.dataset;
    if (
      !tripId ||
      !stopId ||
      (timeType !== 'arrival' && timeType !== 'departure')
    ) {
      return;
    }

    const originalText = span.textContent ?? '';

    openInlineEditor(span, {
      value: originalText === '--:--:--' ? '' : originalText,
      className: 'time-input-live w-20 text-center font-mono',
      placeholder: '--:--:--',
      title: 'Enter a time, e.g. 9:30 or 09:30:00',
      onCommit: (value) => {
        void this.updateArrivalDepartureTime(
          tripId,
          stopId,
          timeType,
          value,
          stopSequence,
          pending === 'true'
        );
      },
    });
  }

  /**
   * Open the searchable stop-picker modal for a row's stop label.
   *
   * On pick, hands off to the existing `changeStopAtRow` (patch recording,
   * SCS re-alignment) unchanged - this only changes how the new stop_id
   * reaches it.
   */
  private async openStopPicker(labelSpan: HTMLElement): Promise<void> {
    const oldStopId = labelSpan.dataset.stopId;
    if (!oldStopId) {
      return;
    }

    const options = await this.getStopOptions();
    const picked = await showOptionPickerModal({
      title: 'Change stop',
      options,
      selectedValue: oldStopId,
      searchable: true,
    });

    if (picked !== null && picked !== oldStopId) {
      void this.changeStopAtRow(oldStopId, picked);
    }
  }

  /**
   * Open the searchable stop-picker modal for the "Add stop" row.
   *
   * On pick, hands off to the existing `addStopFromSelector` unchanged.
   */
  private async openAddStopPicker(): Promise<void> {
    const options = await this.getStopOptions();
    const picked = await showOptionPickerModal({
      title: 'Add stop',
      options,
      searchable: true,
    });

    if (picked) {
      void this.addStopFromSelector(picked);
    }
  }

  /**
   * Dispatch a click on a `.trip-prop-span` to the right editor, by
   * `data-field-kind`: a live input for text/number, a lightweight inline
   * menu for enums, or the searchable shape_id modal.
   */
  private handleTripPropClick(span: HTMLElement): void {
    const { fieldKind } = span.dataset;
    if (fieldKind === 'enum') {
      this.openTripPropEnumMenu(span);
    } else if (fieldKind === 'shape') {
      void this.openTripPropShapePicker(span);
    } else {
      this.openTripPropEditor(span);
    }
  }

  /**
   * Swap a trip-property span for a live input, on click.
   *
   * Mirrors openTimeEditor: at most one editor (time or property) is ever
   * live at a time, guarded by the shared `.editor-input-live` marker class.
   */
  private openTripPropEditor(span: HTMLElement): void {
    const { tripId, field, fieldKind, value } = span.dataset;
    if (!tripId || !field) {
      return;
    }

    openInlineEditor(span, {
      value: value ?? '',
      inputType: fieldKind === 'number' ? 'number' : 'text',
      className: 'w-full text-center',
      onCommit: (newValue) => {
        span.textContent = newValue || '-';
        span.dataset.value = newValue;
        void this.updateTripProperty(tripId, field, newValue);
      },
    });
  }

  /**
   * Open a small inline menu of enum options anchored under the clicked
   * span - `direction_id`, `wheelchair_accessible`, `bikes_allowed`. Per the
   * plan's decision, small enums get this lighter picker instead of the
   * searchable modal.
   */
  private openTripPropEnumMenu(span: HTMLElement): void {
    const { tripId, field, value } = span.dataset;
    if (!tripId || !field) {
      return;
    }

    const enumOptions = getEnumOptions(field) ?? [];

    openInlineMenu(span, {
      currentValue: value ?? '',
      options: [
        { value: '', label: '-' },
        ...enumOptions.map((opt) => ({
          value: String(opt.value),
          label: `${opt.value} - ${opt.label}`,
        })),
      ],
      onPick: (newValue, label) => {
        span.textContent = label || '-';
        span.dataset.value = newValue;
        void this.updateTripProperty(tripId, field, newValue);
      },
    });
  }

  /**
   * Open the searchable shape_id modal for a trip property span.
   *
   * A dangling shape_id (not in `getShapeIds()`) is included as its own
   * option so the picker cannot silently blank the trip's real value.
   */
  private async openTripPropShapePicker(span: HTMLElement): Promise<void> {
    const { tripId, value } = span.dataset;
    if (!tripId) {
      return;
    }

    const currentValue = value ?? '';
    const shapeIds = this.gtfsParser.getShapeIds();
    const options = [
      { value: '', primary: '- none -' },
      ...shapeIds.map((sid) => ({ value: sid, primary: sid })),
    ];
    if (currentValue && !shapeIds.includes(currentValue)) {
      options.push({
        value: currentValue,
        primary: `${currentValue} (dangling reference)`,
      });
    }

    const picked = await showOptionPickerModal({
      title: 'Select shape',
      options,
      selectedValue: currentValue,
      searchable: true,
    });

    if (picked !== null && picked !== currentValue) {
      span.textContent = picked || '-';
      span.dataset.value = picked;
      void this.updateTripProperty(tripId, 'shape_id', picked);
    }
  }

  /**
   * Cached structured stop list for the searchable stop-picker modal.
   * Built at most once per feed. Cleared by invalidateCaches when the stops
   * table changes.
   */
  private stopOptions: OptionPickerItem[] | null = null;

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
    this.stopOptions = null;
    this.timetableDataCache.clear();
    this.dataProcessor.invalidateRouteSource();
  }

  /**
   * Full reset for a new/replacement feed.
   *
   * invalidateCaches() alone is not enough here: it runs on every patch event,
   * but importing a feed clears IndexedDB without going through the patch
   * system, so it never fires. Without this, re-rendering the same
   * route/service/direction id (common when re-uploading a corrected feed)
   * could reuse this.timetableDataCache or the GTFSRouteSource's own caches
   * from the previous feed, and currentRouteId/currentServiceId/pendingStop
   * would still point at state that may no longer exist.
   */
  public resetForNewFeed(): void {
    this.invalidateCaches();
    this.currentRouteId = undefined;
    this.currentServiceId = undefined;
    this.currentDirectionId = undefined;
    this.pendingStop = undefined;
    this.resetTimetableScroll();
  }

  private async getStopOptions(): Promise<OptionPickerItem[]> {
    if (this.stopOptions === null) {
      const stops = await this.gtfsParser.gtfsDatabase.queryRows('stops', {});
      console.log(
        `[ScheduleController] building stop picker options for ${stops.length} stops`
      );
      this.stopOptions = stops.map((stop) => ({
        value: stop.stop_id,
        primary: getStopDisplay(stop as unknown as Record<string, string>)
          .primary,
        secondary: stop.stop_id,
      }));
    }
    return this.stopOptions;
  }

  /** Reset tracked scroll when navigating to a different timetable. */
  resetTimetableScroll(): void {
    this.timetableScrollLeft = 0;
    this.timetableScrollTop = 0;
  }

  setPatchManager(pm: PatchManagerInterface): void {
    this.patchManager = pm;

    // The picker options and TimetableData are cached across renders, so any
    // edit has to drop them. Rebuilding is cheap and only happens on the next
    // render/picker-open.
    //
    // Registration order matters: this runs from the constructor, before
    // index.ts subscribes browseNavigation.refresh() to the same events, so
    // the caches are always clear by the time that refresh re-renders.
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
   * Renumbers stop sequences by time, as part of the same patch.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param timeType - Which time field to update ('arrival' or 'departure')
   * @param newTime - New time value or empty string to clear
   * @param stopSequence - stop_sequence of the edited row, when the cell knows it
   * @param isPendingRow - The cell belongs to the not-yet-saved add-stop row
   * @throws {Error} When validation fails or database update fails
   */
  public async updateArrivalDepartureTime(
    trip_id: string,
    stop_id: string,
    timeType: 'arrival' | 'departure',
    newTime: string,
    stopSequence?: string,
    isPendingRow = false
  ): Promise<void> {
    try {
      const isClear = !newTime.trim();
      const castedTime = isClear
        ? null
        : TimeFormatter.castTimeToHHMMSS(newTime);

      // The pending row has no stop_time yet, so there is nothing to validate
      // against and nothing to find: it always inserts.
      if (castedTime !== null && !isPendingRow) {
        const validation =
          await this.database.validateArrivalDepartureConstraint(
            trip_id,
            stop_id,
            timeType,
            castedTime,
            stopSequence
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

      const plan = await this.database.planStopTimeEdit(
        trip_id,
        stop_id,
        timeType,
        castedTime,
        stopSequence,
        isPendingRow
      );

      // Clearing a cell that has no stop_time behind it would otherwise create
      // a row with no times at all.
      if (plan.isInsert && castedTime === null) {
        return;
      }

      const label = plan.isInsert
        ? `Add stop ${stop_id} to trip ${trip_id}`
        : isClear
          ? `Clear ${timeType} time for ${trip_id}/${stop_id}`
          : `Set ${timeType} time for ${trip_id}/${stop_id} to ${castedTime}`;

      // Clear the pending row before the patch is recorded: the patch event
      // drives the re-render, which must already show the stop as real.
      if (plan.isInsert) {
        this.clearPendingStopIfMatches(stop_id);
      }

      const wrote = await this.commitStopTimePlan(plan, label);
      if (!wrote) {
        console.log(`No stop_time change for ${trip_id}/${stop_id}`);
        return;
      }
      console.log(`[ScheduleController] ${label}`);
      if (plan.isInsert) {
        notify.success('Added stop to trip', { duration: 2000 });
      }
    } catch (error) {
      console.error('Failed to update arrival/departure time:', error);
      this.showTimeError(trip_id, stop_id, 'Failed to save time change');
    }
  }

  /**
   * Write a planned stop_time edit and record it as a single patch.
   *
   * A renumber changes a row's identity (the stop_times key is
   * trip_id + stop_sequence), so any plan that moves sequences is written as a
   * whole-trip replace and recorded as deletes followed by inserts. Only when
   * every key survives does this collapse to a plain field update.
   *
   * @returns Whether anything was written
   */
  private async commitStopTimePlan(
    plan: StopTimeEditPlan,
    label: string
  ): Promise<boolean> {
    const keyOf = (row: StopTimes): string =>
      generateCompositeKeyFromRecord(
        'stop_times',
        row as unknown as Record<string, unknown>
      );

    const before = new Map(plan.beforeRows.map((row) => [keyOf(row), row]));
    const after = new Map(plan.afterRows.map((row) => [keyOf(row), row]));

    const deletes = plan.beforeRows.filter((row) => !after.has(keyOf(row)));
    const inserts = plan.afterRows.filter((row) => !before.has(keyOf(row)));
    const updates = plan.afterRows
      .map((row) => ({ key: keyOf(row), row }))
      .filter(({ key, row }) => {
        const prev = before.get(key);
        return prev !== undefined && changedFields(prev, row) !== null;
      });

    if (deletes.length === 0 && inserts.length === 0 && updates.length === 0) {
      return false;
    }

    const db = this.gtfsParser.gtfsDatabase;
    const pm = this.patchManager;

    // Fast path: nothing was renumbered, so this is one row's field changing.
    if (deletes.length === 0 && inserts.length === 0 && updates.length === 1) {
      const { key, row } = updates[0];
      const changes = changedFields(before.get(key)!, row)!;
      await patchUpdate(
        db,
        pm,
        'stop_times',
        key,
        changes.before,
        changes.after
      );
      this.invalidateCaches();
      return true;
    }

    await db.replaceRows('stop_times', [...before.keys()], plan.afterRows);
    this.invalidateCaches();

    // Deletes first: forward replay (and its reversed inverse) must never hold
    // two rows on one trip_id + stop_sequence key.
    await pm?.recordBatchMixed(
      [
        ...deletes.map((row) => ({
          op: 'delete' as const,
          table: 'stop_times',
          id: keyOf(row),
          record: row as unknown as Record<string, unknown>,
        })),
        ...inserts.map((row) => ({
          op: 'insert' as const,
          table: 'stop_times',
          id: keyOf(row),
          record: row as unknown as Record<string, unknown>,
        })),
        ...updates.map(({ key, row }) => {
          const changes = changedFields(before.get(key)!, row)!;
          return {
            op: 'update' as const,
            table: 'stop_times',
            id: key,
            before: changes.before,
            after: changes.after,
          };
        }),
      ],
      label
    );
    return true;
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
   * Re-render the timetable in place, for UI-only state that no patch covers.
   *
   * Every *recorded* edit is redrawn by the patch:change listener in index.ts
   * (browseNavigation.refresh -> renderSchedule), so calling this after one
   * would run two renders against the same container at once. The only caller
   * is the pending add-stop row, which exists purely in this controller.
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

    // renderSchedule emits its own #schedule-view wrapper, so the old element
    // is replaced rather than filled - assigning innerHTML would nest a second
    // element with the same id inside the first.
    const container = document.getElementById('schedule-view');
    if (!container) {
      return;
    }
    container.outerHTML = html;

    const newScrollDiv = document
      .getElementById('schedule-view')
      ?.querySelector<HTMLElement>('.overflow-x-auto');
    if (newScrollDiv) {
      if (savedScrollLeft > 0) {
        newScrollDiv.scrollLeft = savedScrollLeft;
      }
      if (savedScrollTop > 0) {
        newScrollDiv.scrollTop = savedScrollTop;
      }
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
      this.invalidateCaches();
      await this.patchManager?.recordInsert(
        'trips',
        trimmedId,
        tripData as Record<string, unknown>
      );
      console.log('Trip saved to database:', tripData);
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
      this.invalidateCaches();

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
