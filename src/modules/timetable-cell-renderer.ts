/**
 * Timetable Cell Renderer Module
 * Handles HTML generation for individual stop_time cells
 */

import { TimeFormatter } from '../utils/time-formatter.js';
import { EditableStopTime } from './timetable-data-processor.js';
import type { StopTimeRef } from '../types/gtfs-flex.js';
import { escapeHtml } from '../utils/escape-html.js';
import { getEnumOptions } from '../types/gtfs-enums.js';
import {
  FlagSlot,
  StopTimeFieldMode,
  stopTimeFieldKind,
  stopTimeFlagSlots,
  TIME_FIELDS,
  WINDOW_FIELDS,
} from './timetable-fields.js';
import { renderFlagGlyph } from './flag-icons.js';
import { FieldPresence, stopTimeFieldPresence } from '../utils/flex-rules.js';
import { formatIssueValue, isDanglingReference } from './feed-issues.js';

/** Everything one cell needs to render its stack of sub-rows. */
export interface StopTimeCellParams {
  trip_id: string;
  stop_id: string;
  /** Position in the supersequence, the row's real key */
  stopIndex: number;
  /** The roster of visible fields, in spec order, for the whole table */
  fields: readonly string[];
  mode: StopTimeFieldMode;
  /** The trip's stop_time at this row, when it has one */
  editableStopTime?: EditableStopTime;
  /** Row is the not-yet-saved add-stop preview */
  isPendingRow: boolean;
  /** The pending row references a zone or location group */
  isPendingFlex: boolean;
  /** What the whole row references, whether or not this trip serves it */
  rowRef?: StopTimeRef;
  /**
   * The trip's first departure, set only on a frequency-based trip. Every time
   * sub-row then carries its offset from it in the tooltip: in headway service
   * the stored times are a template and only the offsets carry meaning.
   */
  frequencyOrigin: string | null;
  /** This row is the trip's first stop_sequence: arrival_time is required. */
  isFirstStop: boolean;
  /** This row is the trip's last stop_sequence: arrival_time is required. */
  isLastStop: boolean;
}

/** Which stop_times field a row ref lands in, for the presence rules. */
const REF_FIELD: Record<StopTimeRef['kind'], string> = {
  stop: 'stop_id',
  location_group: 'location_group_id',
  location: 'location_id',
};

/**
 * The stop_times row the presence rules judge, rebuilt from the cell's record.
 *
 * `EditableStopTime` splits the row's reference out into `ref`, but the rules
 * read `location_group_id` / `location_id` off the row itself, so the ref has
 * to be folded back in.
 */
function presenceRow(record: EditableStopTime): Record<string, unknown> {
  const row: Record<string, unknown> = { ...record };
  delete row.ref;
  row[REF_FIELD[record.ref.kind]] = record.ref.id;
  return row;
}

/** The offset of `time` from the trip's first departure, as `+MM:SS`. */
function offsetLabel(time: string, origin: string): string | null {
  const at = TimeFormatter.timeToSeconds(time);
  const from = TimeFormatter.timeToSeconds(origin);
  if (at === null || from === null) {
    return null;
  }
  const delta = at - from;
  const sign = delta < 0 ? '-' : '+';
  const abs = Math.abs(delta);
  const mm = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return `${sign}${mm}:${ss} from first departure`;
}

/**
 * Timetable Cell Renderer - HTML generation for individual stop_time cells
 *
 * A cell is a vertical stack of labeled sub-rows, one `<span class="time-span">`
 * per visible stop_times field. The roster is the same for every cell in the
 * table (see visibleStopTimeFields), which is what keeps the grid rectangular
 * for keyboard navigation - the one exception is compact mode, where a windowed
 * row swaps its two time sub-rows for the two window fields, keeping the count.
 *
 * Editing is handled entirely by ScheduleController's delegated click handler,
 * which swaps a span for a live editor on click - see installTimetablePickers.
 *
 * Every span renders with `tabindex="-1"`. ScheduleController promotes exactly
 * one of them to `tabindex="0"` after each render (see applyTimetableSelection),
 * so Tab enters the grid at a single cell instead of walking all few thousand.
 */
