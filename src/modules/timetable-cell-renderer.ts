/**
 * Timetable Cell Renderer Module
 * Handles HTML generation for individual time cells and cell interactions
 */

import { TimeFormatter } from '../utils/time-formatter.js';
import { EditableStopTime } from './timetable-data-processor.js';

/**
 * Timetable Cell Renderer - HTML generation for individual time cells
 *
 * This class is responsible for:
 * - Rendering different types of time cells (linked/unlinked, editable/read-only)
 * - Managing input states and visual styling
 * - Creating DOM elements programmatically for state changes
 * - Handling skip/unskip functionality visual indicators
 * - Providing consistent time input patterns and validation
 *
 * Uses DaisyUI classes and follows the Enhanced GTFS Object pattern.
 */
export class TimetableCellRenderer {
  /**
   * Render stacked arrival/departure cell with linked/unlinked time inputs
   *
   * Main cell rendering method that displays arrival and departure times.
   * Automatically determines whether to show linked (single input) or unlinked (dual inputs)
   * based on database state. Handles empty states and provides toggle functionality.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param arrival_time - Arrival time string or null
   * @param departure_time - Departure time string or null
   * @param _editableStopTime - Optional editable stop time data (currently unused)
   * @returns HTML string for the complete time cell
   */
  public renderStackedArrivalDepartureCell(
    trip_id: string,
    stop_id: string,
    arrival_time: string | null,
    departure_time: string | null,
    _editableStopTime?: EditableStopTime
  ): string {
    const arrivalDisplay = arrival_time
      ? TimeFormatter.formatTimeWithSeconds(arrival_time)
      : '';
    const departureDisplay = departure_time
      ? TimeFormatter.formatTimeWithSeconds(departure_time)
      : '';

    // Use database state detection - no more UI state tracking
    const showLinked = this.isLinkedState(arrival_time, departure_time);

    // Check if stop is effectively skipped (no times at all)
    const isSkipped = !arrival_time && !departure_time;

    const cellClass = `time-cell p-2 text-center ${
      isSkipped ? 'no-time' : 'has-time'
    }`;

    return `
      <td class="${cellClass}">
        <div class="stacked-time-container space-y-1">
          ${
            showLinked
              ? `
            <!-- Single linked time input -->
            <div class="flex items-center gap-1">
              <input
                type="text"
                class="input input-xs w-20 text-center font-mono bg-base-200 border-base-300 focus:bg-base-100 focus:border-primary"
                value="${arrivalDisplay}"
                placeholder="--:--:--"
                data-trip-id="${trip_id}"
                data-stop-id="${stop_id}"
                data-time-type="linked"
                pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$|^(2[4-9]|[3-9][0-9]):[0-5][0-9]:[0-5][0-9]$"
                title="Enter time in HH:MM:SS format (linked arrival and departure)"
                onchange="gtfsEditor.scheduleController.updateLinkedTime('${trip_id}', '${stop_id}', this.value)"
                onfocus="this.select()"
              />
              <button
                class="btn btn-xs w-6 h-6 p-0 min-h-6"
                onclick="gtfsEditor.scheduleController.toggleTimesLink('${trip_id}', '${stop_id}')"
                title="Times are linked - click to unlink and add dwell time"
              >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M15,1H9V3H15M11,14H13V8H11M19.03,7.39L20.45,5.97C20,5.46 19.55,5 19.04,4.56L17.62,6C16.07,4.74 14.12,4 12,4A9,9 0 0,0 3,13A9,9 0 0,0 12,22C17,22 21,17.97 21,13C21,10.88 20.26,8.93 19.03,7.39M12,20A7,7 0 0,1 5,13A7,7 0 0,1 12,6A7,7 0 0,1 19,13A7,7 0 0,1 12,20Z"/>
                </svg>
              </button>
            </div>
          `
              : `
            <!-- Separate arrival and departure inputs -->
            <div class="space-y-1">
              <!-- Arrival time -->
              <div class="flex items-center gap-1">
                <input
                  type="text"
                  class="input input-xs flex-1 text-center font-mono bg-base-200 border-base-300 focus:bg-base-100 focus:border-primary"
                  value="${arrivalDisplay}"
                  placeholder="--:--:--"
                  data-trip-id="${trip_id}"
                  data-stop-id="${stop_id}"
                  data-time-type="arrival"
                  pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$|^(2[4-9]|[3-9][0-9]):[0-5][0-9]:[0-5][0-9]$"
                  title="Enter arrival time in HH:MM:SS format"
                  onchange="gtfsEditor.scheduleController.updateArrivalDepartureTime('${trip_id}', '${stop_id}', 'arrival', this.value)"
                    onfocus="this.select()"
                />
                <div class="w-6"></div>
              </div>
              <!-- Departure time -->
              <div class="flex items-center gap-1">
                <input
                  type="text"
                  class="input input-xs flex-1 text-center font-mono bg-base-200 border-base-300 focus:bg-base-100 focus:border-primary"
                  value="${departureDisplay}"
                  placeholder="--:--:--"
                  data-trip-id="${trip_id}"
                  data-stop-id="${stop_id}"
                  data-time-type="departure"
                  pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$|^(2[4-9]|[3-9][0-9]):[0-5][0-9]:[0-5][0-9]$"
                  title="Enter departure time in HH:MM:SS format"
                  onchange="gtfsEditor.scheduleController.updateArrivalDepartureTime('${trip_id}', '${stop_id}', 'departure', this.value)"
                    onfocus="this.select()"
                />
                <button
                  class="btn btn-xs w-6 h-6 p-0 min-h-6"
                  onclick="gtfsEditor.scheduleController.toggleTimesLink('${trip_id}', '${stop_id}')"
                  title="Times are separate - click to link arrival and departure"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M15,1H9V3H15M11,14H13V8H11M19.03,7.39L20.45,5.97C20,5.46 19.55,5 19.04,4.56L17.62,6C16.07,4.74 14.12,4 12,4A9,9 0 0,0 3,13A9,9 0 0,0 12,22C17,22 21,17.97 21,13C21,10.88 20.26,8.93 19.03,7.39M12,20A7,7 0 0,1 5,13A7,7 0 0,1 12,6A7,7 0 0,1 19,13A7,7 0 0,1 12,20Z"/>
                  </svg>
                </button>
              </div>
            </div>
          `
          }
        </div>
      </td>
    `;
  }

