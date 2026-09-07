/**
 * Agency View Controller
 *
 * Comprehensive agency view implementation with inline editing and routes list.
 * Provides a single-column layout showing agency properties and related routes.
 */

import type { Agency, Routes } from '../types/gtfs.js';
import type { QueryOnlyDatabase } from '../utils/field-component.js';
import { renderInlineEntityFields } from '../utils/inline-editable-field.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import {
  normalizeAgencyId,
  agencyRouteFilter,
} from '../utils/agency-helpers.js';
import {
  renderRouteReference,
  ROUTE_REF_ROW,
} from '../utils/entity-references.js';
import { renderTrashIcon } from './modal-utils.js';

export interface AgencyViewDependencies {
  gtfsDatabase?: QueryOnlyDatabase;
  onRouteClick: (route_id: string) => void;
  onDeleteAgency?: (agency_id: string) => void;
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

      // Build trip count per route
      const allTrips = ((await this.dependencies.gtfsDatabase?.queryRows(
        'trips'
      )) ?? []) as Record<string, unknown>[];
      const routeIdSet = new Set(routes.map((r) => r.route_id));
      const tripCountByRoute = new Map<string, number>();
      for (const trip of allTrips) {
        const rid = trip.route_id as string;
        if (routeIdSet.has(rid)) {
          tripCountByRoute.set(rid, (tripCountByRoute.get(rid) ?? 0) + 1);
        }
      }

      // Render complete view
      const html = `
        <div class="p-4 space-y-4">
          ${await this.renderAgencyProperties(agency)}
          ${this.renderRoutesList(routes, agency_id, tripCountByRoute)}
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
  private async renderAgencyProperties(agency: Agency): Promise<string> {
    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.AGENCY,
      agency as Record<string, string | number | undefined>,
      this.currentAgencyId ?? ''
    );

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">Agency Properties</h2>
          <button class="btn btn-sm btn-error btn-outline delete-agency-btn" data-agency-id="${this.currentAgencyId ?? ''}" title="Delete">${renderTrashIcon()}</button>
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
   * Render routes list section
   */
  private renderRoutesList(
    routes: Routes[],
    agency_id: string,
    tripCountByRoute: Map<string, number>
  ): string {
    const routeItems = routes
      .map((route) =>
        renderRouteReference(route as Record<string, unknown>, {
          tripCount: tripCountByRoute.get(route.route_id),
        })
      )
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
        { agency_id: normalizeAgencyId(agency_id) }
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
      const allAgencies =
        await this.dependencies.gtfsDatabase.queryRows('agency');
      const agencyCount = allAgencies.length;
      const acceptedIds = agencyRouteFilter(agency_id, agencyCount);

      const routeArrays = await Promise.all(
        acceptedIds.map((id) =>
          this.dependencies.gtfsDatabase!.queryRows('routes', { agency_id: id })
        )
      );
      return routeArrays.flat() as Routes[];
    } catch (error) {
      console.error('Error getting routes for agency:', error);
      return [];
    }
  }

  /**
   * Add event listeners for interactive elements
   */
  addEventListeners(container: HTMLElement): void {
    // Route reference row clicks
    const routeItems = container.querySelectorAll(`.${ROUTE_REF_ROW}`);
    routeItems.forEach((item) => {
      item.addEventListener('click', () => {
        const route_id = item.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });

    // Delete agency button
    const deleteBtn = container.querySelector('.delete-agency-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const agency_id = deleteBtn.getAttribute('data-agency-id');
        if (agency_id && this.dependencies.onDeleteAgency) {
          this.dependencies.onDeleteAgency(agency_id);
        }
      });
    }
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
