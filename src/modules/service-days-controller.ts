/**
 * Service Days Controller Module
 * Handles editing of GTFS calendar patterns and calendar exceptions
 * Provides auto-save functionality for service day modifications
 */

import { Calendar, CalendarDates, GTFSTableMap } from '../types/gtfs-entities';
import { GTFS_TABLES } from '../types/gtfs';
import { notify } from 'interlocking/modules/notification-system';
import { patchUpdate } from '../utils/patch-utils';
import {
  getUsFederalDates,
  getUsFederalHolidays,
} from '../calendar-patterns/us-federal';
import {
  formatGtfsDateWithWeekday,
  fromInputValue,
  toGtfsDateLocal,
} from '../utils/gtfs-date';
import {
  installEditableTableHandlers,
  renderEditableTable,
  type EditableTableConfig,
  type EditableTableDeps,
  type EditableTablePatchManager,
} from './editable-table';
import { renderInlineEntityFields } from '../utils/inline-editable-field';

// Days of the week in US format (Sunday first)
export const DAYS_OF_WEEK = [
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
    getAllRows(tableName: string): Promise<Record<string, unknown>[]>;
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
  };
}

/**
 * The patch surface this controller needs: everything an embedded editable
 * table records, plus the batch forms the holidays checkbox writes.
 */
interface PatchManagerInterface extends EditableTablePatchManager {
  recordBatchInsert(
    ops: Array<{ table: string; id: string; record: Record<string, unknown> }>,
    label?: string
  ): Promise<void>;
  recordBatchDelete(
    ops: Array<{ table: string; id: string; record: Record<string, unknown> }>,
    label?: string
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
      // Get calendar and calendar_dates data
      const [calendarRows, calendarDatesRows] = await Promise.all([
        this.gtfsParser.gtfsDatabase.queryRows('calendar', { service_id }),
        this.gtfsParser.gtfsDatabase.queryRows('calendar_dates', {
          service_id,
        }),
      ]);

      const calendar = calendarRows[0] || null;
      const exceptions = calendarDatesRows || [];

      return await this.renderServiceEditorHTML(
        service_id,
        calendar,
        exceptions
      );
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
        // Derive date range from existing calendar_dates, fall back to today/+1yr
        const existingDates = await this.gtfsParser.gtfsDatabase.queryRows(
          'calendar_dates',
          { service_id }
        );
        let startDate: string;
        let endDate: string;
        if (existingDates.length > 0) {
          const sorted = existingDates.map((e) => e.date).sort();
          startDate = sorted[0];
          endDate = sorted[sorted.length - 1];
        } else {
          const today = new Date();
          startDate = toGtfsDateLocal(today);
          endDate = toGtfsDateLocal(
            new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000)
          );
        }

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
        // The service just gained a date range, which both the range editor
        // and the holidays checkbox render from.
        await this.refreshDateRangeDisplay(service_id);
        await this.refreshExceptionsDisplay(service_id);
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

      const gtfsDate = fromInputValue(date);

      const existing = await this.gtfsParser.gtfsDatabase.queryRows(
        'calendar_dates',
        { service_id, date: gtfsDate }
      );
      const existingRecord = existing[0] ?? null;

