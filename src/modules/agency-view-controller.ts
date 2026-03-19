/**
 * Agency View Controller
 *
 * Comprehensive agency view implementation with inline editing and routes list.
 * Provides a single-column layout showing agency properties and related routes.
 */

import type { Agency, Routes } from '../types/gtfs.js';
import { notifications } from './notification-system.js';
import {
  renderFormFields,
  generateFieldConfigsFromSchema,
} from '../utils/field-component.js';
import { GTFS_TABLES, AgencySchema } from '../types/gtfs.js';

export interface AgencyViewDependencies {
  gtfsDatabase?: {
    queryRows: (
      tableName: string,
      filter?: Record<string, unknown>
    ) => Promise<unknown[]>;
    updateRow: (
      tableName: string,
      key: string,
      data: Record<string, unknown>
    ) => Promise<void>;
  };
  patchManager?: {
    recordUpdate: (
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>,
      description: string
    ) => Promise<void>;
  };
  onRouteClick: (route_id: string) => void;
}

/**
 * Enhanced agency object with dual property access
 */
interface EnhancedAgency {
  // Convenience shorthand properties
  id: string;
  name: string;

  // GTFS standard properties
  agency_id: string;
  agency_name: string;
  agency_url: string;
  agency_timezone: string;
  agency_lang?: string;
  agency_phone?: string;
  agency_fare_url?: string;
  agency_email?: string;
}

export class AgencyViewController {
  private dependencies: AgencyViewDependencies;
  private currentAgencyId: string | null = null;
  private fieldValues: Map<string, string> = new Map();

  constructor(dependencies: AgencyViewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Update dependencies (used when database becomes available)
   */
  updateDependencies(dependencies: AgencyViewDependencies): void {
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
  private renderAgencyProperties(agency: EnhancedAgency): string {
    // Generate field configurations from AgencySchema
    // This automatically includes all GTFS agency fields with proper types and validation
    const fieldConfigs = generateFieldConfigsFromSchema(
      AgencySchema,
      agency,
      GTFS_TABLES.AGENCY
    );

    // Render all fields using the reusable field component
    const fieldsHtml = renderFormFields(fieldConfigs);

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
   * Get enhanced agency data
   */
  private async getAgencyData(
    agency_id: string
  ): Promise<EnhancedAgency | null> {
    if (!this.dependencies.gtfsDatabase) {
      // Fallback to a basic agency object
      return {
        id: agency_id,
        name: agency_id,
        agency_id: agency_id,
        agency_name: agency_id,
        agency_url: '',
        agency_timezone: '',
      };
    }

    try {
      const agencies = await this.dependencies.gtfsDatabase.queryRows(
        'agency',
        {
          agency_id,
        }
      );
      if (agencies.length === 0) {
        return null;
      }

      const agency = agencies[0] as Agency;
      return {
        // Convenience properties
        id: agency.agency_id,
        name: agency.agency_name || agency.agency_id,

        // GTFS standard properties
        agency_id: agency.agency_id,
        agency_name: agency.agency_name,
        agency_url: agency.agency_url,
        agency_timezone: agency.agency_timezone,
        agency_lang: agency.agency_lang,
        agency_phone: agency.agency_phone,
        agency_fare_url: agency.agency_fare_url,
        agency_email: agency.agency_email,
      };
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
   * Handle property updates with auto-save
   */
  async updateAgencyProperty(
    field: string,
    newValue: string
  ): Promise<boolean> {
    if (!this.currentAgencyId || !this.dependencies.gtfsDatabase) {
      const error = new Error('Database not available for editing');
      console.error(error);
      notifications.show('Database not available for editing', 'error');
      throw error;
    }

    try {
      // Get previous value for comparison
      const prevValue = this.fieldValues.get(field) || '';

      // Skip update if value hasn't changed
      if (newValue === prevValue) {
        return true;
      }

      // Convert values to appropriate types
      let processedValue: unknown = newValue;
      if (newValue === '') {
        // Convert empty strings to null for optional fields
        processedValue = null;
      }

      // Update database
      await this.dependencies.gtfsDatabase.updateRow(
        'agency',
        this.currentAgencyId,
        { [field]: processedValue }
      );

      // Record patch
      await this.dependencies.patchManager?.recordUpdate(
        'agency',
        this.currentAgencyId,
        { [field]: prevValue },
        { [field]: processedValue },
        `Updated ${this.getFieldDisplayName(field)} for agency ${this.currentAgencyId}`
      );

      // Store new value for future comparisons
      this.fieldValues.set(field, newValue);

      // Show descriptive notification
      const fieldDisplayName = this.getFieldDisplayName(field);
      const fromDisplay = prevValue || '(empty)';
      const toDisplay = newValue || '(empty)';

      notifications.showSuccess(
        `Updated ${fieldDisplayName} from "${fromDisplay}" to "${toDisplay}" for ${this.currentAgencyId}`,
        { duration: 3000 }
      );

      return true;
    } catch (error) {
      console.error('Error updating agency property:', error);
      notifications.showError(`Failed to update ${field}`);
      return false;
    }
  }

  /**
   * Add event listeners for interactive elements
   */
  addEventListeners(container: HTMLElement): void {
    // Property input handlers with auto-save using the field component utility
    // Only attach to agency fields (data-table="agency.txt")
    const agencyFields = container.querySelectorAll(
      '[data-field][data-table="agency.txt"]'
    );
    agencyFields.forEach((input) => {
      const field = input.getAttribute('data-field');
      if (!field) {
        return;
      }

      // Store initial value for comparison
      const initialValue = (
        input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      ).value;
      this.fieldValues.set(field, initialValue);

      const handleUpdate = async () => {
        const value = (
          input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        ).value;
        await this.updateAgencyProperty(field, value);
      };

      // Use 'change' event to fire when value changes and element loses focus
      input.addEventListener('change', handleUpdate);
    });

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
   * Get human-readable field display name
   */
  private getFieldDisplayName(field: string): string {
    const fieldNames: Record<string, string> = {
      agency_id: 'Agency ID',
      agency_name: 'Agency Name',
      agency_url: 'URL',
      agency_timezone: 'Timezone',
      agency_lang: 'Language',
      agency_phone: 'Phone',
      agency_fare_url: 'Fare URL',
      agency_email: 'Email',
    };
    return fieldNames[field] || field;
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
