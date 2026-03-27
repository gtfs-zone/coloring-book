/**
 * Agency View Controller
 *
 * Comprehensive agency view implementation with inline editing and routes list.
 * Provides a single-column layout showing agency properties and related routes.
 */

import type { Agency, Routes } from '../types/gtfs.js';
import {
  renderEntityFields,
  type QueryOnlyDatabase,
} from '../utils/field-component.js';
import { GTFS_TABLES, AgencySchema } from '../types/gtfs.js';

export interface AgencyViewDependencies {
  gtfsDatabase?: QueryOnlyDatabase;
  onRouteClick: (route_id: string) => void;
}

export class AgencyViewController {
  private dependencies: AgencyViewDependencies;
  private currentAgencyId: string | null = null;

  constructor(dependencies: AgencyViewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Render comprehensive agency view
   */
  async renderAgencyView(agency_id: string): Promise<string> {
    this.currentAgencyId = agency_id;
    console.log('AgencyViewController: Rendering agency view for:', agency_id);

    try {
      // Get agency data
      const agency = await this.getAgencyData(agency_id);
      if (!agency) {
        return this.renderError('Agency not found.');
      }

      // Get related routes
      const routes = await this.getRoutesForAgency(agency_id);

      // Render complete view
      const html = `
        <div class="p-4 space-y-4">
          ${this.renderAgencyProperties(agency)}
          ${this.renderRoutesList(routes, agency_id)}
        </div>
      `;
      console.log('Agency view HTML length:', html.length);
      return html;
    } catch (error) {
      console.error('Error rendering agency view:', error);
      return this.renderError('Failed to load agency information.');
    }
  }

  /**
   * Render editable agency properties section
   */
  private renderAgencyProperties(agency: Agency): string {
    const fieldsHtml = renderEntityFields(
      AgencySchema,
      agency as Record<string, string | number | undefined>,
      GTFS_TABLES.AGENCY,
      this.currentAgencyId ?? ''
    );

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Agency Properties</h2>
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
   * Render routes list section
   */
  private renderRoutesList(routes: Routes[], agency_id: string): string {
    const routeItems = routes
      .map((route) => this.renderRouteItem(route))
      .join('');

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-4">
          <h2 class="text-lg font-semibold">Routes</h2>
          <div class="flex items-center gap-2">
            <input
              type="text"
              class="input input-sm input-bordered"
              placeholder="New Route ID"
              data-inline-create="route"
              data-agency-id="${agency_id}"
              style="width: 150px;"
            />
            <div class="badge badge-outline">${routes.length} route${routes.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${
              routes.length === 0
                ? `<div class="text-center py-6 opacity-70">
                    No routes found for this agency.
                  </div>`
                : `<div class="space-y-2">
                    ${routeItems}
                  </div>`
            }
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render individual route item
   */
  private renderRouteItem(route: Routes): string {
    const routeId = route.route_id;
    const routeShortName = route.route_short_name || route.route_id;
    const routeLongName = route.route_long_name || '';
    const routeColor = route.route_color ? `#${route.route_color}` : '#6366f1';

    return `
      <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors route-item"
           data-route-id="${routeId}">
        <div class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${routeColor}"></div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold">${routeShortName}</span>
            ${routeLongName ? `<span class="text-sm opacity-70 truncate">${routeLongName}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get agency data from database
   */
  private async getAgencyData(agency_id: string): Promise<Agency | null> {
    if (!this.dependencies.gtfsDatabase) {
      return {
        agency_id,
        agency_name: agency_id,
        agency_url: '',
        agency_timezone: '',
      } as Agency;
    }

    try {
      const agencies = await this.dependencies.gtfsDatabase.queryRows(
        'agency',
        { agency_id }
      );
      if (agencies.length === 0) {
        return null;
      }
      return agencies[0] as Agency;
    } catch (error) {
      console.error('Error getting agency data:', error);
      return null;
    }
  }

  /**
   * Get routes for this agency
   */
  private async getRoutesForAgency(agency_id: string): Promise<Routes[]> {
    if (!this.dependencies.gtfsDatabase) {
      return [];
    }

    try {
      const routes = await this.dependencies.gtfsDatabase.queryRows('routes', {
        agency_id,
      });
      return routes as Routes[];
    } catch (error) {
      console.error('Error getting routes for agency:', error);
      return [];
    }
  }

  /**
   * Add event listeners for interactive elements
   */
  addEventListeners(container: HTMLElement): void {
    // Route item clicks
    const routeItems = container.querySelectorAll('.route-item');
    routeItems.forEach((item) => {
      item.addEventListener('click', () => {
        const route_id = item.getAttribute('data-route-id');
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
