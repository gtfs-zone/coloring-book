/**
 * Stop View Controller
 *
 * Comprehensive stop view implementation with inline editing and transit network relationships.
 * Provides a single-column layout showing stop properties and timetable relationships.
 */

import type { Routes, Stops, Trips, StopTimes } from '../types/gtfs.js';
import {
  renderEntityFields,
  type QueryOnlyDatabase,
} from '../utils/field-component.js';
import { GTFS_TABLES, StopsSchema } from '../types/gtfs.js';
import { getStopDisplay, renderCardLabel } from '../utils/entity-display.js';
import { renderTrashIcon } from './modal-utils.js';
import {
  renderServiceReference,
  SERVICE_REF_ROW,
} from '../utils/entity-references.js';

interface TimetableKey {
  route_id: string;
  service_id: string;
}

interface StopRelations {
  routes: Routes[];
  timetableKeys: TimetableKey[];
}

export interface StopViewDependencies {
  gtfsDatabase?: QueryOnlyDatabase;
  gtfsRelationships?: {
    getAgenciesServingStop?: (stop_id: string) => Promise<unknown[]>;
    getRoutesServingStop?: (stop_id: string) => Promise<unknown[]>;
  };
  onTimetableClick: (route_id: string, service_id: string) => void;
  onDeleteStop: (stop_id: string) => Promise<void>;
}

export class StopViewController {
  private dependencies: StopViewDependencies;
  private currentStopId: string | null = null;
  private deleteListenerAbortController: AbortController | null = null;

  constructor(dependencies: StopViewDependencies) {
    this.dependencies = dependencies;
  }

  async renderStopView(stop_id: string): Promise<string> {
    this.currentStopId = stop_id;
    console.log('StopViewController: Rendering stop view for:', stop_id);

    try {
      const stop = await this.getStopData(stop_id);
      if (!stop) {
        return this.renderError('Stop not found.');
      }

      const { routes, timetableKeys } = await this.fetchStopRelations(stop_id);

      const calendarByServiceId = new Map<string, Record<string, unknown>>();
      const calendarDatesByServiceId = new Map<
        string,
        Array<{ date: string; exception_type: string | number }>
      >();

      if (this.dependencies.gtfsDatabase && timetableKeys.length > 0) {
        const serviceIdSet = new Set(timetableKeys.map((k) => k.service_id));
        const allCalendars =
          await this.dependencies.gtfsDatabase.queryRows('calendar');
        for (const cal of allCalendars) {
          const record = cal as Record<string, unknown>;
          const sid = record['service_id'] as string;
          if (serviceIdSet.has(sid)) {
            calendarByServiceId.set(sid, record);
          }
        }
        const allCalendarDates =
          await this.dependencies.gtfsDatabase.queryRows('calendar_dates');
        for (const cd of allCalendarDates) {
          const record = cd as Record<string, unknown>;
          const sid = record['service_id'] as string;
          if (serviceIdSet.has(sid)) {
            const existing = calendarDatesByServiceId.get(sid) ?? [];
            existing.push(
              record as { date: string; exception_type: string | number }
            );
            calendarDatesByServiceId.set(sid, existing);
          }
        }
      }

      const html = `
        <div class="p-4 space-y-4">
          ${this.renderStopProperties(stop)}
          ${this.renderTimetablesSection(timetableKeys, routes, calendarByServiceId, calendarDatesByServiceId)}
        </div>
      `;
      console.log('Stop view HTML length:', html.length);
      return html;
    } catch (error) {
      console.error('Error rendering stop view:', error);
      return this.renderError('Failed to load stop information.');
    }
  }

