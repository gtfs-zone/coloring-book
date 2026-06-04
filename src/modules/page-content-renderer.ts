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
  PathwayViewController,
  PathwayViewDependencies,
} from './pathway-view-controller.js';
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
import { notify } from './notification-system.js';
import {
  getAgencyDisplay,
  getServiceDisplay,
  getRouteDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display.js';
import { showModal, renderTrashIcon } from './modal-utils.js';
import { navigateToHome } from './navigation-actions.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { normalizeAgencyId } from '../utils/agency-helpers.js';
import {
  renderServiceReference,
  SERVICE_REF_ROW,
  STOP_REF_ROW,
  PATHWAY_REF_ROW,
  ENTITY_REF_BTN,
} from '../utils/entity-references.js';

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
    getRow: (tableName: string, key: string) => Promise<unknown | undefined>;
    getAllRows: (tableName: string) => Promise<unknown[]>;
    insertRows: (tableName: string, rows: unknown[]) => Promise<void>;
    updateRow?: (
      tableName: string,
      key: string,
      data: Record<string, unknown>
    ) => Promise<void>;
    deleteRow?: (tableName: string, key: string) => Promise<void>;
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
    highlightPathway: (pathway_id: string) => void;
    clearHighlights: () => void;
    focusOnAgency: (agency_id: string) => void;
    refreshStops: () => void;
    focusFeed: () => void;
  };

  // Navigation callbacks
  onAgencyClick: (agency_id: string) => void;
  onRouteClick: (route_id: string) => void;
  onStopClick: (stop_id: string) => void;
  onPathwayClick?: (pathway_id: string) => void;
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
    recordDelete: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
    recordBatchInsert: (
      ops: Array<{
        table: string;
        id: string;
        record: Record<string, unknown>;
      }>,
      label?: string
    ) => Promise<void>;
    recordBatchDelete: (
      ops: Array<{
        table: string;
        id: string;
        record: Record<string, unknown>;
      }>,
      label?: string
    ) => Promise<void>;
  };

  // Parser for reading in-memory GTFS data (used by patch bridge)
  parser?: {
    getFileDataSync: (fileName: string) => GTFSDatabaseRecord[];
  };

  // Optional: supply level options for the level_id dropdown in stop view
  getLevelOptions?: () => Promise<{ value: string; label: string }[]>;
}

/**
 * Page Content Renderer
 */
export class PageContentRenderer {
  private dependencies: ContentRendererDependencies;
  private stopViewController: StopViewController;
  private agencyViewController: AgencyViewController;
  private serviceViewController: ServiceViewController;
  private pathwayViewController: PathwayViewController;

  constructor(dependencies: ContentRendererDependencies) {
    this.dependencies = dependencies;

    // Initialize StopViewController with current dependencies
    const stopViewDependencies: StopViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      gtfsRelationships: dependencies.gtfsRelationships || {},
      onStopClick: dependencies.onStopClick,
      onPathwayClick: dependencies.onPathwayClick,
      onTimetableClick: dependencies.onTimetableClick,
      onDeleteStop: (stop_id) => this.handleDeleteStop(stop_id),
      getLevelOptions: dependencies.getLevelOptions,
    };
    this.stopViewController = new StopViewController(stopViewDependencies);