export class TimetableCellRenderer {
  /**
   * Render one trip's cell at one row of the timetable.
   *
   * The row's ref decides the cell shape, not this trip's stop_time: a zone row
   * is a zone row on every trip, including the trips that do not serve it.
   * Routing on the saved stop_time instead is what used to render a zone's
   * unserved cells as arrival/departure spans and let a keystroke write a
   * stop_time with a zone id in stop_id.
   *
   * A flex ref's spans carry `data-flex-kind`/`data-flex-id` and deliberately
   * *no* `data-stop-id`. The row's synthetic stop carries the ref id as its
   * `stop_id`, so emitting it here would feed the arrival/departure insert path
   * a zone id as a `stops.txt` foreign key.
   */
  public renderStopTimeCell(params: StopTimeCellParams): string {
    const {
      trip_id,
      stop_id,
      stopIndex,
      mode,
      editableStopTime,
      isPendingRow,
      isPendingFlex,
      rowRef,
      frequencyOrigin,
      isFirstStop,
      isLastStop,
    } = params;

    const record = editableStopTime ?? null;
    // Advisory decoration only: validateFlexStopTimeRow is still the gate that
    // decides whether an edit commits. A cell with no record has no row to
    // judge, and its non-time sub-rows are already non-editable.
    const presence = record
      ? stopTimeFieldPresence(presenceRow(record), {
          isFirst: isFirstStop,
          isLast: isLastStop,
        })
      : new Map<string, FieldPresence>();
    const isFlexRow =
      (rowRef !== undefined && rowRef.kind !== 'stop') ||
      record?.isFlex === true ||
      isPendingFlex;
    const isWindowed =
      isFlexRow ||
      !!record?.start_pickup_drop_off_window ||
      !!record?.end_pickup_drop_off_window;

    // Compact shows two sub-rows on every cell: the window pair on a windowed
    // row, arrival/departure otherwise. Used and All show the full roster, so
    // both pairs are present and no swap is needed.
    const fields =
      mode === 'compact'
        ? isWindowed
          ? WINDOW_FIELDS
          : TIME_FIELDS
        : params.fields;

    const isStopRef = rowRef === undefined || rowRef.kind === 'stop';
    const refAttrs = isStopRef
      ? `data-stop-id="${escapeHtml(stop_id)}"`
      : `data-flex-kind="${escapeHtml(rowRef.kind)}" data-flex-id="${escapeHtml(rowRef.id)}"`;
    const stopSequence = record?.stop_sequence ?? '';

    const spans = fields
      .map((field) =>
        this.renderFieldSpan({
          field,
          trip_id,
          stopIndex,
          refAttrs,
          stopSequence,
          record,
          isPendingRow,
          isWindowed,
          frequencyOrigin,
          presence: presence.get(field),
        })
      )
      .join('');

    // A flex row legitimately has no arrival or departure and is not a skipped
    // stop, so it must never take the `no-time` path.
    const isSkipped =
      !isWindowed && !record?.arrival_time && !record?.departure_time;
    const cellClass = [
      'time-cell align-top p-2 text-center',
      isWindowed ? 'flex-window-cell' : isSkipped ? 'no-time' : 'has-time',
    ].join(' ');

    // Compact mode is the default, so it has to answer "is there more here?"
    // without expanding: nine fixed slots, one per non-time field.
    const flagRow =
      mode === 'compact'
        ? this.renderFlagRow({
            trip_id,
            stopIndex,
            refAttrs,
            stopSequence,
            record,
            isWindowed,
            presence,
          })
        : '';

    return `
      <td class="${cellClass}">
        <div class="stacked-time-container">${spans}${flagRow}</div>
      </td>
    `;
  }

