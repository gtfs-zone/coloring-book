/**
 * Page Content Renderer
 *
 * Unified content rendering system for GTFS.zone Browse tab.
 * Renders appropriate content based on PageState, replacing fragmented
 * rendering logic across multiple modules.
 */

import { PageState } from '../types/page-state.js';
import {
  StopViewController,
  StopViewDependencies,
} from './stop-view-controller.js';
import {
  AgencyViewController,
  AgencyViewDependencies,
} from './agency-view-controller.js';
import {
  ServiceViewController,
  ServiceViewDependencies,
} from './service-view-controller.js';
import {
  renderFormFields,
  generateFieldConfigsFromSchema,
  renderEntityFormFields,
} from '../utils/field-component.js';
import { FeedInfoSchema, GTFS_TABLES } from '../types/gtfs.js';
import { InlineEntityCreator } from '../utils/inline-entity-creator.js';
import {
  attachFormPatchListeners,
  type FormPatchDeps,
} from '../utils/form-patch-bridge.js';
import type { GTFSDatabaseRecord } from './gtfs-database.js';
import { notifications } from './notification-system.js';

/**
 * Interface for injected dependencies
 */
export interface ContentRendererDependencies {
  // GTFS data relationships
  relationships: {
    getAgenciesAsync: () => Promise<unknown[]>;
    getRoutesForAgencyAsync: (agency_id: string) => Promise<unknown[]>;
    getTripsForRouteAsync: (route_id: string) => Promise<unknown[]>;
    getStopTimesForTripAsync: (trip_id: string) => Promise<unknown[]>;
    getStopAsync: (stop_id: string) => Promise<unknown>;
    getAgencyAsync: (agency_id: string) => Promise<unknown>;
    getRouteAsync: (route_id: string) => Promise<unknown>;
  };

  // GTFS database access for stop controller
  gtfsDatabase: {
    queryRows: (
      tableName: string,
      filter?: Record<string, unknown>
    ) => Promise<unknown[]>;
    updateRow: (
      tableName: string,
      key: string,
      data: Record<string, unknown>
    ) => Promise<void>;
    getRow: (tableName: string, key: string) => Promise<unknown | undefined>;
    getAllRows: (tableName: string) => Promise<unknown[]>;
    insertRows: (tableName: string, rows: unknown[]) => Promise<void>;
  };

  // GTFS relationships for stop controller (optional)
  gtfsRelationships?: {
    getAgenciesServingStop?: (stop_id: string) => Promise<unknown[]>;
    getRoutesServingStop?: (stop_id: string) => Promise<unknown[]>;
    getRoutesForService?: (service_id: string) => Promise<unknown[]>;
    getTripsForService?: (service_id: string) => Promise<unknown[]>;
  };

  // Schedule controller for timetables
  scheduleController: {
    renderSchedule: (
      route_id: string,
      service_id: string,
      direction_id?: string
    ) => Promise<string>;
  };

  // Service days controller for calendar editing
  serviceDaysController: {
    renderServiceEditor: (service_id: string) => Promise<string>;
  };

  // Map controller for visualization updates
  mapController: {
    highlightRoute: (route_id: string) => void;
    highlightStop: (stop_id: string) => void;
    clearHighlights: () => void;
    focusOnAgency: (agency_id: string) => void;
  };

  // Navigation callbacks
  onAgencyClick: (agency_id: string) => void;
  onRouteClick: (route_id: string) => void;
  onStopClick: (stop_id: string) => void;
  onServiceClick?: (service_id: string) => void;
  onTimetableClick: (
    route_id: string,
    service_id: string,
    direction_id?: string
  ) => void;
  onEntityCreated?: () => void;

  // Patch manager for recording edits
  patchManager?: {
    recordUpdate: (
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ) => Promise<void>;
    recordInsert: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
  };

  // Parser for reading in-memory GTFS data (used by patch bridge)
  parser?: {
    getFileDataSync: (fileName: string) => GTFSDatabaseRecord[];
  };
}

/**
 * Page Content Renderer
 */
export class PageContentRenderer {
  private dependencies: ContentRendererDependencies;
  private stopViewController: StopViewController;
  private agencyViewController: AgencyViewController;
  private serviceViewController: ServiceViewController;