  /**
   * Render read-only time cell (for display purposes)
   *
   * Creates a simple display-only cell for viewing time data without editing.
   * Used for non-editable views or reference displays.
   *
   * @param trip_id - GTFS trip identifier (for data attributes)
   * @param stop_id - GTFS stop identifier (for data attributes)
   * @param time - Time string to display or null for empty state
   * @returns HTML string for read-only time cell
   */
  public renderReadOnlyTimeCell(
    _trip_id: string,
    _stop_id: string,
    time: string | null
  ): string {
    const displayTime = time ? TimeFormatter.formatTime(time) : '';
    const cellClass = `time-cell p-2 text-center ${
      time ? 'has-time' : 'no-time'
    }`;

    return `
      <td class="${cellClass}">
        <span class="font-mono">${displayTime || '--:--'}</span>
      </td>
    `;
  }

  /**
   * Render editable arrival/departure cell (separate inputs)
   *
   * Creates time cells with separate arrival/departure handling.
   * Supports skip functionality and provides visual feedback for time types.
   * Uses color coding: blue for arrival, orange for departure.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param time - Current time value or null
   * @param timeType - Whether this is 'arrival' or 'departure' time
   * @param editableStopTime - Optional editable stop time data for skip state
   * @returns HTML string for editable arrival/departure cell
   */
  public renderEditableArrivalDepartureCell(
    trip_id: string,
    stop_id: string,
    time: string | null,
    timeType: 'arrival' | 'departure',
    editableStopTime?: EditableStopTime
  ): string {
    const isSkipped = editableStopTime?.isSkipped || false;
    const displayTime = time ? TimeFormatter.formatTime(time) : '';
    const cellClass = `time-cell p-1 text-center ${
      isSkipped
        ? 'skipped bg-warning/20 text-warning-content'
        : time
          ? 'has-time'
          : 'no-time'
    } ${
      timeType === 'arrival' ? 'bg-blue-50/30' : 'bg-orange-50/30'
    } ${timeType === 'departure' ? 'border-l border-base-200' : ''}`;

    if (isSkipped) {
      return `
        <td class="${cellClass}">
          <div class="skipped-indicator">
            <span class="text-xs opacity-70">SKIP</span>
            ${
              timeType === 'departure'
                ? `
              <button class="btn btn-ghost btn-xs ml-1" onclick="gtfsEditor.scheduleController.unskipStop('${trip_id}', '${stop_id}')" title="Unskip this stop">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
                </svg>
              </button>
            `
                : ''
            }
          </div>
        </td>
      `;
    }

    return `
      <td class="${cellClass}">
        <div class="time-input-container relative">
          <input
            type="text"
            class="time-input input input-xs w-16 text-center font-mono bg-transparent border-none focus:outline-none focus:bg-base-200"
            value="${displayTime}"
            placeholder="--:--"
            data-trip-id="${trip_id}"
            data-stop-id="${stop_id}"
            data-time-type="${timeType}"
            pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]$|^(2[4-9]|[3-9][0-9]):[0-5][0-9]$"
            title="Enter time in HH:MM format (24-hour, may exceed 24:00)"
            onchange="gtfsEditor.scheduleController.updateTime('${trip_id}', '${stop_id}', this.value)"
            onfocus="this.select()"
          />
          ${
            timeType === 'departure'
              ? `
          <div class="time-cell-actions opacity-0 group-hover:opacity-100 transition-opacity absolute top-0 right-0">
            <button class="btn btn-ghost btn-xs" onclick="gtfsEditor.scheduleController.skipStop('${trip_id}', '${stop_id}')" title="Skip this stop">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clip-rule="evenodd"></path>
              </svg>
            </button>
          </div>
        `
              : ''
          }
        </div>
      </td>
    `;
  }

