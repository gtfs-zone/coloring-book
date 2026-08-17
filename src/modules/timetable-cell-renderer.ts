/**
 * Timetable Cell Renderer Module
 * Handles HTML generation for individual stop_time cells
 */

import { TimeFormatter } from '../utils/time-formatter.js';
import { EditableStopTime } from './timetable-data-processor.js';
import type { StopTimeRef } from '../types/gtfs-flex.js';
import { escapeHtml } from '../utils/escape-html.js';
import { getEnumOptions } from '../types/gtfs-enums.js';
import { stopTimeFieldKind } from './timetable-fields.js';
import { FieldPresence, stopTimeFieldPresence } from '../utils/flex-rules.js';
import { formatIssueValue, isDanglingReference } from './feed-issues.js';
import { tooltipContentAttr } from '../utils/field-component.js';
import { renderPickerTrigger } from '../utils/picker-trigger.js';

/** Everything one cell needs to render its stack of sub-rows. */
export interface StopTimeCellParams {
  trip_id: string;
  stop_id: string;
  /** Position in the supersequence, the row's real key */
  stopIndex: number;
  /** The roster of visible fields, in spec order, for the whole table */
  fields: readonly string[];
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
 * for keyboard navigation: a windowed row and a scheduled row share a column,
 * so both pairs of time fields are in the roster whenever either is used.
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

    const isStopRef = rowRef === undefined || rowRef.kind === 'stop';
    const refAttrs = isStopRef
      ? `data-stop-id="${escapeHtml(stop_id)}"`
      : `data-flex-kind="${escapeHtml(rowRef.kind)}" data-flex-id="${escapeHtml(rowRef.id)}"`;
    const stopSequence = record?.stop_sequence ?? '';

    const spans = params.fields
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
      'time-cell group align-top p-2 text-center',
      isWindowed ? 'flex-window-cell' : isSkipped ? 'no-time' : 'has-time',
    ].join(' ');

    // The roster is table-wide, so a field the user wants to edit here is added
    // to every cell. Hidden until the cell is hovered or focused, or the grid
    // would be littered with plus signs.
    const addFieldTip =
      '<div>Show another <code>stop_times.txt</code> field</div>' +
      '<div class="opacity-70">Picks a field to add as a sub-row of every cell in this table. It is not written to the feed until a value is typed, and it is dropped on leaving the timetable.</div>';
    const addField = `
      <button
        type="button"
        class="add-field-btn field-tooltip-trigger btn btn-ghost btn-xs h-4 min-h-0 w-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        data-trip-id="${escapeHtml(trip_id)}"
        data-stop-index="${stopIndex}"
        ${tooltipContentAttr(addFieldTip)}
      >+</button>
    `;

    return `
      <td class="${cellClass}">
        <div class="stacked-time-container">${spans}${addField}</div>
      </td>
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

    // A booking rule is picked from a modal, so its sub-row wears the shared
    // trigger shape. Only when it is editable: a chevron on an inert cell
    // promises a picker that will not open.
    const isPicker = kind === 'booking_rule' && editable;

    const classes = [
      `time-span font-mono text-xs h-6 leading-6 rounded px-1 ${isPicker ? 'w-full' : 'block truncate'}`,
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

    const attrs = `
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
        title="${escapeHtml(titleParts.join(' - '))}"`;
    const display = escapeHtml(this.displayValue(field, kind, value));

    if (isPicker) {
      return renderPickerTrigger({
        content: display,
        variant: 'bare',
        className: classes,
        attrs,
      });
    }

    return `<span class="${classes}" ${attrs}>${display}</span>`;
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