  constructor(dependencies: ContentRendererDependencies) {
    this.dependencies = dependencies;

    // Initialize StopViewController with current dependencies
    const stopViewDependencies: StopViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      gtfsRelationships: dependencies.gtfsRelationships || {},
      onAgencyClick: dependencies.onAgencyClick,
      onRouteClick: dependencies.onRouteClick,
    };
    this.stopViewController = new StopViewController(stopViewDependencies);

    // Initialize AgencyViewController with current dependencies
    const agencyViewDependencies: AgencyViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      onRouteClick: dependencies.onRouteClick,
    };
    this.agencyViewController = new AgencyViewController(
      agencyViewDependencies
    );

    // Initialize ServiceViewController with current dependencies
    const serviceViewDependencies: ServiceViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      gtfsRelationships: dependencies.gtfsRelationships || {},
      serviceDaysController: dependencies.serviceDaysController,
      onAgencyClick: dependencies.onAgencyClick,
      onRouteClick: dependencies.onRouteClick,
      onTimetableClick: dependencies.onTimetableClick,
    };
    this.serviceViewController = new ServiceViewController(
      serviceViewDependencies
    );
  }

  /**
   * Main rendering method - renders content based on page state
   * @param pageState - Current page state to render
   * @returns HTML string for the content
   */
  async renderPage(pageState: PageState): Promise<string> {
    try {
      // Render based on page type
      switch (pageState.type) {
        case 'home':
          return await this.renderHome();
        case 'agency':
          return await this.renderAgency(pageState.agency_id);
        case 'route':
          return await this.renderRoute(pageState.route_id);
        case 'timetable':
          return await this.renderTimetable(
            pageState.route_id,
            pageState.service_id,
            pageState.direction_id
          );
        case 'stop':
          return await this.renderStop(pageState.stop_id);
        case 'service':
          return await this.renderService(pageState.service_id);
        default:
          // TypeScript should prevent this, but fallback to home
          return await this.renderHome();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error rendering page:', error);
      return this.renderError('Failed to load content. Please try again.');
    }
  }

  /**
   * Render loading state
   */
  renderLoading(): string {
    return `
      <div class="flex items-center justify-center p-8">
        <div class="loading loading-spinner loading-lg"></div>
        <span class="ml-3">Loading...</span>
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
   * Render home page (feed info and agencies list)
   */
  private async renderHome(): Promise<string> {
    const agencies = await this.dependencies.relationships.getAgenciesAsync();

    // Get feed_info data
    const feedInfo = await this.getFeedInfo();

    // Get all unique services
    const services = await this.getServices();

    const agencyItems = agencies
      .map((agency: unknown) => {
        const agencyData = agency as Record<string, unknown>;
        const agencyName =
          (agencyData.agency_name as string) ||
          (agencyData.agency_id as string) ||
          'Unknown Agency';

        return `
          <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors agency-card"
               data-agency-id="${agencyData.agency_id as string}">
            <div class="flex-1 min-w-0">
              <div class="font-semibold">${agencyName}</div>
            </div>
          </div>
        `;
      })
      .join('');

    const serviceItems = services
      .map((service: Record<string, unknown>) => {
        const serviceName = service.service_id as string;

        return `
          <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors service-card"
               data-service-id="${service.service_id as string}">
            <div class="flex-1 min-w-0">
              <div class="font-semibold">${serviceName}</div>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="p-4 space-y-4">
        ${feedInfo ? this.renderFeedInfoProperties(feedInfo) : ''}

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-lg font-semibold">Agencies</h2>
            <div class="flex items-center gap-2">
              <input
                type="text"
                class="input input-sm input-bordered"
                placeholder="New Agency ID"
                data-inline-create="agency"
                style="width: 150px;"
              />
              <div class="badge badge-outline">${agencies.length} agenc${agencies.length !== 1 ? 'ies' : 'y'}</div>
            </div>
          </div>
          ${
            agencies.length === 0
              ? `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="text-center py-6 opacity-70">
                      No agencies found in GTFS data.
                    </div>
                  </div>
                </div>`
              : `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="space-y-2">
                      ${agencyItems}
                    </div>
                  </div>
                </div>`
          }
        </div>

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-lg font-semibold">Services</h2>
            <div class="flex items-center gap-2">
              <input
                type="text"
                class="input input-sm input-bordered"
                placeholder="New Service ID"
                data-inline-create="service"
                style="width: 150px;"
              />
              <div class="badge badge-outline">${services.length} service${services.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          ${
            services.length === 0
              ? `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="text-center py-6 opacity-70">
                      No services found in GTFS data.
                    </div>
                  </div>
                </div>`
              : `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="space-y-2">
                      ${serviceItems}
                    </div>
                  </div>
                </div>`
          }
        </div>
      </div>
    `;
  }

  /**
   * Get feed_info data
   */
  private async getFeedInfo(): Promise<Record<string, unknown> | null> {
    try {
      const feedInfoRows =
        await this.dependencies.gtfsDatabase.queryRows('feed_info');
      return feedInfoRows.length > 0
        ? (feedInfoRows[0] as Record<string, unknown>)
        : null;
    } catch (error) {
      console.error('Error getting feed_info:', error);
      return null;
    }
  }

  /**
   * Get all services from calendar
   */
  private async getServices(): Promise<Record<string, unknown>[]> {
    try {
      // Get all services from calendar table
      const services =
        await this.dependencies.gtfsDatabase.getAllRows('calendar');
      return services;
    } catch (error) {
      console.error('Error getting services:', error);
      return [];
    }
  }

  /**
   * Render feed_info properties section
   */
  private renderFeedInfoProperties(feedInfo: Record<string, unknown>): string {
    // Generate field configurations from FeedInfoSchema
    const fieldConfigs = generateFieldConfigsFromSchema(
      FeedInfoSchema,
      feedInfo,
      GTFS_TABLES.FEED_INFO
    ).map((c) => ({ ...c, recordId: 'feed_info' }));

    // Render all fields using the reusable field component
    const fieldsHtml = renderFormFields(fieldConfigs);

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Feed Information</h2>
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
   * Render agency page (agency properties and routes list)
   */
  private async renderAgency(agency_id: string): Promise<string> {
    // Update map to focus on this agency
    this.dependencies.mapController.focusOnAgency(agency_id);

    // Update AgencyViewController dependencies in case database became available
    const agencyViewDependencies: AgencyViewDependencies = {
      gtfsDatabase: this.dependencies.gtfsDatabase,
      onRouteClick: this.dependencies.onRouteClick,
    };
    this.agencyViewController.updateDependencies(agencyViewDependencies);

    // Use the new AgencyViewController for comprehensive agency view
    return await this.agencyViewController.renderAgencyView(agency_id);
  }

  /**
   * Render route page (route properties + services list)
   */
  private async renderRoute(route_id: string): Promise<string> {
    const trips =
      await this.dependencies.relationships.getTripsForRouteAsync(route_id);

    // Update map to highlight this route
    this.dependencies.mapController.highlightRoute(route_id);

    // Group trips by service_id for service list
    const serviceGroups = trips.reduce(
      (groups: Record<string, unknown[]>, trip: unknown) => {
        const tripData = trip as Record<string, unknown>;
        const service_id = tripData.service_id as string;
        if (!groups[service_id]) {
          groups[service_id] = [];
        }
        groups[service_id].push(trip);
        return groups;
      },
      {}
    );

    // Fetch raw row data and render form fields
    const fieldsHtml = await renderEntityFormFields(
      GTFS_TABLES.ROUTES,
      route_id,
      this.dependencies.gtfsDatabase
    );

    // Render route properties section
    const routePropertiesHTML = `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Route Properties</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="max-w-md">
              ${fieldsHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    // Get all available services from calendar
    const allServices =
      await this.dependencies.gtfsDatabase.getAllRows('calendar');

    // Render new service selector
    const newServiceSelectorHTML =
      allServices.length > 0
        ? `
      <div class="space-y-2">
        <label class="label" for="new-service-select">
          Add timetable for service:
        </label>
        <select
          id="new-service-select"
          class="select select-bordered w-full"
          data-route-id="${route_id}"
        >
          <option value="">Choose a service...</option>
          ${allServices
            .filter((s) => !serviceGroups[s.service_id as string]) // Only show services without trips
            .map(
              (service) => `
              <option value="${service.service_id}">${service.service_id}</option>
            `
            )
            .join('')}
        </select>
      </div>
    `
        : '';

    // Render services list
    const servicesListHTML = `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Services</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            ${newServiceSelectorHTML}
            ${
              Object.keys(serviceGroups).length === 0 &&
              allServices.length === 0
                ? `<div class="text-center py-6 opacity-70">
                    No services found. Create a service first.
                  </div>`
                : Object.keys(serviceGroups).length === 0
                  ? `<div class="text-center py-6 opacity-70 mt-4">
                    No timetables yet. Select a service above to create one.
                  </div>`
                  : `<div class="space-y-2 ${newServiceSelectorHTML ? 'mt-4' : ''}">
                    ${Object.entries(serviceGroups)
                      .map(([service_id, serviceTrips]) => {
                        const tripCount = serviceTrips.length;
                        const directions = [
                          ...new Set(
                            serviceTrips.map(
                              (trip: unknown) =>
                                (trip as Record<string, unknown>).direction_id
                            )
                          ),
                        ];

                        return `
                          <div class="flex items-center justify-between p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors service-row"
                               data-service-id="${service_id}">
                            <div class="flex-1">
                              <div class="font-semibold">Service ${service_id}</div>
                              <div class="text-sm text-base-content/70">
                                ${tripCount} trip${tripCount !== 1 ? 's' : ''}
                                ${directions.length > 1 ? ' • Both directions' : ''}
                              </div>
                            </div>
                            <button class="btn btn-sm btn-ghost route-timetable-btn"
                                    data-route-id="${route_id}"
                                    data-service-id="${service_id}">
                              View Timetable
                            </button>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>`
            }
          </div>
        </div>
      </div>
    `;

    return `
      <div class="p-4 space-y-4">
        ${routePropertiesHTML}
        ${servicesListHTML}
      </div>
    `;
  }

  /**
   * Render timetable page
   */
  private async renderTimetable(
    route_id: string,
    service_id: string,
    direction_id?: string
  ): Promise<string> {
    try {
      // Get the rendered schedule HTML directly
      return await this.dependencies.scheduleController.renderSchedule(
        route_id,
        service_id,
        direction_id
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error rendering timetable:', error);
      return this.renderError('Failed to load timetable. Please try again.');
    }
  }

  /**
   * Render stop page
   */
  private async renderStop(stop_id: string): Promise<string> {
    // Update map to highlight this stop
    this.dependencies.mapController.highlightStop(stop_id);

    // Update StopViewController dependencies in case database became available
    const stopViewDependencies: StopViewDependencies = {
      gtfsDatabase: this.dependencies.gtfsDatabase,
      gtfsRelationships: this.dependencies.gtfsRelationships || {},
      onAgencyClick: this.dependencies.onAgencyClick,
      onRouteClick: this.dependencies.onRouteClick,
    };
    this.stopViewController.updateDependencies(stopViewDependencies);

    // Use the new StopViewController for comprehensive stop view
    return await this.stopViewController.renderStopView(stop_id);
  }

  /**
   * Render service page
   */
  private async renderService(service_id: string): Promise<string> {
    // Update ServiceViewController dependencies in case database became available
    const serviceViewDependencies: ServiceViewDependencies = {
      gtfsDatabase: this.dependencies.gtfsDatabase,
      gtfsRelationships: this.dependencies.gtfsRelationships || {},
      serviceDaysController: this.dependencies.serviceDaysController,
      onAgencyClick: this.dependencies.onAgencyClick,
      onRouteClick: this.dependencies.onRouteClick,
      onTimetableClick: this.dependencies.onTimetableClick,
    };
    this.serviceViewController.updateDependencies(serviceViewDependencies);

    // Use the new ServiceViewController for comprehensive service view
    return await this.serviceViewController.renderServiceView(service_id);
  }

  /**
   * Add event listeners for interactive elements
   * This should be called after the content is inserted into the DOM
   */
  addEventListeners(container: HTMLElement): void {
    // Agency card clicks
    const agencyCards = container.querySelectorAll('.agency-card');
    agencyCards.forEach((card) => {
      card.addEventListener('click', () => {
        const agency_id = card.getAttribute('data-agency-id');
        if (agency_id) {
          this.dependencies.onAgencyClick(agency_id);
        }
      });
    });

    // Service card clicks
    const serviceCards = container.querySelectorAll('.service-card');
    serviceCards.forEach((card) => {
      card.addEventListener('click', () => {
        const service_id = card.getAttribute('data-service-id');
        if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // Route card clicks
    const routeCards = container.querySelectorAll('.route-card');
    routeCards.forEach((card) => {
      card.addEventListener('click', () => {
        const route_id = card.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });

    // Service timetable button clicks (route page)
    const routeTimetableButtons = container.querySelectorAll(
      '.route-timetable-btn'
    );
    routeTimetableButtons.forEach((button) => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const route_id = button.getAttribute('data-route-id');
        const service_id = button.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    });

    // Service row clicks (route page)
    const serviceRows = container.querySelectorAll('.service-row');
    serviceRows.forEach((row) => {
      row.addEventListener('click', () => {
        const service_id = row.getAttribute('data-service-id');
        if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // Service link clicks (on route page)
    const serviceLinks = container.querySelectorAll('.service-link');
    serviceLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event bubbling
        const service_id = link.getAttribute('data-service-id');
        if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // Add StopViewController event listeners
    // It will only attach to stop fields (data-table="stops.txt")
    this.stopViewController.addEventListeners(container);

    // Add AgencyViewController event listeners
    // It will only attach to agency fields (data-table="agency.txt")
    this.agencyViewController.addEventListeners(container);

    // Add ServiceViewController event listeners
    // It will only attach to service-related elements
    this.serviceViewController.addEventListeners(container);

    // Add feed_info field patch listeners via bridge
    if (this.dependencies.patchManager && this.dependencies.parser) {
      const patchDeps: FormPatchDeps = {
        patchManager: this.dependencies.patchManager,
        parser: this.dependencies.parser,
      };
      attachFormPatchListeners(container, patchDeps);
    }

    // Add inline entity creation event listeners
    this.addInlineCreationListeners(container);

    // Add service selection dropdown listener
    this.addServiceSelectionListener(container);
  }

  /**
   * Add event listeners for inline entity creation
   */
  private addInlineCreationListeners(container: HTMLElement): void {
    const inlineCreator = new InlineEntityCreator(
      this.dependencies.gtfsDatabase,
      notifications,
      () => {
        // Refresh the page after entity creation
        if (this.dependencies.onEntityCreated) {
          this.dependencies.onEntityCreated();
        }
      },
      this.dependencies.patchManager
    );

    // Find all inline creation inputs
    const createInputs = container.querySelectorAll('[data-inline-create]');
    createInputs.forEach((input) => {
      const entityType = input.getAttribute('data-inline-create');

      // Handle blur event to create entity
      input.addEventListener('blur', async () => {
        const value = (input as HTMLInputElement).value.trim();
        if (!value) {
          return;
        }

        let success = false;
        if (entityType === 'agency') {
          success = await inlineCreator.createAgency(value);
        } else if (entityType === 'service') {
          success = await inlineCreator.createService(value);
        } else if (entityType === 'route') {
          const agencyId = input.getAttribute('data-agency-id') || undefined;
          success = await inlineCreator.createRoute(value, agencyId);
        }

        // Clear input if successful
        if (success) {
          (input as HTMLInputElement).value = '';
        }
      });

      // Handle Enter key
      input.addEventListener('keydown', async (e: Event) => {
        const keyEvent = e as KeyboardEvent;
        if (keyEvent.key === 'Enter') {
          (input as HTMLElement).blur();
        }
      });
    });
  }

  /**
   * Add event listener for service selection dropdown
   */
  private addServiceSelectionListener(container: HTMLElement): void {
    const serviceSelect = container.querySelector(
      '#new-service-select'
    ) as HTMLSelectElement;
    if (!serviceSelect) {
      return;
    }

    serviceSelect.addEventListener('change', () => {
      const selectedServiceId = serviceSelect.value;
      const routeId = serviceSelect.getAttribute('data-route-id');

      if (!selectedServiceId || !routeId) {
        return;
      }

      // Navigate directly to timetable view
      this.dependencies.onTimetableClick(routeId, selectedServiceId);

      // Reset the dropdown
      serviceSelect.value = '';
    });
  }
}
