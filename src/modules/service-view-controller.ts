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
import {
  renderRouteReference,
  ROUTE_REF_ROW,
  ENTITY_REF_BTN,
} from '../utils/entity-references.js';

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

      const html = `
        <div class="p-4 space-y-4">
          ${await this.renderServiceProperties(service_id)}
          ${this.renderTimetablesSection(routes, agencyNameByNormalizedId, tripCountByRoute, service_id)}
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

  private renderTimetablesSection(
    routes: Routes[],
    agencyNameByNormalizedId: Map<string, string>,
    tripCountByRoute: Map<string, number>,
    service_id: string
  ): string {
    if (routes.length === 0) {
      return `
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">Timetables</h2>
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

    const items = routes
      .map((route) => {
        const normalizedId = normalizeAgencyId(route.agency_id);
        return renderRouteReference(route as Record<string, unknown>, {
          agencyName: agencyNameByNormalizedId.get(normalizedId),
          tripCount: tripCountByRoute.get(route.route_id),
          service_id,
        });
      })
      .join('');

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Timetables</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="space-y-2">${items}</div>
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
    // Route reference row click → timetable
    const routeRows = container.querySelectorAll(`.${ROUTE_REF_ROW}`);
    routeRows.forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        const service_id = row.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    });

    // "View Route" button click → route page
    const entityBtns = container.querySelectorAll(`.${ENTITY_REF_BTN}`);
    entityBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const route_id = btn.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });
  }
}