    // Initialize PathwayViewController
    const pathwayViewDependencies: PathwayViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      onStopClick: dependencies.onStopClick,
      onDeletePathway: (pathway_id) => this.handleDeletePathway(pathway_id),
    };
    this.pathwayViewController = new PathwayViewController(
      pathwayViewDependencies
    );

    // Initialize AgencyViewController with current dependencies
    const agencyViewDependencies: AgencyViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      onRouteClick: dependencies.onRouteClick,
      onDeleteAgency: (agency_id) => this.handleDeleteAgency(agency_id),
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
      onDeleteService: (service_id) => this.handleDeleteService(service_id),
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
        case 'pathway':
          return await this.renderPathway(pageState.pathway_id);
        default:
          // TypeScript should prevent this, but fallback to home
          return await this.renderHome();
      }
    } catch (error) {
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
    this.dependencies.mapController.focusFeed();
    const agencies = await this.dependencies.relationships.getAgenciesAsync();

    // Get feed_info data
    const feedInfo = await this.getFeedInfo();

    // Get all unique services
    const services = await this.getServices();

    const agencyItems = agencies
      .map((agency: unknown) => {
        const agencyData = agency as Record<string, string>;

        return `
          <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors agency-card"
               data-agency-id="${normalizeAgencyId(agencyData.agency_id as string)}">
            <div class="flex-1 min-w-0">
              <div class="font-semibold">${renderCardLabel(getAgencyDisplay(agencyData))}</div>
            </div>
          </div>
        `;
      })
      .join('');

    const allTrips = (await this.dependencies.gtfsDatabase.getAllRows(
      'trips'
    )) as Record<string, unknown>[];
    const tripCountByService = new Map<string, number>();
    const routesByService = new Map<string, Set<string>>();
    for (const trip of allTrips) {
      const sid = trip.service_id as string;
      const rid = trip.route_id as string;
      tripCountByService.set(sid, (tripCountByService.get(sid) ?? 0) + 1);
      if (!routesByService.has(sid)) {
        routesByService.set(sid, new Set());
      }
      routesByService.get(sid)!.add(rid);
    }

    const serviceItems = services
      .map((service: Record<string, unknown>) => {
        const sid = service.service_id as string;
        return renderServiceReference(service, {
          tripCount: tripCountByService.get(sid),
          routeCount: routesByService.get(sid)?.size,
        });
      })
      .join('');

    return `
      <div class="p-4 space-y-4">
        ${this.renderFeedInfoProperties(feedInfo)}

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
  private async getFeedInfo(): Promise<Record<string, unknown>> {
    try {
      const feedInfoRows =
        await this.dependencies.gtfsDatabase.queryRows('feed_info');
      return feedInfoRows.length > 0
        ? (feedInfoRows[0] as Record<string, unknown>)
        : {};
    } catch (error) {
      console.error('Error getting feed_info:', error);
      return {};
    }
  }

  /**
   * Get all services from calendar
   */
  private async getServices(): Promise<Record<string, unknown>[]> {
    try {
      const calendarRows = (await this.dependencies.gtfsDatabase.getAllRows(
        'calendar'
      )) as Record<string, unknown>[];
      const calendarDatesRows =
        (await this.dependencies.gtfsDatabase.getAllRows(
          'calendar_dates'
        )) as Record<string, unknown>[];

      const covered = new Set<string>(
        calendarRows.map((r) => String(r['service_id'] ?? ''))
      );

      const extraIds = new Set<string>();
      for (const r of calendarDatesRows) {
        const id = String(r['service_id'] ?? '');
        if (id !== '' && !covered.has(id)) {
          extraIds.add(id);
        }
      }
      const extraServices = [...extraIds].map((id) => ({ service_id: id }));

      return [...calendarRows, ...extraServices];
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
      feedInfo as Record<string, string | number | undefined>,
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

    // Fetch route data for the header
    const routeRows = await this.dependencies.gtfsDatabase.queryRows('routes', {
      route_id,
    });
    const routeData = (
      routeRows.length > 0 ? routeRows[0] : { route_id }
    ) as Record<string, string>;

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
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">${renderCardLabel(getRouteDisplay(routeData))}</h2>
          <button class="btn btn-sm btn-error btn-outline delete-route-btn" data-route-id="${route_id}" title="Delete">${renderTrashIcon()}</button>
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

    // Get all available services from calendar, then merge in calendar_dates-only services
    const allServices = (await this.dependencies.gtfsDatabase.getAllRows(
      'calendar'
    )) as Record<string, unknown>[];
    const calendarServiceIds = new Set(
      allServices.map((s) => s.service_id as string)
    );
    const calendarDatesRows = (await this.dependencies.gtfsDatabase.getAllRows(
      'calendar_dates'
    )) as Record<string, unknown>[];
    for (const row of calendarDatesRows) {
      const sid = row.service_id as string;
      if (!calendarServiceIds.has(sid)) {
        calendarServiceIds.add(sid);
        allServices.push({ service_id: sid });
      }
    }

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
              <option value="${service.service_id}">${renderOptionLabel(getServiceDisplay(service as Record<string, string>))}</option>
            `
            )
            .join('')}
        </select>
      </div>
    `
        : '';

    // Build lookup map for calendar data (full calendar rows only)
    const calendarByServiceId = new Map(
      allServices.map((s) => [s.service_id as string, s])
    );

    // Render timetables list
    const servicesListHTML = `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Timetables</h2>
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
                      .map(([service_id, serviceTrips]) =>
                        renderServiceReference(
                          calendarByServiceId.get(service_id) ?? { service_id },
                          { tripCount: serviceTrips.length, route_id }
                        )
                      )
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
      this.dependencies.mapController.highlightRoute(route_id);
      // Get the rendered schedule HTML directly
      return await this.dependencies.scheduleController.renderSchedule(
        route_id,
        service_id,
        direction_id
      );
    } catch (error) {
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

    // Use the new StopViewController for comprehensive stop view
    return await this.stopViewController.renderStopView(stop_id);
  }

  /**
   * Render service page
   */
  private async renderService(service_id: string): Promise<string> {
    this.dependencies.mapController.focusFeed();
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

    // Service reference row clicks → timetable (route page) or service page (home)
    const serviceRefRows = container.querySelectorAll(`.${SERVICE_REF_ROW}`);
    serviceRefRows.forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        const service_id = row.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        } else if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // "View ..." button clicks — handles stops and services
    const entityRefBtns = container.querySelectorAll(`.${ENTITY_REF_BTN}`);
    entityRefBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stop_id = btn.getAttribute('data-stop-id');
        if (stop_id) {
          this.dependencies.onStopClick(stop_id);
          return;
        }
        const service_id = btn.getAttribute('data-service-id');
        if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // Stop reference row clicks → stop page
    const stopRefRows = container.querySelectorAll(`.${STOP_REF_ROW}`);
    stopRefRows.forEach((row) => {
      row.addEventListener('click', () => {
        const stop_id = row.getAttribute('data-stop-id');
        if (stop_id) {
          this.dependencies.onStopClick(stop_id);
        }
      });
    });

    // Pathway reference row clicks → pathway page
    const pathwayRefRows = container.querySelectorAll(`.${PATHWAY_REF_ROW}`);
    pathwayRefRows.forEach((row) => {
      row.addEventListener('click', () => {
        const pathway_id = row.getAttribute('data-pathway-id');
        if (pathway_id && this.dependencies.onPathwayClick) {
          this.dependencies.onPathwayClick(pathway_id);
        }
      });
    });

    // Delete route button
    const deleteRouteBtn = container.querySelector('.delete-route-btn');
    if (deleteRouteBtn) {
      deleteRouteBtn.addEventListener('click', () => {
        const route_id = deleteRouteBtn.getAttribute('data-route-id');
        if (route_id) {
          this.handleDeleteRoute(route_id);
        }
      });
    }

    // Add StopViewController event listeners
    // It will only attach to stop fields (data-table="stops.txt")
    this.stopViewController.addEventListeners(container);

    // Add PathwayViewController event listeners
    this.pathwayViewController.addEventListeners(container);

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
      this.dependencies
        .gtfsDatabase as unknown as import('./gtfs-database.js').GTFSDatabase,
      notify,
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

  private async handleDeleteRoute(route_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteRoute called, route_id:',
      route_id
    );
    const db = this.dependencies.gtfsDatabase;
    const pm = this.dependencies.patchManager;
    if (!db || !pm || !db.deleteRow) {
      console.warn(
        '[PageContentRenderer] handleDeleteRoute: missing db/pm/deleteRow'
      );
      return;
    }

    const routeRows = await db.queryRows('routes', { route_id });
    const route = routeRows[0] as Record<string, unknown> | undefined;
    if (!route) {
      console.warn(
        '[PageContentRenderer] handleDeleteRoute: route not found for id',
        route_id
      );
      return;
    }

    const trips = (await db.queryRows('trips', {
      route_id,
    })) as Record<string, unknown>[];

    const stopTimesPerTrip: Array<Record<string, unknown>[]> =
      await Promise.all(
        trips.map(
          (trip) =>
            db.queryRows('stop_times', {
              trip_id: trip.trip_id as string,
            }) as Promise<Record<string, unknown>[]>
        )
      );
    const allStopTimes = stopTimesPerTrip.flat();

    const doDelete = async () => {
      for (const st of allStopTimes) {
        const key = generateCompositeKeyFromRecord('stop_times', st);
        await db.deleteRow!('stop_times', key);
      }
      for (const trip of trips) {
        await db.deleteRow!('trips', trip.trip_id as string);
      }
      await db.deleteRow!('routes', route_id);

      const deleteOps = [
        ...allStopTimes.map((st) => ({
          table: 'stop_times',
          id: generateCompositeKeyFromRecord('stop_times', st),
          record: st,
        })),
        ...trips.map((trip) => ({
          table: 'trips',
          id: trip.trip_id as string,
          record: trip,
        })),
        { table: 'routes', id: route_id, record: route },
      ];
      const label =
        trips.length === 0
          ? 'Delete route'
          : `Delete route + ${trips.length} trip${trips.length !== 1 ? 's' : ''} + ${allStopTimes.length} stop_time${allStopTimes.length !== 1 ? 's' : ''}`;
      await pm.recordBatchDelete(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted route ${route_id} + ${trips.length} trips + ${allStopTimes.length} stop_times`
      );
      await navigateToHome();
    };

    if (trips.length === 0) {
      await showModal({
        title: 'Delete route?',
        body: `<p>This route has no trips. Are you sure you want to delete it?</p>`,
        enterAction: 1,
        escapeAction: 0,
        actions: [
          { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
          { label: 'Delete route', className: 'btn-error', onClick: doDelete },
        ],
      });
      return;
    }

    await showModal({
      title: 'Route has trips',
      body: `<p>This route has <strong>${trips.length} trip${trips.length !== 1 ? 's' : ''}</strong> and <strong>${allStopTimes.length} stop_time${allStopTimes.length !== 1 ? 's' : ''}</strong>.</p>
             <p class="mt-3">Deleting this route will cascade-delete all its trips and stop_times (reversible via undo). Or cancel to keep it.</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
        {
          label: `Delete route + ${trips.length} trips + ${allStopTimes.length} stop_times`,
          className: 'btn-error',
          onClick: doDelete,
        },
      ],
    });
  }

  private async handleDeleteService(service_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteService called, service_id:',
      service_id
    );
    const db = this.dependencies.gtfsDatabase;
    const pm = this.dependencies.patchManager;
    if (!db || !pm || !db.deleteRow) {
      console.warn(
        '[PageContentRenderer] handleDeleteService: missing db/pm/deleteRow'
      );
      return;
    }

    const trips = (await db.queryRows('trips', {
      service_id,
    })) as Record<string, unknown>[];

    const stopTimesPerTrip: Array<Record<string, unknown>[]> =
      await Promise.all(
        trips.map(
          (trip) =>
            db.queryRows('stop_times', {
              trip_id: trip.trip_id as string,
            }) as Promise<Record<string, unknown>[]>
        )
      );
    const allStopTimes = stopTimesPerTrip.flat();

    const calendarDates = (await db.queryRows('calendar_dates', {
      service_id,
    })) as Record<string, unknown>[];

    const calendarRow = (await db.getRow('calendar', service_id)) as
      | Record<string, unknown>
      | undefined;

    const doDelete = async () => {
      for (const st of allStopTimes) {
        const key = generateCompositeKeyFromRecord('stop_times', st);
        await db.deleteRow!('stop_times', key);
      }
      for (const trip of trips) {
        await db.deleteRow!('trips', trip.trip_id as string);
      }
      for (const cd of calendarDates) {
        const key = generateCompositeKeyFromRecord('calendar_dates', cd);
        await db.deleteRow!('calendar_dates', key);
      }
      if (calendarRow) {
        await db.deleteRow!('calendar', service_id);
      }

      const deleteOps = [
        ...allStopTimes.map((st) => ({
          table: 'stop_times',
          id: generateCompositeKeyFromRecord('stop_times', st),
          record: st,
        })),
        ...trips.map((trip) => ({
          table: 'trips',
          id: trip.trip_id as string,
          record: trip,
        })),
        ...calendarDates.map((cd) => ({
          table: 'calendar_dates',
          id: generateCompositeKeyFromRecord('calendar_dates', cd),
          record: cd,
        })),
        ...(calendarRow
          ? [{ table: 'calendar', id: service_id, record: calendarRow }]
          : []),
      ];

      const parts: string[] = [];
      if (trips.length > 0) {
        parts.push(`${trips.length} trip${trips.length !== 1 ? 's' : ''}`);
      }
      if (allStopTimes.length > 0) {
        parts.push(
          `${allStopTimes.length} stop_time${allStopTimes.length !== 1 ? 's' : ''}`
        );
      }
      if (calendarDates.length > 0) {
        parts.push(
          `${calendarDates.length} calendar_date${calendarDates.length !== 1 ? 's' : ''}`
        );
      }
      const label =
        parts.length === 0
          ? 'Delete service'
          : `Delete service + ${parts.join(', ')}`;
      await pm.recordBatchDelete(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted service ${service_id} + ${trips.length} trips + ${allStopTimes.length} stop_times + ${calendarDates.length} calendar_dates`
      );
      await navigateToHome();
    };

    const hasAnyDependents = trips.length > 0 || calendarDates.length > 0;

    if (!hasAnyDependents) {
      await showModal({
        title: 'Delete service?',
        body: `<p>This service has no trips or calendar dates. Are you sure you want to delete it?</p>`,
        enterAction: 1,
        escapeAction: 0,
        actions: [
          { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
          {
            label: 'Delete service',
            className: 'btn-error',
            onClick: doDelete,
          },
        ],
      });
      return;
    }

    const summaryParts: string[] = [];
    if (trips.length > 0) {
      summaryParts.push(
        `<strong>${trips.length} trip${trips.length !== 1 ? 's' : ''}</strong>`
      );
    }
    if (allStopTimes.length > 0) {
      summaryParts.push(
        `<strong>${allStopTimes.length} stop_time${allStopTimes.length !== 1 ? 's' : ''}</strong>`
      );
    }
    if (calendarDates.length > 0) {
      summaryParts.push(
        `<strong>${calendarDates.length} calendar_date${calendarDates.length !== 1 ? 's' : ''}</strong>`
      );
    }

    const deleteBtnParts: string[] = [];
    if (trips.length > 0) {
      deleteBtnParts.push(`${trips.length} trips`);
    }
    if (allStopTimes.length > 0) {
      deleteBtnParts.push(`${allStopTimes.length} stop_times`);
    }
    if (calendarDates.length > 0) {
      deleteBtnParts.push(`${calendarDates.length} calendar_dates`);
    }

    await showModal({
      title: 'Service has dependents',
      body: `<p>This service has ${summaryParts.join(', ')}.</p>
             <p class="mt-3">Deleting this service will cascade-delete all its trips, stop_times, and calendar_dates (reversible via undo). Or cancel to keep it.</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
        {
          label: `Delete service + ${deleteBtnParts.join(' + ')}`,
          className: 'btn-error',
          onClick: doDelete,
        },
      ],
    });
  }

  private async handleDeleteAgency(agency_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteAgency called, agency_id:',
      agency_id
    );
    const db = this.dependencies.gtfsDatabase;
    const pm = this.dependencies.patchManager;
    if (!db || !pm || !db.deleteRow) {
      console.warn(
        '[PageContentRenderer] handleDeleteAgency: missing db/pm/deleteRow'
      );
      return;
    }

    const agencyRows = await db.queryRows('agency', { agency_id });
    const agency = agencyRows[0] as Record<string, unknown> | undefined;
    if (!agency) {
      console.warn(
        '[PageContentRenderer] handleDeleteAgency: agency not found for id',
        agency_id
      );
      return;
    }

    const routes = (await db.queryRows('routes', {
      agency_id,
    })) as Record<string, unknown>[];

    const tripsPerRoute: Array<Record<string, unknown>[]> = await Promise.all(
      routes.map(
        (route) =>
          db.queryRows('trips', {
            route_id: route.route_id as string,
          }) as Promise<Record<string, unknown>[]>
      )
    );
    const allTrips = tripsPerRoute.flat();

    const stopTimesPerTrip: Array<Record<string, unknown>[]> =
      await Promise.all(
        allTrips.map(
          (trip) =>
            db.queryRows('stop_times', {
              trip_id: trip.trip_id as string,
            }) as Promise<Record<string, unknown>[]>
        )
      );
    const allStopTimes = stopTimesPerTrip.flat();

    const doDelete = async () => {
      for (const st of allStopTimes) {
        const key = generateCompositeKeyFromRecord('stop_times', st);
        await db.deleteRow!('stop_times', key);
      }
      for (const trip of allTrips) {
        await db.deleteRow!('trips', trip.trip_id as string);
      }
      for (const route of routes) {
        await db.deleteRow!('routes', route.route_id as string);
      }
      await db.deleteRow!('agency', agency_id);

      const deleteOps = [
        ...allStopTimes.map((st) => ({
          table: 'stop_times',
          id: generateCompositeKeyFromRecord('stop_times', st),
          record: st,
        })),
        ...allTrips.map((trip) => ({
          table: 'trips',
          id: trip.trip_id as string,
          record: trip,
        })),
        ...routes.map((route) => ({
          table: 'routes',
          id: route.route_id as string,
          record: route,
        })),
        { table: 'agency', id: agency_id, record: agency },
      ];

      const label =
        routes.length === 0
          ? 'Delete agency'
          : `Delete agency + ${routes.length} route${routes.length !== 1 ? 's' : ''} + ${allTrips.length} trip${allTrips.length !== 1 ? 's' : ''} + ${allStopTimes.length} stop_time${allStopTimes.length !== 1 ? 's' : ''}`;
      await pm.recordBatchDelete(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted agency ${agency_id} + ${routes.length} routes + ${allTrips.length} trips + ${allStopTimes.length} stop_times`
      );
      await navigateToHome();
    };

    if (routes.length === 0) {
      await showModal({
        title: 'Delete agency?',
        body: `<p>This agency has no routes. Are you sure you want to delete it?</p>`,
        enterAction: 1,
        escapeAction: 0,
        actions: [
          { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
          {
            label: 'Delete agency',
            className: 'btn-error',
            onClick: doDelete,
          },
        ],
      });
      return;
    }

    await showModal({
      title: 'Agency has routes',
      body: `<p>This agency has <strong>${routes.length} route${routes.length !== 1 ? 's' : ''}</strong>, <strong>${allTrips.length} trip${allTrips.length !== 1 ? 's' : ''}</strong>, and <strong>${allStopTimes.length} stop_time${allStopTimes.length !== 1 ? 's' : ''}</strong>.</p>
             <p class="mt-3">Deleting this agency will cascade-delete all its routes, trips, and stop_times (reversible via undo). Or cancel to keep it.</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
        {
          label: `Delete agency + ${routes.length} routes + ${allTrips.length} trips + ${allStopTimes.length} stop_times`,
          className: 'btn-error',
          onClick: doDelete,
        },
      ],
    });
  }

  private async handleDeleteStop(stop_id: string): Promise<void> {
    console.log(
      '[PageContentRenderer] handleDeleteStop called, stop_id:',
      stop_id
    );
    const db = this.dependencies.gtfsDatabase;
    const pm = this.dependencies.patchManager;
    if (!db || !pm || !db.deleteRow) {
      console.warn(
        '[PageContentRenderer] handleDeleteStop: missing db/pm/deleteRow',
        { db: !!db, pm: !!pm, deleteRow: !!db?.deleteRow }
      );
      return;
    }

    const stops = await db.queryRows('stops', { stop_id });
    const stop = stops[0] as Record<string, unknown> | undefined;
    if (!stop) {
      console.warn(
        '[PageContentRenderer] handleDeleteStop: stop not found for id',
        stop_id
      );
      return;
    }

    const stopTimes = (await db.queryRows('stop_times', {
      stop_id,
    })) as Record<string, unknown>[];

    const doDelete = async (cascade: boolean) => {
      // Do all DB deletions first — no 'change' events fire during this phase
      if (cascade) {
        for (const st of stopTimes) {
          const key = generateCompositeKeyFromRecord('stop_times', st);
          await db.deleteRow!('stop_times', key);
        }
      }
      await db.deleteRow!('stops', stop_id);

      // Record as one atomic batch patch → one 'change' event, one notification
      const deleteOps = [
        ...(cascade
          ? stopTimes.map((st) => ({
              table: 'stop_times',
              id: generateCompositeKeyFromRecord('stop_times', st),
              record: st,
            }))
          : []),
        { table: 'stops', id: stop_id, record: stop },
      ];
      const label = cascade
        ? `Delete stop + ${stopTimes.length} stop_time${stopTimes.length !== 1 ? 's' : ''}`
        : 'Delete stop';
      await pm.recordBatchDelete(deleteOps, label);

      console.log(
        `[PageContentRenderer] Deleted stop ${stop_id}${cascade ? ` and ${stopTimes.length} stop_times` : ''}`
      );
      this.dependencies.mapController.refreshStops();
      await navigateToHome();
    };

    if (stopTimes.length === 0) {
      await doDelete(false);
      return;
    }

    const tripIds = [...new Set(stopTimes.map((st) => st.trip_id as string))];
    const tripSummary =
      tripIds.slice(0, 5).join(', ') +
      (tripIds.length > 5 ? ` … and ${tripIds.length - 5} more` : '');
    await showModal({
      title: 'Stop has scheduled visits',
      body: `<p>This stop is referenced by <strong>${stopTimes.length} stop_time${stopTimes.length !== 1 ? 's' : ''}</strong> across ${tripIds.length} trip${tripIds.length !== 1 ? 's' : ''}:</p>
             <p class="text-sm opacity-70 mt-1">${tripSummary}</p>
             <p class="mt-3">You can cascade-delete the stop and all its stop_times (reversible via undo), or cancel.</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
        {
          label: `Delete stop + ${stopTimes.length} stop_times`,
          className: 'btn-error',
          onClick: () => doDelete(true),
        },
      ],
    });
  }

  private async renderPathway(pathway_id: string): Promise<string> {
    this.dependencies.mapController.highlightPathway(pathway_id);
    return this.pathwayViewController.renderPathwayView(pathway_id);
  }

  private async handleDeletePathway(pathway_id: string): Promise<void> {
    const db = this.dependencies.gtfsDatabase;
    const pm = this.dependencies.patchManager;
    if (!db || !pm || !db.deleteRow) {
      return;
    }

    const rows = await db.queryRows('pathways', { pathway_id });
    const pathway = rows[0] as Record<string, unknown> | undefined;
    if (!pathway) {
      return;
    }

    await db.deleteRow('pathways', pathway_id);
    await pm.recordDelete('pathways', pathway_id, pathway);

    console.log(`[PageContentRenderer] Deleted pathway ${pathway_id}`);
    await navigateToHome();
  }
}
