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
 */
export class TimetableCellRenderer {
  /**
   * Render a stop/trip time cell as arrival and departure spans.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param arrival_time - Arrival time string or null
   * @param departure_time - Departure time string or null
   * @param editableStopTime - Optional editable stop time data (supplies stop_sequence)
   * @param supersequencePosition - This row's stable index into the timetable's stop list
   * @returns HTML string for the complete time cell
   */
  public renderStackedArrivalDepartureCell(
    trip_id: string,
    stop_id: string,
    arrival_time: string | null,
    departure_time: string | null,
    editableStopTime?: EditableStopTime,
    supersequencePosition?: number
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
    const position = supersequencePosition ?? '';
    const stopSequence = editableStopTime?.stop_sequence ?? '';

    const renderSpan = (
      timeType: 'arrival' | 'departure',
      display: string
    ): string => `
        <span
          class="time-span block font-mono text-xs cursor-pointer rounded px-1 hover:bg-base-200"
          data-trip-id="${trip_id}"
          data-stop-id="${stop_id}"
          data-time-type="${timeType}"
          data-position="${position}"
          data-stop-sequence="${stopSequence}"
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