  /**
   * The compact cell's flag row: nine slots in four clusters, in a fixed order
   * so a column of cells reads vertically slot by slot.
   *
   * The slots are `tabindex="-1"` buttons and carry no `.time-span` class, so
   * they stay out of `timeCellRows` and out of the roving-tabindex grid: they
   * are mouse-only by design, and a keyboard user switches to Used or All mode
   * where every one of these fields is a real grid cell.
   */
  private renderFlagRow(args: {
    trip_id: string;
    stopIndex: number;
    refAttrs: string;
    stopSequence: string;
    record: EditableStopTime | null;
    isWindowed: boolean;
    presence: Map<string, FieldPresence>;
  }): string {
    const {
      trip_id,
      stopIndex,
      refAttrs,
      stopSequence,
      record,
      isWindowed,
      presence,
    } = args;

    const slots = stopTimeFlagSlots(
      record ? presenceRow(record) : null,
      presence
    );
    const cells = slots
      .map((slot) => {
        const html = this.renderFlagSlot({
          slot,
          trip_id,
          stopIndex,
          refAttrs,
          stopSequence,
          hasRecord: record !== null,
          isWindowed,
          presence: presence.get(slot.field),
        });
        return slot.endsCluster
          ? `${html}<span class="inline-block w-px h-3 bg-base-300 mx-0.5"></span>`
          : html;
      })
      .join('');

    return `<div class="flag-row flex items-center justify-center gap-px h-4">${cells}</div>`;
  }

