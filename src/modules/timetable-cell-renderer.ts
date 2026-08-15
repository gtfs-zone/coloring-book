/**
 * Timetable Cell Renderer Module
 * Handles HTML generation for individual time cells
 */

import { TimeFormatter } from '../utils/time-formatter.js';
import { EditableStopTime } from './timetable-data-processor.js';

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
}
