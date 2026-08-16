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
  ZoneViewController,
  ZoneViewDependencies,
} from './zone-view-controller.js';
import {
  LocationGroupViewController,
  LocationGroupViewDependencies,
} from './location-group-view-controller.js';
import {
  installInlineEditableFields,
  renderInlineEntityFields,
} from '../utils/inline-editable-field.js';
import { installStopAreasField } from '../utils/stop-areas-field.js';
import { renderIssueCard } from '../utils/issue-card.js';
import { getFeedIssues, refreshFeedIssuesIfStale } from './feed-issues.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import { InlineEntityCreator } from '../utils/inline-entity-creator.js';
import {
  getAgencyDisplay,
  getEntityDisplay,
  getServiceDisplay,
  getRouteDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display.js';
import { showModal, renderTrashIcon } from './modal-utils.js';
import { showOptionPickerModal } from './option-picker-modal.js';
import { notify } from './notification-system.js';
import { escapeHtml } from '../utils/escape-html.js';
import {
  getCurrentPageState,
  navigateToHome,
  navigateToLocationGroup,
  navigateToZone,
} from './navigation-actions.js';
import type { GTFSParser } from './gtfs-parser.js';
import { renderRouteDiagram, ROUTE_DIAGRAM_ROW } from './route-diagram.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import {
  attachServiceTimelineListeners,
  filterServiceDataMap,
  loadServiceData,
  loadTripCounts,
  renderServiceTimeline,
  type ServiceTimelineSource,
} from './service-timeline.js';
import { normalizeAgencyId } from '../utils/agency-helpers.js';
import {
  STOP_REF_ROW,
  PATHWAY_REF_ROW,
  ENTITY_REF_BTN,
  TIMETABLE_REF_ROW,
  VIEW_ROUTE_BTN,
  VIEW_SERVICE_BTN,
} from '../utils/entity-references.js';

/** Marks the route page's network picker. */
const ROUTE_NETWORK_FIELD = 'route-network-field';