  /** One flag slot: a glyph the click handler opens this field's editor on. */
  private renderFlagSlot(args: {
    slot: FlagSlot;
    trip_id: string;
    stopIndex: number;
    refAttrs: string;
    stopSequence: string;
    hasRecord: boolean;
    isWindowed: boolean;
    presence?: FieldPresence;
  }): string {
    const {
      slot,
      trip_id,
      stopIndex,
      refAttrs,
      stopSequence,
      hasRecord,
      isWindowed,
      presence,
    } = args;

    // Same rule as the sub-rows: only a time edit may create a stop_time, and a
    // field the spec forbids here is inert unless it already holds a value.
    const forbiddenEmpty = presence?.state === 'forbidden' && slot.value === '';
    const editable = hasRecord && !forbiddenEmpty;

    const dangling =
      stopTimeFieldKind(slot.field) === 'booking_rule' &&
      isDanglingReference('stop_times.txt', slot.field, slot.value);

    const titleParts = [slot.tooltip];
    if (dangling) {
      titleParts.push(
        `No record with ${slot.field} ${formatIssueValue(slot.value)} exists`
      );
    }
    if (!hasRecord) {
      titleParts.push('no stop_time on this trip yet');
    }

    const classes = [
      'flag-slot inline-flex items-center justify-center w-3 h-3 shrink-0 rounded-sm',
      slot.tone === 'error' || dangling
        ? 'text-error'
        : slot.tone === 'muted'
          ? 'opacity-30'
          : 'text-base-content',
      editable
        ? 'cursor-pointer hover:bg-base-200'
        : 'opacity-30 cursor-default pointer-events-none',
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <button
        type="button"
        class="${classes}"
        tabindex="-1"
        data-trip-id="${escapeHtml(trip_id)}"
        ${refAttrs}
        data-stop-index="${stopIndex}"
        data-field="${escapeHtml(slot.field)}"
        data-field-kind="${stopTimeFieldKind(slot.field)}"
        data-stop-sequence="${escapeHtml(stopSequence)}"
        data-value="${escapeHtml(slot.value)}"
        data-windowed="${isWindowed}"
        ${editable ? '' : 'data-disabled="true"'}
        title="${escapeHtml(titleParts.join(' - '))}"
      >${renderFlagGlyph(slot.glyph)}</button>
    `;
  }

  /** One field's sub-row: a display span the click handler swaps for an editor. */
  private renderFieldSpan(args: {
    field: string;
    trip_id: string;
    stopIndex: number;
    refAttrs: string;
    stopSequence: string;
    record: EditableStopTime | null;
    isPendingRow: boolean;
    isWindowed: boolean;
    frequencyOrigin: string | null;
    presence?: FieldPresence;
  }): string {
    const {
      field,
      trip_id,
      stopIndex,
      refAttrs,
      stopSequence,
      record,
      isPendingRow,
      isWindowed,
      frequencyOrigin,
      presence,
    } = args;

    const kind = stopTimeFieldKind(field);
    const raw = record
      ? ((record as unknown as Record<string, unknown>)[field] ?? null)
      : null;
    const value = raw === null || raw === undefined ? '' : String(raw);

    // A value the spec forbids here stays editable, so it can be cleared from
    // the grid. Only an empty forbidden field is inert: there is nothing to fix
    // and offering an editor would invite writing a violation.
    const forbiddenEmpty = presence?.state === 'forbidden' && value === '';

    // Only a time edit may create a stop_time: every other field is an edit to
    // an existing record, and there is nothing to address it to without one.
    const editable = (record !== null || kind === 'time') && !forbiddenEmpty;

    const dangling =
      kind === 'booking_rule' &&
      isDanglingReference('stop_times.txt', field, value);

    const titleParts = [field];
    if (kind === 'time' && value && frequencyOrigin) {
      const offset = offsetLabel(value, frequencyOrigin);
      if (offset) {
        titleParts.push(offset);
      }
    }
    if (presence?.reason) {
      titleParts.push(presence.reason);
    }
    if (dangling) {
      titleParts.push(
        `No record with ${field} ${formatIssueValue(value)} exists`
      );
    }
    if (!editable && !forbiddenEmpty) {
      titleParts.push('no stop_time on this trip yet');
    }

    const classes = [
      'time-span block font-mono text-xs h-6 leading-6 truncate rounded px-1',
      kind === 'time' && isWindowed ? 'text-info' : '',
      // A forbidden value and a dangling reference read the same way: an error
      // that is still editable, exactly as renderPropertyCell shows one.
      (presence?.state === 'forbidden' && value !== '') || dangling
        ? 'text-error font-semibold'
        : '',
      presence?.state === 'required' ? 'text-warning' : '',
      forbiddenEmpty
        ? 'opacity-40 cursor-not-allowed pointer-events-none'
        : editable
          ? 'cursor-pointer hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary'
          : 'opacity-40 cursor-default',
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <span
        class="${classes}"
        role="gridcell"
        tabindex="-1"
        data-trip-id="${escapeHtml(trip_id)}"
        ${refAttrs}
        data-stop-index="${stopIndex}"
        data-field="${escapeHtml(field)}"
        data-field-kind="${kind}"
        data-stop-sequence="${escapeHtml(stopSequence)}"
        data-value="${escapeHtml(value)}"
        data-pending="${isPendingRow}"
        data-windowed="${isWindowed}"
        ${editable ? '' : 'data-disabled="true"'}
        title="${escapeHtml(titleParts.join(' - '))}"
      >${escapeHtml(this.displayValue(field, kind, value))}</span>
    `;
  }

  /**
   * What a sub-row shows: times formatted with seconds, enums as
   * `value - Short Label`, everything else raw. Empty renders as `-`, except a
   * time, which keeps the `--:--:--` placeholder the grid has always used.
   */
  private displayValue(field: string, kind: string, value: string): string {
    if (kind === 'time') {
      return value ? TimeFormatter.formatTimeWithSeconds(value) : '--:--:--';
    }
    if (value === '') {
      return '-';
    }
    if (kind === 'enum') {
      const option = (getEnumOptions(field) ?? []).find(
        (opt) => String(opt.value) === value
      );
      return option ? `${value} - ${option.label}` : value;
    }
    return value;
  }
}
