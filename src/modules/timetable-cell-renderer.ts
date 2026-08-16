/**
 * Timetable Cell Renderer Module
 * Handles HTML generation for individual time cells
 */

import { TimeFormatter } from '../utils/time-formatter.js';
import { EditableStopTime } from './timetable-data-processor.js';
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
    isPendingFlex = false
  ): string {
    if (editableStopTime?.isFlex || isPendingFlex) {
      return this.renderFlexWindowCell(
        trip_id,
        stop_id,
        stopIndex,
        editableStopTime ?? null,
        isPendingFlex
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
   * The pending row (a zone or location group picked from "Add stop or zone"
   * but not yet written) has no stop_time behind it: it renders the same two
   * empty window spans with `data-pending="true"`, which is what routes the
   * first typed value to the insert path instead of an update.
   */
  private renderFlexWindowCell(
    trip_id: string,
    stop_id: string,
    stopIndex: number,
    editableStopTime: EditableStopTime | null,
    isPendingRow: boolean
  ): string {
    const stopSequence = editableStopTime?.stop_sequence ?? '';

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
          data-stop-id="${escapeHtml(stop_id)}"
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

    // The pending row has no stop_time yet, so there is nothing to address a
    // type or rule edit to: its badges appear once the first window is typed.
    const badgesHtml = isPendingRow
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