  /**
   * Render editable time cell (single time input)
   *
   * Creates a single time input cell for basic time editing.
   * Supports skip functionality and hover actions.
   * Used for simpler time editing scenarios.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param time - Current time value or null
   * @param editableStopTime - Optional editable stop time data for skip state
   * @returns HTML string for editable time cell
   */
  public renderEditableTimeCell(
    trip_id: string,
    stop_id: string,
    time: string | null,
    editableStopTime?: EditableStopTime
  ): string {
    const isSkipped = editableStopTime?.isSkipped || false;
    const displayTime = time ? TimeFormatter.formatTime(time) : '';

    const cellClass = `time-cell p-1 text-center ${
      isSkipped
        ? 'skipped bg-warning/20 text-warning-content'
        : time
          ? 'has-time'
          : 'no-time'
    }`;

    if (isSkipped) {
      return `
        <td class="${cellClass}">
          <div class="skipped-indicator">
            <span class="text-xs opacity-70">SKIP</span>
            <button class="btn btn-ghost btn-xs ml-1" onclick="gtfsEditor.scheduleController.unskipStop('${trip_id}', '${stop_id}')" title="Unskip this stop">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
              </svg>
            </button>
          </div>
        </td>
      `;
    }

    return `
      <td class="${cellClass}">
        <div class="time-input-container">
          <input
            type="text"
            class="time-input input input-xs w-20 text-center font-mono bg-transparent border-none focus:outline-none focus:bg-base-200"
            value="${displayTime}"
            placeholder="--:--"
            data-trip-id="${trip_id}"
            data-stop-id="${stop_id}"
            pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]$|^(2[4-9]|[3-9][0-9]):[0-5][0-9]$"
            title="Enter time in HH:MM format (24-hour, may exceed 24:00)"
            onchange="gtfsEditor.scheduleController.updateTime('${trip_id}', '${stop_id}', this.value)"
            onfocus="this.select()"
          />
          <div class="time-cell-actions opacity-0 group-hover:opacity-100 transition-opacity absolute top-0 right-0">
            <button class="btn btn-ghost btn-xs" onclick="gtfsEditor.scheduleController.skipStop('${trip_id}', '${stop_id}')" title="Skip this stop">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clip-rule="evenodd"></path>
              </svg>
            </button>
          </div>
        </div>
      </td>
    `;
  }

