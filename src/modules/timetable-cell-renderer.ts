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
   * @returns HTML string for the complete time cell
   */
  public renderStackedArrivalDepartureCell(
    trip_id: string,
    stop_id: string,
    stopIndex: number,
    arrival_time: string | null,
    departure_time: string | null,
    editableStopTime?: EditableStopTime,
    isPendingRow = false
  ): string {
    if (editableStopTime?.isFlex) {
      return this.renderFlexWindowCell(
        trip_id,
        stop_id,
        stopIndex,
        editableStopTime
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
   */
  private renderFlexWindowCell(
    trip_id: string,
    stop_id: string,
    stopIndex: number,
    editableStopTime: EditableStopTime
  ): string {
    const stopSequence = editableStopTime.stop_sequence;

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
          data-pending="false"
          title="${timeType === 'window-start' ? 'Window start' : 'Window end'}"
        >${display || '--:--:--'}</span>
      `;
    };

    // Booking rules are per stop_time, so the badges live on the cell rather
    // than the row label. Phase 6 turns these into links into the On-Demand
    // modal; for now they only surface that a rule applies.
    const badge = (label: string, rule: string | null): string =>
      rule
        ? `<span class="badge badge-xs badge-outline font-mono" title="${escapeHtml(`${label} booking rule ${rule}`)}">${label} ${escapeHtml(rule)}</span>`
        : '';
    const badges = [
      badge('PU', editableStopTime.pickup_booking_rule_id),
      badge('DO', editableStopTime.drop_off_booking_rule_id),
    ].filter((html) => html !== '');
    const badgesHtml =
      badges.length > 0
        ? `<div class="flex flex-wrap justify-center gap-1 pt-1">${badges.join('')}</div>`
        : '';

    return `
      <td class="time-cell flex-window-cell p-2 text-center">
        <div class="stacked-time-container space-y-1">
          ${renderSpan('window-start', editableStopTime.start_pickup_drop_off_window)}
          ${renderSpan('window-end', editableStopTime.end_pickup_drop_off_window)}
        </div>
        ${badgesHtml}
      </td>
    `;
  }
}