/** Sentinel option value for "create a network inline". */
const CREATE_NETWORK = '\0create-network';

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
    // Flex lookups: synchronous, they read the parser's in-memory tables.
    getTripsForZone?: (location_id: string) => Array<Record<string, unknown>>;
    getTripsForLocationGroup?: (
      location_group_id: string
    ) => Array<Record<string, unknown>>;
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
    highlightZone: (location_id: string) => void;
    highlightLocationGroup: (location_group_id: string) => void;
    clearHighlights: () => void;
    focusOnAgency: (agency_id: string) => void;
    refreshStops: () => void;
    refreshZones: () => void;
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

  // Parser access, for the route page's diagram (GTFSRouteSource reads the
  // virtual tables directly). Absent, the diagram section is skipped.
  gtfsParser?: GTFSParser;

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
  private zoneViewController: ZoneViewController;
  private locationGroupViewController: LocationGroupViewController;

  constructor(dependencies: ContentRendererDependencies) {
    this.dependencies = dependencies;

    // Initialize StopViewController with current dependencies
    const stopViewDependencies: StopViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      gtfsRelationships: dependencies.gtfsRelationships || {},
      onStopClick: dependencies.onStopClick,
      onPathwayClick: dependencies.onPathwayClick,
      onDeleteStop: (stop_id) => this.handleDeleteStop(stop_id),
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

    // Initialize ZoneViewController (on-demand zones, locations.geojson)
    const zoneViewDependencies: ZoneViewDependencies = {
      gtfsParser: dependencies.gtfsParser,
      patchManager: dependencies.patchManager ?? null,
      getTripsForZone: dependencies.relationships.getTripsForZone,
      getRouteAsync: dependencies.relationships.getRouteAsync,
      onRouteClick: dependencies.onRouteClick,
      onGeometryChanged: () => {
        // The page re-render does not touch the map, so refresh the polygons too.
        dependencies.mapController.refreshZones();
        dependencies.onEntityCreated?.();
      },
    };
    this.zoneViewController = new ZoneViewController(zoneViewDependencies);

    // Initialize LocationGroupViewController
    const locationGroupViewDependencies: LocationGroupViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      patchManager: dependencies.patchManager ?? null,
      getTripsForLocationGroup:
        dependencies.relationships.getTripsForLocationGroup,
      getRouteAsync: dependencies.relationships.getRouteAsync,
      onStopClick: dependencies.onStopClick,
      onRouteClick: dependencies.onRouteClick,
      onMembersChanged: () => dependencies.onEntityCreated?.(),
    };
    this.locationGroupViewController = new LocationGroupViewController(
      locationGroupViewDependencies
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

    // Click-to-edit property fields commit straight to the patch log, so they
    // need the same dependencies this renderer holds. Installing here rather
    // than in addEventListeners keeps it to once per renderer, and the fields
    // are rendered before any listener pass runs anyway.
    installInlineEditableFields({
      gtfsDatabase: {
        getRow: (table, key) =>
          dependencies.gtfsDatabase.getRow(table, key) as Promise<
            Record<string, unknown> | undefined
          >,
        getAllRows: (table) =>
          dependencies.gtfsDatabase.getAllRows(table) as Promise<
            Record<string, unknown>[]
          >,
        insertRows: (table, rows) =>
          dependencies.gtfsDatabase.insertRows(table, rows),
      },
      patchManager: dependencies.patchManager ?? null,
    });

    // The stop page's area chips write stop_areas.txt, which the stop view
    // controller's query-only handle cannot do.
    installStopAreasField({
      gtfsDatabase: dependencies.gtfsDatabase,
      patchManager: dependencies.patchManager ?? null,
    });
  }

  /**
   * Point the map at whatever the page being rendered is about.
   *
   * Synchronous and up front rather than inside the individual render*
   * methods: those sit behind awaits, so a re-render triggered by an edit
   * could resolve after the user had already navigated elsewhere and drag the
   * map back to the old object. Skipped outright when page state has moved on
   * since this render was requested.
   */
  private applyMapFocus(pageState: PageState): void {
    if (JSON.stringify(getCurrentPageState()) !== JSON.stringify(pageState)) {
      console.log(
        `[PageContentRenderer] stale render for ${pageState.type}, skipping map focus`
      );
      return;
    }

    const map = this.dependencies.mapController;
    switch (pageState.type) {
      case 'agency':
        map.focusOnAgency(pageState.agency_id);
        break;
      case 'route':
      case 'timetable':
        map.highlightRoute(pageState.route_id);
        break;
      case 'stop':
        map.highlightStop(pageState.stop_id);
        break;
      case 'pathway':
        map.highlightPathway(pageState.pathway_id);
        break;
      case 'zone':
        map.highlightZone(pageState.location_id);
        break;
      case 'location_group':
        map.highlightLocationGroup(pageState.location_group_id);
        break;
      default:
        // home and service: no single object to focus, frame the whole feed
        map.focusFeed();
        break;
    }
  }

  /**
   * Main rendering method - renders content based on page state
   * @param pageState - Current page state to render
   * @returns HTML string for the content
   */
  async renderPage(pageState: PageState): Promise<string> {
    this.applyMapFocus(pageState);

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
        case 'zone':
          return await this.renderZone(pageState.location_id);
        case 'location_group':
          return await this.renderLocationGroup(pageState.location_group_id);
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
    // Edits since the last pass are not reflected in the published issues.
    refreshFeedIssuesIfStale();

    const agencies = await this.dependencies.relationships.getAgenciesAsync();

    // Get feed_info data
    const feedInfo = await this.getFeedInfo();

    // Every service in the feed, rendered as the shared timeline
    const serviceData = await loadServiceData(this.serviceTimelineSource());
    const serviceCount = serviceData.size;
    const tripCounts = await loadTripCounts(this.serviceTimelineSource());

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

    return `
      <div class="p-4 space-y-4">
        ${await this.renderFeedInfoProperties(feedInfo)}

        ${renderIssueCard('Feed issues', getFeedIssues())}

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
              <div class="badge badge-outline">${serviceCount} service${serviceCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
          ${
            serviceCount === 0
              ? `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    <div class="text-center py-6 opacity-70">
                      No services found in GTFS data.
                    </div>
                  </div>
                </div>`
              : `<div class="card bg-base-100 shadow-lg">
                  <div class="card-body p-4">
                    ${renderServiceTimeline(serviceData, { tripCounts })}
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

  /** Adapter over the injected database for the shared services timeline. */
  private serviceTimelineSource(): ServiceTimelineSource {
    return {
      getAllRows: (tableName: string) =>
        this.dependencies.gtfsDatabase.getAllRows(tableName) as Promise<
          Record<string, unknown>[]
        >,
    };
  }

  /**
   * Render feed_info properties section
   */
  private async renderFeedInfoProperties(
    feedInfo: Record<string, unknown>
  ): Promise<string> {
    // feed_info holds a single row with no primary key of its own, so its
    // patches are keyed by the table name, matching generateCompositeKeyFromRecord.
    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.FEED_INFO,
      feedInfo as Record<string, string | number | undefined>,
      'feed_info'
    );

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
    // Use the new AgencyViewController for comprehensive agency view
    return await this.agencyViewController.renderAgencyView(agency_id);
  }

  /**
   * Render route page (route properties + services list)
   */
  private async renderRoute(route_id: string): Promise<string> {
    const trips =
      await this.dependencies.relationships.getTripsForRouteAsync(route_id);

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

    // network_id is not edited here: network membership is held in
    // route_networks.txt and only written back onto routes.txt at export.
    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.ROUTES,
      routeData,
      route_id,
      ['network_id']
    );
    const networkFieldHtml = await this.renderRouteNetworkField(route_id);

    // Render route properties section
    const routePropertiesHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2 min-w-0">
          <h2 class="text-lg font-semibold truncate">${renderCardLabel(getRouteDisplay(routeData))}</h2>
          <button class="btn btn-sm btn-error btn-outline delete-route-btn shrink-0" data-route-id="${route_id}" title="Delete">${renderTrashIcon()}</button>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="max-w-md space-y-3">
              ${fieldsHtml}
              ${networkFieldHtml}
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

    // Timeline scoped to the services this route actually runs. The fixed
    // route context makes a row click land on that route's timetable.
    const routeServiceData = filterServiceDataMap(
      await loadServiceData(this.serviceTimelineSource()),
      Object.keys(serviceGroups)
    );

    // Trips of this route only, straight off the grouping above.
    const routeTripCounts = new Map<string, number>(
      Object.entries(serviceGroups).map(([sid, group]) => [sid, group.length])
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
                  : `<div class="max-h-96 overflow-y-auto ${newServiceSelectorHTML ? 'mt-4' : ''}">
                    ${renderServiceTimeline(routeServiceData, { route_id, tripCounts: routeTripCounts })}
                  </div>`
            }
          </div>
        </div>
      </div>
    `;

    // Covers every trip of the route, not one service, so branches that only a
    // few timetables run are visible from the route page.
    const diagramHTML = this.dependencies.gtfsParser
      ? renderRouteDiagram(this.dependencies.gtfsParser, routeData)
      : '';

    return `
      <div class="p-4 space-y-4">
        ${routePropertiesHTML}
        ${servicesListHTML}
        ${diagramHTML}
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
      console.error('Error rendering timetable:', error);
      return this.renderError('Failed to load timetable. Please try again.');
    }
  }

  /**
   * Render stop page
   */
  private async renderStop(stop_id: string): Promise<string> {
    // Use the new StopViewController for comprehensive stop view
    return await this.stopViewController.renderStopView(stop_id);
  }

  /**
   * Render service page
   */
  private async renderService(service_id: string): Promise<string> {
    // Use the new ServiceViewController for comprehensive service view
    return await this.serviceViewController.renderServiceView(service_id);
  }

  /**
   * Add event listeners for interactive elements
   * This should be called after the content is inserted into the DOM
   */
  /**
   * The route's network, as a click-to-edit field over `route_networks.txt`.
   *
   * Not a `routes.network_id` editor: the database always holds membership in
   * the canonical tables, and a route may belong to at most one network, which
   * is why this is one value rather than a list.
   */
  private async renderRouteNetworkField(route_id: string): Promise<string> {
    const assignment = (await this.dependencies.gtfsDatabase.getRow(
      'route_networks',
      route_id
    )) as Record<string, unknown> | undefined;
    const network_id = String(assignment?.network_id ?? '');
    const label = network_id === '' ? '' : await this.networkLabel(network_id);

    return `
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Network</legend>
        <span
          class="${ROUTE_NETWORK_FIELD} block w-full cursor-pointer truncate rounded-field border border-base-300 px-3 py-1.5 text-sm hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          tabindex="0"
          role="button"
          data-route-id="${escapeHtml(route_id)}"
          data-network-id="${escapeHtml(network_id)}"
        >${label ? escapeHtml(label) : '<span class="opacity-40">Not in a network</span>'}</span>
      </fieldset>
    `;
  }

  /** A network's display label, falling back to the raw id. */
  private async networkLabel(network_id: string): Promise<string> {
    const row = (await this.dependencies.gtfsDatabase.getRow(
      'networks',
      network_id
    )) as Record<string, string> | undefined;
    return row
      ? renderOptionLabel(getEntityDisplay('networks', row))
      : network_id;
  }

  /**
   * Move a route into a network, out of one, or into a network created on the
   * spot. `route_networks` is keyed on `route_id`, so replacing the row is all
   * that is needed to keep a route in at most one network.
   */
  private async pickRouteNetwork(span: HTMLElement): Promise<void> {
    const route_id = span.dataset.routeId ?? '';
    const current = span.dataset.networkId ?? '';
    if (route_id === '') {
      return;
    }

    const networks = (await this.dependencies.gtfsDatabase.getAllRows(
      'networks'
    )) as Record<string, string>[];
    const picked = await showOptionPickerModal({
      title: 'Select network',
      options: [
        { value: '', primary: '- none -' },
        ...networks.map((n) => ({
          value: String(n.network_id ?? ''),
          primary: renderOptionLabel(getEntityDisplay('networks', n)),
          secondary: String(n.network_id ?? ''),
        })),
        { value: CREATE_NETWORK, primary: '+ Create a new network...' },
      ],
      selectedValue: current,
      searchable: true,
    });
    if (picked === null) {
      return;
    }

    let network_id = picked;
    if (picked === CREATE_NETWORK) {
      const created = await this.createNetwork(
        networks.map((n) => String(n.network_id ?? ''))
      );
      if (created === null) {
        return;
      }
      network_id = created;
    }
    if (network_id === current) {
      return;
    }

    const db = this.dependencies.gtfsDatabase;
    const pm = this.dependencies.patchManager;
    const existing = (await db.getRow('route_networks', route_id)) as
      | Record<string, unknown>
      | undefined;

    if (network_id === '') {
      if (existing) {
        console.log(`[Networks] unassign route ${route_id}`);
        await db.deleteRow?.('route_networks', route_id);
        await pm?.recordDelete('route_networks', route_id, existing);
      }
    } else if (existing) {
      console.log(`[Networks] move route ${route_id} to ${network_id}`);
      // recordUpdate applies the write itself.
      await pm?.recordUpdate(
        'route_networks',
        route_id,
        { network_id: existing.network_id ?? '' },
        { network_id }
      );
    } else {
      console.log(`[Networks] assign route ${route_id} to ${network_id}`);
      const record = { network_id, route_id };
      await db.insertRows('route_networks', [record]);
      await pm?.recordInsert('route_networks', route_id, record);
    }

    span.dataset.networkId = network_id;
    span.innerHTML =
      network_id === ''
        ? '<span class="opacity-40">Not in a network</span>'
        : escapeHtml(await this.networkLabel(network_id));
  }

  /** Ask for a new network's id and name, and write it. Returns its id. */
  private async createNetwork(existingIds: string[]): Promise<string | null> {
    let network_id: string | null = null;

    await showModal({
      title: 'New network',
      body: `
        <div class="space-y-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">network_id</legend>
            <input id="new-network-id" type="text" class="input input-bordered w-full" autocomplete="off" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">network_name</legend>
            <input id="new-network-name" type="text" class="input input-bordered w-full" autocomplete="off" />
            <p class="text-xs opacity-60">Naming a network makes the feed export networks.txt and route_networks.txt rather than a network_id column on routes.txt.</p>
          </fieldset>
        </div>
      `,
      actions: [
        {
          label: 'Create',
          className: 'btn-primary',
          onClick: async () => {
            const id = (
              document.getElementById('new-network-id') as HTMLInputElement
            ).value.trim();
            const name = (
              document.getElementById('new-network-name') as HTMLInputElement
            ).value.trim();
            if (id === '') {
              notify.error('network_id cannot be empty');
              return true;
            }
            if (existingIds.includes(id)) {
              notify.error(`Network "${id}" already exists`);
              return true;
            }
            const record = { network_id: id, network_name: name };
            await this.dependencies.gtfsDatabase.insertRows('networks', [
              record,
            ]);
            await this.dependencies.patchManager?.recordInsert(
              'networks',
              id,
              record
            );
            console.log(`[Networks] created ${id}`);
            network_id = id;
            return false;
          },
        },
        { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
      ],
      enterAction: 0,
      escapeAction: 1,
      onMount: () => document.getElementById('new-network-id')?.focus(),
    });

    return network_id;
  }

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

    // Timeline row clicks go to the timetable (route page, which supplies a
    // route context) or to the service page (home page, which does not)
    attachServiceTimelineListeners(container, (service_id, route_id) => {
      if (route_id) {
        this.dependencies.onTimetableClick(route_id, service_id);
      } else {
        this.dependencies.onServiceClick?.(service_id);
      }
    });

    // Timetable rows: the row opens the timetable, the buttons branch off to
    // either half of the route/service pair.
    container.querySelectorAll(`.${TIMETABLE_REF_ROW}`).forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        const service_id = row.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    });
    container.querySelectorAll(`.${VIEW_ROUTE_BTN}`).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const route_id = btn.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick(route_id);
        }
      });
    });
    container.querySelectorAll(`.${VIEW_SERVICE_BTN}`).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const service_id = btn.getAttribute('data-service-id');
        if (service_id && this.dependencies.onServiceClick) {
          this.dependencies.onServiceClick(service_id);
        }
      });
    });

    // "View ..." button clicks: handles stops and services
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

    // Stop reference row clicks go to stop page
    const stopRefRows = container.querySelectorAll(`.${STOP_REF_ROW}`);
    stopRefRows.forEach((row) => {
      row.addEventListener('click', () => {
        const stop_id = row.getAttribute('data-stop-id');
        if (stop_id) {
          this.dependencies.onStopClick(stop_id);
        }
      });
    });

    // Route diagram rows go to the stop page, or to the zone / location group
    // page for a flex row. The flex navigations are imported directly rather
    // than added to ContentRendererDependencies: they take no renderer state,
    // and it is how schedule-controller already navigates.
    container.querySelectorAll(`.${ROUTE_DIAGRAM_ROW}`).forEach((row) => {
      row.addEventListener('click', () => {
        const stop_id = row.getAttribute('data-stop-id');
        if (stop_id) {
          this.dependencies.onStopClick(stop_id);
          return;
        }
        const flex_id = row.getAttribute('data-flex-id');
        if (flex_id) {
          if (row.getAttribute('data-flex-kind') === 'location_group') {
            void navigateToLocationGroup(flex_id);
          } else {
            void navigateToZone(flex_id);
          }
        }
      });
    });

    // Pathway reference row clicks go to pathway page
    const pathwayRefRows = container.querySelectorAll(`.${PATHWAY_REF_ROW}`);
    pathwayRefRows.forEach((row) => {
      row.addEventListener('click', () => {
        const pathway_id = row.getAttribute('data-pathway-id');
        if (pathway_id && this.dependencies.onPathwayClick) {
          this.dependencies.onPathwayClick(pathway_id);
        }
      });
    });

    // Feed issue card items: navigate to the offending object's own page.
    container.querySelectorAll('[data-issue-nav]').forEach((item) => {
      item.addEventListener('click', () => {
        const nav = item.getAttribute('data-issue-nav');
        // A trip opens its route+service timetable, not a page of its own.
        if (nav === 'timetable') {
          const route_id = item.getAttribute('data-issue-route-id');
          const service_id = item.getAttribute('data-issue-service-id');
          if (route_id && service_id) {
            this.dependencies.onTimetableClick(
              route_id,
              service_id,
              item.getAttribute('data-issue-direction-id') ?? undefined
            );
          }
          return;
        }
        const id = item.getAttribute('data-issue-id');
        if (!id) {
          return;
        }
        if (nav === 'agency') {
          this.dependencies.onAgencyClick(id);
        } else if (nav === 'route') {
          this.dependencies.onRouteClick(id);
        } else if (nav === 'stop') {
          this.dependencies.onStopClick(id);
        } else if (nav === 'service') {
          this.dependencies.onServiceClick?.(id);
        } else if (nav === 'pathway') {
          this.dependencies.onPathwayClick?.(id);
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

    // Add zone and location group event listeners
    this.zoneViewController.addEventListeners(container);
    this.locationGroupViewController.addEventListeners(container);

    // Add AgencyViewController event listeners
    // It will only attach to agency fields (data-table="agency.txt")
    this.agencyViewController.addEventListeners(container);

    // Add ServiceViewController event listeners
    // It will only attach to service-related elements
    this.serviceViewController.addEventListeners(container);

    // Add inline entity creation event listeners
    this.addInlineCreationListeners(container);

    // Add service selection dropdown listener
    this.addServiceSelectionListener(container);

    // Route network field: same activation contract as the click-to-edit
    // property fields, so it is reachable by Tab and opens on Enter or Space.
    container.querySelectorAll(`.${ROUTE_NETWORK_FIELD}`).forEach((span) => {
      span.addEventListener('click', () => {
        void this.pickRouteNetwork(span as HTMLElement);
      });
      span.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          void this.pickRouteNetwork(span as HTMLElement);
        }
      });
    });
  }

  /**
   * Add event listeners for inline entity creation
   */
  private addInlineCreationListeners(container: HTMLElement): void {
    const inlineCreator = new InlineEntityCreator(
      this.dependencies
        .gtfsDatabase as unknown as import('./gtfs-database.js').GTFSDatabase,
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
      // Do all DB deletions first, no 'change' events fire during this phase
      if (cascade) {
        for (const st of stopTimes) {
          const key = generateCompositeKeyFromRecord('stop_times', st);
          await db.deleteRow!('stop_times', key);
        }
      }
      await db.deleteRow!('stops', stop_id);

      // Record as one atomic batch patch: one 'change' event, one notification
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
    return this.pathwayViewController.renderPathwayView(pathway_id);
  }

  private async renderZone(location_id: string): Promise<string> {
    return this.zoneViewController.renderZoneView(location_id);
  }

  private async renderLocationGroup(
    location_group_id: string
  ): Promise<string> {
    return this.locationGroupViewController.renderLocationGroupView(
      location_group_id
    );
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
