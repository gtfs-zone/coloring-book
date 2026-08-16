/**
 * Timetable Cell Renderer Module
 * Handles HTML generation for individual time cells
 */

import { TimeFormatter } from '../utils/time-formatter.js';
import { EditableStopTime } from './timetable-data-processor.js';
import type { StopTimeRef } from '../types/gtfs-flex.js';
import { escapeHtml } from '../utils/escape-html.js';

/**
 * Timetable Cell Renderer - HTML generation for individual time cells
 *
 * Renders a stop/trip time cell as two plain `<span>`s (arrival, departure).
 * Editing is handled entirely by ScheduleController's delegated click handler,
 * which swaps a span for a live `<input>` on click - see installTimeCellEditor.
 *
 * Every span renders with `tabindex="-1"`. ScheduleController promotes exactly
 * one of them to `tabindex="0"` after each render (see applyTimetableSelection),
 * so Tab enters the grid at a single cell instead of walking all few thousand.
 */
export class TimetableCellRenderer {
  /**
   * Render a stop/trip time cell as arrival and departure spans.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param stopIndex - Position in the supersequence, the row's real key
   * @param arrival_time - Arrival time string or null
   * @param departure_time - Departure time string or null
   * @param editableStopTime - Optional editable stop time data (supplies stop_sequence)
   * @param isPendingRow - Row is the not-yet-saved add-stop preview
   * @param isPendingFlex - The pending row references a zone or location group
   * @param rowRef - What the whole row references, whether or not this trip serves it
   * @returns HTML string for the complete time cell
   */
  public renderStackedArrivalDepartureCell(
    trip_id: string,
    stop_id: string,
    stopIndex: number,
    arrival_time: string | null,
    departure_time: string | null,
    editableStopTime?: EditableStopTime,
    isPendingRow = false,
    isPendingFlex = false,
    rowRef?: StopTimeRef
  ): string {
    // The row's ref decides the cell shape, not this trip's stop_time: a zone
    // row is a zone row on every trip, including the trips that do not serve it.
    // Routing on the saved stop_time instead is what used to render a zone's
    // unserved cells as arrival/departure spans and let a keystroke write a
    // stop_time with a zone id in stop_id.
    const isFlexRow =
      (rowRef !== undefined && rowRef.kind !== 'stop') ||
      editableStopTime?.isFlex === true ||
      isPendingFlex;
    if (isFlexRow) {
      return this.renderFlexWindowCell(
        trip_id,
        stop_id,
        stopIndex,
        editableStopTime ?? null,
        isPendingRow,
        rowRef ?? editableStopTime?.ref
      );
    }

    const arrivalDisplay = arrival_time
      ? TimeFormatter.formatTimeWithSeconds(arrival_time)
      : '';
    const departureDisplay = departure_time
      ? TimeFormatter.formatTimeWithSeconds(departure_time)
      : '';

    const isSkipped = !arrival_time && !departure_time;
    const cellClass = `time-cell p-2 text-center ${
      isSkipped ? 'no-time' : 'has-time'
    }`;
    const stopSequence = editableStopTime?.stop_sequence ?? '';

    const renderSpan = (
      timeType: 'arrival' | 'departure',
      display: string
    ): string => `
        <span
          class="time-span block font-mono text-xs cursor-pointer rounded px-1 hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
          role="gridcell"
          tabindex="-1"
          data-trip-id="${trip_id}"
          data-stop-id="${stop_id}"
          data-stop-index="${stopIndex}"
          data-time-type="${timeType}"
          data-stop-sequence="${stopSequence}"
          data-pending="${isPendingRow}"
        >${display || '--:--:--'}</span>
    `;

    return `
      <td class="${cellClass}">
        <div class="stacked-time-container space-y-1">
          ${renderSpan('arrival', arrivalDisplay)}
          ${renderSpan('departure', departureDisplay)}
        </div>
      </td>
    `;
  }

