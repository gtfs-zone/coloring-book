/**
 * Browse Navigation Module
 * Handles the hierarchical navigation UI for Browse mode
 * Uses PageStateManager for state management and breadcrumb navigation
 */

import { PageState } from '../types/page-state.js';
import { getPageStateManager } from './page-state-manager.js';
import {
  BreadcrumbItem,
  pageTitle,
  renderBreadcrumbTrail,
} from './breadcrumb-trail.js';
import { APP_NAME } from './breadcrumbs.js';
import {
  navigateToAgency,
  navigateToRoute,
  navigateToStop,
  navigateToService,
  navigateToPathway,
  openTimetable,
  addNavigationListener,
  getCurrentPageState,
  consumePendingFocusSelector,
} from './navigation-actions.js';
import {
  PageContentRenderer,
  ContentRendererDependencies,
} from './page-content-renderer.js';
import type { GTFSParser } from './gtfs-parser.js';

export class BrowseNavigation {
  private relationships: {
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
    highlightPathway: (pathway_id: string) => void;
    highlightZone: (location_id: string) => void;
    highlightLocationGroup: (location_group_id: string) => void;
    hoverStop: (stop_id: string | null) => void;
    hoverTransfer: (
      edge: { from_stop_id: string; to_stop_id: string } | null
    ) => void;
    clearHighlights: () => void;
    highlightRoute: (route_id: string) => void;
    fitToRoutes: (route_ids: string[]) => void;
    focusRoute: (route_id: string) => void;
    focusStop: (stop_id: string) => void;
    clearFocus: () => void;
    setRouteSelectCallback: (callback: (route_id: string) => void) => void;
    setStopSelectCallback: (callback: (stop_id: string) => void) => void;
    refreshStops: () => void;
    refreshZones: () => void;
    focusFeed: () => void;
    highlightAgencyRoutes: (agency_id: string) => void;
  };
  public uiController: {
    showFileInEditor: (filename: string, rowId?: string) => void;
  } | null = null; // Will be set after initialization
  public serviceDaysController: {
    renderServiceEditor: (service_id: string) => Promise<string>;
  } | null = null; // Will be set after initialization
  public searchQuery: string = '';
  private container: HTMLElement | null = null;
  private isLoading: boolean = false;
  private lastRenderedPageState: PageState | null = null;
  private contentRenderer: PageContentRenderer | null = null;
  private gtfsParser: GTFSParser | null = null;
  // The same shape the content renderer takes, which is what it is handed to.
  private patchManager: ContentRendererDependencies['patchManager'] | null =
    null;

  setPatchManager(pm: ContentRendererDependencies['patchManager']): void {
    this.patchManager = pm;
  }

  constructor(
    gtfsRelationships: {
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
      highlightPathway: (pathway_id: string) => void;
      highlightZone: (location_id: string) => void;
      highlightLocationGroup: (location_group_id: string) => void;
      hoverStop: (stop_id: string | null) => void;
      hoverTransfer: (
        edge: { from_stop_id: string; to_stop_id: string } | null
      ) => void;
      clearHighlights: () => void;
      highlightRoute: (route_id: string) => void;
      fitToRoutes: (route_ids: string[]) => void;
      focusRoute: (route_id: string) => void;
      focusStop: (stop_id: string) => void;
      clearFocus: () => void;
      setRouteSelectCallback: (callback: (route_id: string) => void) => void;
      setStopSelectCallback: (callback: (stop_id: string) => void) => void;
      refreshStops: () => void;
      refreshZones: () => void;
      focusFeed: () => void;
      highlightAgencyRoutes: (agency_id: string) => void;
    },
    serviceDaysController?: {
      renderServiceEditor: (service_id: string) => Promise<string>;
    },
    // The route page's diagram reads the parser's virtual tables directly,
    // through GTFSRouteSource, which the relationships layer does not expose.
    gtfsParser?: GTFSParser
  ) {
    this.relationships = gtfsRelationships;
    this.gtfsParser = gtfsParser ?? null;
    this.gtfsRelationshipsInstance =
      gtfsRelationships as unknown as import('./gtfs-relationships.js').GTFSRelationships;
    this.mapController = mapController;
    this.serviceDaysController = serviceDaysController ?? null;
  }

