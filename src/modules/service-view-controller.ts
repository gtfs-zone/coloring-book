/**
 * Service View Controller
 *
 * Comprehensive service view implementation with inline editing and related routes/trips.
 * Provides a single-column layout showing service properties (weekly pattern editor)
 * and related transit routes/trips.
 */

import type { Agency, Routes, Trips } from '../types/gtfs';
import { normalizeAgencyId } from '../utils/agency-helpers';
import { renderTrashIcon } from 'interlocking/modules/modal-utils';
import {
  renderTimetableReference,
  TIMETABLE_REF_ROW,
  VIEW_ROUTE_BTN,
} from '../utils/entity-references';
import { getRouteDisplay } from '../utils/entity-display';
import {
  feedBounds,
  trimOrExtendServices,
  type BatchMixedPatchManager,
  type FeedBounds,
} from '../utils/feed-bounds';
import {
  showOptionPickerModal,
  type OptionPickerItem,
} from './option-picker-modal';

const CREATE_TIMETABLE_BTN = 'create-timetable-btn';
const TRIM_TO_FEED_START_BTN = 'trim-to-feed-start-btn';
const EXTEND_TO_FEED_END_BTN = 'extend-to-feed-end-btn';

export interface ServiceViewDependencies {
  gtfsDatabase?: {
    queryRows: (
      tableName: string,
      filter?: Record<string, unknown>
    ) => Promise<unknown[]>;
    getAllRows: (tableName: string) => Promise<unknown[]>;
    updateRow?: (
      tableName: string,
      key: string,
      data: Record<string, unknown>
    ) => Promise<void>;
    deleteRow?: (tableName: string, key: string) => Promise<void>;
  };
  gtfsRelationships?: {
    getRoutesForService?: (service_id: string) => Promise<unknown[]>;
    getTripsForService?: (service_id: string) => Promise<unknown[]>;
  };
  serviceDaysController: {
    renderServiceEditor: (service_id: string) => Promise<string>;
  };
  patchManager?: BatchMixedPatchManager | null;
  onAgencyClick?: (agency_id: string) => void;
  onRouteClick: (route_id: string) => void;
  onTimetableClick: (
    route_id: string,
    service_id: string,
    direction_id?: string
  ) => void;
  onDeleteService?: (service_id: string) => void;
  /** Re-render the page after the service's calendar row is trimmed/extended. */
  onServiceChanged?: (service_id: string) => void;
}

export class ServiceViewController {
  private dependencies: ServiceViewDependencies;