  /**
   * Create linked input element (for programmatic use)
   *
   * Programmatically creates a linked time input DOM element.
   * Used during state transitions from unlinked to linked mode.
   * Includes proper event listeners and data attributes.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param timeValue - Initial time value for the input
   * @returns DOM element for linked time input
   */
  public createLinkedInput(
    trip_id: string,
    stop_id: string,
    timeValue: string
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'flex items-center gap-1';

    const input = document.createElement('input');
    input.type = 'text';
    input.className =
      'input input-xs w-20 text-center font-mono bg-base-200 border-base-300 focus:bg-base-100 focus:border-primary';
    input.value = timeValue;
    input.placeholder = '--:--:--';
    input.setAttribute('data-trip-id', trip_id);
    input.setAttribute('data-stop-id', stop_id);
    input.setAttribute('data-time-type', 'linked');
    input.pattern =
      '^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$|^(2[4-9]|[3-9][0-9]):[0-5][0-9]:[0-5][0-9]$';
    input.title =
      'Enter time in HH:MM:SS format (linked arrival and departure)';

    // Add event listeners
    input.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      // @ts-expect-error - gtfsEditor is available globally
      gtfsEditor.scheduleController.updateLinkedTime(
        trip_id,
        stop_id,
        target.value
      );
    });

    input.addEventListener('focus', () => {
      input.select();
    });

    // Add unlink button
    const unlinkButton = document.createElement('button');
    unlinkButton.className = 'btn btn-xs w-6 h-6 p-0 min-h-6';
    unlinkButton.title =
      'Times are linked - click to unlink and add dwell time';
    unlinkButton.innerHTML = `
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M15,1H9V3H15M11,14H13V8H11M19.03,7.39L20.45,5.97C20,5.46 19.55,5 19.04,4.56L17.62,6C16.07,4.74 14.12,4 12,4A9,9 0 0,0 3,13A9,9 0 0,0 12,22C17,22 21,17.97 21,13C21,10.88 20.26,8.93 19.03,7.39M12,20A7,7 0 0,1 5,13A7,7 0 0,1 12,6A7,7 0 0,1 19,13A7,7 0 0,1 12,20Z"/>
      </svg>
    `;

    // Add event listener for unlink button
    unlinkButton.addEventListener('click', () => {
      // @ts-expect-error - gtfsEditor is available globally
      gtfsEditor.scheduleController.toggleTimesLink(trip_id, stop_id);
    });

    container.appendChild(input);
    container.appendChild(unlinkButton);

    return container;
  }

  /**
   * Create unlinked inputs container (for programmatic use)
   *
   * Programmatically creates separate arrival/departure input DOM elements.
   * Used during state transitions from linked to unlinked mode.
   * Creates complete container with proper labels, styling, and event listeners.
   *
   * @param trip_id - GTFS trip identifier
   * @param stop_id - GTFS stop identifier
   * @param arrivalTime - Initial arrival time value
   * @param departureTime - Initial departure time value
   * @returns DOM element containing both arrival and departure inputs
   */
  public createUnlinkedInputs(
    trip_id: string,
    stop_id: string,
    arrivalTime: string,
    departureTime: string
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'space-y-1';

    // Arrival input
    const arrivalDiv = document.createElement('div');
    arrivalDiv.className = 'flex items-center gap-1';

    const arrivalInput = document.createElement('input');
    arrivalInput.type = 'text';
    arrivalInput.className =
      'input input-xs flex-1 text-center font-mono bg-base-200 border-base-300 focus:bg-base-100 focus:border-primary';
    arrivalInput.value = arrivalTime;
    arrivalInput.placeholder = '--:--:--';
    arrivalInput.setAttribute('data-trip-id', trip_id);
    arrivalInput.setAttribute('data-stop-id', stop_id);
    arrivalInput.setAttribute('data-time-type', 'arrival');

    // Add event listeners for arrival input
    arrivalInput.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      // @ts-expect-error - gtfsEditor is available globally
      gtfsEditor.scheduleController.updateArrivalDepartureTime(
        trip_id,
        stop_id,
        'arrival',
        target.value
      );
    });
    arrivalInput.addEventListener('focus', () => {
      arrivalInput.select();
    });

    // Add spacer to match button width in departure row
    const arrivalSpacer = document.createElement('div');
    arrivalSpacer.className = 'w-6';

    arrivalDiv.appendChild(arrivalInput);
    arrivalDiv.appendChild(arrivalSpacer);

    // Departure input
    const departureDiv = document.createElement('div');
    departureDiv.className = 'flex items-center gap-1';

    const departureInput = document.createElement('input');
    departureInput.type = 'text';
    departureInput.className =
      'input input-xs flex-1 text-center font-mono bg-base-200 border-base-300 focus:bg-base-100 focus:border-primary';
    departureInput.value = departureTime;
    departureInput.placeholder = '--:--:--';
    departureInput.setAttribute('data-trip-id', trip_id);
    departureInput.setAttribute('data-stop-id', stop_id);
    departureInput.setAttribute('data-time-type', 'departure');

    // Add event listeners for departure input
    departureInput.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      // @ts-expect-error - gtfsEditor is available globally
      gtfsEditor.scheduleController.updateArrivalDepartureTime(
        trip_id,
        stop_id,
        'departure',
        target.value
      );
    });
    departureInput.addEventListener('focus', () => {
      departureInput.select();
    });

    departureDiv.appendChild(departureInput);

    // Add link button next to departure input
    const linkButton = document.createElement('button');
    linkButton.className = 'btn btn-xs w-6 h-6 p-0 min-h-6';
    linkButton.title =
      'Times are separate - click to link arrival and departure';
    linkButton.innerHTML = `
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M15,1H9V3H15M11,14H13V8H11M19.03,7.39L20.45,5.97C20,5.46 19.55,5 19.04,4.56L17.62,6C16.07,4.74 14.12,4 12,4A9,9 0 0,0 3,13A9,9 0 0,0 12,22C17,22 21,17.97 21,13C21,10.88 20.26,8.93 19.03,7.39M12,20A7,7 0 0,1 5,13A7,7 0 0,1 12,6A7,7 0 0,1 19,13A7,7 0 0,1 12,20Z"/>
      </svg>
    `;

    // Add event listener for link button
    linkButton.addEventListener('click', () => {
      // @ts-expect-error - gtfsEditor is available globally
      gtfsEditor.scheduleController.toggleTimesLink(trip_id, stop_id);
    });

    departureDiv.appendChild(linkButton);

    container.appendChild(arrivalDiv);
    container.appendChild(departureDiv);

    return container;
  }

  /**
   * Determine if times should be shown as linked
   *
   * Business logic for determining when arrival and departure times
   * should be displayed as a single linked input versus separate inputs.
   * Times are linked when they have identical values.
   *
   * @param arrival_time - Current arrival time value
   * @param departure_time - Current departure time value
   * @returns True if times should be displayed as linked
   */
  private isLinkedState(
    arrival_time: string | null,
    departure_time: string | null
  ): boolean {
    // Times are linked if they're equal or if one is missing and the other exists
    return arrival_time === departure_time;
  }
}
