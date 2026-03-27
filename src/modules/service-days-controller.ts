/**
 * Service Days Controller Module
 * Handles editing of GTFS calendar patterns and calendar exceptions
 * Provides auto-save functionality for service day modifications
 */

import {
  Calendar,
  CalendarDates,
  GTFSTableMap,
} from '../types/gtfs-entities.js';
import { notifications } from './notification-system';
import { patchUpdate } from '../utils/patch-utils.js';

// Days of the week in US format (Sunday first)
const DAYS_OF_WEEK = [
  { key: 'sunday', label: 'Sun' },
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
] as const;

interface GTFSParserInterface {
  gtfsDatabase: {
    queryRows<T extends keyof GTFSTableMap>(
      tableName: T,
      filter?: { [key: string]: string | number | boolean }
    ): Promise<GTFSTableMap[T][]>;
    updateRow<T extends keyof GTFSTableMap>(
      tableName: T,
      key: string,
      data: Partial<GTFSTableMap[T]>
    ): Promise<void>;
    deleteRow<T extends keyof GTFSTableMap>(
      tableName: T,
      key: string
    ): Promise<void>;
    insertRows<T extends keyof GTFSTableMap>(
      tableName: T,
      rows: GTFSTableMap[T][]
    ): Promise<void>;
    generateKey<T extends keyof GTFSTableMap>(
      tableName: T,
      data: GTFSTableMap[T]
    ): string;
  };
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
  recordDelete(
    table: string,
    id: string,
    record: Record<string, unknown>
  ): Promise<void>;
}

/**
 * ServiceDaysController - Manages GTFS calendar and calendar_dates editing
 *
 * This controller provides inline editing capabilities for:
 * - Weekly service patterns (calendar.txt)
 * - Service exceptions (calendar_dates.txt)
 * - Auto-save functionality following existing patterns
 *
 * Follows the Enhanced GTFS Object pattern and FAIL HARD error handling policy.
 */
export class ServiceDaysController {
  private gtfsParser: GTFSParserInterface;
  private patchManager: PatchManagerInterface | null = null;
  private currentServiceId: string | null = null;
  private savingIndicators: Set<string> = new Set();

  /**
   * Initialize ServiceDaysController with required dependencies
   *
   * @param gtfsParser - GTFS parser with database access
   */
  constructor(gtfsParser: GTFSParserInterface) {
    this.gtfsParser = gtfsParser;
  }

  setPatchManager(pm: PatchManagerInterface): void {
    this.patchManager = pm;
  }

  // ===== PUBLIC RENDERING METHODS =====

  /**
   * Render service days editor for a specific service ID
   * Returns HTML to be embedded inline in existing object view
   *
   * @param service_id - GTFS service identifier
   * @returns Promise resolving to HTML string for the service editor
   */
  async renderServiceEditor(service_id: string): Promise<string> {
    try {
      this.currentServiceId = service_id;

      // Get calendar and calendar_dates data
      const [calendarRows, calendarDatesRows] = await Promise.all([
        this.gtfsParser.gtfsDatabase.queryRows('calendar', { service_id }),
        this.gtfsParser.gtfsDatabase.queryRows('calendar_dates', {
          service_id,
        }),
      ]);

      const calendar = calendarRows[0] || null;
      const exceptions = calendarDatesRows || [];

      return this.renderServiceEditorHTML(service_id, calendar, exceptions);
    } catch (error) {
      console.error('Error rendering service editor:', error);
      return this.renderErrorHTML('Failed to load service editor');
    }
  }

  // ===== PUBLIC EDITING METHODS =====

