/**
 * Stop View Controller
 *
 * Comprehensive stop view implementation with inline editing and transit network relationships.
 * Provides a single-column layout showing stop properties and related transit services.
 */

import type { Agency, Routes, Stops, Trips, StopTimes } from '../types/gtfs.js';
import {
  renderEntityFields,
  type QueryOnlyDatabase,
} from '../utils/field-component.js';
import { GTFS_TABLES, StopsSchema } from '../types/gtfs.js';
import { getStopDisplay, renderCardLabel } from '../utils/entity-display.js';
import type { LevelOption } from './levels-controller.js';

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export interface StopViewDependencies {
  gtfsDatabase?: QueryOnlyDatabase;
  gtfsRelationships?: {
    getAgenciesServingStop?: (stop_id: string) => Promise<unknown[]>;
    getRoutesServingStop?: (stop_id: string) => Promise<unknown[]>;
  };
  onAgencyClick: (agency_id: string) => void;
  onRouteClick: (route_id: string) => void;
  onStopClick?: (stop_id: string) => void;
  onDeleteStop: (stop_id: string) => Promise<void>;
  getLevelOptions?: () => Promise<LevelOption[]>;
}

export class StopViewController {
  private dependencies: StopViewDependencies;
  private currentStopId: string | null = null;
  private deleteListenerAbortController: AbortController | null = null;

