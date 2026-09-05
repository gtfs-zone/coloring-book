/**
 * Schedule Controller Module
 * Handles timetable view for routes showing aligned trips in a standard train schedule format
 * Accessed via Objects tab -> Route -> Service ID
 */

import { Stops, StopTimes } from '../types/gtfs-entities.js';
import type { StopTimeRef } from '../types/gtfs-flex.js';
import { notify } from './notification-system';
import {
  formatIssueValue,
  markReferenceResolved,
  refreshFeedIssuesIfStale,
} from './feed-issues.js';
import type { GTFSParser } from './gtfs-parser.js';
import { TimeFormatter } from '../utils/time-formatter.js';
import {
  coupleStopTimes,
  type CoupledTimes,
} from '../utils/stop-time-coupling.js';
import {
  TimetableDataProcessor,
  TimetableData,
} from './timetable-data-processor.js';
import { TimetableRenderer } from './timetable-renderer.js';
import {
  TimetableDatabase,
  StopTimeEditPlan,
  FlexWindowField,
  FlexRowShape,
} from './timetable-database.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { patchUpdate } from '../utils/patch-utils.js';
import {
  openInlineEditor,
  openInlineMenu,
  getLiveEditorState,
} from '../utils/inline-edit.js';
import {
  arrowToGridDirection,
  type GridDirection,
} from '../utils/grid-navigation.js';
import { showModal } from './modal-utils.js';
import {
  showOptionPickerModal,
  OptionPickerItem,
} from './option-picker-modal.js';
import { getEnumOptions } from '../types/gtfs-enums.js';
import {
  navigateToLocationGroup,
  navigateToZone,
  openTimetable,
} from './navigation-actions.js';
import {
  TIMETABLE_ADD_DIRECTION,
  TIMETABLE_DIRECTION_TAB,
  TIMETABLE_ROUTE_PICKER,
  TIMETABLE_SERVICE_PICKER,
} from './timetable-selectors.js';
import { getRouteDisplay, getStopDisplay } from '../utils/entity-display.js';
import {
  formatDateRange,
  formatDaysOfWeek,
} from '../utils/entity-references.js';
import { showNewServiceModal } from './new-service-modal.js';
import { getZoneFeatures, zoneName } from './zone-store.js';
import { validateFlexStopTimeRow } from '../utils/flex-rules.js';
import { renderSpecDescriptionPlain } from '../utils/spec-markup.js';
import { escapeHtml } from '../utils/escape-html.js';
import { setPickerTriggerContent } from '../utils/picker-trigger.js';
import { getGTFSFieldDescription } from '../utils/zod-tooltip-helper.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import type { LocationGroups } from '../types/gtfs-entities.js';
import {
  stopTimeFieldKind,
  STOP_TIME_EDITABLE_FIELDS,
  TIME_FIELDS,
  WINDOW_FIELDS,
} from './timetable-fields.js';
import {
  validateFrequencyRow,
  frequencyPeriodKey,
} from '../utils/frequency-rules.js';

/**
 * Identifies one time cell across a re-render.
 *
 * stopIndex is the supersequence position, not stop_id: a circular route visits
 * the same stop twice and stop_id alone would match the wrong row.
 */
interface TimeCellKey {
  tripId: string;
  stopIndex: string;
  /** The stop_times field this sub-row edits. */
  field: string;
}

/**
 * Which pane of the On-Demand modal to open on, and which row to highlight.
 *
 * Structural on purpose: the timetable does not import the modal, it is handed
 * an opener by index.ts.
 */
export interface OnDemandTarget {
  table?: string;
  rowKey?: string;
}

/**
 * Which timetable the modal is showing. `direction_id` is optional: left out,
 * `renderSchedule` picks the busiest direction the route runs.
 */
export interface TimetableTarget {
  route_id: string;
  service_id: string;
  direction_id?: string;
}