  constructor(dependencies: ServiceViewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Render comprehensive service view
   */
  async renderServiceView(service_id: string): Promise<string> {
    console.log(
      'ServiceViewController: Rendering service view for:',
      service_id
    );

    try {
      const routes = await this.getRoutesForService(service_id);
      const agencies = await this.getAgenciesForRoutes(routes);

      const trips =
        await (this.dependencies.gtfsRelationships?.getTripsForService?.(
          service_id
        ) ??
          this.dependencies.gtfsDatabase?.queryRows('trips', { service_id }) ??
          []);
      const tripCountByRoute = new Map<string, number>();
      for (const trip of trips) {
        const rid = (trip as Record<string, unknown>).route_id as string;
        tripCountByRoute.set(rid, (tripCountByRoute.get(rid) ?? 0) + 1);
      }

      const agencyNameByNormalizedId = new Map<string, string>();
      for (const agency of agencies) {
        agencyNameByNormalizedId.set(
          normalizeAgencyId(agency.agency_id),
          agency.agency_name || agency.agency_id
        );
      }

      const { calendar, calendarDates } =
        await this.getServiceCalendar(service_id);
      const bounds = this.dependencies.gtfsDatabase
        ? await feedBounds(this.dependencies.gtfsDatabase)
        : {};

      const html = `
        <div class="p-4 space-y-4">
          ${await this.renderServiceProperties(service_id, calendar, calendarDates, bounds)}
          ${this.renderTimetablesSection(service_id, routes, agencyNameByNormalizedId, tripCountByRoute, calendar, calendarDates)}
        </div>
      `;
      console.log('Service view HTML length:', html.length);
      return html;
    } catch (error) {
      console.error('Error rendering service view:', error);
      return this.renderError('Failed to load service information.');
    }
  }

  /**
   * The calendar row and exception dates behind a service. A service may live
   * only in calendar_dates.txt, in which case there is no calendar row and the
   * caller falls back to the bare service_id.
   */
  private async getServiceCalendar(service_id: string): Promise<{
    calendar: Record<string, unknown>;
    calendarDates: Array<{ date: string; exception_type: string | number }>;
  }> {
    if (!this.dependencies.gtfsDatabase) {
      return { calendar: { service_id }, calendarDates: [] };
    }
    const calendarRows = await this.dependencies.gtfsDatabase.queryRows(
      'calendar',
      { service_id }
    );
    const calendarDates = (await this.dependencies.gtfsDatabase.queryRows(
      'calendar_dates',
      { service_id }
    )) as Array<{ date: string; exception_type: string | number }>;
    return {
      calendar:
        calendarRows.length > 0
          ? (calendarRows[0] as Record<string, unknown>)
          : { service_id },
      calendarDates,
    };
  }

  /**
   * Get routes using this service
   */
  private async getRoutesForService(service_id: string): Promise<Routes[]> {
    if (
      this.dependencies.gtfsRelationships?.getRoutesForService &&
      this.dependencies.gtfsDatabase
    ) {
      try {
        const routes =
          await this.dependencies.gtfsRelationships.getRoutesForService(
            service_id
          );
        return routes as Routes[];
      } catch (error) {
        console.error('Error getting routes for service:', error);
        return [];
      }
    }

    // Fallback: query database directly
    if (this.dependencies.gtfsDatabase) {
      try {
        // Get all trips for this service
        const trips = await this.dependencies.gtfsDatabase.queryRows('trips', {
          service_id,
        });

        // Get unique route_ids
        const route_ids = [
          ...new Set(trips.map((trip: unknown) => (trip as Trips).route_id)),
        ];

        // Get routes data
        const allRoutes =
          await this.dependencies.gtfsDatabase.queryRows('routes');
        const routes = allRoutes.filter((route: unknown) =>
          route_ids.includes((route as Routes).route_id)
        );

        return routes as Routes[];
      } catch (error) {
        console.error('Error getting routes for service (fallback):', error);
        return [];
      }
    }

    return [];
  }

  /**
   * Get agencies for the given routes
   */
  private async getAgenciesForRoutes(routes: Routes[]): Promise<Agency[]> {
    if (!this.dependencies.gtfsDatabase) {
      return [];
    }

    try {
      const agency_ids = [
        ...new Set(
          routes
            .map((route) => route.agency_id)
            .filter((id) => id !== undefined)
        ),
      ];

      if (agency_ids.length === 0) {
        return [];
      }

      const allAgencies =
        await this.dependencies.gtfsDatabase.queryRows('agency');
      return allAgencies.filter((agency: unknown) =>
        agency_ids.includes((agency as Agency).agency_id)
      ) as Agency[];
    } catch (error) {
      console.error('Error getting agencies:', error);
      return [];
    }
  }

  /**
   * Render service properties section (weekly pattern editor)
   */
  private async renderServiceProperties(
    service_id: string,
    calendar: Record<string, unknown>,
    calendarDates: Array<{ date: string; exception_type: string | number }>,
    bounds: FeedBounds
  ): Promise<string> {
    // Use the service days controller to render the weekly pattern editor
    const serviceEditorHTML =
      await this.dependencies.serviceDaysController.renderServiceEditor(
        service_id
      );

    const startDate =
      calendar.start_date !== undefined ? String(calendar.start_date) : null;
    const endDate =
      calendar.end_date !== undefined ? String(calendar.end_date) : null;
    // A service that lives only in calendar_dates.txt has no calendar row at
    // all, so there is nothing for either button to trim or extend.
    const hasCalendarRow = startDate !== null || endDate !== null;

    // A service already at the bound can still carry exceptions past it, so the
    // buttons stay live while there is anything to prune.
    const strayBefore = bounds.start
      ? calendarDates.filter((d) => String(d.date) < bounds.start!).length
      : 0;
    const strayAfter = bounds.end
      ? calendarDates.filter((d) => String(d.date) > bounds.end!).length
      : 0;
    const canTrim = hasCalendarRow && startDate !== bounds.start;
    const canExtend = hasCalendarRow && endDate !== bounds.end;

    const trimDisabled = !bounds.start || (!canTrim && strayBefore === 0);
    const trimTitle = !bounds.start
      ? 'feed_info has no feed_start_date'
      : !canTrim && strayBefore === 0
        ? hasCalendarRow
          ? 'Already at feed start'
          : 'This service has no calendar.txt row and no early exceptions'
        : `${canTrim ? `Set start_date to ${bounds.start}, and remove` : 'Remove'} every exception before it`;

    const extendDisabled = !bounds.end || (!canExtend && strayAfter === 0);
    const extendTitle = !bounds.end
      ? 'feed_info has no feed_end_date'
      : !canExtend && strayAfter === 0
        ? hasCalendarRow
          ? 'Already at feed end'
          : 'This service has no calendar.txt row and no late exceptions'
        : `${canExtend ? `Set end_date to ${bounds.end}, and remove` : 'Remove'} every exception after it`;

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">Service Schedule</h2>
          <div class="flex items-center gap-2">
            <button class="btn btn-xs btn-outline ${TRIM_TO_FEED_START_BTN}" data-service-id="${service_id}" title="${trimTitle}" ${trimDisabled ? 'disabled' : ''}>Trim to feed start</button>
            <button class="btn btn-xs btn-outline ${EXTEND_TO_FEED_END_BTN}" data-service-id="${service_id}" title="${extendTitle}" ${extendDisabled ? 'disabled' : ''}>Extend to feed end</button>
            <button class="btn btn-sm btn-error btn-outline delete-service-btn" data-service-id="${service_id}" title="Delete">${renderTrashIcon()}</button>
          </div>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${serviceEditorHTML}
          </div>
        </div>
      </div>
    `;
  }

  private renderTimetablesHeader(service_id: string): string {
    return `
      <div class="flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold">Timetables</h2>
        <button
          type="button"
          class="btn btn-sm btn-outline ${CREATE_TIMETABLE_BTN}"
          data-service-id="${service_id}"
        >+ Timetable</button>
      </div>
    `;
  }

  private renderTimetablesSection(
    service_id: string,
    routes: Routes[],
    agencyNameByNormalizedId: Map<string, string>,
    tripCountByRoute: Map<string, number>,
    calendar: Record<string, unknown>,
    calendarDates: Array<{ date: string; exception_type: string | number }>
  ): string {
    if (routes.length === 0) {
      return `
        <div class="space-y-4">
          ${this.renderTimetablesHeader(service_id)}
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="text-center py-6 opacity-70">
                No routes are using this service.
                <div>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary ${CREATE_TIMETABLE_BTN} mt-2"
                    data-service-id="${service_id}"
                  >Create a timetable</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const items = routes
      .map((route) => {
        const normalizedId = normalizeAgencyId(route.agency_id);
        return renderTimetableReference(
          route as Record<string, unknown>,
          calendar,
          {
            calendarDates,
            agencyName: agencyNameByNormalizedId.get(normalizedId),
            tripCount: tripCountByRoute.get(route.route_id),
            hide: 'service',
          }
        );
      })
      .join('');

    return `
      <div class="space-y-4">
        ${this.renderTimetablesHeader(service_id)}
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="space-y-2">${items}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Route picker for creating a timetable on this service: excludes routes
   * that already have one, and hands the choice off to onTimetableClick, the
   * same navigation the Route page's service dropdown uses.
   */
  private async openCreateTimetablePicker(service_id: string): Promise<void> {
    if (!this.dependencies.gtfsDatabase) {
      return;
    }
    const existingRoutes = await this.getRoutesForService(service_id);
    const existingRouteIds = new Set(
      existingRoutes.map((route) => route.route_id)
    );
    const allRoutes = await this.dependencies.gtfsDatabase.queryRows('routes');
    const options: OptionPickerItem[] = (allRoutes as Routes[])
      .filter((route) => !existingRouteIds.has(route.route_id))
      .map((route) => {
        const display = getRouteDisplay(route as Record<string, string>);
        return {
          value: route.route_id,
          primary: display.primary,
          secondary: display.secondary,
        };
      });

    const route_id = await showOptionPickerModal({
      title: 'Create timetable',
      options,
      searchable: true,
    });
    if (route_id) {
      this.dependencies.onTimetableClick(route_id, service_id);
    }
  }

  /**
   * Set the one service's `start_date` or `end_date` to the matching
   * `feed_info` bound and drop its exceptions past that edge, as one batch so
   * a single undo reverts both. Same write as the bulk buttons, scoped to this
   * service.
   */
  private async trimOrExtendService(
    service_id: string,
    field: 'start_date' | 'end_date'
  ): Promise<void> {
    const db = this.dependencies.gtfsDatabase;
    const patchManager = this.dependencies.patchManager;
    if (!db?.updateRow || !db.deleteRow || !patchManager) {
      console.warn('[ServiceView] No writable database, cannot trim/extend');
      return;
    }
    const bounds = await feedBounds(db);
    const value = field === 'start_date' ? bounds.start : bounds.end;
    if (!value) {
      return;
    }
    const { services, exceptions } = await trimOrExtendServices(
      db as Parameters<typeof trimOrExtendServices>[0],
      patchManager,
      field,
      value,
      new Set([service_id])
    );
    if (services === 0 && exceptions === 0) {
      return;
    }
    this.dependencies.onServiceChanged?.(service_id);
  }

  /**
   * Render error state
   */
  private renderError(message: string): string {
    return `
      <div class="alert alert-error m-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>${message}</span>
      </div>
    `;
  }

  /**
   * Add event listeners for interactive elements
   * This should be called after the content is inserted into the DOM
   */
  addEventListeners(container: HTMLElement): void {
    // Delete service button
    const deleteServiceBtn = container.querySelector('.delete-service-btn');
    if (deleteServiceBtn) {
      deleteServiceBtn.addEventListener('click', () => {
        const service_id = deleteServiceBtn.getAttribute('data-service-id');
        if (service_id && this.dependencies.onDeleteService) {
          this.dependencies.onDeleteService(service_id);
        }
      });
    }

    // Trim/extend this service's calendar row to the feed's declared bounds
    const trimBtn = container.querySelector(`.${TRIM_TO_FEED_START_BTN}`);
    trimBtn?.addEventListener('click', () => {
      const service_id = trimBtn.getAttribute('data-service-id');
      if (service_id) {
        void this.trimOrExtendService(service_id, 'start_date');
      }
    });

    const extendBtn = container.querySelector(`.${EXTEND_TO_FEED_END_BTN}`);
    extendBtn?.addEventListener('click', () => {
      const service_id = extendBtn.getAttribute('data-service-id');
      if (service_id) {
        void this.trimOrExtendService(service_id, 'end_date');
      }
    });

    // Timetable row click goes to the timetable
    const routeRows = container.querySelectorAll(`.${TIMETABLE_REF_ROW}`);
    routeRows.forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        const service_id = row.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    });

    // "Route" button click goes to route page
    const entityBtns = container.querySelectorAll(`.${VIEW_ROUTE_BTN}`);
    entityBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const route_id = btn.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });

    // "+ Timetable" / "Create a timetable" open the route picker
    const createTimetableBtns = container.querySelectorAll(
      `.${CREATE_TIMETABLE_BTN}`
    );
    createTimetableBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const service_id = btn.getAttribute('data-service-id');
        if (service_id) {
          void this.openCreateTimetablePicker(service_id);
        }
      });
    });
  }
}
