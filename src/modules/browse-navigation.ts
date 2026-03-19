/**
 * Browse Navigation Module
 * Handles the hierarchical navigation UI for Browse mode
 * Uses PageStateManager for state management and breadcrumb navigation
 */

import { PageState } from '../types/page-state.js';
import { getPageStateManager } from './page-state-manager.js';
import {
  navigateToAgency,
  navigateToRoute,
  navigateToStop,
  navigateToService,
  navigateToTimetable,
  addNavigationListener,
  getCurrentPageState,
} from './navigation-actions.js';
import {
  PageContentRenderer,
  ContentRendererDependencies,
} from './page-content-renderer.js';

export class BrowseNavigation {
  private relationships: {
    hasDataAsync: () => Promise<boolean>;
    getAgenciesAsync: () => Promise<Record<string, unknown>[]>;
    getRoutesForAgencyAsync: (
      agency_id: string
    ) => Promise<Record<string, unknown>[]>;
    getTripsForRouteAsync: (
      route_id: string
    ) => Promise<Record<string, unknown>[]>;
    getStopTimesForTripAsync: (
      trip_id: string
    ) => Promise<Record<string, unknown>[]>;
    getStopByIdAsync: (
      stop_id: string
    ) => Promise<Record<string, unknown> | null>;
    getServicesForRouteByDirectionAsync: (
      route_id: string
    ) => Promise<Record<string, unknown>[]>;
    getRouteByIdAsync: (
      route_id: string
    ) => Promise<Record<string, unknown> | null>;
    getTripByIdAsync: (
      trip_id: string
    ) => Promise<Record<string, unknown> | null>;
    getCalendarForServiceAsync: (
      service_id: string
    ) => Promise<Record<string, unknown> | null>;
    getAgencyByIdAsync?: (
      agency_id: string
    ) => Promise<Record<string, unknown> | null>;
    getRoutesForServiceAsync?: (
      service_id: string
    ) => Promise<Record<string, unknown>[]>;
    getTripsForServiceAsync?: (
      service_id: string
    ) => Promise<Record<string, unknown>[]>;
  };
  private gtfsRelationshipsInstance: import('./gtfs-relationships.js').GTFSRelationships; // The actual GTFSRelationships instance for database access
  private mapController: {
    highlightTrip: (trip_id: string) => void;
    highlightStop: (stop_id: string) => void;
    clearHighlights: () => void;
    highlightRoute: (route_id: string) => void;
    fitToRoutes: (route_ids: string[]) => void;
    focusRoute: (route_id: string) => void;
    focusStop: (stop_id: string) => void;
    clearFocus: () => void;
    setRouteSelectCallback: (callback: (route_id: string) => void) => void;
    setStopSelectCallback: (callback: (stop_id: string) => void) => void;
  };
  public uiController: {
    showFileInEditor: (filename: string, rowId?: string) => void;
  } | null = null; // Will be set after initialization
  public scheduleController: {
    renderSchedule: (
      route_id: string,
      service_id: string,
      direction_id?: string
    ) => Promise<string>;
  } | null = null; // Will be set after initialization
  public serviceDaysController: {
    renderServiceEditor: (service_id: string) => Promise<string>;
  } | null = null; // Will be set after initialization
  private container: HTMLElement | null = null;
  private isLoading: boolean = false;
  private contentRenderer: PageContentRenderer | null = null;
  private patchManager: {
    recordUpdate: (
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>,
      description: string
    ) => Promise<void>;
  } | null = null;

  setPatchManager(pm: {
    recordUpdate: (
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>,
      description: string
    ) => Promise<void>;
  }): void {
    this.patchManager = pm;
  }

  constructor(
    gtfsRelationships: {
      hasDataAsync: () => Promise<boolean>;
      getAgenciesAsync: () => Promise<Record<string, unknown>[]>;
      getRoutesForAgencyAsync: (
        agency_id: string
      ) => Promise<Record<string, unknown>[]>;
      getTripsForRouteAsync: (
        route_id: string
      ) => Promise<Record<string, unknown>[]>;
      getStopTimesForTripAsync: (
        trip_id: string
      ) => Promise<Record<string, unknown>[]>;
      getStopByIdAsync: (
        stop_id: string
      ) => Promise<Record<string, unknown> | null>;
      getServicesForRouteByDirectionAsync: (
        route_id: string
      ) => Promise<Record<string, unknown>[]>;
      getRouteByIdAsync: (
        route_id: string
      ) => Promise<Record<string, unknown> | null>;
      getTripByIdAsync: (
        trip_id: string
      ) => Promise<Record<string, unknown> | null>;
      getCalendarForServiceAsync: (
        service_id: string
      ) => Promise<Record<string, unknown> | null>;
      getAgencyByIdAsync?: (
        agency_id: string
      ) => Promise<Record<string, unknown> | null>;
    },
    mapController: {
      highlightTrip: (trip_id: string) => void;
      highlightStop: (stop_id: string) => void;
      clearHighlights: () => void;
      highlightRoute: (route_id: string) => void;
      fitToRoutes: (route_ids: string[]) => void;
      focusRoute: (route_id: string) => void;
      focusStop: (stop_id: string) => void;
      clearFocus: () => void;
      setRouteSelectCallback: (callback: (route_id: string) => void) => void;
      setStopSelectCallback: (callback: (stop_id: string) => void) => void;
    },
    scheduleController?: {
      renderSchedule: (
        route_id: string,
        service_id: string,
        direction_id?: string
      ) => Promise<string>;
    },
    serviceDaysController?: {
      renderServiceEditor: (service_id: string) => Promise<string>;
    }
  ) {
    this.relationships = gtfsRelationships;
    this.gtfsRelationshipsInstance = gtfsRelationships; // Store the actual instance for database access
    this.mapController = mapController;
    this.scheduleController = scheduleController;
    this.serviceDaysController = serviceDaysController;
  }