  /**
   * Render an on-demand (GTFS Flex) cell: the pickup/drop-off window in place
   * of arrival and departure.
   *
   * Deliberately keeps the `.time-span` class and the same two-span shape as a
   * timed cell so grid navigation and the roving tabindex keep working - only
   * `data-time-type` distinguishes it, which is what routes the editor to the
   * window fields instead of arrival/departure. It must never take the
   * `no-time` (skipped) path: a flex row legitimately has no arrival or
   * departure and is not a skipped stop.
   *
   * A cell with no stop_time behind it - either the pending row, or a trip that
   * simply does not serve this row's zone - renders the same two empty window
   * spans with an empty `data-stop-sequence` and no badges: there is no record
   * to address a type or booking-rule edit to. Typing in one creates the
   * record; that is the only way a zone row gets filled in for a second trip.
   *
   * A flex ref's spans carry `data-flex-kind`/`data-flex-id` and deliberately
   * *no* `data-stop-id`. The row's synthetic stop carries the ref id as its
   * `stop_id`, so emitting it here would feed the arrival/departure insert path
   * a zone id as a `stops.txt` foreign key.
   */
  private renderFlexWindowCell(
    trip_id: string,
    stop_id: string,
    stopIndex: number,
    editableStopTime: EditableStopTime | null,
    isPendingRow: boolean,
    rowRef?: StopTimeRef
  ): string {
    const stopSequence = editableStopTime?.stop_sequence ?? '';
    const hasRecord = editableStopTime !== null;
    const isStopRef = rowRef === undefined || rowRef.kind === 'stop';
    const refAttrs = isStopRef
      ? `data-stop-id="${escapeHtml(stop_id)}"`
      : `data-flex-kind="${escapeHtml(rowRef.kind)}" data-flex-id="${escapeHtml(rowRef.id)}"`;

    const renderSpan = (
      timeType: 'window-start' | 'window-end',
      raw: string | null
    ): string => {
      const display = raw ? TimeFormatter.formatTimeWithSeconds(raw) : '';
      return `
        <span
          class="time-span flex-window block font-mono text-xs text-info cursor-pointer rounded px-1 hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
          role="gridcell"
          tabindex="-1"
          data-trip-id="${escapeHtml(trip_id)}"
          ${refAttrs}
          data-stop-index="${stopIndex}"
          data-time-type="${timeType}"
          data-stop-sequence="${escapeHtml(stopSequence)}"
          data-pending="${isPendingRow}"
          title="${timeType === 'window-start' ? 'Window start' : 'Window end'}"
        >${display || '--:--:--'}</span>
      `;
    };

    const stopSequenceAttr = `data-trip-id="${escapeHtml(trip_id)}" data-stop-sequence="${escapeHtml(stopSequence)}"`;

    // pickup_type / drop_off_type are what make a row a request-a-ride pickup
    // rather than a no-boarding one, so they are editable in place. Clicking
    // one opens a small enum menu restricted to the values a window allows;
    // schedule-controller delegates the click.
    const typeBadge = (
      label: string,
      field: 'pickup_type' | 'drop_off_type',
      value: string | null
    ): string => `<button
           type="button"
           class="flex-type-badge badge badge-xs badge-ghost font-mono cursor-pointer"
           ${stopSequenceAttr}
           data-field="${field}"
           data-value="${escapeHtml(value ?? '')}"
           title="${escapeHtml(`${field} for this row. Click to change.`)}"
         >${label} ${escapeHtml(value ?? '-')}</button>`;

    // Booking rules are per stop_time, so the badges live on the cell rather
    // than the row label. Clicking a set rule opens the On-Demand modal on it;
    // the separate assign button is what changes or clears it.
    const ruleBadge = (
      label: string,
      field: 'pickup_booking_rule_id' | 'drop_off_booking_rule_id',
      rule: string | null
    ): string => {
      const assign = `<button
             type="button"
             class="booking-rule-assign badge badge-xs badge-ghost badge-dash cursor-pointer"
             ${stopSequenceAttr}
             data-field="${field}"
             data-value="${escapeHtml(rule ?? '')}"
             title="${escapeHtml(`Assign the ${label === 'PU' ? 'pickup' : 'drop-off'} booking rule for this row.`)}"
           >${label} ${rule ? 'rule...' : 'rule +'}</button>`;
      if (!rule) {
        return assign;
      }
      return `<button
             type="button"
             class="booking-rule-badge badge badge-xs badge-outline font-mono cursor-pointer"
             data-booking-rule-id="${escapeHtml(rule)}"
             title="${escapeHtml(`${label} booking rule ${rule}. Opens the On-Demand editor.`)}"
           >${label} ${escapeHtml(rule)}</button>${assign}`;
    };

    // No stop_time means nothing to address a type or rule edit to: the badges
    // appear once the first window is typed and the record exists.
    const badgesHtml = !hasRecord
      ? ''
      : `<div class="flex flex-wrap justify-center gap-1 pt-1">
          ${typeBadge('PU', 'pickup_type', editableStopTime?.pickup_type ?? null)}
          ${typeBadge('DO', 'drop_off_type', editableStopTime?.drop_off_type ?? null)}
        </div>
        <div class="flex flex-wrap justify-center gap-1 pt-1">
          ${ruleBadge('PU', 'pickup_booking_rule_id', editableStopTime?.pickup_booking_rule_id ?? null)}
          ${ruleBadge('DO', 'drop_off_booking_rule_id', editableStopTime?.drop_off_booking_rule_id ?? null)}
        </div>`;

    return `
      <td class="time-cell flex-window-cell p-2 text-center">
        <div class="stacked-time-container space-y-1">
          ${renderSpan('window-start', editableStopTime?.start_pickup_drop_off_window ?? null)}
          ${renderSpan('window-end', editableStopTime?.end_pickup_drop_off_window ?? null)}
        </div>
        ${badgesHtml}
      </td>
    `;
  }
}
