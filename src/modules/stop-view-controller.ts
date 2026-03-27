/**
 * Stop View Controller
 *
 * Comprehensive stop view implementation with inline editing and transit network relationships.
 * Provides a single-column layout showing stop properties and related transit services.
 */

import type { Agency, Routes, Stops, Trips, StopTimes } from '../types/gtfs.js';
import {
  renderFormFields,
  generateFieldConfigsFromSchema,
} from '../utils/field-component.js';
import { GTFS_TABLES, StopsSchema } from '../types/gtfs.js';

export interface StopViewDependencies {
  gtfsDatabase?: {
    queryRows: (
      tableName: string,
      filter?: Record<string, unknown>
    ) => Promise<unknown[]>;
  };
  gtfsRelationships?: {
    getAgenciesServingStop?: (stop_id: string) => Promise<unknown[]>;
    getRoutesServingStop?: (stop_id: string) => Promise<unknown[]>;
  };
  onAgencyClick: (agency_id: string) => void;
  onRouteClick: (route_id: string) => void;
}

/**
 * Enhanced stop object with dual property access
 */
interface EnhancedStop {
  // Convenience shorthand properties
  id: string;
  name: string;

  // GTFS standard properties
  stop_id: string;
  stop_name: string;
  stop_lat?: number;
  stop_lon?: number;
  stop_code?: string;
  stop_desc?: string;
  location_type?: number;
  parent_station?: string;
  wheelchair_boarding?: number;
  platform_code?: string;
  zone_id?: string;
}

export class StopViewController {
  private dependencies: StopViewDependencies;
  private currentStopId: string | null = null;

  constructor(dependencies: StopViewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Update dependencies (used when database becomes available)
   */
  updateDependencies(dependencies: StopViewDependencies): void {
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

      // Get related transit data
      const [agencies, routes] = await Promise.all([
        this.getAgenciesServingStop(stop_id),
        this.getRoutesServingStop(stop_id),
      ]);

      // Render complete view - don't set height/overflow, let parent handle it
      const html = `
        <div class="p-4 space-y-4">
          ${this.renderStopProperties(stop)}
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
  private renderStopProperties(stop: EnhancedStop): string {
    // Generate field configurations from StopsSchema
    // This automatically includes all GTFS stop fields with proper types and validation
    const fieldConfigs = generateFieldConfigsFromSchema(
      StopsSchema,
      stop,
      GTFS_TABLES.STOPS
    ).map((c) => ({ ...c, recordId: this.currentStopId ?? '' }));

    // Render all fields using the reusable field component
    const fieldsHtml = renderFormFields(fieldConfigs);

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Stop Properties</h2>
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
            ${agencyRoutes.map((route) => this.renderRouteCard(route)).join('')}
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
   * Get enhanced stop data
   */
  private async getStopData(stop_id: string): Promise<EnhancedStop | null> {
    if (!this.dependencies.gtfsDatabase) {
      // Fallback to a basic stop object
      return {
        id: stop_id,
        name: stop_id,
        stop_id: stop_id,
        stop_name: stop_id,
      };
    }

    try {
      const stops = await this.dependencies.gtfsDatabase.queryRows('stops', {
        stop_id,
      });
      if (stops.length === 0) {
        return null;
      }

      const stop = stops[0] as Stops;
      return {
        // Convenience properties
        id: stop.stop_id,
        name: stop.stop_name || stop.stop_id,

        // GTFS standard properties
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        stop_lat: parseFloat(stop.stop_lat as string) || undefined,
        stop_lon: parseFloat(stop.stop_lon as string) || undefined,
        stop_code: stop.stop_code,
        stop_desc: stop.stop_desc,
        location_type: parseInt(stop.location_type as string) || undefined,
        parent_station: stop.parent_station,
        wheelchair_boarding:
          parseInt(stop.wheelchair_boarding as string) || undefined,
        platform_code: stop.platform_code,
        zone_id: stop.zone_id,
      };
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
      const stopTimes = await this.dependencies.gtfsDatabase.queryRows(
        'stop_times',
        { stop_id }
      );
      const tripIds = [
        ...new Set(stopTimes.map((st: StopTimes) => st.trip_id)),
      ];

      if (tripIds.length === 0) {
        return [];
      }

      // Get routes from trips
      const allTrips = await this.dependencies.gtfsDatabase.queryRows('trips');
      const relevantTrips = allTrips.filter((trip: Trips) =>
        tripIds.includes(trip.trip_id)
      );
      const routeIds = [
        ...new Set(relevantTrips.map((trip: Trips) => trip.route_id)),
      ];

      // Get agencies from routes
      const allRoutes =
        await this.dependencies.gtfsDatabase.queryRows('routes');
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
      const agencies = await this.dependencies.gtfsDatabase.queryRows('agency');
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
      const stopTimes = await this.dependencies.gtfsDatabase.queryRows(
        'stop_times',
        { stop_id }
      );
      const tripIds = [
        ...new Set(stopTimes.map((st: StopTimes) => st.trip_id)),
      ];

      if (tripIds.length === 0) {
        return [];
      }

      // Get routes from trips
      const allTrips = await this.dependencies.gtfsDatabase.queryRows('trips');
      const relevantTrips = allTrips.filter((trip: Trips) =>
        tripIds.includes(trip.trip_id)
      );
      const routeIds = [
        ...new Set(relevantTrips.map((trip: Trips) => trip.route_id)),
      ];

      // Get route details
      const routes = await this.dependencies.gtfsDatabase.queryRows('routes');
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