  initialize(containerId: string): void {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      // eslint-disable-next-line no-console
      console.error(`Browse navigation container ${containerId} not found`);
      return;
    }

    // Initialize content renderer
    this.initializeContentRenderer();

    // Set up bidirectional communication with map
    this.setupMapCallbacks();

    // Add navigation listener for page state changes
    addNavigationListener((_pageState: PageState) => {
      this.render();
    });

    this.render();
  }

  private initializeContentRenderer(): void {
    const dependencies: ContentRendererDependencies = {
      relationships: {
        hasDataAsync: () => this.relationships.hasDataAsync(),
        getAgenciesAsync: () => this.relationships.getAgenciesAsync(),
        getRoutesForAgencyAsync: (agency_id: string) =>
          this.relationships.getRoutesForAgencyAsync(agency_id),
        getTripsForRouteAsync: (route_id: string) =>
          this.relationships.getTripsForRouteAsync(route_id),
        getStopTimesForTripAsync: (trip_id: string) =>
          this.relationships.getStopTimesForTripAsync(trip_id),
        getStopAsync: (stop_id: string) =>
          this.relationships.getStopByIdAsync(stop_id),
        getAgencyAsync: (agency_id: string) =>
          this.relationships.getAgencyByIdAsync?.(agency_id) ||
          Promise.resolve(null),
        getRouteAsync: (route_id: string) =>
          this.relationships.getRouteByIdAsync(route_id),
        getRoutesForService: (service_id: string) =>
          this.relationships.getRoutesForServiceAsync?.(service_id) ||
          Promise.resolve([]),
        getTripsForService: (service_id: string) =>
          this.relationships.getTripsForServiceAsync?.(service_id) ||
          Promise.resolve([]),
      },
      // Provide access to the actual database for StopViewController
      gtfsDatabase: this.gtfsRelationshipsInstance?.gtfsDatabase
        ? {
            queryRows: (tableName: string, filter?: Record<string, unknown>) =>
              this.gtfsRelationshipsInstance.gtfsDatabase.queryRows(
                tableName,
                filter
              ),
            updateRow: (
              tableName: string,
              key: string,
              data: Record<string, unknown>
            ) =>
              this.gtfsRelationshipsInstance.gtfsDatabase.updateRow(
                tableName,
                key,
                data
              ),
            getRow: (tableName: string, key: string) =>
              this.gtfsRelationshipsInstance.gtfsDatabase.getRow(
                tableName,
                key
              ),
            getAllRows: (tableName: string) =>
              this.gtfsRelationshipsInstance.gtfsDatabase.getAllRows(tableName),
            insertRows: <T extends Record<string, unknown>>(
              tableName: string,
              rows: T[]
            ) =>
              this.gtfsRelationshipsInstance.gtfsDatabase.insertRows(
                tableName,
                rows
              ),
          }
        : undefined,
      gtfsRelationships: this.gtfsRelationshipsInstance,
      scheduleController: this.scheduleController || {
        renderSchedule: () =>
          Promise.resolve('<div>Schedule not available</div>'),
      },
      serviceDaysController: this.serviceDaysController || {
        renderServiceEditor: () =>
          Promise.resolve('<div>Service days editor not available</div>'),
      },
      mapController: {
        highlightRoute: (route_id: string) =>
          this.mapController.highlightRoute?.(route_id),
        highlightStop: (stop_id: string) =>
          this.mapController.highlightStop(stop_id),
        clearHighlights: () => this.mapController.clearHighlights(),
        focusOnAgency: (agency_id: string) =>
          this.highlightAgencyOnMap(agency_id),
      },
      onAgencyClick: (agency_id: string) => navigateToAgency(agency_id),
      onRouteClick: (route_id: string) => navigateToRoute(route_id),
      onStopClick: (stop_id: string) => navigateToStop(stop_id),
      onServiceClick: (service_id: string) => navigateToService(service_id),
      onTimetableClick: (
        route_id: string,
        service_id: string,
        direction_id?: string
      ) => navigateToTimetable(route_id, service_id, direction_id),
      onEntityCreated: () => this.render(),
      patchManager: this.patchManager ?? undefined,
    };

    this.contentRenderer = new PageContentRenderer(dependencies);
  }

  setupMapCallbacks(): void {
    // Map clicks now use PageStateManager directly
    // No more direct tab manipulation - PageStateManager handles navigation
    // Tab switching should be handled by a navigation event listener at the app level

    console.log(
      'Browse: Map callbacks set up to use PageStateManager navigation'
    );
  }

  private async navigateToRouteById(route_id: string): Promise<void> {
    // Get the route to find its agency
    const route = await this.relationships.getRouteByIdAsync(route_id);
    if (route) {
      const agency_id = route.agency_id || route.agency_id || 'default';
      navigateToRoute(agency_id, route_id);
    }
  }

  async render(): Promise<void> {
    if (!this.container || !this.contentRenderer) {
      return;
    }

    if (this.isLoading) {
      this.renderLoadingState();
      return;
    }

    try {
      // Get current page state from PageStateManager
      const pageState = getCurrentPageState();

      // Get breadcrumbs from PageStateManager
      const breadcrumbs = await getPageStateManager().getBreadcrumbs();

      // Render page content
      const pageContent = await this.contentRenderer.renderPage(pageState);

      this.container.innerHTML = `
        <div class="browse-navigation h-full flex flex-col">
          ${this.renderBreadcrumbs(breadcrumbs)}
          <div class="content flex-1 overflow-y-auto">
            ${pageContent}
          </div>
        </div>
      `;

      this.attachEventListeners();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error rendering browse navigation:', error);
      this.renderErrorState();
    }
  }

  renderLoadingState(): void {
    if (!this.container) {
      return;
    }

    this.container.innerHTML = `
      <div class="browse-navigation h-full flex flex-col">
        ${this.renderBreadcrumbs([])}
        <div class="content flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="loading loading-spinner loading-lg mb-4"></div>
            <div class="text-sm opacity-60">Loading...</div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderErrorState(): void {
    if (!this.container) {
      return;
    }

    this.container.innerHTML = `
      <div class="browse-navigation h-full flex flex-col">
        ${this.renderBreadcrumbs([])}
        <div class="content flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="text-4xl mb-4">⚠️</div>
            <div class="text-lg mb-2">Error loading content</div>
            <div class="text-sm opacity-60">Please try refreshing the page</div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderBreadcrumbs(
    breadcrumbs: { label: string; pageState: PageState }[]
  ): string {
    if (breadcrumbs.length === 0) {
      return `
        <div class="p-3 border-b border-base-300 bg-base-200">
          <div class="breadcrumbs text-sm">
            <ul>
              <li>Home</li>
            </ul>
          </div>
        </div>
      `;
    }

    const breadcrumbItems = breadcrumbs.map((item, index) => {
      const isLast = index === breadcrumbs.length - 1;
      if (isLast) {
        return `<li>${item.label}</li>`;
      } else {
        return `<li><a class="breadcrumb-item" data-breadcrumb-index="${index}">${item.label}</a></li>`;
      }
    });

    return `
      <div class="p-3 border-b border-base-300 bg-base-200">
        <div class="breadcrumbs text-sm">
          <ul>
            ${breadcrumbItems.join('')}
          </ul>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    if (!this.container) {
      return;
    }

    // Add event listeners from content renderer for agency/route/service cards
    if (this.contentRenderer) {
      this.contentRenderer.addEventListeners(this.container);
    }

    // Breadcrumb navigation
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('breadcrumb-item')) {
        const index = parseInt(target.dataset.breadcrumbIndex || '0');
        const breadcrumbs = await getPageStateManager().getBreadcrumbs();
        if (breadcrumbs[index]) {
          await getPageStateManager().navigateTo(breadcrumbs[index].pageState);
        }
      }
    });
  }

  // Map highlighting methods
  highlightAgencyOnMap(agency_id) {
    if (this.mapController && this.mapController.highlightAgencyRoutes) {
      this.mapController.highlightAgencyRoutes(agency_id);
    }
  }

  highlightRouteOnMap(route_id) {
    if (this.mapController && this.mapController.focusRoute) {
      // Use new focus method instead of old highlight method
      this.mapController.focusRoute(route_id);
    }
  }

  highlightTripOnMap(trip_id) {
    if (this.mapController && this.mapController.highlightTrip) {
      this.mapController.highlightTrip(trip_id);
    }
  }

  highlightStopOnMap(stop_id) {
    if (this.mapController && this.mapController.highlightStop) {
      this.mapController.highlightStop(stop_id);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async refresh() {
    await this.render();
  }
}