/** Is this sub-row one end of a pickup/drop-off window? */
function asWindowField(field: string | undefined): FlexWindowField | null {
  return field !== undefined && WINDOW_FIELDS.includes(field)
    ? (field as FlexWindowField)
    : null;
}

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
  recordDelete(
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
  // Trip count of the timetable last rendered, so click handlers can refuse
  // actions that need a trip without re-querying.
  private currentTripCount = 0;

  // Tracks the last scroll position on the timetable's scroll container.
  // overflow-x-auto scrolls BOTH axes (CSS forces overflow-y to auto when
  // overflow-x is non-visible).  We cannot read from the DOM at edit time
  // because the browser resets both values during async DB awaits.
  public timetableScrollLeft = 0;
  public timetableScrollTop = 0;

  // The time cell the user is editing, so a full re-render can put them back.
  // Every committed edit records a patch, which rebuilds the whole browse panel
  // and destroys the input they have already moved on to.
  private editingCell:
    | (TimeCellKey & {
        value?: string;
        caret?: number | null;
      })
    | null = null;

  // The time cell holding the roving tabindex: focused but not being edited.
  // Tracked the same way as editingCell so a re-render can put the selection
  // back, and so Tab lands on the cell the user was last on.
  private selectedCell: TimeCellKey | null = null;

  // Whether the selected cell actually had focus before the last re-render.
  // Without this, a rebuild triggered by an unrelated edit would yank focus
  // into the timetable from wherever the user really is.
  private selectionHadFocus = false;

  // Where the selection has to land on the next render, when the edit moved the
  // row it was on. Keyed on stop_sequence rather than strip position: an edit
  // that reorders the trip changes which stop sits at a given position, so the
  // position the user typed into would select somebody else's cell.
  // One-shot: consumed by the first applyTimetableSelection after the edit.
  private pendingSelection: {
    tripId: string;
    stopSequence: string;
    field: string;
  } | null = null;

  // Map wiring for the stop column, injected by index.ts
  private stopFocus: ((stop_id: string) => void) | null = null;
  private refHover: ((ref: StopTimeRef | null) => void) | null = null;
  private onDemandOpen: ((target: OnDemandTarget) => void) | null = null;
  private shapesOpen: (() => void) | null = null;
  private shapeUpload:
    | ((tripId: string, currentShapeId: string) => Promise<string | null>)
    | null = null;
  private hoveredRef: StopTimeRef | null = null;

  /**
   * Fields the user has added to the sub-row roster from a cell's `+` button.
   *
   * UI-only and deliberately not persisted: they last for this visit to the
   * timetable, so nothing remembers a preference the feed does not support. A
   * field that gains a real value stays visible on its own merit afterwards.
   */
  private provisionalFields: string[] = [];

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
      const stopDot = (e.target as Element)?.closest?.('.strip-stop-dot');
      if (stopDot instanceof HTMLElement) {
        const stop_id = stopDot.dataset.stopId;
        if (stop_id) {
          this.stopFocus?.(stop_id);
        }
        return;
      }

      const stopLabel = (e.target as Element)?.closest?.('.stop-label-span');
      if (stopLabel instanceof HTMLElement) {
        void this.openStopPicker(stopLabel);
        return;
      }

      // Flex row labels open the zone or location group's browse page. There is
      // no picker: repointing a flex row at another zone is not a stop swap.
      const flexLabel = (e.target as Element)?.closest?.('.flex-label-span');
      if (flexLabel instanceof HTMLElement) {
        const id = flexLabel.dataset.flexId ?? '';
        if (id !== '') {
          if (flexLabel.dataset.flexKind === 'location_group') {
            void navigateToLocationGroup(id);
          } else {
            void navigateToZone(id);
          }
        }
        return;
      }

      const routePicker = (e.target as Element)?.closest?.(
        `.${TIMETABLE_ROUTE_PICKER}`
      );
      if (routePicker instanceof HTMLElement) {
        void this.openRoutePicker();
        return;
      }

      const servicePicker = (e.target as Element)?.closest?.(
        `.${TIMETABLE_SERVICE_PICKER}`
      );
      if (servicePicker instanceof HTMLElement) {
        void this.openServicePicker();
        return;
      }

      const addDirection = (e.target as Element)?.closest?.(
        `.${TIMETABLE_ADD_DIRECTION}`
      );
      if (addDirection instanceof HTMLElement) {
        const direction_id = addDirection.dataset.directionId;
        if (
          direction_id !== undefined &&
          this.currentRouteId &&
          this.currentServiceId
        ) {
          console.log(
            `[ScheduleController] adding direction ${direction_id} to route ${this.currentRouteId}`
          );
          void openTimetable(
            this.currentRouteId,
            this.currentServiceId,
            direction_id
          );
        }
        return;
      }

      const directionTab = (e.target as Element)?.closest?.(
        `.${TIMETABLE_DIRECTION_TAB}`
      );
      if (directionTab instanceof HTMLElement) {
        const direction_id = directionTab.dataset.directionId;
        if (
          direction_id !== undefined &&
          this.currentRouteId &&
          this.currentServiceId
        ) {
          void openTimetable(
            this.currentRouteId,
            this.currentServiceId,
            direction_id
          );
        }
        return;
      }

      const addStopBtn = (e.target as Element)?.closest?.('.add-stop-btn');
      if (addStopBtn instanceof HTMLElement) {
        if (this.currentTripCount === 0) {
          console.warn(
            '[ScheduleController] add stop ignored: the timetable has no trips'
          );
          return;
        }
        void this.openAddStopPicker();
        return;
      }

      const addFirstTripBtn = (e.target as Element)?.closest?.(
        '.add-first-trip-btn'
      );
      if (addFirstTripBtn instanceof HTMLElement) {
        void this.createFirstTrip();
        return;
      }

      const addFieldBtn = (e.target as Element)?.closest?.('.add-field-btn');
      if (addFieldBtn instanceof HTMLElement) {
        void this.openAddFieldPicker();
        return;
      }

      const removeFieldBtn = (e.target as Element)?.closest?.(
        '.remove-field-btn'
      );
      if (removeFieldBtn instanceof HTMLElement) {
        const field = removeFieldBtn.dataset.field;
        if (field) {
          this.removeProvisionalField(field);
        }
        return;
      }

      const span = (e.target as Element)?.closest?.('.time-span');
      if (span instanceof HTMLElement) {
        this.openStopTimeEditor(span);
        return;
      }

      const propSpan = (e.target as Element)?.closest?.('.trip-prop-span');
      if (propSpan instanceof HTMLElement) {
        this.handleTripPropClick(propSpan);
        return;
      }

      // The frequency band. Its spans are deliberately not .time-span, so they
      // are matched here rather than by the grid's handler above.
      const freqSpan = (e.target as Element)?.closest?.('.freq-span');
      if (freqSpan instanceof HTMLElement) {
        this.openFrequencyEditor(freqSpan);
        return;
      }

      const freqAdd = (e.target as Element)?.closest?.('.freq-add');
      if (freqAdd instanceof HTMLElement) {
        const trip_id = freqAdd.dataset.tripId;
        if (trip_id) {
          void this.addFrequencyPeriod(trip_id);
        }
        return;
      }

      const freqDelete = (e.target as Element)?.closest?.('.freq-delete');
      if (freqDelete instanceof HTMLElement) {
        const { tripId, startTime } = freqDelete.dataset;
        if (tripId && startTime) {
          void this.deleteFrequencyPeriod(tripId, startTime);
        }
        return;
      }

      const resortBtn = (e.target as Element)?.closest?.('.resort-trip-btn');
      if (resortBtn instanceof HTMLElement) {
        const trip_id = resortBtn.dataset.tripId;
        if (trip_id) {
          void this.resortTrip(trip_id);
        }
        return;
      }

      const uploadShapeBtn = (e.target as Element)?.closest?.(
        '.upload-shape-btn'
      );
      if (uploadShapeBtn instanceof HTMLElement) {
        const trip_id = uploadShapeBtn.dataset.tripId;
        if (trip_id) {
          void this.handleUploadShapeForTrip(
            trip_id,
            uploadShapeBtn.dataset.shapeId ?? ''
          );
        }
        return;
      }

      const deleteBtn = (e.target as Element)?.closest?.('.delete-trip-btn');
      const tripId = deleteBtn?.getAttribute('data-trip-id');
      if (tripId) {
        void this.handleDeleteTrip(tripId);
      }
    });

    // Keyboard navigation over the time cells. Delegated to document for the
    // same reason as the clicks above.
    document.addEventListener('keydown', (e) => this.handleTimeCellKeydown(e));

    // Tabbing into the grid, or clicking a cell, makes that cell the selection
    // so a later re-render puts the user back on it.
    document.addEventListener('focusin', (e) => {
      const span = (e.target as Element)?.closest?.('.time-span');
      if (span instanceof HTMLElement) {
        this.selectTimeCell(span, false);
      }
    });

    this.installStopRowHover();
  }

  /**
   * Keyboard handling for a focused-but-not-editing time cell.
   *
   * The spreadsheet model: arrows move the selection without opening anything,
   * Enter or F2 opens the editor on the current cell, and typing a printable
   * character opens it seeded with that character. Phase-1 behaviour inside an
   * open editor is untouched - `openInlineEditor` replaces the span with the
   * input, so while editing there is no `.time-span` to be the event target and
   * this handler never fires.
   *
   * Tab is deliberately not handled: the roving tabindex means Tab leaves the
   * grid, which is the only way out of a few thousand cells.
   */
  private handleTimeCellKeydown(e: KeyboardEvent): void {
    const span = (e.target as Element)?.closest?.('.time-span');
    if (!(span instanceof HTMLElement)) {
      return;
    }

    const direction = arrowToGridDirection(e);
    if (direction) {
      e.preventDefault();
      const target = this.resolveNeighbour(span, direction);
      if (target) {
        this.selectTimeCell(target, true);
      }
      return;
    }

    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      this.openStopTimeEditor(span);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.clearTimeCell(span);
      return;
    }

    // A printable character starts editing with that character already typed.
    // Modifier combinations are left alone so the global shortcuts in
    // keyboard-shortcuts.ts still fire: a focused span is not an input, so
    // their isInputField guard no longer suppresses them for us.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      this.openStopTimeEditor(span, { value: e.key, caret: e.key.length });
    }
  }

  /** Clear a selected cell's field, recording a patch like any other edit. */
  private clearTimeCell(span: HTMLElement): void {
    const {
      tripId,
      stopId,
      stopIndex,
      field,
      stopSequence,
      pending,
      disabled,
    } = span.dataset;
    // The pending row has no stop_time behind it, so there is nothing to clear.
    if (pending === 'true' || disabled === 'true' || !tripId || !field) {
      return;
    }

    const windowField = asWindowField(field);
    if (windowField) {
      // An unserved flex cell has no stop_sequence and so no record to clear.
      if (stopSequence) {
        void this.updateFlexWindow(tripId, stopSequence, windowField, '');
      }
      return;
    }

    if (TIME_FIELDS.includes(field)) {
      if (!stopId) {
        return;
      }
      void this.updateArrivalDepartureTime(
        tripId,
        stopId,
        field === 'arrival_time' ? 'arrival' : 'departure',
        '',
        stopSequence,
        false,
        stopIndex === undefined ? undefined : Number(stopIndex)
      );
      return;
    }

    if (stopSequence) {
      void this.updateStopTimeField(tripId, stopSequence, field, '');
    }
  }

  /**
   * Hovering a row lights what it references on the map: a stop, an on-demand
   * zone, or every member stop of a location group.
   *
   * `pointerover`/`pointerout` bubble (unlike mouseenter/mouseleave), so this
   * can be delegated to `document` like the pickers above. Moving between two
   * children of the same row fires an out/over pair for the same row, hence
   * the same-row guard: without it the highlight flickers off and on.
   *
   * Bound to `document` once, so it fires for every `.strip-stop-row` on the
   * page - the timetable and the route diagram both. Both must emit the same
   * attribute pair or one of them silently stops hovering.
   */
  private installStopRowHover(): void {
    const rowRef = (e: Event): StopTimeRef | null => {
      const row = (e.target as Element)?.closest?.('.strip-stop-row');
      if (!(row instanceof HTMLElement)) {
        return null;
      }
      const stop_id = row.dataset.stopId;
      if (stop_id) {
        return { kind: 'stop', id: stop_id };
      }
      const flex_id = row.dataset.flexId;
      const kind = row.dataset.flexKind;
      if (flex_id && (kind === 'location' || kind === 'location_group')) {
        return { kind, id: flex_id };
      }
      return null;
    };

    const same = (a: StopTimeRef | null, b: StopTimeRef | null): boolean =>
      a !== null && b !== null && a.kind === b.kind && a.id === b.id;

    document.addEventListener('pointerover', (e) => {
      const ref = rowRef(e);
      if (ref && !same(ref, this.hoveredRef)) {
        this.hoveredRef = ref;
        this.refHover?.(ref);
      }
    });

    document.addEventListener('pointerout', (e) => {
      const ref = rowRef(e);
      if (same(ref, this.hoveredRef)) {
        // Only really left the row if the pointer landed outside it.
        const next = (e as PointerEvent).relatedTarget;
        if (next instanceof Element && next.closest('.strip-stop-row')) {
          return;
        }
        this.hoveredRef = null;
        this.refHover?.(null);
      }
    });
  }

  /**
   * Wire the timetable stop column to the map: clicking a stop's rail dot
   * focuses it, hovering a row lights whatever it references (stop, zone or
   * location group). Injected from `index.ts` because ScheduleController has
   * no map or navigation reference of its own.
   */
  public setStopHighlightHandlers(handlers: {
    onStopFocus: (stop_id: string) => void;
    onRefHover: (ref: StopTimeRef | null) => void;
  }): void {
    this.stopFocus = handlers.onStopFocus;
    this.refHover = handlers.onRefHover;
  }

  /**
   * Wire the timetable's pickers to the two modals that author what they list:
   * On-Demand (booking rules, location groups, zones) and Shapes. Injected for
   * the same reason as the stop handlers: both modals need the database and the
   * patch manager, which the timetable does not carry.
   *
   * They are reached from a picker's footer button, never from a value span:
   * assigning a rule or a shape is an edit, opening its editor is navigation.
   */
  public setManagerHandlers(handlers: {
    openOnDemand: (target: OnDemandTarget) => void;
    openShapes: () => void;
    uploadShape: (
      tripId: string,
      currentShapeId: string
    ) => Promise<string | null>;
  }): void {
    this.onDemandOpen = handlers.openOnDemand;
    this.shapesOpen = handlers.openShapes;
    this.shapeUpload = handlers.uploadShape;
  }

  /** The roster the last render used, stamped on #schedule-view. */
  private renderedFields(): string[] {
    const view = document.getElementById('schedule-view');
    const stamped = view?.dataset.fields ?? '';
    return stamped === '' ? [] : stamped.split(',');
  }

  /**
   * Add a stop_times field to the roster from a cell's `+` button.
   *
   * The field you want is discovered while looking at a specific cell, but the
   * grid has to stay rectangular, so it appears as a sub-row in every cell. It
   * is UI-only: no patch, no persistence, dropped on leaving the timetable.
   */
  private async openAddFieldPicker(): Promise<void> {
    const shown = new Set(this.renderedFields());
    const options: OptionPickerItem[] = STOP_TIME_EDITABLE_FIELDS.filter(
      (field) => !shown.has(field)
    ).map((field) => ({
      value: field,
      primary: field,
      detail: renderSpecDescriptionPlain(
        getGTFSFieldDescription('stop_times.txt', field)
      ),
    }));

    if (options.length === 0) {
      notify.info('Every stop_times field is already shown', {
        duration: 3000,
      });
      return;
    }

    const picked = await showOptionPickerModal({
      title: 'Add a stop_times field',
      options,
      searchable: true,
    });
    if (picked === null || picked === '') {
      return;
    }

    console.log(`[ScheduleController] showing stop_times field ${picked}`);
    this.provisionalFields.push(picked);
    // A full re-render, not a DOM patch: data-fields-per-cell is stamped at
    // render time and resolveNeighbour's stride depends on it.
    await this.refreshCurrentTimetable();
  }

  /** Drop a field added from the `+` button. Used fields have no ✕. */
  private removeProvisionalField(field: string): void {
    const index = this.provisionalFields.indexOf(field);
    if (index === -1) {
      return;
    }
    this.provisionalFields.splice(index, 1);
    console.log(`[ScheduleController] hiding stop_times field ${field}`);
    void this.refreshCurrentTimetable();
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
  private openStopTimeEditor(
    span: HTMLElement,
    seed?: { value: string; caret: number | null }
  ): void {
    const { field, disabled } = span.dataset;
    if (!field || disabled === 'true') {
      return;
    }

    switch (stopTimeFieldKind(field)) {
      case 'time':
        this.openTimeEditor(span, seed);
        return;
      case 'enum':
        this.openStopTimeEnumMenu(span);
        return;
      case 'booking_rule':
        void this.openBookingRulePicker(span);
        return;
      default:
        this.openStopTimeValueEditor(span, seed);
    }
  }

  /**
   * The editor for a cell's `arrival_time` / `departure_time` sub-row, or for
   * one end of its pickup/drop-off window. Only these fields can bring a
   * stop_time into existence; the other nine always edit an existing record.
   */
  private openTimeEditor(
    span: HTMLElement,
    seed?: { value: string; caret: number | null }
  ): void {
    const {
      tripId,
      stopId,
      stopIndex,
      field,
      stopSequence,
      pending,
      flexKind,
      flexId,
    } = span.dataset;
    const windowField = asWindowField(field);
    // A flex cell carries no stop_id at all - only the window fields and the
    // ref - so stop_id is required for arrival/departure editing only.
    if (!tripId || !field) {
      return;
    }
    if (!windowField && (!stopId || !TIME_FIELDS.includes(field))) {
      return;
    }

    const originalText = span.textContent?.trim() ?? '';
    const displayValue = originalText === '--:--:--' ? '' : originalText;

    this.editingCell = {
      tripId,
      stopIndex: stopIndex ?? '',
      field,
    };
    // The edited cell is also the selected one, so closing the editor leaves
    // the roving tabindex where the user actually is.
    this.selectTimeCell(span, false);

    openInlineEditor(span, {
      value: displayValue,
      initialValue: seed?.value,
      selectionStart: seed?.caret,
      className: 'time-input-live w-20 text-center font-mono',
      placeholder: '--:--:--',
      title: windowField
        ? 'Enter a pickup/drop-off window time, e.g. 9:30 or 09:30:00'
        : 'Enter a time, e.g. 9:30 or 09:30:00',
      arrowNavigation: true,
      onCommit: (value) => {
        if (windowField) {
          const cellRef: StopTimeRef | undefined =
            flexId && (flexKind === 'location' || flexKind === 'location_group')
              ? { kind: flexKind, id: flexId }
              : undefined;
          void this.updateFlexWindow(
            tripId,
            stopSequence,
            windowField,
            value,
            pending === 'true',
            cellRef,
            stopIndex === undefined ? undefined : Number(stopIndex)
          );
          return;
        }
        // Enter blurs the input, so nothing in the grid holds focus by the time
        // the re-render captures it. openInlineEditor has already put the span
        // back, so focusing it here is what makes the selection survive the
        // rebuild instead of dropping to the document.
        this.selectTimeCell(span, true);
        void this.updateArrivalDepartureTime(
          tripId,
          stopId as string,
          field === 'arrival_time' ? 'arrival' : 'departure',
          value,
          stopSequence,
          pending === 'true',
          stopIndex === undefined ? undefined : Number(stopIndex)
        );
      },
      onNavigate: (direction) => this.moveTimeCell(span, direction),
    });
  }

  /**
   * The editor for a text or number sub-row: `stop_headsign`,
   * `shape_dist_traveled`. Same click-to-edit swap as a time cell, so the grid
   * has one editing mechanism rather than one per field kind.
   */
  private openStopTimeValueEditor(
    span: HTMLElement,
    seed?: { value: string; caret: number | null }
  ): void {
    const { tripId, stopIndex, field, stopSequence, value } = span.dataset;
    if (!tripId || !field || !stopSequence) {
      return;
    }

    // A flag slot is not in the grid, so there is no cell to restore an editor
    // onto after a re-render - leaving editingCell null just drops the edit
    // rather than logging a missing cell.
    const isGridCell = span.classList.contains('time-span');
    if (isGridCell) {
      this.editingCell = { tripId, stopIndex: stopIndex ?? '', field };
    }
    this.selectTimeCell(span, false);

    openInlineEditor(span, {
      value: value ?? '',
      initialValue: seed?.value,
      selectionStart: seed?.caret,
      inputType: stopTimeFieldKind(field) === 'number' ? 'number' : 'text',
      // A slot is 12px wide, so an editor sized to it would be unusable; it
      // overflows its flag row for as long as it is open.
      className: isGridCell
        ? 'w-full text-center font-mono'
        : 'w-24 shrink-0 text-center font-mono',
      title: field,
      arrowNavigation: isGridCell,
      onCommit: (newValue) => {
        void this.updateStopTimeField(tripId, stopSequence, field, newValue);
      },
      // Only a grid cell has neighbours; arrowing out of a flag slot's editor
      // has nowhere to land.
      onNavigate: isGridCell
        ? (direction) => this.moveTimeCell(span, direction)
        : undefined,
    });
  }

  /**
   * The menu for an enum sub-row: the two types, the two continuous fields,
   * `timepoint`.
   *
   * On a windowed row the pickup/drop-off options are restricted to what a
   * pickup/drop-off window allows - pickup 1 or 2, drop-off 1, 2 or 3 - so the
   * documented `(2,1)` / `(1,2)` pattern is reachable from the grid and an
   * invalid one is not. Empty is not offered there: it is equivalent to 0,
   * which is forbidden under a window.
   */
  private openStopTimeEnumMenu(span: HTMLElement): void {
    const { tripId, stopSequence, field, value, windowed } = span.dataset;
    if (!tripId || !stopSequence || !field) {
      return;
    }

    const restricted =
      windowed === 'true' &&
      (field === 'pickup_type' || field === 'drop_off_type');
    const allowed = field === 'pickup_type' ? ['1', '2'] : ['1', '2', '3'];
    const enumOptions = (getEnumOptions(field) ?? [])
      .filter((opt) => !restricted || allowed.includes(String(opt.value)))
      .map((opt) => ({
        value: String(opt.value),
        label: `${opt.value} - ${opt.label}`,
      }));

    openInlineMenu(span, {
      currentValue: value ?? '',
      options: restricted
        ? enumOptions
        : [{ value: '', label: '-' }, ...enumOptions],
      onPick: (newValue) => {
        void this.updateStopTimeField(tripId, stopSequence, field, newValue);
      },
    });
  }

  /**
   * Every time cell in the rendered timetable, in row-major order.
   *
   * Rows are the `<tr>`s that actually contain time cells, which excludes both
   * the trip-property rows and the "Add stop" row - they share one `<tbody>`
   * with the stop rows, so they cannot be addressed by index.
   */
  private timeCellRows(): HTMLElement[][] {
    const view = document.getElementById('schedule-view');
    if (!view) {
      return [];
    }
    return Array.from(view.querySelectorAll('tr'))
      .map((row) => Array.from(row.querySelectorAll<HTMLElement>('.time-span')))
      .filter((cells) => cells.length > 0);
  }

  /**
   * The cell one step in `direction` from `from`, or null at the grid's edge.
   *
   * Down runs the cell's fields in spec order, then the first field of the next
   * stop row, which is the order a trip is actually entered in. Left and right
   * move between trips at the same stop and clamp at the row's edge rather than
   * wrapping, so a stray Tab cannot fling the user across a wide timetable.
   *
   * Every cell renders the same number of sub-rows, so the whole grid is a
   * single stride: N comes from `data-fields-per-cell`, stamped on
   * `#schedule-view` at render time.
   *
   * Shared by editing and selection so the two cannot disagree about what the
   * next cell is.
   */
  private resolveNeighbour(
    from: HTMLElement,
    direction: GridDirection
  ): HTMLElement | null {
    const rows = this.timeCellRows();
    const perCell = this.fieldsPerCell();
    let rowIndex = -1;
    let cellIndex = -1;
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].indexOf(from);
      if (c !== -1) {
        rowIndex = r;
        cellIndex = c;
        break;
      }
    }
    if (rowIndex === -1) {
      console.warn('[ScheduleController] navigated from a detached time cell');
      return null;
    }

    // A field the spec forbids on this row renders as an inert span that is
    // still in the DOM, so the grid stays rectangular. Keep stepping past those
    // rather than filtering them out: the stride arithmetic below assumes every
    // cell has the same span count, which a filtered row would break.
    let position: { rowIndex: number; cellIndex: number } | null = {
      rowIndex,
      cellIndex,
    };
    for (;;) {
      position = this.stepNeighbour(rows, perCell, position, direction);
      if (!position) {
        return null;
      }
      const target = rows[position.rowIndex][position.cellIndex];
      if (target.dataset.disabled !== 'true') {
        return target;
      }
    }
  }

  /** One step in `direction`, ignoring whether the cell it lands on is enabled. */
  private stepNeighbour(
    rows: HTMLElement[][],
    perCell: number,
    from: { rowIndex: number; cellIndex: number },
    direction: GridDirection
  ): { rowIndex: number; cellIndex: number } | null {
    const { rowIndex, cellIndex } = from;
    // N spans per trip column, in the visible field roster's order.
    const offset = cellIndex % perCell;

    let next: { rowIndex: number; cellIndex: number };
    if (direction === 'down') {
      next =
        offset < perCell - 1
          ? { rowIndex, cellIndex: cellIndex + 1 }
          : { rowIndex: rowIndex + 1, cellIndex: cellIndex - (perCell - 1) };
    } else if (direction === 'up') {
      next =
        offset > 0
          ? { rowIndex, cellIndex: cellIndex - 1 }
          : { rowIndex: rowIndex - 1, cellIndex: cellIndex + (perCell - 1) };
    } else {
      const step = direction === 'right' ? perCell : -perCell;
      next = { rowIndex, cellIndex: cellIndex + step };
    }

    return rows[next.rowIndex]?.[next.cellIndex] ? next : null;
  }

  /** How many sub-rows each cell renders, from the last render's stamp. */
  private fieldsPerCell(): number {
    const view = document.getElementById('schedule-view');
    const parsed = Number(view?.dataset.fieldsPerCell ?? '2');
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
  }

  /**
   * Commit-and-move: open the editor on the cell in `direction` from `from`.
   *
   * At the grid's edge this does nothing: the editor has already committed and
   * closed, which is the right place to stop.
   */
  private moveTimeCell(from: HTMLElement, direction: GridDirection): void {
    const target = this.resolveNeighbour(from, direction);
    if (!target) {
      this.editingCell = null;
      return;
    }

    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.openStopTimeEditor(target);
  }

  /** The re-render-stable identity of a time cell, from its data attributes. */
  private timeCellKey(span: HTMLElement): TimeCellKey | null {
    const { tripId, stopIndex, field } = span.dataset;
    if (!tripId || !field) {
      return null;
    }
    return { tripId, stopIndex: stopIndex ?? '', field };
  }

  /** Find a time cell in the rendered timetable by its key. */
  private findTimeCell(key: TimeCellKey): HTMLElement | null {
    const selector =
      `.time-span[data-trip-id="${CSS.escape(key.tripId)}"]` +
      `[data-stop-index="${CSS.escape(key.stopIndex)}"]` +
      `[data-field="${CSS.escape(key.field)}"]`;
    return (
      document
        .getElementById('schedule-view')
        ?.querySelector<HTMLElement>(selector) ?? null
    );
  }

  /**
   * Make `span` the selected cell: it takes the roving tabindex, and every
   * other cell drops back to -1 so the grid stays a single tab stop.
   *
   * Only a `.time-span` can be the selection. A compact-mode flag slot opens
   * the same editors but is not part of the grid, so clicking one must not move
   * the tab stop onto a button no arrow key can leave.
   */
  private selectTimeCell(span: HTMLElement, focus: boolean): void {
    if (!span.classList.contains('time-span')) {
      return;
    }
    const view = document.getElementById('schedule-view');
    view
      ?.querySelectorAll<HTMLElement>('.time-span[tabindex="0"]')
      .forEach((el) => el.setAttribute('tabindex', '-1'));
    span.setAttribute('tabindex', '0');
    this.selectedCell = this.timeCellKey(span);

    if (focus) {
      span.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      span.focus();
    }
  }

  /**
   * Put the roving tabindex back after a render, and re-focus the selected cell
   * if it was focused before the rebuild.
   *
   * Call on every timetable render, not just the ones that restore an editor:
   * without a cell carrying tabindex="0" the grid cannot be tabbed into at all.
   * Falls back to the first time cell so a freshly opened timetable still has an
   * entry point.
   */
  public applyTimetableSelection(): void {
    const view = document.getElementById('schedule-view');
    if (!view) {
      return;
    }

    const wasFocused = this.selectionHadFocus;
    this.selectionHadFocus = false;

    // A forbidden-and-empty cell is inert, so it must never hold the roving
    // tabindex - the grid would then open on a cell no key can leave.
    const entry = () =>
      view.querySelector<HTMLElement>('.time-span:not([data-disabled="true"])');

    // A pending key wins: the edit that caused this render moved its row, so
    // the strip position in selectedCell now belongs to a different stop.
    const pending = this.pendingSelection;
    this.pendingSelection = null;
    const moved = pending
      ? view.querySelector<HTMLElement>(
          `.time-span[data-trip-id="${CSS.escape(pending.tripId)}"]` +
            `[data-stop-sequence="${CSS.escape(pending.stopSequence)}"]` +
            `[data-field="${CSS.escape(pending.field)}"]`
        )
      : null;

    const selected =
      moved ??
      (this.selectedCell ? this.findTimeCell(this.selectedCell) : null);
    const target =
      selected && selected.dataset.disabled !== 'true' ? selected : entry();
    if (!target) {
      // The selected trip or stop was deleted by the edit that caused this
      // render, or a mode switch left the field it named unrenderable.
      this.selectedCell = null;
      return;
    }

    this.selectTimeCell(target, wasFocused);
  }

  /**
   * Remember the open time editor and what has been typed into it, before a
   * re-render tears it out of the DOM. Mirrors how the scroll position is
   * tracked: read it while it still exists, not afterwards.
   */
  public captureTimetableEditor(): void {
    // Read before the rebuild: a selected (not edited) cell is a focused span,
    // and only a span that really had focus should get it back afterwards.
    this.selectionHadFocus =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains('time-span');

    if (!this.editingCell) {
      return;
    }
    const live = getLiveEditorState();
    if (!live) {
      this.editingCell = null;
      return;
    }
    // An editor the user only navigated onto (Enter/Tab moved focus there but
    // no key has been typed yet) shows stale seed text, not a real edit in
    // progress - e.g. a just-coupled departure_time still reads the pre-write
    // placeholder. Only a dirty editor's text is worth protecting from the
    // rebuild; an untouched one should reseed from the freshly rendered span.
    if (live.dirty) {
      this.editingCell.value = live.value;
      this.editingCell.caret = live.selectionStart;
    }
  }

  /**
   * Re-open the editor captured by `captureTimetableEditor` on the freshly
   * rendered timetable. Call synchronously after the new markup is in place.
   *
   * Silently gives up if the cell is gone: the stop or trip may have been
   * deleted by the very edit that triggered this render.
   */
  public restoreTimetableEditor(): void {
    const cell = this.editingCell;
    if (!cell) {
      return;
    }
    this.editingCell = null;

    // The edit that caused this render may have renumbered stop_sequence and
    // moved this row's strip position out from under cell.stopIndex - the same
    // reason applyTimetableSelection resolves `pendingSelection` by
    // stop_sequence instead. Peek rather than consume: applyTimetableSelection
    // runs next and needs the same pending entry to land the roving tabindex on
    // this cell too.
    const pending = this.pendingSelection;
    const moved =
      pending && pending.tripId === cell.tripId && pending.field === cell.field
        ? document
            .getElementById('schedule-view')
            ?.querySelector<HTMLElement>(
              `.time-span[data-trip-id="${CSS.escape(pending.tripId)}"]` +
                `[data-stop-sequence="${CSS.escape(pending.stopSequence)}"]` +
                `[data-field="${CSS.escape(pending.field)}"]`
            )
        : null;

    const span = moved ?? this.findTimeCell(cell);
    if (!span) {
      console.log('[ScheduleController] edited cell is gone, dropping focus');
      return;
    }

    // No captured value means the editor was only navigated onto, never typed
    // into: reopen with no seed so it picks up the freshly rendered span's
    // text (e.g. a just-coupled departure_time) instead of the stale text it
    // opened with before the write landed.
    this.openStopTimeEditor(
      span,
      cell.value === undefined
        ? undefined
        : { value: cell.value, caret: cell.caret ?? null }
    );
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
   * Open the searchable picker for the "Add stop or zone" row.
   *
   * Unlike `openStopPicker` this lists stops, on-demand zones and location
   * groups in one flat list: the value is the `kind:id` wire form of a
   * StopTimeRef, so the pick drops straight into the pending-row state.
   */
  private async openAddStopPicker(): Promise<void> {
    const options = await this.getRefOptions();
    const picked = await showOptionPickerModal({
      title: 'Add stop or zone',
      options,
      searchable: true,
      // Two of the three kinds this lists are authored in the On-Demand modal.
      // Stops have no list page to send anyone to, so the label names what the
      // button actually opens.
      footerAction: this.onDemandOpen
        ? {
            label: 'Manage zones and location groups...',
            onClick: () =>
              this.onDemandOpen?.({ table: GTFS_TABLES.LOCATION_GROUPS }),
          }
        : undefined,
    });

    if (picked) {
      void this.addRefFromSelector(picked);
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
   * Open the searchable booking-rule picker for a booking-rule sub-row.
   *
   * A booking rule behaves like every other field here: clicking it assigns
   * one. Reading or authoring a rule is a different job, reached from the
   * picker's `Manage booking rules...` footer button - navigating to a modal is
   * not an edit, so it must not be what a plain click does.
   */
  private async openBookingRulePicker(badge: HTMLElement): Promise<void> {
    const { tripId, stopSequence, field, value } = badge.dataset;
    if (!tripId || !stopSequence || !field) {
      return;
    }

    const currentValue = value ?? '';
    const rules = this.gtfsParser.getFileDataSyncTyped<Record<string, unknown>>(
      GTFS_TABLES.BOOKING_RULES
    );
    const options: OptionPickerItem[] = [
      { value: '', primary: '- none -' },
      ...rules.map((rule) => {
        const id = String(rule.booking_rule_id ?? '');
        const message = String(rule.message ?? '').trim();
        const bookingType = String(rule.booking_type ?? '');
        return {
          value: id,
          primary: id,
          secondary: message || `booking_type ${bookingType || '-'}`,
        };
      }),
    ];
    if (
      currentValue &&
      !rules.some((rule) => String(rule.booking_rule_id ?? '') === currentValue)
    ) {
      options.push({
        value: currentValue,
        primary: `${formatIssueValue(currentValue)} (dangling reference)`,
      });
    }

    const picked = await showOptionPickerModal({
      title:
        field === 'pickup_booking_rule_id'
          ? 'Pickup booking rule'
          : 'Drop-off booking rule',
      options,
      selectedValue: currentValue,
      searchable: true,
      footerAction: this.onDemandOpen
        ? {
            label: 'Manage booking rules...',
            onClick: () =>
              this.onDemandOpen?.({
                table: GTFS_TABLES.BOOKING_RULES,
                rowKey: currentValue,
              }),
          }
        : undefined,
    });

    if (picked !== null && picked !== currentValue) {
      await this.updateStopTimeField(tripId, stopSequence, field, picked);
    }
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
        primary: `${formatIssueValue(currentValue)} (dangling reference)`,
      });
    }

    const picked = await showOptionPickerModal({
      title: 'Select shape',
      options,
      selectedValue: currentValue,
      searchable: true,
      footerAction: this.shapesOpen
        ? {
            label: 'Manage shapes...',
            onClick: () => this.shapesOpen?.(),
          }
        : undefined,
    });

    if (picked !== null && picked !== currentValue) {
      setPickerTriggerContent(span, escapeHtml(picked) || '-');
      span.dataset.value = picked;
      // The old value was the broken one, so drop the red without waiting for
      // the next validation pass.
      markReferenceResolved('trips.txt', 'shape_id', currentValue);
      span.classList.remove('text-error', 'font-semibold');
      span.removeAttribute('title');
      void this.updateTripProperty(tripId, 'shape_id', picked);
    }
  }

  /**
   * The "Upload shape" button in the shape actions row: pick a GPX file, name
   * a shape, and point this one trip's shape_id at it, in one step.
   *
   * The insert and the trip update are recorded together by
   * `ShapesManager.uploadShapeForTrip`, so there is nothing left to record
   * here - only the DOM to catch up, mirroring what
   * `openTripPropShapePicker` does after a pick. When the user chose to
   * replace the trip's existing shape the id comes back unchanged, so the DOM
   * writes below are no-ops.
   */
  private async handleUploadShapeForTrip(
    tripId: string,
    currentShapeId: string
  ): Promise<void> {
    if (!this.shapeUpload) {
      return;
    }

    const shapeId = await this.shapeUpload(tripId, currentShapeId);
    if (!shapeId) {
      return;
    }

    const span = document.querySelector(
      `.trip-prop-span[data-trip-id="${CSS.escape(tripId)}"][data-field="shape_id"]`
    );
    if (span instanceof HTMLElement) {
      setPickerTriggerContent(span, escapeHtml(shapeId) || '-');
      span.dataset.value = shapeId;
      markReferenceResolved('trips.txt', 'shape_id', currentShapeId);
      span.classList.remove('text-error', 'font-semibold');
      span.removeAttribute('title');
    }

    const uploadBtn = document.querySelector(
      `.upload-shape-btn[data-trip-id="${CSS.escape(tripId)}"]`
    );
    if (uploadBtn instanceof HTMLElement) {
      uploadBtn.dataset.shapeId = shapeId;
    }

    notify.success(
      shapeId === currentShapeId
        ? `Replaced shape ${shapeId}`
        : `Uploaded shape ${shapeId} for trip ${tripId}`
    );
  }

  /**
   * Cached structured stop list for the searchable stop-picker modal.
   * Built at most once per feed. Cleared by invalidateCaches when the stops
   * table changes.
   */
  private stopOptions: OptionPickerItem[] | null = null;

  /**
   * Cached stop + zone + location group list for the "Add stop or zone" picker.
   * Built at most once per feed, cleared by invalidateCaches.
   */
  private refOptions: OptionPickerItem[] | null = null;

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
    this.refOptions = null;
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
   * from the previous feed, and currentRouteId/currentServiceId/pendingRow
   * would still point at state that may no longer exist.
   */
  public resetForNewFeed(): void {
    this.invalidateCaches();
    this.currentRouteId = undefined;
    this.currentServiceId = undefined;
    this.currentDirectionId = undefined;
    this.currentTripCount = 0;
    this.pendingRow = undefined;
    this.provisionalFields = [];
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

  /**
   * Stops, on-demand zones and location groups as one option list.
   *
   * The value is `kind:id`, the wire form of a StopTimeRef, and the kind is the
   * secondary line so the three kinds stay tellable apart in a flat list.
   */
  private async getRefOptions(): Promise<OptionPickerItem[]> {
    if (this.refOptions === null) {
      const stops = await this.getStopOptions();
      const zones = getZoneFeatures(this.gtfsParser).map((feature) => {
        const location_id = String(feature.id);
        const name = zoneName(feature);
        return {
          value: `location:${location_id}`,
          primary: name || location_id,
          secondary: `On-demand zone - ${location_id}`,
        };
      });
      const groups = this.gtfsParser
        .getFileDataSyncTyped<LocationGroups>(GTFS_TABLES.LOCATION_GROUPS)
        .map((group) => {
          const location_group_id = String(group.location_group_id ?? '');
          const name = String(group.location_group_name ?? '');
          return {
            value: `location_group:${location_group_id}`,
            primary: name || location_group_id,
            secondary: `Location group - ${location_group_id}`,
          };
        })
        .filter((option) => option.value !== 'location_group:');

      console.log(
        `[ScheduleController] building add-row picker options: ${stops.length} stops, ${zones.length} zones, ${groups.length} location groups`
      );
      this.refOptions = [
        ...stops.map((option) => ({
          ...option,
          value: `stop:${option.value}`,
        })),
        ...zones,
        ...groups,
      ];
    }
    return this.refOptions;
  }

  /** Reset tracked scroll and selection when navigating to a different page. */
  resetTimetableScroll(): void {
    this.timetableScrollLeft = 0;
    this.timetableScrollTop = 0;
    // The selection keys off trip and stop index, which mean nothing in the
    // next timetable. Drop it so the new grid opens at its first cell.
    this.selectedCell = null;
    this.selectionHadFocus = false;
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
   * @param stopIndex - Supersequence position of the edited cell on the strip
   * @throws {Error} When validation fails or database update fails
   */
  public async updateArrivalDepartureTime(
    trip_id: string,
    stop_id: string,
    timeType: 'arrival' | 'departure',
    newTime: string,
    stopSequence?: string,
    isPendingRow = false,
    stopIndex?: number
  ): Promise<void> {
    try {
      const isClear = !newTime.trim();
      const castedTime = isClear
        ? null
        : TimeFormatter.castTimeToHHMMSS(newTime);

      // The pending row has no stop_time yet, so there is nothing to couple
      // against and nothing to find: it always inserts. A cell with no
      // stop_sequence is in the same position.
      const existing =
        isPendingRow || !stopSequence
          ? null
          : await this.database.getStopTime(trip_id, stopSequence);

      // One time entry writes both fields: a lone arrival is neither what the
      // user meant nor valid for most feeds.
      let coupled: CoupledTimes | undefined;
      if (castedTime !== null) {
        coupled = coupleStopTimes({
          field: timeType,
          oldArrival: existing?.arrival_time,
          oldDeparture: existing?.departure_time,
          newValue: castedTime,
        });
        const validation =
          this.database.validateArrivalDepartureConstraint(coupled);
        if (!validation.isValid) {
          this.showTimeError(
            trip_id,
            stop_id,
            validation.errorMessage || 'Invalid time'
          );
          return;
        }
        const delta =
          coupled.deltaSeconds === null
            ? 'none'
            : `${coupled.deltaSeconds >= 0 ? '+' : ''}${coupled.deltaSeconds}s`;
        console.log(
          `[ScheduleController] coupled times trip=${trip_id} stop=${stop_id} field=${timeType} delta=${delta} -> ${coupled.arrival_time ?? ''}/${coupled.departure_time ?? ''}`
        );
      }

      // Clearing the row's last time means the trip no longer serves this stop:
      // a row with no arrival, no departure and no window has nothing left to
      // show in the grid, so it is removed rather than left behind empty.
      if (castedTime === null && stopSequence && !isPendingRow) {
        if (await this.clearsWholeRow(trip_id, stopSequence, timeType)) {
          await this.deleteStopTimeRow(trip_id, stopSequence, stop_id);
          return;
        }
      }

      const plan = await this.database.planStopTimeEdit(
        trip_id,
        stop_id,
        timeType,
        castedTime,
        stopSequence,
        isPendingRow,
        this.stopTimeInsertIndex(trip_id, stopIndex),
        coupled
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
        this.clearPendingRowIfMatches({ kind: 'stop', id: stop_id });
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

      // An insert renumbers every row after it, so the cell the user typed into
      // may no longer answer to the stop_sequence it was rendered with. Carry
      // the selection to where the edited row actually landed.
      if (plan.resultIndex !== undefined) {
        this.pendingSelection = {
          tripId: trip_id,
          stopSequence: String(plan.resultIndex),
          field: timeType === 'arrival' ? 'arrival_time' : 'departure_time',
        };
      }
    } catch (error) {
      console.error('Failed to update arrival/departure time:', error);
      this.showTimeError(trip_id, stop_id, 'Failed to save time change');
    }
  }

  /**
   * Update one end of a stop_time's pickup/drop-off window.
   *
   * A flex row is addressed by trip_id + stop_sequence, not stop_id: it has no
   * stop_id at all when it references a location group or zone.
   *
   * Three cells reach here with no stop_sequence, and each one creates a record
   * rather than updating one: the pending row from the "Add stop or zone"
   * picker (a ref no trip on the route uses yet), and any zone row cell on a
   * trip that does not serve that zone. Clearing a window end on a flex-ref row
   * deletes the record instead, since a flex row with no window is invalid.
   *
   * @param trip_id - GTFS trip identifier
   * @param stopSequence - stop_sequence of the edited row, when a record exists
   * @param field - Which end of the window to write
   * @param newTime - New time value or empty string to clear
   * @param isPendingRow - The cell belongs to the not-yet-saved pending row
   * @param cellRef - What this cell's row references, for the insert path
   * @param stopIndex - Supersequence position of the row, for the insert path
   */
  public async updateFlexWindow(
    trip_id: string,
    stopSequence: string | undefined,
    field: FlexWindowField,
    newTime: string,
    isPendingRow = false,
    cellRef?: StopTimeRef,
    stopIndex?: number
  ): Promise<void> {
    if (isPendingRow) {
      await this.insertFlexStopTime(trip_id, newTime);
      return;
    }

    if (!stopSequence) {
      // Clearing a cell with no record behind it has nothing to do.
      if (!newTime.trim()) {
        return;
      }
      if (cellRef && cellRef.kind !== 'stop' && stopIndex !== undefined) {
        await this.insertFlexStopTimeOnTrip(
          trip_id,
          cellRef,
          stopIndex,
          newTime
        );
        return;
      }
      console.warn(
        `[ScheduleController] flex window edit for ${trip_id} has no stop_sequence`
      );
      return;
    }

    const row = this.gtfsParser
      .getStopTimesByTripId(trip_id)
      .find((st) => String(st.stop_sequence) === stopSequence);
    if (!row) {
      console.warn(
        `[ScheduleController] no stop_time for ${trip_id} at stop_sequence ${stopSequence}`
      );
      return;
    }

    const rowId = String(
      row.location_group_id ?? row.location_id ?? row.stop_id ?? ''
    );
    const isClear = !newTime.trim();
    const casted = isClear ? '' : TimeFormatter.castTimeToHHMMSS(newTime);
    const current = String(row[field] ?? '');
    if (current === casted) {
      return;
    }

    // Clearing a window end on a zone or location group row means "this trip
    // does not serve this ref": a flex row with no window fails
    // validateFlexStopTimeRow, so there is no valid half-cleared state to write.
    // A timed stop that happens to carry a window is a different case - there
    // the row survives its window, so that is a plain field clear.
    const isFlexRefRow = !!(row.location_id || row.location_group_id);
    if (isClear && isFlexRefRow) {
      await this.deleteStopTimeRow(trip_id, stopSequence, rowId);
      return;
    }

    // Same string comparison the arrival/departure constraint uses: GTFS times
    // are zero-padded HH:MM:SS, so lexical order is chronological order.
    const other = String(
      row[
        field === 'start_pickup_drop_off_window'
          ? 'end_pickup_drop_off_window'
          : 'start_pickup_drop_off_window'
      ] ?? ''
    );
    if (casted && other) {
      const invalid =
        field === 'start_pickup_drop_off_window'
          ? casted > other
          : casted < other;
      if (invalid) {
        this.showTimeError(
          trip_id,
          rowId,
          'Window start must be before or equal to window end'
        );
        return;
      }
    }

    try {
      const key = generateCompositeKeyFromRecord(
        'stop_times',
        row as unknown as Record<string, unknown>
      );
      await patchUpdate(
        this.gtfsParser.gtfsDatabase,
        this.patchManager,
        'stop_times',
        key,
        { [field]: current },
        { [field]: casted }
      );
      const label = isClear
        ? `Clear ${field} for ${trip_id}/${rowId}`
        : `Set ${field} for ${trip_id}/${rowId} to ${casted}`;
      console.log(`[ScheduleController] ${label}`);
    } catch (error) {
      console.error('Failed to update pickup/drop-off window:', error);
      this.showTimeError(trip_id, rowId, 'Failed to save window change');
    }
  }

  /**
   * Write one non-time field of an existing stop_time, addressed the same way
   * `updateFlexWindow` addresses it: trip_id + stop_sequence, since a flex row
   * has no stop_id.
   *
   * Takes any of the grid's editable fields. There is deliberately no insert
   * path: only a time edit may bring a stop_time into existence, so a cell with
   * no record renders its other sub-rows as non-editable and never reaches here.
   *
   * The whole row is run through `validateFlexStopTimeRow` with the change
   * applied, so the grid cannot produce a row the feed validator would reject.
   *
   * @param trip_id - GTFS trip identifier
   * @param stopSequence - stop_sequence of the edited row
   * @param field - Which field to write
   * @param value - New value, or an empty string to clear
   */
  private async updateStopTimeField(
    trip_id: string,
    stopSequence: string,
    field: string,
    rawValue: string
  ): Promise<void> {
    const value = rawValue.trim();
    const row = this.gtfsParser
      .getStopTimesByTripId(trip_id)
      .find((st) => String(st.stop_sequence) === stopSequence);
    if (!row) {
      console.warn(
        `[ScheduleController] no stop_time for ${trip_id} at stop_sequence ${stopSequence}`
      );
      return;
    }

    const rowId = String(
      row.location_group_id ?? row.location_id ?? row.stop_id ?? ''
    );
    const record = row as unknown as Record<string, unknown>;
    const current = String(record[field] ?? '');
    if (current === value) {
      return;
    }

    const invalid = validateFlexStopTimeRow({ ...record, [field]: value });
    if (invalid) {
      this.showTimeError(trip_id, rowId, invalid);
      return;
    }

    try {
      const key = generateCompositeKeyFromRecord('stop_times', record);
      await patchUpdate(
        this.gtfsParser.gtfsDatabase,
        this.patchManager,
        'stop_times',
        key,
        { [field]: current },
        { [field]: value }
      );
      console.log(
        `[ScheduleController] Set ${field} for ${trip_id}/${rowId} to ${value || '(empty)'}`
      );
    } catch (error) {
      console.error(`Failed to update ${field}:`, error);
      this.showTimeError(trip_id, rowId, `Failed to save ${field}`);
    }
  }

  /**
   * Create the on-demand stop_time behind the pending row, on its first window
   * edit.
   *
   * The row is validated by the same `validateFlexStopTimeRow` the On-Demand
   * editor and the feed validator use, so a row typed here cannot be less valid
   * than one typed there.
   *
   * @param trip_id - Trip the new stop_time belongs to
   * @param newTime - The window value the user typed
   */
  private async insertFlexStopTime(
    trip_id: string,
    newTime: string
  ): Promise<void> {
    const pending = this.pendingRow;
    if (!pending || pending.ref.kind === 'stop') {
      console.warn(
        `[ScheduleController] flex window insert for ${trip_id} with no pending flex row`
      );
      return;
    }

    // Clearing an empty pending cell has nothing to create.
    if (!newTime.trim()) {
      return;
    }

    const ref = pending.ref;
    try {
      const casted = TimeFormatter.castTimeToHHMMSS(newTime);
      const plan = await this.database.planFlexStopTimeInsert(
        trip_id,
        ref,
        casted
      );
      const newRow = plan.afterRows[plan.insertedIndex ?? 0];
      const invalid = validateFlexStopTimeRow(
        newRow as unknown as Record<string, unknown>
      );
      if (invalid) {
        this.showTimeError(trip_id, ref.id, invalid);
        return;
      }

      const label = `Add ${ref.kind} ${ref.id} to trip ${trip_id}`;
      // Clear the pending row before the patch is recorded: the patch event
      // drives the re-render, which must already show the row as real.
      this.clearPendingRowIfMatches(ref);

      const wrote = await this.commitStopTimePlan(plan, label);
      if (!wrote) {
        console.log(`No stop_time change for ${trip_id}/${ref.id}`);
        return;
      }
      console.log(`[ScheduleController] ${label}`);
      notify.success('Added on-demand row to trip', { duration: 2000 });
    } catch (error) {
      console.error('Failed to create on-demand stop_time:', error);
      this.showTimeError(trip_id, ref.id, 'Failed to save on-demand row');
    }
  }

  /**
   * Create the on-demand stop_time for a trip that does not yet serve a zone
   * row the route already has.
   *
   * The sibling of `insertFlexStopTime`: that one is for a ref no trip on the
   * route uses at all (the pending row), this one is for the empty cells in a
   * row that already exists. The new record lands where the supersequence says
   * rather than at the end of the trip, and inherits the row's
   * pickup/drop-off types and booking rules from whichever trip already has a
   * record at this position - the four fields the user would otherwise have to
   * retype. The window is never inherited: a differing window per trip is the
   * reason the route has several trips.
   *
   * @param trip_id - Trip gaining the record
   * @param ref - The zone or location group the row references
   * @param stopIndex - The row's supersequence position
   * @param newTime - The window value the user typed
   */
  private async insertFlexStopTimeOnTrip(
    trip_id: string,
    ref: StopTimeRef,
    stopIndex: number,
    newTime: string
  ): Promise<void> {
    const data = this.currentTimetableData();
    if (!data) {
      console.warn(
        `[ScheduleController] no timetable data in hand for a flex insert on ${trip_id}`
      );
      return;
    }

    const inherited = this.inheritedFlexShape(data, stopIndex, trip_id);
    try {
      const casted = TimeFormatter.castTimeToHHMMSS(newTime);
      const plan = await this.database.planFlexStopTimeInsert(
        trip_id,
        ref,
        casted,
        this.tripInsertIndex(data, trip_id, stopIndex),
        inherited?.shape
      );
      const newRow = plan.afterRows[plan.insertedIndex ?? 0];
      const invalid = validateFlexStopTimeRow(
        newRow as unknown as Record<string, unknown>
      );
      if (invalid) {
        this.showTimeError(trip_id, ref.id, invalid);
        return;
      }

      const label = `Add ${ref.kind} ${ref.id} to trip ${trip_id}`;
      const wrote = await this.commitStopTimePlan(plan, label);
      if (!wrote) {
        console.log(`No stop_time change for ${trip_id}/${ref.id}`);
        return;
      }
      console.log(`[ScheduleController] ${label}`);

      // Four fields written from one keystroke has to be visible without
      // opening the Changes panel.
      notify.success(
        inherited
          ? `Added ${ref.id} to trip ${trip_id} (pickup ${inherited.shape.pickup_type}, drop-off ${inherited.shape.drop_off_type} copied from ${inherited.from})`
          : `Added ${ref.id} to trip ${trip_id}`,
        { duration: 4000 }
      );
    } catch (error) {
      console.error('Failed to create on-demand stop_time:', error);
      this.showTimeError(trip_id, ref.id, 'Failed to save on-demand row');
    }
  }

  /**
   * Whether clearing `timeType` would leave the row with nothing that makes it
   * a served row: no arrival, no departure and no pickup/drop-off window. Such
   * a row cannot be told apart from an unserved cell in the grid, so the caller
   * removes it instead of writing it.
   *
   * @param trip_id - GTFS trip identifier
   * @param stopSequence - stop_sequence of the row being cleared
   * @param timeType - Which time field is being cleared
   */
  private async clearsWholeRow(
    trip_id: string,
    stopSequence: string,
    timeType: 'arrival' | 'departure'
  ): Promise<boolean> {
    const row = await this.database.getStopTime(trip_id, stopSequence);
    if (!row) {
      return false;
    }
    const other =
      timeType === 'arrival' ? row.departure_time : row.arrival_time;
    return (
      !other &&
      !row.start_pickup_drop_off_window &&
      !row.end_pickup_drop_off_window
    );
  }

  /**
   * Delete one stop_time and renumber the trip, as a single patch.
   *
   * @param trip_id - GTFS trip identifier
   * @param stopSequence - stop_sequence of the row to remove
   * @param rowId - The row's ref id, for error reporting
   */
  private async deleteStopTimeRow(
    trip_id: string,
    stopSequence: string,
    rowId: string
  ): Promise<void> {
    try {
      const plan = await this.database.planStopTimeDelete(
        trip_id,
        stopSequence
      );
      if (!plan) {
        console.warn(
          `[ScheduleController] no stop_time for ${trip_id} at stop_sequence ${stopSequence} to delete`
        );
        return;
      }
      const label = `Remove ${rowId} from trip ${trip_id}`;
      const wrote = await this.commitStopTimePlan(plan, label);
      if (!wrote) {
        return;
      }
      console.log(`[ScheduleController] ${label}`);
      notify.success(`Removed ${rowId} from trip ${trip_id}`, {
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to delete stop_time:', error);
      this.showTimeError(trip_id, rowId, 'Failed to remove row from trip');
    }
  }

  // ===== FREQUENCIES BAND =====

  /** The trip's headway periods, straight from the parsed table. */
  private tripFrequencyRows(trip_id: string): Record<string, unknown>[] {
    return this.gtfsParser
      .getFileDataSyncTyped<Record<string, unknown>>(GTFS_TABLES.FREQUENCIES)
      .filter((row) => String(row.trip_id ?? '') === trip_id);
  }

  /**
   * Swap a frequency band span for its editor, the same click-to-edit contract
   * the trip property rows use.
   */
  private openFrequencyEditor(span: HTMLElement): void {
    const { tripId, startTime, field, fieldKind, value } = span.dataset;
    if (!tripId || startTime === undefined || !field) {
      return;
    }

    if (fieldKind === 'enum') {
      openInlineMenu(span, {
        currentValue: value ?? '',
        options: [
          { value: '', label: '- (empty, same as 0)' },
          ...(getEnumOptions('exact_times') ?? []).map((opt) => ({
            value: String(opt.value),
            label: `${opt.value} - ${opt.label}`,
          })),
        ],
        onPick: (newValue) => {
          void this.updateFrequencyField(tripId, startTime, field, newValue);
        },
      });
      return;
    }

    openInlineEditor(span, {
      value: value ?? '',
      inputType: fieldKind === 'number' ? 'number' : 'text',
      className: 'w-full text-center font-mono',
      placeholder: fieldKind === 'time' ? '--:--:--' : '',
      title:
        fieldKind === 'time'
          ? 'Enter a time, e.g. 9:30 or 09:30:00'
          : 'Seconds between departures',
      onCommit: (newValue) => {
        void this.updateFrequencyField(tripId, startTime, field, newValue);
      },
    });
  }

  /**
   * Write one field of one headway period.
   *
   * `start_time` is half of the composite primary key, so editing it re-keys
   * the record: that path is a delete plus an insert recorded as one mixed
   * batch, deletes first. `patchUpdate` looks like it works there - the virtual
   * table re-keys `byId` in place, so the forward edit lands - but the patch's
   * `source.id` is then the stale old key and its inverse silently drops on
   * undo.
   */
  private async updateFrequencyField(
    trip_id: string,
    startTime: string,
    field: string,
    rawValue: string
  ): Promise<void> {
    const rows = this.tripFrequencyRows(trip_id);
    const row = rows.find((r) => String(r.start_time ?? '') === startTime);
    if (!row) {
      console.warn(
        `[ScheduleController] no frequency for ${trip_id} starting ${startTime}`
      );
      return;
    }
    const siblings = rows.filter((r) => r !== row);

    const value =
      field === 'start_time' || field === 'end_time'
        ? rawValue.trim()
          ? TimeFormatter.castTimeToHHMMSS(rawValue)
          : ''
        : rawValue.trim();
    const current = String(row[field] ?? '');
    if (current === value) {
      return;
    }

    const after = { ...row, [field]: value };
    const invalid = validateFrequencyRow(after, siblings);
    if (invalid) {
      notify.error(invalid, { duration: 5000 });
      return;
    }

    try {
      const oldKey = frequencyPeriodKey(row);
      if (field !== 'start_time') {
        await patchUpdate(
          this.gtfsParser.gtfsDatabase,
          this.patchManager,
          'frequencies',
          oldKey,
          { [field]: row[field] ?? null },
          { [field]: value }
        );
      } else {
        const newKey = frequencyPeriodKey(after);
        await this.gtfsParser.gtfsDatabase.deleteRow('frequencies', oldKey);
        await this.gtfsParser.gtfsDatabase.insertRows('frequencies', [after]);
        this.invalidateCaches();
        await this.patchManager?.recordBatchMixed(
          [
            { op: 'delete', table: 'frequencies', id: oldKey, record: row },
            { op: 'insert', table: 'frequencies', id: newKey, record: after },
          ],
          `Move headway period of ${trip_id} to ${value}`
        );
      }
      console.log(
        `[ScheduleController] Set ${field} of frequency ${oldKey} to ${value || '(empty)'}`
      );
    } catch (error) {
      console.error(`Failed to update frequency ${field}:`, error);
      notify.error(`Failed to save ${field}`);
    }
  }

  /**
   * Append a headway period to a trip.
   *
   * Defaults to an hour from the trip's first departure, moved to sit after the
   * trip's last period when that would collide - a new period always has to be
   * valid on arrival, since there is no half-saved state in this band.
   */
  private async addFrequencyPeriod(trip_id: string): Promise<void> {
    const siblings = this.tripFrequencyRows(trip_id);

    const stopTimes = this.gtfsParser.getStopTimesByTripId(trip_id);
    const firstDeparture =
      stopTimes
        .slice()
        .sort(
          (a, b) =>
            parseInt(String(a.stop_sequence)) -
            parseInt(String(b.stop_sequence))
        )
        .map((st) => st.departure_time || st.arrival_time)
        .find((time) => !!time) ?? '';

    let startSecs = TimeFormatter.timeToSeconds(firstDeparture) ?? 8 * 3600;
    const collides = (from: number, to: number): boolean =>
      siblings.some((sibling) => {
        const sStart = TimeFormatter.timeToSeconds(
          String(sibling.start_time ?? '')
        );
        const sEnd = TimeFormatter.timeToSeconds(
          String(sibling.end_time ?? '')
        );
        return sStart !== null && sEnd !== null && from < sEnd && sStart < to;
      });

    if (collides(startSecs, startSecs + 3600)) {
      const lastEnd = siblings.reduce((max, sibling) => {
        const end = TimeFormatter.timeToSeconds(String(sibling.end_time ?? ''));
        return end !== null && end > max ? end : max;
      }, startSecs);
      startSecs = lastEnd;
    }

    const record: Record<string, unknown> = {
      trip_id,
      start_time: TimeFormatter.secondsToTime(startSecs),
      end_time: TimeFormatter.secondsToTime(startSecs + 3600),
      headway_secs: '600',
      exact_times: '',
    };

    const invalid = validateFrequencyRow(record, siblings);
    if (invalid) {
      notify.error(invalid, { duration: 5000 });
      return;
    }

    try {
      const key = frequencyPeriodKey(record);
      await this.gtfsParser.gtfsDatabase.insertRows('frequencies', [record]);
      this.invalidateCaches();
      await this.patchManager?.recordInsert('frequencies', key, record);
      console.log(`[ScheduleController] Added headway period ${key}`);
    } catch (error) {
      console.error('Failed to add headway period:', error);
      notify.error('Failed to add headway period');
    }
  }

  /** Remove one headway period. No confirmation: it is one undo away. */
  private async deleteFrequencyPeriod(
    trip_id: string,
    startTime: string
  ): Promise<void> {
    const row = this.tripFrequencyRows(trip_id).find(
      (r) => String(r.start_time ?? '') === startTime
    );
    if (!row) {
      console.warn(
        `[ScheduleController] no frequency for ${trip_id} starting ${startTime} to delete`
      );
      return;
    }

    try {
      const key = frequencyPeriodKey(row);
      await this.gtfsParser.gtfsDatabase.deleteRow('frequencies', key);
      this.invalidateCaches();
      await this.patchManager?.recordDelete('frequencies', key, row);
      console.log(`[ScheduleController] Removed headway period ${key}`);
    } catch (error) {
      console.error('Failed to remove headway period:', error);
      notify.error('Failed to remove headway period');
    }
  }

  /** The `TimetableData` currently on screen, if the cache still holds it. */
  private currentTimetableData(): TimetableData | undefined {
    if (
      !this.currentRouteId ||
      !this.currentServiceId ||
      this.currentDirectionId === undefined
    ) {
      return undefined;
    }
    return this.timetableDataCache.get(
      this.timetableDataCacheKey(
        this.currentRouteId,
        this.currentServiceId,
        this.currentDirectionId
      )
    );
  }

  /**
   * `tripInsertIndex` for the arrival/departure path, resolving the timetable
   * data itself. Returns undefined when the caller had no strip position or the
   * timetable is not the one in hand, which leaves planStopTimeEdit appending.
   */
  private stopTimeInsertIndex(
    trip_id: string,
    stopIndex?: number
  ): number | undefined {
    if (stopIndex === undefined || Number.isNaN(stopIndex)) {
      return undefined;
    }
    const data = this.currentTimetableData();
    if (!data) {
      console.warn(
        `[ScheduleController] no timetable data in hand to place a new stop_time on ${trip_id}`
      );
      return undefined;
    }
    return this.tripInsertIndex(data, trip_id, stopIndex);
  }

  /**
   * Where a new record for supersequence position `stopIndex` belongs in a
   * trip's own stop_sequence order: before the trip's first row that sits
   * further right on the strip.
   *
   * `positionOf` returns null for a trip whose pattern was dropped from the
   * ordering, in which case the row degrades to an append rather than throwing.
   */
  private tripInsertIndex(
    data: TimetableData,
    trip_id: string,
    stopIndex: number
  ): number {
    const rows = this.gtfsParser
      .getStopTimesByTripId(trip_id)
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const sequence = data.sequence;
    if (!sequence) {
      return rows.length;
    }
    const positions = rows.map((_, i) => sequence.positionOf(trip_id, i));
    const slot = positions.findIndex(
      (position) => position !== null && position > stopIndex
    );
    const result = slot === -1 ? rows.length : slot;

    console.log(
      `[ScheduleController] tripInsertIndex ${JSON.stringify({
        trip_id,
        stopIndex,
        stripStops: sequence.stops.map((s) => `${s.ref.id}#${s.occurrence}`),
        tripRows: rows.map((r) => `${r.stop_sequence}:${r.stop_id ?? '?'}`),
        positions,
        result,
      })}`
    );
    return result;
  }

  /**
   * The pickup/drop-off types and booking rules of the first other trip that
   * already has a record on this timetable row, or null when the row is empty
   * everywhere else.
   */
  private inheritedFlexShape(
    data: TimetableData,
    stopIndex: number,
    exclude_trip_id: string
  ): { shape: FlexRowShape; from: string } | null {
    for (const trip of data.trips) {
      if (trip.trip_id === exclude_trip_id) {
        continue;
      }
      const sibling = trip.editableStopTimes?.get(stopIndex);
      if (!sibling) {
        continue;
      }
      return {
        from: trip.trip_id,
        shape: {
          pickup_type: sibling.pickup_type ?? '2',
          drop_off_type: sibling.drop_off_type ?? '2',
          pickup_booking_rule_id: sibling.pickup_booking_rule_id ?? '',
          drop_off_booking_rule_id: sibling.drop_off_booking_rule_id ?? '',
        },
      };
    }
    return null;
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

      // The dangling-reference styling (e.g. a red shape_id) is only as fresh
      // as the last validation pass, which otherwise only reruns when the
      // home panel draws. Without this, fixing a reference from inside the
      // timetable (assign a shape, add a stop) leaves it red until something
      // else triggers a revalidation.
      refreshFeedIssuesIfStale();

      // Leaving a timetable drops the UI-only field roster: it is a choice
      // about this route and direction, not a persisted preference.
      if (
        this.currentRouteId !== route_id ||
        this.currentServiceId !== service_id
      ) {
        this.provisionalFields = [];
      }

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
      if (this.currentDirectionId !== selectedDirection) {
        this.provisionalFields = [];
      }
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
      this.currentTripCount = timetableData.trips.length;

      // A direction the user just added from the "+" tab has no trips, so
      // directionsForRoute cannot see it. Show it as an empty tab so the
      // first trip can be created there.
      if (!availableDirections.some((d) => d.id === selectedDirection)) {
        availableDirections.push({
          id: selectedDirection,
          name: `Direction ${selectedDirection}`,
          tripCount: 0,
        });
      }

      // Add direction information to timetable data
      timetableData.availableDirections = availableDirections;
      timetableData.selectedDirectionId = selectedDirection;

      // Add the pending row to the end of the stops array (UI only, not in
      // database). A zone or location group has no stops.txt row, so it gets a
      // synthetic one carrying its resolved name, exactly as
      // TimetableDataProcessor does for saved flex rows.
      // A timetable with no trips has no sequence and no graph, and the
      // renderer needs both to draw a stop row. Drop the pending row loudly
      // rather than pushing it into a body that cannot render it.
      if (this.pendingRow) {
        if (!timetableData.sequence || !timetableData.graph) {
          console.warn(
            `[ScheduleController] dropping pending ${this.pendingRow.ref.kind} ${this.pendingRow.ref.id}: timetable has no route sequence/graph`
          );
          this.pendingRow = undefined;
        } else {
          timetableData.stops.push({
            stop_id: this.pendingRow.ref.id,
            stop_name: this.pendingRow.name,
          } as Stops);
        }
      }

      return this.renderer.renderTimetableHTML(
        timetableData,
        this.pendingRow?.ref,
        this.provisionalFields
      );
    } catch (error) {
      console.error('Error rendering schedule:', error);
      return this.renderer.renderErrorHTML('Failed to generate schedule view');
    }
  }

  /**
   * Fill in whatever the caller did not name, so the timetable modal always
   * opens on a real timetable.
   *
   * Defaults are the first route that runs trips, the first service that route
   * runs, and (left to `renderSchedule`) the busiest direction. Returns null
   * when the feed has no trips at all, which is the one case the modal cannot
   * show anything for.
   */
  async resolveTimetableTarget(
    partial: Partial<TimetableTarget> = {}
  ): Promise<TimetableTarget | null> {
    const trips = this.gtfsParser.getFileDataSyncTyped<Record<string, unknown>>(
      GTFS_TABLES.TRIPS
    );
    if (!trips || trips.length === 0) {
      console.warn(
        '[ScheduleController] no trips in feed, no timetable to open'
      );
      return null;
    }

    const route_id = partial.route_id ?? String(trips[0].route_id ?? '');
    if (route_id === '') {
      return null;
    }

    // A requested service the route has no trips for is a timetable being
    // started, not a bad id: honour it as long as the feed defines the service.
    // Only a missing or unknown id falls back to what the route already runs.
    const services = this.servicesForRoute(route_id);
    const requested = partial.service_id;
    const service_id =
      requested !== undefined &&
      requested !== '' &&
      (services.includes(requested) || this.allServices().has(requested))
        ? requested
        : (services[0] ?? requested);
    if (service_id === undefined || service_id === '') {
      console.warn(
        `[ScheduleController] route ${route_id} runs no service, no timetable to open`
      );
      return null;
    }

    return {
      route_id,
      service_id,
      ...(partial.direction_id !== undefined && {
        direction_id: partial.direction_id,
      }),
    };
  }

  /**
   * Every service the feed defines, keyed by service_id.
   *
   * `calendar.txt` rows plus the service_ids that only ever appear in
   * `calendar_dates.txt`, which carry no row of their own and so map to an
   * id-only record. This is the feed's real service roster;
   * `servicesForRoute` is narrower by construction, since it reads trips.
   */
  private allServices(): Map<string, Record<string, unknown>> {
    const services = new Map<string, Record<string, unknown>>();
    const calendar =
      this.gtfsParser.getFileDataSyncTyped<Record<string, unknown>>(
        GTFS_TABLES.CALENDAR
      ) ?? [];
    for (const row of calendar) {
      const service_id = String(row.service_id ?? '');
      if (service_id !== '') {
        services.set(service_id, row);
      }
    }
    const exceptions =
      this.gtfsParser.getFileDataSyncTyped<Record<string, unknown>>(
        GTFS_TABLES.CALENDAR_DATES
      ) ?? [];
    for (const row of exceptions) {
      const service_id = String(row.service_id ?? '');
      if (service_id !== '' && !services.has(service_id)) {
        services.set(service_id, { service_id });
      }
    }
    return services;
  }

  /** Distinct service_ids this route runs, in the order trips.txt lists them. */
  private servicesForRoute(route_id: string): string[] {
    const trips =
      this.gtfsParser.getFileDataSyncTyped<Record<string, unknown>>(
        GTFS_TABLES.TRIPS
      ) ?? [];
    const seen: string[] = [];
    for (const trip of trips) {
      if (String(trip.route_id ?? '') !== route_id) {
        continue;
      }
      const service_id = String(trip.service_id ?? '');
      if (service_id !== '' && !seen.includes(service_id)) {
        seen.push(service_id);
      }
    }
    return seen;
  }

  /**
   * Repoint the timetable at another route. Service and direction reset to
   * values valid for the new route, which is what makes the three selectors
   * always name a timetable that exists.
   */
  private async openRoutePicker(): Promise<void> {
    const routes =
      this.gtfsParser.getFileDataSyncTyped<Record<string, string>>(
        GTFS_TABLES.ROUTES
      ) ?? [];
    const options: OptionPickerItem[] = routes.map((route) => {
      const display = getRouteDisplay(route);
      return {
        value: String(route.route_id ?? ''),
        primary: display.primary,
        ...(display.secondary && { secondary: display.secondary }),
      };
    });

    const picked = await showOptionPickerModal({
      title: 'Timetable route',
      options,
      searchable: true,
      ...(this.currentRouteId && { selectedValue: this.currentRouteId }),
    });
    if (picked === null || picked === '' || picked === this.currentRouteId) {
      return;
    }

    const target = await this.resolveTimetableTarget({ route_id: picked });
    if (!target) {
      notify.warning(`Route ${picked} has no trips, so it has no timetable.`);
      return;
    }
    await openTimetable(target.route_id, target.service_id);
  }

  /**
   * Repoint the timetable at another service, or create one.
   *
   * Lists every service the feed defines, not just the ones this route runs:
   * picking one the route has no trips for is how a new timetable is started,
   * and it lands on the empty "add the first trip" state. The footer action
   * covers the case where the service does not exist yet either.
   */
  private async openServicePicker(): Promise<void> {
    if (!this.currentRouteId) {
      return;
    }

    const services = this.allServices();
    const onRoute = this.servicesForRoute(this.currentRouteId);
    const onRouteSet = new Set(onRoute);
    const ordered = [
      ...onRoute,
      ...[...services.keys()].filter((id) => !onRouteSet.has(id)),
    ];

    // The day pattern is the useful label either way; whether the route runs
    // the service goes in the detail line, since that is what tells the user
    // the pick will open an empty timetable rather than an existing one.
    const options: OptionPickerItem[] = ordered.map((service_id) => {
      const row = services.get(service_id) ?? { service_id };
      const range = formatDateRange(row);
      const detail = onRouteSet.has(service_id)
        ? range
        : ['Not on this route yet', range].filter(Boolean).join(' - ');
      return {
        value: service_id,
        primary: service_id,
        secondary: formatDaysOfWeek(row),
        ...(detail !== '' && { detail }),
      };
    });

    let createNew = false;
    const picked = await showOptionPickerModal({
      title: 'Timetable service',
      options,
      searchable: true,
      footerAction: {
        label: 'New service…',
        onClick: () => {
          createNew = true;
        },
      },
      ...(this.currentServiceId && { selectedValue: this.currentServiceId }),
    });

    if (createNew) {
      const service_id = await showNewServiceModal({
        database: this.gtfsParser.gtfsDatabase,
        patchManager: this.patchManager,
      });
      if (service_id !== null) {
        await openTimetable(this.currentRouteId, service_id);
      }
      return;
    }

    if (picked === null || picked === '' || picked === this.currentServiceId) {
      return;
    }
    await openTimetable(this.currentRouteId, picked);
  }

  /**
   * Re-render the timetable in place.
   *
   * The timetable modal's only rebuild path. It subscribes this to the patch
   * events, so a recorded edit redraws through here; the callers inside this
   * controller are the UI-only states no patch covers (the pending add-stop
   * row, the provisional field roster).
   *
   * Passing a `target` repoints the timetable at another route, service or
   * direction without tearing the modal down. No-op when nothing is displayed
   * and no target names one.
   */
  async refreshCurrentTimetable(target?: TimetableTarget): Promise<void> {
    const route_id = target?.route_id ?? this.currentRouteId;
    const service_id = target?.service_id ?? this.currentServiceId;
    const direction_id = target ? target.direction_id : this.currentDirectionId;

    if (!route_id || !service_id) {
      console.log('No current timetable to refresh');
      return;
    }

    console.log('Refreshing timetable:', {
      route_id,
      service_id,
      direction_id,
    });

    // Landing on a different timetable is a fresh grid: its scroll, its open
    // editor and its selection all belong to the timetable being left.
    const isRetarget =
      route_id !== this.currentRouteId ||
      service_id !== this.currentServiceId ||
      direction_id !== this.currentDirectionId;
    if (isRetarget) {
      this.resetTimetableScroll();
      this.editingCell = null;
    } else {
      this.captureTimetableEditor();
    }

    // Use the value tracked by the scroll listener, the DOM is unreliable here
    // because the browser resets scrollLeft during every async DB await.
    const savedScrollLeft = this.timetableScrollLeft;
    const savedScrollTop = this.timetableScrollTop;

    const html = await this.renderSchedule(route_id, service_id, direction_id);

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

    this.restoreTimetableEditor();
    this.applyTimetableSelection();
  }

  /**
   * The row added from the "Add stop or zone" picker but not yet written.
   *
   * A stop, an on-demand zone or a location group: it only reaches the database
   * once the user types a time (or a window) into one of its cells.
   */
  private pendingRow?: {
    ref: StopTimeRef;
    name: string;
  };

  /**
   * Clear the pending row after its first time is entered
   * Called automatically when a time is successfully saved
   */
  private clearPendingRowIfMatches(ref: StopTimeRef): void {
    const pending = this.pendingRow?.ref;
    if (pending && pending.kind === ref.kind && pending.id === ref.id) {
      console.log(
        `Clearing pending ${ref.kind} ${ref.id} - the row has been saved`
      );
      this.pendingRow = undefined;
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

      await this.insertTrip(trimmedId);
    } catch (error) {
      console.error('Failed to create trip:', error);
      notify.error('Failed to create trip');
    }
  }

  /**
   * The entry point from the empty timetable's "Add first trip" button.
   * Focuses the "New trip ID..." input rather than creating a trip directly,
   * so the trip gets a meaningful id instead of a generated one.
   */
  public async createFirstTrip(): Promise<void> {
    const input = document.getElementById('new-trip-input');
    if (input instanceof HTMLInputElement) {
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      input.focus();
    }
  }

  /**
   * Write one trip for the current route/service/direction and record it.
   *
   * direction_id is only written when the current direction is non-empty:
   * feeds that omit it collapse to the '' direction, and writing a 0 there
   * would move the trip out of the timetable it was created from.
   *
   * @param trip_id - Trip ID to create, already trimmed
   */
  private async insertTrip(trip_id: string): Promise<void> {
    if (!this.currentRouteId || !this.currentServiceId) {
      notify.error('No timetable loaded');
      return;
    }

    const validation = await this.validateTripId(trip_id);
    if (!validation.isValid) {
      notify.error(validation.errorMessage || 'Invalid trip ID');
      return;
    }

    const tripData = {
      trip_id,
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
      trip_id,
      tripData as Record<string, unknown>
    );
    console.log('Trip saved to database:', tripData);
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
   * Add a stop, zone or location group from the "Add stop or zone" picker.
   *
   * The row is only "pending": it reaches the database when the user types a
   * time (a stop) or a window (a zone or location group) into one of its cells.
   *
   * @param value - Picked option value, in `kind:id` form
   */
  public async addRefFromSelector(value: string): Promise<void> {
    const separator = value.indexOf(':');
    if (separator === -1) {
      console.warn(`[ScheduleController] unparseable picker value: ${value}`);
      return;
    }
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (
      !id ||
      (kind !== 'stop' && kind !== 'location' && kind !== 'location_group')
    ) {
      console.warn(`[ScheduleController] unparseable picker value: ${value}`);
      return;
    }
    const ref: StopTimeRef = { kind, id };

    try {
      if (!this.currentRouteId || !this.currentServiceId) {
        console.error('No current timetable to add a row to');
        return;
      }

      const name = await this.refDisplayName(ref);
      if (name === null) {
        notify.error(`${kind === 'stop' ? 'Stop' : 'Reference'} not found`);
        return;
      }

      // NOT saved to the database yet
      this.pendingRow = { ref, name };
      console.log(
        `[ScheduleController] pending ${ref.kind} ${ref.id}: ${name}`
      );

      notify.success(
        ref.kind === 'stop'
          ? 'Stop added. Enter a time for at least one trip to save.'
          : 'Row added. Enter a pickup window for at least one trip to save.'
      );

      // Refresh the timetable to show the new pending row
      await this.refreshCurrentTimetable();
    } catch (error) {
      console.error('Failed to add row to timetable:', error);
      notify.error('Failed to add row to timetable');
    }
  }

  /** The label for a picked ref, or null when it no longer exists. */
  private async refDisplayName(ref: StopTimeRef): Promise<string | null> {
    if (ref.kind === 'stop') {
      const stops = await this.gtfsParser.gtfsDatabase.queryRows('stops', {
        stop_id: ref.id,
      });
      if (stops.length === 0) {
        return null;
      }
      return stops[0].stop_name || stops[0].stop_id;
    }

    if (ref.kind === 'location') {
      const feature = getZoneFeatures(this.gtfsParser).find(
        (f) => String(f.id) === ref.id
      );
      return feature ? zoneName(feature) || ref.id : null;
    }

    const group = this.gtfsParser
      .getFileDataSyncTyped<LocationGroups>(GTFS_TABLES.LOCATION_GROUPS)
      .find((g) => String(g.location_group_id ?? '') === ref.id);
    return group ? String(group.location_group_name || ref.id) : null;
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

  /**
   * Sort one trip's stop_times into chronological order, on request.
   *
   * Edits never move a row on their own: stop_sequence order is what numbers a
   * strip element's occurrence, so re-sorting can change which column every row
   * of the trip belongs to, and a trip left disagreeing with its siblings about
   * stop order leaves the route with no valid supersequence. Doing it only when
   * asked keeps that a visible, undoable step the user can look at.
   *
   * @param trip_id - Trip to sort
   */
  public async resortTrip(trip_id: string): Promise<void> {
    try {
      const plan = await this.database.planTripResort(trip_id);
      if (!plan) {
        notify.info(`Trip ${trip_id} is already in time order`, {
          duration: 2000,
        });
        return;
      }

      const label = `Sort trip ${trip_id} by time`;
      const wrote = await this.commitStopTimePlan(plan, label);
      if (!wrote) {
        console.log(`No stop_time change sorting ${trip_id}`);
        return;
      }
      console.log(`[ScheduleController] ${label}`);
      notify.success(
        `Sorted trip ${trip_id} by time (${plan.moved?.length ?? 0} rows moved)`,
        { duration: 3000 }
      );
    } catch (error) {
      console.error('Failed to sort trip by time:', error);
      notify.error(`Failed to sort trip ${trip_id}`);
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