  initialize(containerId: string): void {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Browse navigation container ${containerId} not found`);
      return;
    }

    // Initialize content renderer
    this.initializeContentRenderer();

    // Breadcrumb navigation. Delegated to the container, which survives every
    // render (render() only replaces its innerHTML), so this is attached once
    // here rather than in attachEventListeners(): re-attaching it per render
    // stacked up duplicate handlers, and since the handler itself navigates,
    // one crumb click then fanned out into one full re-render per handler.
    this.container.addEventListener('click', async (e) => {
      const link = (e.target as HTMLElement).closest('[data-nav]');
      if (!(link instanceof HTMLElement)) {
        return;
      }
      e.preventDefault();
      try {
        const state = JSON.parse(link.dataset.nav || '') as PageState;
        await getPageStateManager().navigateTo(state);
      } catch (error) {
        console.warn('[BrowseNavigation] bad data-nav payload:', error);
      }
    });

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
        getTripsForZone: (location_id: string) =>
          this.gtfsRelationshipsInstance.getTripsForZone(location_id),
        getTripsForLocationGroup: (location_group_id: string) =>
          this.gtfsRelationshipsInstance.getTripsForLocationGroup(
            location_group_id
          ),
      },
      // Provide access to the actual database for StopViewController
      gtfsDatabase: {
        queryRows: (tableName: string, filter?: Record<string, unknown>) =>
          this.gtfsRelationshipsInstance.gtfsDatabase.queryRows(
            tableName,
            filter as { [key: string]: string | number | boolean } | undefined
          ),
        updateRow: (
          tableName: string,
          key: string,
          data: Record<string, unknown>
        ) =>
          this.gtfsRelationshipsInstance.gtfsDatabase.updateRow(
            tableName,
            key,
            data as Partial<import('./gtfs-database.js').GTFSDatabaseRecord>
          ),
        getRow: (tableName: string, key: string) =>
          this.gtfsRelationshipsInstance.gtfsDatabase.getRow(tableName, key),
        getAllRows: (tableName: string) =>
          this.gtfsRelationshipsInstance.gtfsDatabase.getAllRows(tableName),
        insertRows: (tableName: string, rows: unknown[]) =>
          this.gtfsRelationshipsInstance.gtfsDatabase.insertRows(
            tableName,
            rows as import('./gtfs-database.js').GTFSDatabaseRecord[]
          ),
        deleteRow: (tableName: string, key: string) =>
          this.gtfsRelationshipsInstance.gtfsDatabase.deleteRow(tableName, key),
      },
      gtfsRelationships: {
        getRoutesForService: (service_id: string) =>
          this.relationships.getRoutesForServiceAsync?.(service_id) ||
          Promise.resolve([]),
        getTripsForService: (service_id: string) =>
          this.relationships.getTripsForServiceAsync?.(service_id) ||
          Promise.resolve([]),
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
        highlightPathway: (pathway_id: string) =>
          this.mapController.highlightPathway(pathway_id),
        highlightZone: (location_id: string) =>
          this.mapController.highlightZone(location_id),
        highlightLocationGroup: (location_group_id: string) =>
          this.mapController.highlightLocationGroup(location_group_id),
        hoverStop: (stop_id: string | null) =>
          this.mapController.hoverStop(stop_id),
        hoverTransfer: (
          edge: { from_stop_id: string; to_stop_id: string } | null
        ) => this.mapController.hoverTransfer(edge),
        clearHighlights: () => this.mapController.clearHighlights(),
        focusOnAgency: (agency_id: string) =>
          this.highlightAgencyOnMap(agency_id),
        refreshStops: () => this.mapController.refreshStops(),
        refreshZones: () => this.mapController.refreshZones(),
        focusFeed: () => this.mapController.focusFeed(),
      },
      onAgencyClick: (agency_id: string) => navigateToAgency(agency_id),
      onRouteClick: (route_id: string) => navigateToRoute(route_id),
      onStopClick: (stop_id: string) => navigateToStop(stop_id),
      onServiceClick: (service_id: string) => navigateToService(service_id),
      onPathwayClick: (pathway_id: string) => navigateToPathway(pathway_id),
      onTimetableClick: (
        route_id: string,
        service_id: string,
        direction_id?: string
      ) => openTimetable(route_id, service_id, direction_id),
      onEntityCreated: () => this.render(),
      patchManager: this.patchManager ?? undefined,
      gtfsParser: this.gtfsParser ?? undefined,
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

  async render(): Promise<void> {
    if (!this.container || !this.contentRenderer) {
      return;
    }

    if (this.isLoading) {
      this.renderLoadingState();
      return;
    }

    try {
      // Capture scroll position before rebuild
      const contentDiv = this.container.querySelector<HTMLElement>('.content');
      const savedScrollTop = contentDiv?.scrollTop ?? 0;

      // Capture focus before rebuild. An edit committed on blur re-renders the
      // page while the user is already clicking the next field, so without this
      // the rebuild drops focus on whatever they just moved to. Only elements
      // carrying an id can be found again afterwards.
      const savedFocus = this.captureFocus();

      // Get current page state from PageStateManager
      const pageState = getCurrentPageState();

      const isSamePage =
        this.lastRenderedPageState !== null &&
        JSON.stringify(this.lastRenderedPageState) ===
          JSON.stringify(pageState);

      // Get breadcrumbs from PageStateManager
      const breadcrumbs = await getPageStateManager().getBreadcrumbs();
      document.title = pageTitle(breadcrumbs, APP_NAME);

      // Render page content
      const pageContent = await this.contentRenderer.renderPage(pageState);

      // Navigating away mid-render (an edit re-renders the current page, the
      // user clicks elsewhere before it resolves) leaves this holding the old
      // page's HTML. Drop it: the navigation kicked off its own render.
      if (JSON.stringify(getCurrentPageState()) !== JSON.stringify(pageState)) {
        console.log(
          `[BrowseNavigation] stale render for ${pageState.type}, discarding`
        );
        return;
      }

      const domStart = performance.now();
      this.container.innerHTML = `
        <div class="browse-navigation h-full flex flex-col">
          ${this.renderBreadcrumbs(breadcrumbs)}
          <div class="content flex-1 overflow-y-auto">
            ${pageContent}
          </div>
        </div>
      `;

      this.attachEventListeners();
      console.log(
        `[BrowseNavigation] rendered ${pageState.type}: dom=${Math.round(
          performance.now() - domStart
        )}ms`
      );

      const focusSelector = consumePendingFocusSelector();
      if (focusSelector) {
        this.container.querySelector<HTMLElement>(focusSelector)?.focus();
      }

      this.lastRenderedPageState = pageState;
      if (isSamePage) {
        const newContent =
          this.container.querySelector<HTMLElement>('.content');
        if (newContent && savedScrollTop > 0) {
          newContent.scrollTop = savedScrollTop;
        }
        this.restoreFocus(savedFocus);
      }
    } catch (error) {
      console.error('Error rendering browse navigation:', error);
      this.renderErrorState();
    }
  }

  /**
   * The focused element inside the panel, as something the rebuilt DOM can be
   * searched for. Returns null when nothing in the panel has focus, or when the
   * focused element has no id to find it by.
   */
  private captureFocus(): { id: string; selectionStart: number | null } | null {
    const active = document.activeElement;
    if (
      !(active instanceof HTMLElement) ||
      !active.id ||
      !this.container?.contains(active)
    ) {
      return null;
    }
    // Only text-like inputs expose a caret; date and number inputs throw.
    let selectionStart: number | null = null;
    if (active instanceof HTMLInputElement) {
      try {
        selectionStart = active.selectionStart;
      } catch {
        selectionStart = null;
      }
    }
    return { id: active.id, selectionStart };
  }

  private restoreFocus(
    saved: { id: string; selectionStart: number | null } | null
  ): void {
    if (!saved) {
      return;
    }
    const el = this.container?.querySelector<HTMLElement>(
      `#${CSS.escape(saved.id)}`
    );
    if (!el) {
      return;
    }
    el.focus();
    if (saved.selectionStart !== null && el instanceof HTMLInputElement) {
      try {
        el.setSelectionRange(saved.selectionStart, saved.selectionStart);
      } catch {
        // Input type does not support a selection range; focus alone is enough.
      }
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
            <div class="text-4xl mb-4"></div>
            <div class="text-lg mb-2">Error loading content</div>
            <div class="text-sm opacity-60">Please try refreshing the page</div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderBreadcrumbs(breadcrumbs: BreadcrumbItem[]): string {
    if (breadcrumbs.length === 0) {
      return '';
    }

    const trail = renderBreadcrumbTrail(breadcrumbs, (state) => {
      const hash = getPageStateManager().pageStateToURL(state);
      return hash ? `#${hash}` : '#';
    });

    return `
      <div class="p-3 border-b border-base-300 bg-base-200">
        ${trail}
      </div>
    `;
  }

  attachEventListeners() {
    if (!this.container) {
      return;
    }

    // Add event listeners from content renderer for agency/route/service cards.
    // These bind to elements inside the container, which the render replaced,
    // so they have to be re-attached. The breadcrumb listener does not: it is
    // delegated to the container itself and attached once in initialize().
    if (this.contentRenderer) {
      this.contentRenderer.addEventListeners(this.container);
    }
  }

  // Map highlighting methods
  highlightAgencyOnMap(agency_id: string) {
    this.mapController?.highlightAgencyRoutes(agency_id);
  }

  highlightRouteOnMap(route_id: string) {
    if (this.mapController && this.mapController.focusRoute) {
      // Use new focus method instead of old highlight method
      this.mapController.focusRoute(route_id);
    }
  }

  highlightTripOnMap(trip_id: string) {
    if (this.mapController && this.mapController.highlightTrip) {
      this.mapController.highlightTrip(trip_id);
    }
  }

  highlightStopOnMap(stop_id: string) {
    if (this.mapController && this.mapController.highlightStop) {
      this.mapController.highlightStop(stop_id);
    }
  }

  escapeHtml(text: string) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async refresh() {
    await this.render();
  }
}