  /**
   * Toggle a day of the week for a service
   *
   * @param service_id - GTFS service identifier
   * @param dayKey - Day key (sunday, monday, etc.)
   */
  async toggleDay(service_id: string, dayKey: string): Promise<void> {
    try {
      this.showSavingIndicator(`day-${dayKey}-${service_id}`);

      // Get current calendar entry
      const calendarRows = await this.gtfsParser.gtfsDatabase.queryRows(
        'calendar',
        { service_id }
      );
      let calendar = calendarRows[0];

      if (!calendar) {
        // Create new calendar entry with default dates
        const today = new Date();
        const startDate = this.formatDateToGTFS(today);
        const endDate = this.formatDateToGTFS(
          new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000)
        ); // 1 year from now

        calendar = {
          service_id,
          monday: 0,
          tuesday: 0,
          wednesday: 0,
          thursday: 0,
          friday: 0,
          saturday: 0,
          sunday: 0,
          start_date: startDate,
          end_date: endDate,
        } as Calendar;

        (calendar as Record<string, unknown>)[dayKey] = 1;
        await this.gtfsParser.gtfsDatabase.insertRows('calendar', [calendar]);
        await this.patchManager?.recordInsert(
          'calendar',
          service_id,
          calendar as Record<string, unknown>
        );
      } else {
        // Toggle the day - handle both string and number values from database
        const currentValue = Number(
          (calendar as Record<string, unknown>)[dayKey]
        );
        const newValue = currentValue === 1 ? 0 : 1;

        await patchUpdate(
          this.gtfsParser.gtfsDatabase,
          this.patchManager,
          'calendar',
          service_id,
          { [dayKey]: currentValue },
          { [dayKey]: newValue }
        );
      }

      this.showSaveSuccess(`day-${dayKey}-${service_id}`);

      // Update button UI immediately to reflect new state
      this.updateDayButtonUI(service_id, dayKey);
    } catch (error) {
      console.error(`Failed to toggle ${dayKey}:`, error);
      this.showSaveError(
        `day-${dayKey}-${service_id}`,
        `Failed to update ${dayKey}`
      );
    }
  }

  /**
   * Update date range for a service
   *
   * @param service_id - GTFS service identifier
   * @param dateType - Either 'start_date' or 'end_date'
   * @param newDate - New date in YYYY-MM-DD format
   */
  async updateDateRange(
    service_id: string,
    dateType: 'start_date' | 'end_date',
    newDate: string
  ): Promise<void> {
    try {
      this.showSavingIndicator(`date-${dateType}`);

      // Convert to GTFS format (YYYYMMDD)
      const gtfsDate = this.formatDateToGTFS(new Date(newDate));

      // Get or create calendar entry
      const calendarRows = await this.gtfsParser.gtfsDatabase.queryRows(
        'calendar',
        { service_id }
      );
      let calendar = calendarRows[0];

      if (!calendar) {
        // Create new calendar entry
        calendar = {
          service_id,
          monday: 0,
          tuesday: 0,
          wednesday: 0,
          thursday: 0,
          friday: 0,
          saturday: 0,
          sunday: 0,
          start_date: gtfsDate,
          end_date: gtfsDate,
        } as Calendar;

        calendar[dateType] = gtfsDate;
        await this.gtfsParser.gtfsDatabase.insertRows('calendar', [calendar]);
        await this.patchManager?.recordInsert(
          'calendar',
          service_id,
          calendar as Record<string, unknown>
        );
      } else {
        await patchUpdate(
          this.gtfsParser.gtfsDatabase,
          this.patchManager,
          'calendar',
          service_id,
          { [dateType]: calendar[dateType] },
          { [dateType]: gtfsDate }
        );
      }

      this.showSaveSuccess(`date-${dateType}`);
      console.log(
        `Updated ${dateType} for service ${service_id} to ${gtfsDate}`
      );
    } catch (error) {
      console.error(`Failed to update ${dateType}:`, error);
      this.showSaveError(`date-${dateType}`, `Failed to update ${dateType}`);
    }
  }

  /**
   * Add a service exception
   *
   * @param service_id - GTFS service identifier
   * @param date - Date in YYYY-MM-DD format
   * @param exception_type - 1 for add service, 2 for remove service
   */
  async addException(
    service_id: string,
    date: string,
    exception_type: 1 | 2
  ): Promise<void> {
    try {
      this.showSavingIndicator('exceptions');

      const gtfsDate = this.formatDateToGTFS(new Date(date));

      const exceptionData: CalendarDates = {
        service_id,
        date: gtfsDate,
        exception_type,
      };

      await this.gtfsParser.gtfsDatabase.insertRows('calendar_dates', [
        exceptionData,
      ]);
      await this.patchManager?.recordInsert(
        'calendar_dates',
        `${service_id}:${gtfsDate}`,
        exceptionData as Record<string, unknown>
      );

      this.showSaveSuccess('exceptions');
      console.log(
        `Added exception for service ${service_id} on ${gtfsDate} (type ${exception_type})`
      );
    } catch (error) {
      console.error('Failed to add exception:', error);
      this.showSaveError('exceptions', 'Failed to add exception');
    }
  }

  /**
   * Remove a service exception
   *
   * @param service_id - GTFS service identifier
   * @param date - Date in YYYYMMDD format
   */
  async removeException(service_id: string, date: string): Promise<void> {
    try {
      this.showSavingIndicator('exceptions');

      const key = `${service_id}:${date}`;
      const existingExceptions = await this.gtfsParser.gtfsDatabase.queryRows(
        'calendar_dates',
        { service_id, date }
      );
      const existingRecord = existingExceptions[0];
      await this.gtfsParser.gtfsDatabase.deleteRow('calendar_dates', key);
      if (existingRecord) {
        await this.patchManager?.recordDelete(
          'calendar_dates',
          key,
          existingRecord as Record<string, unknown>
        );
      }

      this.showSaveSuccess('exceptions');
      console.log(`Removed exception for service ${service_id} on ${date}`);
    } catch (error) {
      console.error('Failed to remove exception:', error);
      this.showSaveError('exceptions', 'Failed to remove exception');
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Render the main service editor HTML
   */
  private renderServiceEditorHTML(
    service_id: string,
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): string {
    const weeklyPatternHTML = this.renderWeeklyPattern(service_id, calendar);
    const dateRangeHTML = this.renderDateRange(service_id, calendar);
    const exceptionsHTML = this.renderExceptions(service_id, exceptions);

    return `
      <div class="service-days-editor bg-base-200/50 p-4 rounded-lg">
        <div class="space-y-4">
          <!-- Weekly Pattern -->
          <div class="weekly-pattern">
            <h4 class="text-sm font-semibold mb-2 text-base-content/80">Weekly Pattern</h4>
            ${weeklyPatternHTML}
          </div>

          <!-- Date Range -->
          <div class="date-range">
            <h4 class="text-sm font-semibold mb-2 text-base-content/80">Date Range</h4>
            ${dateRangeHTML}
          </div>

          <!-- Exceptions -->
          <div class="exceptions">
            <h4 class="text-sm font-semibold mb-2 text-base-content/80">Service Exceptions</h4>
            ${exceptionsHTML}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render weekly day pattern toggles
   */
  private renderWeeklyPattern(
    service_id: string,
    calendar: Calendar | null
  ): string {
    const dayToggles = DAYS_OF_WEEK.map(({ key, label }) => {
      // Handle both string and number values from database
      const isActive = calendar
        ? Number((calendar as Record<string, unknown>)[key]) === 1
        : false;
      const activeClass = isActive ? 'btn-primary' : 'btn-outline';

      return `
        <button
          class="btn ${activeClass} btn-xs day-toggle"
          data-service-id="${service_id}"
          data-day="${key}"
          onclick="window.gtfsEditor.serviceDaysController.toggleDay('${service_id}', '${key}')"
        >
          <span class="saving-indicator" id="saving-day-${key}-${service_id}" style="display: none;">
            <span class="loading loading-spinner loading-xs"></span>
          </span>
          ${label}
        </button>
      `;
    }).join('');

    return `
      <div class="day-toggles flex gap-1 text-xs">
        ${dayToggles}
      </div>
    `;
  }

  /**
   * Render date range inputs
   */
  private renderDateRange(
    service_id: string,
    calendar: Calendar | null
  ): string {
    const startDate = calendar?.start_date
      ? this.parseGTFSDate(calendar.start_date)
      : '';
    const endDate = calendar?.end_date
      ? this.parseGTFSDate(calendar.end_date)
      : '';

    return `
      <div class="date-inputs grid grid-cols-2 gap-3">
        <div class="form-control">
          <label class="label py-1">
            <span class="label-text text-xs">Start Date</span>
            <span class="saving-indicator" id="saving-date-start_date" style="display: none;">
              <span class="loading loading-spinner loading-xs"></span>
            </span>
          </label>
          <input
            type="date"
            class="input input-bordered input-sm text-xs"
            value="${startDate}"
            onchange="window.gtfsEditor.serviceDaysController.updateDateRange('${service_id}', 'start_date', this.value)"
          />
        </div>
        <div class="form-control">
          <label class="label py-1">
            <span class="label-text text-xs">End Date</span>
            <span class="saving-indicator" id="saving-date-end_date" style="display: none;">
              <span class="loading loading-spinner loading-xs"></span>
            </span>
          </label>
          <input
            type="date"
            class="input input-bordered input-sm text-xs"
            value="${endDate}"
            onchange="window.gtfsEditor.serviceDaysController.updateDateRange('${service_id}', 'end_date', this.value)"
          />
        </div>
      </div>
    `;
  }

  /**
   * Render exceptions list and add form
   */
  private renderExceptions(
    service_id: string,
    exceptions: CalendarDates[]
  ): string {
    const exceptionsList = exceptions
      .map((exception) => {
        const formattedDate = this.parseGTFSDate(exception.date);
        const typeText =
          exception.exception_type === 1 ? 'Add Service' : 'Remove Service';
        const typeClass =
          exception.exception_type === 1 ? 'badge-success' : 'badge-error';

        return `
        <div class="exception-item flex items-center justify-between p-1 text-xs">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs">${formattedDate}</span>
            <span class="badge ${typeClass} badge-xs">${typeText}</span>
          </div>
          <button
            class="btn btn-ghost btn-xs"
            onclick="window.gtfsEditor.serviceDaysController.removeException('${service_id}', '${exception.date}')"
          >
            ✕
          </button>
        </div>
      `;
      })
      .join('');

    return `
      <div class="exceptions-container">
        <div class="saving-indicator" id="saving-exceptions" style="display: none;">
          <span class="loading loading-spinner loading-xs"></span>
        </div>

        <!-- Add Exception Form -->
        <div class="add-exception-form bg-base-100 border border-base-300 p-2 rounded mb-2">
          <div class="grid grid-cols-3 gap-1 items-end">
            <input type="date" id="exception-date-${service_id}" class="input input-bordered input-xs text-xs" />
            <select id="exception-type-${service_id}" class="select select-bordered select-xs text-xs">
              <option value="1">Add Service</option>
              <option value="2">Remove Service</option>
            </select>
            <button
              class="btn btn-primary btn-xs text-xs"
              onclick="window.gtfsEditor.serviceDaysController.addExceptionFromForm('${service_id}')"
            >
              Add
            </button>
          </div>
        </div>

        <!-- Exceptions List -->
        <div class="exceptions-list max-h-32 overflow-y-auto space-y-1 bg-base-100 border border-base-300 rounded p-2">
          ${exceptionsList || '<div class="text-xs text-base-content/60 p-2">No exceptions defined</div>'}
        </div>
      </div>
    `;
  }

  /**
   * Add exception from form (convenience method for HTML onclick)
   */
  async addExceptionFromForm(service_id: string): Promise<void> {
    const dateInput = document.getElementById(
      `exception-date-${service_id}`
    ) as HTMLInputElement;
    const typeSelect = document.getElementById(
      `exception-type-${service_id}`
    ) as HTMLSelectElement;

    if (!dateInput.value) {
      notifications.showError('Please select a date', { duration: 3000 });
      return;
    }

    const exception_type = parseInt(typeSelect.value) as 1 | 2;
    await this.addException(service_id, dateInput.value, exception_type);

    // Clear form
    dateInput.value = '';
    typeSelect.value = '1';

    // Refresh the exceptions display
    this.refreshExceptionsDisplay(service_id);
  }

  /**
   * Refresh exceptions display after changes
   */
  private async refreshExceptionsDisplay(service_id: string): Promise<void> {
    try {
      const exceptions = await this.gtfsParser.gtfsDatabase.queryRows(
        'calendar_dates',
        { service_id }
      );
      const exceptionsContainer = document.querySelector('.exceptions-list');
      if (exceptionsContainer) {
        exceptionsContainer.innerHTML = this.renderExceptionsList(
          service_id,
          exceptions
        );
      }
    } catch (error) {
      console.error('Failed to refresh exceptions display:', error);
    }
  }

  /**
   * Render just the exceptions list (for refreshing)
   */
  private renderExceptionsList(
    service_id: string,
    exceptions: CalendarDates[]
  ): string {
    return exceptions
      .map((exception) => {
        const formattedDate = this.parseGTFSDate(exception.date);
        const typeText =
          exception.exception_type === 1 ? 'Add Service' : 'Remove Service';
        const typeClass =
          exception.exception_type === 1 ? 'badge-success' : 'badge-error';

        return `
        <div class="exception-item flex items-center justify-between p-1 text-xs">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs">${formattedDate}</span>
            <span class="badge ${typeClass} badge-xs">${typeText}</span>
          </div>
          <button
            class="btn btn-ghost btn-xs"
            onclick="window.gtfsEditor.serviceDaysController.removeException('${service_id}', '${exception.date}')"
          >
            ✕
          </button>
        </div>
      `;
      })
      .join('');
  }

  /**
   * Update day button UI to reflect current database state
   */
  private async updateDayButtonUI(
    service_id: string,
    dayKey: string
  ): Promise<void> {
    try {
      // Get current state from database
      const calendarRows = await this.gtfsParser.gtfsDatabase.queryRows(
        'calendar',
        { service_id }
      );
      const calendar = calendarRows[0];

      if (!calendar) {
        return;
      }

      // Get current value from database
      const isActive =
        Number((calendar as Record<string, unknown>)[dayKey]) === 1;

      // Find the button and update its classes
      const button = document.querySelector(
        `button[data-service-id="${service_id}"][data-day="${dayKey}"]`
      ) as HTMLButtonElement;

      if (button) {
        // Remove both classes first
        button.classList.remove('btn-primary', 'btn-outline');
        // Add the appropriate class based on current state
        button.classList.add(isActive ? 'btn-primary' : 'btn-outline');
      }
    } catch (error) {
      console.error(`Failed to update day button UI for ${dayKey}:`, error);
    }
  }

  /**
   * Show saving indicator
   */
  private showSavingIndicator(elementId: string): void {
    this.savingIndicators.add(elementId);
    const indicator = document.getElementById(`saving-${elementId}`);
    if (indicator) {
      indicator.style.display = 'inline-block';
    }
  }

  /**
   * Show save success
   */
  private showSaveSuccess(elementId: string): void {
    this.savingIndicators.delete(elementId);
    const indicator = document.getElementById(`saving-${elementId}`);
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  /**
   * Show save error
   */
  private showSaveError(elementId: string, message: string): void {
    this.savingIndicators.delete(elementId);
    const indicator = document.getElementById(`saving-${elementId}`);
    if (indicator) {
      indicator.style.display = 'none';
    }
    notifications.showError(message, { duration: 5000 });
  }

  /**
   * Convert JavaScript Date to GTFS format (YYYYMMDD)
   */
  private formatDateToGTFS(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Parse GTFS date (YYYYMMDD) to YYYY-MM-DD format for HTML date input
   */
  private parseGTFSDate(gtfsDate: string): string {
    if (!gtfsDate || gtfsDate.length !== 8) {
      return '';
    }
    const year = gtfsDate.substring(0, 4);
    const month = gtfsDate.substring(4, 6);
    const day = gtfsDate.substring(6, 8);
    return `${year}-${month}-${day}`;
  }

  /**
   * Render error HTML
   */
  private renderErrorHTML(message: string): string {
    return `
      <div class="alert alert-error">
        <span>${message}</span>
      </div>
    `;
  }
}