  constructor(dependencies: StopViewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Render comprehensive stop view
   */
  async renderStopView(stop_id: string): Promise<string> {
    this.currentStopId = stop_id;
    console.log('StopViewController: Rendering stop view for:', stop_id);

    try {
      // Get stop data
      const stop = await this.getStopData(stop_id);
      if (!stop) {
        return this.renderError('Stop not found.');
      }

      const locationType =
        typeof stop.location_type === 'number'
          ? stop.location_type
          : parseInt(stop.location_type ?? '0', 10) || 0;
      const isStation = locationType === 1;

      // Get related transit data, level options, and (for stations) child stops in parallel
      const [agencies, routes, levelOptions, childStops] = await Promise.all([
        this.getAgenciesServingStop(stop_id),
        this.getRoutesServingStop(stop_id),
        this.dependencies.getLevelOptions?.() ?? Promise.resolve([]),
        isStation ? this.getChildStops(stop_id) : Promise.resolve([]),
      ]);

      // Render complete view - don't set height/overflow, let parent handle it
      const html = `
        <div class="p-4 space-y-4">
          ${this.renderStopProperties(stop, levelOptions)}
          ${isStation ? this.renderChildStopsSection(childStops) : ''}
          ${this.renderTransitNetwork(agencies, routes)}
        </div>
      `;
      console.log('Stop view HTML length:', html.length);
      return html;
    } catch (error) {
      console.error('Error rendering stop view:', error);
      return this.renderError('Failed to load stop information.');
    }
  }

  /**
   * Render editable stop properties section
   */
  private renderStopProperties(
    stop: Stops,
    levelOptions: LevelOption[]
  ): string {
    let fieldsHtml = renderEntityFields(
      StopsSchema,
      stop as Record<string, string | number | undefined>,
      GTFS_TABLES.STOPS,
      this.currentStopId ?? ''
    );

    // Replace the level_id text input with a <select> populated from levels
    if (this.dependencies.getLevelOptions) {
      const currentValue = String(stop.level_id ?? '');
      const optionsHtml =
        `<option value="">— no level —</option>` +
        levelOptions
          .map(
            (opt) =>
              `<option value="${escapeAttr(opt.value)}"${opt.value === currentValue ? ' selected' : ''}>${escapeAttr(opt.label)}</option>`
          )
          .join('');
      const hint =
        levelOptions.length === 0
          ? `<div class="text-xs opacity-60 mt-1">Add levels via the Levels button in the nav bar.</div>`
          : '';
      // Match the input rendered by field-component for level_id
      fieldsHtml = fieldsHtml.replace(
        /<input([^>]*data-field="level_id"[^>]*)>/,
        (_match, attrs) => {
          // Strip value attribute — select uses <option selected> instead
          const attrsClean = attrs.replace(/\s*value="[^"]*"/, '');
          return `<select${attrsClean} class="select select-bordered select-sm w-full">${optionsHtml}</select>${hint}`;
        }
      );
    }

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">${renderCardLabel(getStopDisplay(stop as unknown as Record<string, string>))}</h2>
          <button class="btn btn-sm btn-error btn-outline delete-stop-btn" data-stop-id="${stop.stop_id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
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

  /**
   * Render transit network relationships
   */
  private renderTransitNetwork(agencies: Agency[], routes: Routes[]): string {
    if (agencies.length === 0) {
      return `
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">Transit Network</h2>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="text-center py-6 opacity-70">
                This stop is not served by any routes.
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Group routes by agency
    const routesByAgency = new Map();
    routes.forEach((route) => {
      const agency_id = route.agency_id || 'default';
      if (!routesByAgency.has(agency_id)) {
        routesByAgency.set(agency_id, []);
      }
      routesByAgency.get(agency_id).push(route);
    });

    const agencySections = agencies
      .map((agency) => {
        const agencyRoutes = routesByAgency.get(agency.agency_id) || [];

        return `
        <div class="mb-6">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <h3 class="text-lg font-semibold">${agency.agency_name || agency.agency_id}</h3>
              <div class="badge badge-outline">${agencyRoutes.length} route${agencyRoutes.length !== 1 ? 's' : ''}</div>
            </div>
            <button class="btn btn-sm btn-outline agency-view-btn" data-agency-id="${agency.agency_id}">
              View Agency
            </button>
          </div>

          <div class="grid grid-cols-1 gap-2">
            ${(agencyRoutes as Routes[]).map((route: Routes) => this.renderRouteCard(route)).join('')}
          </div>
        </div>
      `;
      })
      .join('');

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Transit Network</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${agencySections}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render individual route card
   */
  private renderRouteCard(route: Routes): string {
    const routeName =
      route.route_short_name || route.route_long_name || route.route_id;
    const routeDescription = route.route_long_name || route.route_desc || '';

    return `
      <div class="card bg-base-100 border hover:shadow-md transition-shadow cursor-pointer route-card-mini"
           data-route-id="${route.route_id}">
        <div class="card-body p-2">
          <div class="flex items-center gap-2">
            <div class="badge badge-primary badge-sm">${routeName}</div>
            ${routeDescription ? `<div class="text-sm opacity-70 truncate flex-1">${routeDescription}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get all child stops of a station (stops where parent_station = station_id)
   */
  private async getChildStops(station_id: string): Promise<Stops[]> {
    if (!this.dependencies.gtfsDatabase) {
      return [];
    }
    try {
      const rows = await this.dependencies.gtfsDatabase.queryRows('stops', {
        parent_station: station_id,
      });
      return rows as Stops[];
    } catch {
      return [];
    }
  }

  private readonly LOCATION_TYPE_LABELS: Record<number, string> = {
    0: 'Platform',
    2: 'Entrance/Exit',
    3: 'Generic Node',
    4: 'Boarding Area',
  };

  /**
   * Render child stops section for a station
   */
  private renderChildStopsSection(children: Stops[]): string {
    if (children.length === 0) {
      return `
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">Child Stops</h2>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="text-center py-4 opacity-70">No child stops defined.</div>
            </div>
          </div>
        </div>
      `;
    }

    const rows = children
      .map((child) => {
        const locType =
          typeof child.location_type === 'number'
            ? child.location_type
            : parseInt(child.location_type ?? '0', 10) || 0;
        const typeLabel =
          this.LOCATION_TYPE_LABELS[locType] ?? `Type ${locType}`;
        const name = child.stop_name || child.stop_id;
        return `
          <div class="flex items-center justify-between py-2 border-b last:border-b-0">
            <div>
              <span class="font-mono text-sm">${escapeAttr(child.stop_id)}</span>
              ${name !== child.stop_id ? `<span class="ml-2 opacity-70">${escapeAttr(name)}</span>` : ''}
              <span class="ml-2 badge badge-outline badge-sm">${escapeAttr(typeLabel)}</span>
            </div>
            <button class="btn btn-xs btn-ghost child-stop-btn" data-stop-id="${escapeAttr(child.stop_id)}">View</button>
          </div>
        `;
      })
      .join('');

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Child Stops</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${rows}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get stop data from database
   */
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

  /**
   * Get agencies serving this stop
   */
  private async getAgenciesServingStop(stop_id: string): Promise<Agency[]> {
    if (!this.dependencies.gtfsDatabase) {
      return [];
    }

    try {
      // Get all routes that serve this stop via stop_times
      const stopTimes = (await this.dependencies.gtfsDatabase.queryRows(
        'stop_times',
        { stop_id }
      )) as StopTimes[];
      const tripIds = [
        ...new Set(stopTimes.map((st: StopTimes) => st.trip_id)),
      ];

      if (tripIds.length === 0) {
        return [];
      }

      // Get routes from trips
      const allTrips = (await this.dependencies.gtfsDatabase.queryRows(
        'trips'
      )) as Trips[];
      const relevantTrips = allTrips.filter((trip: Trips) =>
        tripIds.includes(trip.trip_id)
      );
      const routeIds = [
        ...new Set(relevantTrips.map((trip: Trips) => trip.route_id)),
      ];

      // Get agencies from routes
      const allRoutes = (await this.dependencies.gtfsDatabase.queryRows(
        'routes'
      )) as Routes[];
      const relevantRoutes = allRoutes.filter((route: Routes) =>
        routeIds.includes(route.route_id)
      );
      const agencyIds = [
        ...new Set(
          relevantRoutes
            .map((route: Routes) => route.agency_id)
            .filter((id) => id)
        ),
      ];

      // Get agency details
      const agencies = (await this.dependencies.gtfsDatabase.queryRows(
        'agency'
      )) as Agency[];
      return agencies.filter((agency: Agency) =>
        agencyIds.includes(agency.agency_id)
      );
    } catch (error) {
      console.error('Error getting agencies serving stop:', error);
      return [];
    }
  }

  /**
   * Get routes serving this stop
   */
  private async getRoutesServingStop(stop_id: string): Promise<Routes[]> {
    if (!this.dependencies.gtfsDatabase) {
      return [];
    }

    try {
      // Get all routes that serve this stop via stop_times
      const stopTimes = (await this.dependencies.gtfsDatabase.queryRows(
        'stop_times',
        { stop_id }
      )) as StopTimes[];
      const tripIds = [
        ...new Set(stopTimes.map((st: StopTimes) => st.trip_id)),
      ];

      if (tripIds.length === 0) {
        return [];
      }

      // Get routes from trips
      const allTrips = (await this.dependencies.gtfsDatabase.queryRows(
        'trips'
      )) as Trips[];
      const relevantTrips = allTrips.filter((trip: Trips) =>
        tripIds.includes(trip.trip_id)
      );
      const routeIds = [
        ...new Set(relevantTrips.map((trip: Trips) => trip.route_id)),
      ];

      // Get route details
      const routes = (await this.dependencies.gtfsDatabase.queryRows(
        'routes'
      )) as Routes[];
      return routes.filter((route: Routes) =>
        routeIds.includes(route.route_id)
      );
    } catch (error) {
      console.error('Error getting routes serving stop:', error);
      return [];
    }
  }

  /**
   * Add event listeners for interactive elements
   */
  addEventListeners(container: HTMLElement): void {
    // Agency view button clicks
    const agencyButtons = container.querySelectorAll('.agency-view-btn');
    agencyButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const agency_id = button.getAttribute('data-agency-id');
        if (agency_id) {
          this.dependencies.onAgencyClick(agency_id);
        }
      });
    });

    // Route card clicks
    const routeCards = container.querySelectorAll('.route-card-mini');
    routeCards.forEach((card) => {
      card.addEventListener('click', () => {
        const route_id = card.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });

    // Child stop links (station view)
    if (this.dependencies.onStopClick) {
      const childBtns = container.querySelectorAll('.child-stop-btn');
      childBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const stop_id = btn.getAttribute('data-stop-id');
          if (stop_id) {
            this.dependencies.onStopClick!(stop_id);
          }
        });
      });
    }

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
}
