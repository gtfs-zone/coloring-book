/**
 * Service View Controller
 *
 * Comprehensive service view implementation with inline editing and related routes/trips.
 * Provides a single-column layout showing service properties (weekly pattern editor)
 * and related transit routes/trips.
 */

import type { Agency, Routes, Trips } from '../types/gtfs.js';
import type { QueryOnlyDatabase } from '../utils/field-component.js';
import { normalizeAgencyId } from '../utils/agency-helpers.js';

export interface ServiceViewDependencies {
  gtfsDatabase?: QueryOnlyDatabase;
  gtfsRelationships?: {
    getRoutesForService?: (service_id: string) => Promise<unknown[]>;
    getTripsForService?: (service_id: string) => Promise<unknown[]>;
  };
  serviceDaysController: {
    renderServiceEditor: (service_id: string) => Promise<string>;
  };
  onAgencyClick?: (agency_id: string) => void;
  onRouteClick: (route_id: string) => void;
  onTimetableClick: (
    route_id: string,
    service_id: string,
    direction_id?: string
  ) => void;
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

      const html = `
        <div class="p-4 space-y-4">
          ${await this.renderServiceProperties(service_id)}
          ${this.renderRelatedRoutes(routes, agencies, service_id)}
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
  private async renderServiceProperties(service_id: string): Promise<string> {
    // Use the service days controller to render the weekly pattern editor
    const serviceEditorHTML =
      await this.dependencies.serviceDaysController.renderServiceEditor(
        service_id
      );

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Service Schedule</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${serviceEditorHTML}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render related routes section with DaisyUI table-pin-rows
   */
  private renderRelatedRoutes(
    routes: Routes[],
    agencies: Agency[],
    service_id: string
  ): string {
    if (routes.length === 0) {
      return `
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">Routes Using This Service</h2>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="text-center py-6 opacity-70">
                No routes are using this service.
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Group routes by agency
    const routesByAgency = new Map<string, Routes[]>();
    routes.forEach((route) => {
      const agency_id = normalizeAgencyId(route.agency_id);
      if (!routesByAgency.has(agency_id)) {
        routesByAgency.set(agency_id, []);
      }
      routesByAgency.get(agency_id)?.push(route);
    });

    // Build table with pinned rows
    let tableHTML = '';

    // If we have agencies, group by agency
    if (agencies.length > 0) {
      agencies.forEach((agency) => {
        const agencyRoutes =
          routesByAgency.get(normalizeAgencyId(agency.agency_id)) || [];
        if (agencyRoutes.length === 0) {
          return;
        }

        // Agency header (pinned row) - clickable
        tableHTML += `
          <thead>
            <tr>
              <th colspan="3" class="bg-base-200">
                <div class="flex items-center justify-between">
                  <span class="font-semibold link link-hover agency-link cursor-pointer" data-agency-id="${agency.agency_id}">${agency.agency_name || agency.agency_id}</span>
                  <div class="badge badge-outline">${agencyRoutes.length} route${agencyRoutes.length !== 1 ? 's' : ''}</div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            ${agencyRoutes
              .map(
                (route) => `
              <tr class="hover">
                <td class="cursor-pointer route-row" data-route-id="${route.route_id}">
                  <div class="font-medium">${route.route_short_name || route.route_long_name || route.route_id}</div>
                  ${route.route_long_name && route.route_short_name ? `<div class="text-sm opacity-70">${route.route_long_name}</div>` : ''}
                </td>
                <td class="text-right">
                  ${route.route_color ? `<div class="badge" style="background-color: #${route.route_color}; color: #${route.route_text_color || 'FFFFFF'};">${route.route_short_name || 'Route'}</div>` : ''}
                </td>
                <td class="text-right">
                  <button class="btn btn-xs btn-ghost timetable-btn" data-route-id="${route.route_id}" data-service-id="${service_id}">
                    Timetable
                  </button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        `;
      });
    } else {
      // No agencies, just show routes
      tableHTML = `
        <thead>
          <tr>
            <th>Route</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${routes
            .map(
              (route) => `
            <tr class="hover">
              <td class="cursor-pointer route-row" data-route-id="${route.route_id}">
                <div class="font-medium">${route.route_short_name || route.route_long_name || route.route_id}</div>
                ${route.route_long_name && route.route_short_name ? `<div class="text-sm opacity-70">${route.route_long_name}</div>` : ''}
              </td>
              <td class="text-right">
                ${route.route_color ? `<div class="badge" style="background-color: #${route.route_color}; color: #${route.route_text_color || 'FFFFFF'};">${route.route_short_name || 'Route'}</div>` : ''}
              </td>
              <td class="text-right">
                <button class="btn btn-xs btn-ghost timetable-btn" data-route-id="${route.route_id}" data-service-id="${service_id}">
                  Timetable
                </button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      `;
    }

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Routes Using This Service</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-0">
            <table class="table table-pin-rows">
              ${tableHTML}
            </table>
          </div>
        </div>
      </div>
    `;
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
    // Route row clicks
    const routeRows = container.querySelectorAll('.route-row');
    routeRows.forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });

    // Agency link clicks
    const agencyLinks = container.querySelectorAll('.agency-link');
    agencyLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const agency_id = link.getAttribute('data-agency-id');
        if (agency_id && this.dependencies.onAgencyClick) {
          this.dependencies.onAgencyClick(agency_id);
        }
      });
    });

    // Timetable button clicks
    const timetableButtons = container.querySelectorAll('.timetable-btn');
    timetableButtons.forEach((button) => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const route_id = button.getAttribute('data-route-id');
        const service_id = button.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    });
  }
}