      if (existingRecord) {
        if (existingRecord.exception_type === exception_type) {
          // Already the correct type, no-op
          this.showSaveSuccess('exceptions');
          return;
        }
        // Different type, update in place
        const key = `${service_id}:${gtfsDate}`;
        await this.gtfsParser.gtfsDatabase.updateRow('calendar_dates', key, {
          exception_type,
        });
        await this.patchManager?.recordBatchMixed([
          {
            op: 'update',
            table: 'calendar_dates',
            id: key,
            before: { exception_type: existingRecord.exception_type },
            after: { exception_type },
          },
        ]);
        this.showSaveSuccess('exceptions');
        console.log(
          `[ServiceDaysController] Updated exception for service ${service_id} on ${gtfsDate} (type ${existingRecord.exception_type} -> ${exception_type})`
        );
      } else {
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
          `[ServiceDaysController] Added exception for service ${service_id} on ${gtfsDate} (type ${exception_type})`
        );
      }
    } catch (error) {
      console.error('Failed to add exception:', error);
      this.showSaveError('exceptions', 'Failed to add exception');
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Render the main service editor HTML
   */
  private async renderServiceEditorHTML(
    service_id: string,
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): Promise<string> {
    const weeklyPatternHTML = this.renderWeeklyPattern(service_id, calendar);
    const dateRangeHTML = await this.renderDateRange(service_id, calendar);
    const exceptionsHTML = await this.renderExceptions(
      service_id,
      calendar,
      exceptions
    );

    return `
      <div class="service-days-editor bg-base-200/50 p-4 rounded-lg">
        <div class="space-y-4">
          <!-- Weekly Pattern -->
          <div class="weekly-pattern">
            <h4 class="text-sm font-semibold mb-2 text-base-content/80">Weekly Pattern</h4>
            ${weeklyPatternHTML}
          </div>

          <!-- Date Range -->
          <div class="date-range" id="service-date-range-${service_id}">
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
   * Start and end date, as the stacked entity fields every other page uses.
   *
   * A service with no calendar.txt row has no range of its own to edit, and a
   * field editor has no row to write to, so it says so instead.
   */
  private async renderDateRange(
    service_id: string,
    calendar: Calendar | null
  ): Promise<string> {
    if (!calendar) {
      return `
        <div class="text-xs text-base-content/60">
          This service has no calendar.txt row, so it has no date range. Its
          dates come from the exceptions below. Toggle a weekday to create one.
        </div>
      `;
    }

    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.CALENDAR,
      calendar as unknown as Record<string, string | number | undefined>,
      service_id,
      [...DAYS_OF_WEEK.map((day) => day.key), 'service_id']
    );
    return `<div class="max-w-md">${fieldsHtml}</div>`;
  }

  /**
   * The writing handle the exception tables need.
   *
   * Null before the patch manager is wired: a table that cannot record its
   * edits must not be rendered at all.
   */
  private editableDeps(): EditableTableDeps | null {
    if (!this.patchManager) {
      console.warn(
        '[ServiceDaysController] no patch manager, exception tables are skipped'
      );
      return null;
    }
    const db = this.gtfsParser.gtfsDatabase;
    return {
      gtfsDatabase: {
        getAllRows: (table) => db.getAllRows(table),
        insertRows: (table, rows) =>
          db.insertRows(
            table as keyof GTFSTableMap,
            rows as GTFSTableMap[keyof GTFSTableMap][]
          ),
        updateRow: (table, key, data) =>
          db.updateRow(table as keyof GTFSTableMap, key, data),
        deleteRow: (table, key) =>
          db.deleteRow(table as keyof GTFSTableMap, key),
      },
      patchManager: this.patchManager,
    };
  }

  /**
   * The exceptions, split by what they do: one list of dates that add service,
   * one of dates that remove it. The heading carries the meaning, so no row
   * needs a badge.
   */
  private async renderExceptions(
    service_id: string,
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): Promise<string> {
    const deps = this.editableDeps();
    const byDate = (a: CalendarDates, b: CalendarDates) =>
      String(a.date).localeCompare(String(b.date));
    const added = exceptions
      .filter((e) => Number(e.exception_type) === 1)
      .sort(byDate);
    const removed = exceptions
      .filter((e) => Number(e.exception_type) === 2)
      .sort(byDate);

    const unavailable =
      '<div class="text-xs text-base-content/60">Exceptions cannot be edited until the edit history is ready.</div>';
    const holidayNames = this.federalHolidayNames(calendar, exceptions);
    const addedHTML = deps
      ? await this.renderExceptionTable(
          service_id,
          deps,
          1,
          added,
          holidayNames
        )
      : unavailable;
    const removedHTML = deps
      ? await this.renderExceptionTable(
          service_id,
          deps,
          2,
          removed,
          holidayNames
        )
      : unavailable;

    return `
      <div id="service-exceptions-${service_id}" class="space-y-3">
        <div class="saving-indicator" id="saving-exceptions" style="display: none;">
          <span class="loading loading-spinner loading-xs"></span>
        </div>

        <div class="space-y-1">
          <h5 class="text-xs font-semibold text-base-content/70">Added service</h5>
          ${addedHTML}
        </div>

        <div class="space-y-1">
          <h5 class="text-xs font-semibold text-base-content/70">Removed service</h5>
          ${this.renderHolidaysCheckbox(service_id, calendar, exceptions)}
          ${removedHTML}
        </div>
      </div>
    `;
  }

  /**
   * One exception list as an editable table over `calendar_dates`.
   *
   * Only the date is a column: the service and the exception type are what the
   * list is, so they ride along as fixed values on every row it inserts. The
   * insert itself goes through `addException`, which reconciles a date that is
   * already in the other list instead of colliding with it.
   */
  private async renderExceptionTable(
    service_id: string,
    deps: EditableTableDeps,
    exception_type: 1 | 2,
    rows: CalendarDates[],
    holidayNames: Map<string, string>
  ): Promise<string> {
    const config: EditableTableConfig = {
      instanceId: `calendar-dates-${exception_type}-${service_id}`,
      tableName: GTFS_TABLES.CALENDAR_DATES,
      fields: ['date'],
      rows: rows as unknown as Record<string, unknown>[],
      deps,
      columnOverrides: {
        date: {
          format: (value) => {
            const date = String(value ?? '');
            if (!/^\d{8}$/.test(date)) {
              return date;
            }
            const text = formatGtfsDateWithWeekday(date);
            // Only the removed list names the holiday: that is the list a
            // holiday explains being in.
            const name =
              exception_type === 2 ? holidayNames.get(date) : undefined;
            return name ? `${text} - ${name}` : text;
          },
        },
      },
      fixedValues: { service_id, exception_type },
      emptyMessage:
        exception_type === 1
          ? 'No dates add service beyond the weekly pattern.'
          : 'No dates remove service from the weekly pattern.',
      insertRow: async (record) => {
        const date = fromInputValue(String(record.date ?? ''));
        if (!/^\d{8}$/.test(date)) {
          return 'Enter a date as YYYYMMDD';
        }
        await this.addException(service_id, date, exception_type);
        return null;
      },
      onInsert: () => void this.refreshExceptionsDisplay(service_id),
      onDelete: () => void this.refreshExceptionsDisplay(service_id),
      onRowsChanged: () => void this.refreshExceptionsDisplay(service_id),
    };

    // Re-registered on every render, so the handlers always hold the rows on
    // screen. The instance outlives the panel, but its cells do not.
    installEditableTableHandlers(config);
    return renderEditableTable(config);
  }

  /**
   * The federal-holidays convenience above the removed list.
   *
   * Nothing about it is stored: it is checked when every federal holiday in
   * the service's date range already has a removed-service row, and a partial
   * state reads as unchecked.
   */
  private renderHolidaysCheckbox(
    service_id: string,
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): string {
    const holidays = this.federalHolidayDates(calendar, exceptions);
    const removedDates = new Set(
      exceptions
        .filter((e) => Number(e.exception_type) === 2)
        .map((e) => String(e.date))
    );
    const checked =
      holidays.length > 0 && holidays.every((date) => removedDates.has(date));
    const title =
      holidays.length === 0
        ? 'Set a start and end date first'
        : `${holidays.length} federal holiday date${holidays.length === 1 ? '' : 's'} fall in this date range`;

    return `
      <label class="label cursor-pointer justify-start gap-2 py-1" title="${title}">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          ${checked ? 'checked' : ''}
          ${holidays.length === 0 ? 'disabled' : ''}
          onchange="window.gtfsEditor.serviceDaysController.toggleFederalHolidays('${service_id}')"
        />
        <span class="label-text text-xs">Exclude US Federal Holidays</span>
      </label>
    `;
  }

  /**
   * Observed US federal holiday dates inside the service's date range, sorted.
   *
   * Empty when the service has no usable range, which is what disables the
   * checkbox: there is nothing to add dates to.
   */
  /**
   * Observed federal holiday date to name, over the years the calendar spans.
   *
   * Unlike `federalHolidayDates` this is not clipped to the service's start and
   * end: an exception date outside the range still deserves its name.
   */
  private federalHolidayNames(
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): Map<string, string> {
    const range = this.getYearsRange(calendar, exceptions);
    const years = exceptions
      .map((e) => parseInt(String(e.date).substring(0, 4)))
      .filter((year) => Number.isFinite(year));
    const startYear = Math.min(range.startYear, ...years);
    const endYear = Math.max(range.endYear, ...years);
    const names = new Map<string, string>();
    for (let year = startYear; year <= endYear; year++) {
      for (const holiday of getUsFederalHolidays(year)) {
        names.set(holiday.date, holiday.name);
      }
    }
    return names;
  }

  private federalHolidayDates(
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): string[] {
    const start = String(calendar?.start_date ?? '');
    const end = String(calendar?.end_date ?? '');
    if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
      return [];
    }

    const { startYear, endYear } = this.getYearsRange(calendar, exceptions);
    const dates: string[] = [];
    for (let year = startYear; year <= endYear; year++) {
      for (const date of getUsFederalDates(year)) {
        if (date >= start && date <= end) {
          dates.push(date);
        }
      }
    }
    return dates.sort();
  }

  /**
   * Put every federal holiday in range on the removed list, or take them all
   * off it again. One undo step either way.
   *
   * Checking also flips a holiday that was on the added list: the label
   * promises the holidays are excluded, so leaving one added would contradict
   * both the label and the checkbox it fails to check.
   */
  async toggleFederalHolidays(service_id: string): Promise<void> {
    try {
      this.showSavingIndicator('exceptions');

      const [calendarRows, exceptions] = await Promise.all([
        this.gtfsParser.gtfsDatabase.queryRows('calendar', { service_id }),
        this.gtfsParser.gtfsDatabase.queryRows('calendar_dates', {
          service_id,
        }),
      ]);
      const calendar = calendarRows[0] ?? null;
      const holidays = this.federalHolidayDates(calendar, exceptions);
      if (holidays.length === 0) {
        this.showSaveError(
          'exceptions',
          'Set a start and end date before excluding holidays'
        );
        return;
      }

      const byDate = new Map(exceptions.map((e) => [String(e.date), e]));
      const holidaySet = new Set(holidays);
      const allRemoved = holidays.every(
        (date) => Number(byDate.get(date)?.exception_type) === 2
      );
      const table = 'calendar_dates';

      if (allRemoved) {
        const ops = exceptions
          .filter((e) => holidaySet.has(String(e.date)))
          .map((e) => ({
            table,
            id: `${service_id}:${e.date}`,
            record: e as unknown as Record<string, unknown>,
          }));
        for (const op of ops) {
          await this.gtfsParser.gtfsDatabase.deleteRow(table, op.id);
        }
        await this.patchManager?.recordBatchDelete(
          ops,
          'Include US federal holidays'
        );
        console.log(
          `[ServiceDaysController] Removed ${ops.length} federal holiday rows for ${service_id}`
        );
      } else {
        const inserts: CalendarDates[] = holidays
          .filter((date) => !byDate.has(date))
          .map((date) => ({ service_id, date, exception_type: 2 as const }));
        const flips = holidays
          .map((date) => byDate.get(date))
          .filter(
            (row): row is CalendarDates =>
              row !== undefined && Number(row.exception_type) !== 2
          );

        if (inserts.length > 0) {
          await this.gtfsParser.gtfsDatabase.insertRows(table, inserts);
        }
        for (const row of flips) {
          await this.gtfsParser.gtfsDatabase.updateRow(
            table,
            `${service_id}:${row.date}`,
            { exception_type: 2 }
          );
        }

        const label = 'Exclude US federal holidays';
        const insertOps = inserts.map((row) => ({
          table,
          id: `${service_id}:${row.date}`,
          record: row as unknown as Record<string, unknown>,
        }));
        if (flips.length === 0) {
          await this.patchManager?.recordBatchInsert(insertOps, label);
        } else {
          await this.patchManager?.recordBatchMixed(
            [
              ...insertOps.map((op) => ({ op: 'insert' as const, ...op })),
              ...flips.map((row) => ({
                op: 'update' as const,
                table,
                id: `${service_id}:${row.date}`,
                before: { exception_type: row.exception_type },
                after: { exception_type: 2 },
              })),
            ],
            label
          );
        }
        console.log(
          `[ServiceDaysController] Excluded federal holidays for ${service_id} (+${inserts.length}, flipped ${flips.length})`
        );
      }

      this.showSaveSuccess('exceptions');
      await this.refreshExceptionsDisplay(service_id);
    } catch (error) {
      console.error('Failed to toggle federal holidays:', error);
      this.showSaveError('exceptions', 'Failed to update federal holidays');
    }
  }

  /**
   * Derive year range from calendar dates or exception dates
   */
  private getYearsRange(
    calendar: Calendar | null,
    exceptions: CalendarDates[]
  ): { startYear: number; endYear: number } {
    if (calendar?.start_date && calendar?.end_date) {
      return {
        startYear: parseInt(calendar.start_date.substring(0, 4)),
        endYear: parseInt(calendar.end_date.substring(0, 4)),
      };
    }
    if (exceptions.length === 0) {
      const y = new Date().getFullYear();
      return { startYear: y, endYear: y };
    }
    const years = exceptions.map((e) => parseInt(e.date.substring(0, 4)));
    return { startYear: Math.min(...years), endYear: Math.max(...years) };
  }

  /**
   * Re-render the date range section after the calendar row appears.
   */
  private async refreshDateRangeDisplay(service_id: string): Promise<void> {
    const container = document.getElementById(
      `service-date-range-${service_id}`
    );
    if (!container) {
      return;
    }
    const calendarRows = await this.gtfsParser.gtfsDatabase.queryRows(
      'calendar',
      { service_id }
    );
    const calendar = calendarRows[0] ?? null;
    container.innerHTML = `
      <h4 class="text-sm font-semibold mb-2 text-base-content/80">Date Range</h4>
      ${await this.renderDateRange(service_id, calendar)}
    `;
  }

  /**
   * Refresh exceptions display after changes
   */
  async refreshExceptionsDisplay(service_id: string): Promise<void> {
    try {
      const [calendarRows, exceptions] = await Promise.all([
        this.gtfsParser.gtfsDatabase.queryRows('calendar', { service_id }),
        this.gtfsParser.gtfsDatabase.queryRows('calendar_dates', {
          service_id,
        }),
      ]);
      const calendar = calendarRows[0] ?? null;
      const container = document.getElementById(
        `service-exceptions-${service_id}`
      );
      if (container) {
        container.outerHTML = await this.renderExceptions(
          service_id,
          calendar,
          exceptions
        );
      }
    } catch (error) {
      console.error(
        '[ServiceDaysController] Failed to refresh exceptions display:',
        error
      );
    }
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
    notify.error(message, { duration: 5000 });
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