  private renderStopProperties(stop: Stops): string {
    const fieldsHtml = renderEntityFields(
      StopsSchema,
      stop as Record<string, string | number | undefined>,
      GTFS_TABLES.STOPS,
      this.currentStopId ?? ''
    );

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">${renderCardLabel(getStopDisplay(stop as unknown as Record<string, string>))}</h2>
          <button class="btn btn-sm btn-error btn-outline delete-stop-btn" data-stop-id="${stop.stop_id}" title="Delete">${renderTrashIcon()}</button>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="max-w-md">
              ${fieldsHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderTimetablesSection(
    timetableKeys: TimetableKey[],
    _routes: Routes[],
    calendarByServiceId: Map<string, Record<string, unknown>>,
    calendarDatesByServiceId: Map<
      string,
      Array<{ date: string; exception_type: string | number }>
    >
  ): string {
    if (timetableKeys.length === 0) {
      return `
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">Timetables</h2>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="text-center py-6 opacity-70">
                This stop is not included in any timetables.
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const rows = timetableKeys
      .map(({ route_id, service_id }) => {
        const calendar = calendarByServiceId.get(service_id) ?? { service_id };
        const calendarDates = calendarDatesByServiceId.get(service_id);
        return renderServiceReference(calendar, { route_id, calendarDates });
      })
      .join('');

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Timetables</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="space-y-2">
              ${rows}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private async getStopData(stop_id: string): Promise<Stops | null> {
    if (!this.dependencies.gtfsDatabase) {
      return { stop_id, stop_name: stop_id, parent_station: '' } as Stops;
    }

    try {
      const stops = await this.dependencies.gtfsDatabase.queryRows('stops', {
        stop_id,
      });
      if (stops.length === 0) {
        return null;
      }
      return stops[0] as Stops;
    } catch (error) {
      console.error('Error getting stop data:', error);
      return null;
    }
  }

  private async fetchStopRelations(stop_id: string): Promise<StopRelations> {
    if (!this.dependencies.gtfsDatabase) {
      return { routes: [], timetableKeys: [] };
    }

    try {
      const stopTimes = (await this.dependencies.gtfsDatabase.queryRows(
        'stop_times',
        { stop_id }
      )) as StopTimes[];
      const tripIdSet = new Set(stopTimes.map((st) => st.trip_id));

      if (tripIdSet.size === 0) {
        return { routes: [], timetableKeys: [] };
      }

      const allTrips = (await this.dependencies.gtfsDatabase.queryRows(
        'trips'
      )) as Trips[];
      const relevantTrips = allTrips.filter((trip) =>
        tripIdSet.has(trip.trip_id)
      );

      const routeIdSet = new Set(relevantTrips.map((trip) => trip.route_id));
      const timetableKeySet = new Set<string>();
      const timetableKeys: TimetableKey[] = [];
      for (const trip of relevantTrips) {
        const key = `${trip.route_id}||${trip.service_id}`;
        if (!timetableKeySet.has(key)) {
          timetableKeySet.add(key);
          timetableKeys.push({
            route_id: trip.route_id,
            service_id: trip.service_id,
          });
        }
      }

      const allRoutes = (await this.dependencies.gtfsDatabase.queryRows(
        'routes'
      )) as Routes[];
      const routes = allRoutes.filter((route) =>
        routeIdSet.has(route.route_id)
      );

      return { routes, timetableKeys };
    } catch (error) {
      console.error('Error fetching stop relations:', error);
      return { routes: [], timetableKeys: [] };
    }
  }

  addEventListeners(container: HTMLElement): void {
    // Delete stop button — use event delegation so clicks on the SVG child
    // element are caught correctly. Use an AbortController to prevent the
    // listener from accumulating across re-renders of the same container.
    if (this.deleteListenerAbortController) {
      this.deleteListenerAbortController.abort();
    }
    this.deleteListenerAbortController = new AbortController();
    container.addEventListener(
      'click',
      async (e) => {
        const btn = (e.target as Element).closest('.delete-stop-btn');
        if (!btn) {
          return;
        }
        console.log('[StopViewController] Delete button clicked');
        const stop_id = btn.getAttribute('data-stop-id');
        console.log('[StopViewController] stop_id from button:', stop_id);
        if (stop_id) {
          await this.dependencies.onDeleteStop(stop_id);
        }
      },
      { signal: this.deleteListenerAbortController.signal }
    );
  }

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
}

// SERVICE_REF_ROW is used by page-content-renderer's event delegation — re-export
// so callers don't need to import entity-references directly for this class.
export { SERVICE_REF_ROW };
