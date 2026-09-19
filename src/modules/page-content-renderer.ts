/**
 * Page Content Renderer
 *
 * Unified content rendering system for GTFS.zone Browse tab.
 * Renders appropriate content based on PageState, replacing fragmented
 * rendering logic across multiple modules.
 */

import { PageState } from '../types/page-state';
import {
  StopViewController,
  StopViewDependencies,
} from './stop-view-controller';
import {
  AgencyViewController,
  AgencyViewDependencies,
} from './agency-view-controller';
import {
  ServiceViewController,
  ServiceViewDependencies,
} from './service-view-controller';
import {
  PathwayViewController,
  PathwayViewDependencies,
} from './pathway-view-controller';
import {
  ZoneViewController,
  ZoneViewDependencies,
} from './zone-view-controller';
import {
  LocationGroupViewController,
  LocationGroupViewDependencies,
} from './location-group-view-controller';
import {
  installInlineEditableFields,
  renderInlineEntityFields,
} from '../utils/inline-editable-field';
import { installStopAreasField } from '../utils/stop-areas-field';
import type {
  EditableTableDeps,
  EditableTablePatchManager,
} from './editable-table';
import { renderIssueCard } from 'interlocking/ui/issue-card';
import { installGuideButtons } from 'interlocking/ui/help-modal';
import {
  getFeedIssueEntities,
  getFeedIssues,
  refreshFeedIssuesIfStale,
} from './feed-issues';
import {
  applyWhitespaceFix,
  describeWhitespaceFix,
  WHITESPACE_FIX_ACTION,
} from '../utils/whitespace-fix';
import { GTFS_TABLES } from '../types/gtfs';
import { InlineEntityCreator } from '../utils/inline-entity-creator';
import {
  getAgencyDisplay,
  getEntityDisplay,
  getServiceDisplay,
  getRouteDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display';
import { showModal, renderTrashIcon } from 'interlocking/ui/modal-utils';
import { renderNavIcon } from 'interlocking/ui/nav-icons';
import { promptNewEntity } from './entity-form-modal';
import { showNewServiceModal } from './new-service-modal';
import { specStoreName } from '../utils/spec-field-edit';
import { showOptionPickerModal } from './option-picker-modal';
import {
  renderPickerTrigger,
  setPickerTriggerContent,
} from '../utils/picker-trigger';
import { notify } from 'interlocking/ui/notification-system';
import { escapeHtml } from 'interlocking/util/escape-html';
import {
  getCurrentPageState,
  navigateToHome,
  openModal,
  navigateToLocationGroup,
  navigateToZone,
} from './navigation-actions';
import type { GTFSParser } from './gtfs-parser';
import { renderRouteDiagram, ROUTE_DIAGRAM_ROW } from './route-diagram';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import {
  applyZoneFeatures,
  getZoneFeatures,
  LOCATIONS_ROW_KEY,
  LOCATIONS_TABLE,
} from './zone-store';
import {
  attachServiceTimelineListeners,
  filterServiceDataMap,
  loadServiceData,
  loadTripCounts,
  renderServiceTimeline,
  type ServiceTimelineSource,
} from './service-timeline';
import { normalizeAgencyId } from '../utils/agency-helpers';
import { feedBounds, trimOrExtendServices } from '../utils/feed-bounds';
import {
  STOP_REF_ROW,
  PATHWAY_REF_ROW,
  ENTITY_REF_BTN,
  TIMETABLE_REF_ROW,
  VIEW_ROUTE_BTN,
  VIEW_SERVICE_BTN,
} from '../utils/entity-references';

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
    hoverStop: (stop_id: string | null) => void;
    hoverTransfer: (
      edge: { from_stop_id: string; to_stop_id: string } | null
    ) => void;
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
    // Editing a key field of a composite-key table (the stop page's transfers)
    // re-keys the row, which the editable table records as delete plus insert.
    recordBatchMixed: EditableTablePatchManager['recordBatchMixed'];
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

  // Time the last applyMapFocus took, folded into the renderHome timing line.
  private lastMapFocusMs = 0;

  constructor(dependencies: ContentRendererDependencies) {
    this.dependencies = dependencies;

    // Initialize StopViewController with current dependencies
    const stopViewDependencies: StopViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
      gtfsRelationships: dependencies.gtfsRelationships || {},
      editableDeps: this.editableDeps(),
      onStopClick: dependencies.onStopClick,
      onStopHover: (stop_id) => dependencies.mapController.hoverStop(stop_id),
      onTransferHover: (edge) => dependencies.mapController.hoverTransfer(edge),
      onPathwayClick: dependencies.onPathwayClick,
      onDeleteStop: (stop_id) => this.handleDeleteStop(stop_id),
      onTransfersChanged: () => dependencies.onEntityCreated?.(),
    };
    this.stopViewController = new StopViewController(stopViewDependencies);

    // Initialize PathwayViewController
    const pathwayViewDependencies: PathwayViewDependencies = {
      gtfsDatabase: dependencies.gtfsDatabase,
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
      onPropertiesChanged: () => {
        // Zone labels are drawn from the feature properties, so the map needs
        // the same refresh a geometry edit gets.
        dependencies.mapController.refreshZones();
        dependencies.onEntityCreated?.();
      },
      onDeleteZone: (location_id) => this.handleDeleteZone(location_id),
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
      patchManager: dependencies.patchManager ?? null,
      onAgencyClick: dependencies.onAgencyClick,
      onRouteClick: dependencies.onRouteClick,
      onTimetableClick: dependencies.onTimetableClick,
      onDeleteService: (service_id) => this.handleDeleteService(service_id),
      onServiceChanged: () => dependencies.onEntityCreated?.(),
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
   * The writing handle an embedded editable table needs.
   *
   * Null when the page has no patch manager or a read-only database handle: a
   * table that cannot record its edits must not be rendered at all.
   */
  private editableDeps(): EditableTableDeps | undefined {
    const db = this.dependencies.gtfsDatabase;
    const patchManager = this.dependencies.patchManager;
    if (!patchManager || !db.updateRow || !db.deleteRow) {
      console.warn(
        '[PageContentRenderer] no editable database handle, embedded tables are skipped'
      );
      return undefined;
    }
    const updateRow = db.updateRow;
    const deleteRow = db.deleteRow;
    return {
      gtfsDatabase: {
        getAllRows: (table) =>
          db.getAllRows(table) as Promise<Record<string, unknown>[]>,
        insertRows: (table, rows) => db.insertRows(table, rows),
        updateRow: (table, key, data) => updateRow(table, key, data),
        deleteRow: (table, key) => deleteRow(table, key),
      },
      patchManager,
    };
  }

  /**
   * Clean every value the last validation pass flagged as carrying hidden
   * whitespace, as one patch.
   *
   * The button is disabled for the duration rather than left clickable: the
   * fix reads the published issue list, so a second run while the first is in
   * flight would work from entities that have already been rewritten.
   */
  private async runWhitespaceFix(button: HTMLButtonElement): Promise<void> {
    const deps = this.editableDeps();
    if (!deps) {
      notify.error('This feed is open read-only, so it cannot be fixed');
      return;
    }
    const entities = getFeedIssueEntities('UNCLEAN_VALUE');
    button.disabled = true;
    try {
      const result = await applyWhitespaceFix(entities, deps);
      const message = describeWhitespaceFix(result);
      if (result.rows === 0) {
        notify.warning(message);
      } else {
        notify.success(message);
      }
    } catch (error) {
      console.error('[PageContentRenderer] whitespace fix failed:', error);
      notify.error('Could not clean the whitespace, see the console');
      button.disabled = false;
      return;
    }
    // Re-render the home panel; the patch moved the feed version, so drawing
    // the issue card revalidates and the fixed rows drop out of it.
    this.dependencies.onEntityCreated?.();
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
    const focusStart = performance.now();
    this.applyMapFocus(pageState);
    this.lastMapFocusMs = performance.now() - focusStart;

    try {
      // Render based on page type
      switch (pageState.type) {
        case 'home':
          return await this.renderHome();
        case 'agency':
          return await this.renderAgency(pageState.agency_id);
        case 'route':
          return await this.renderRoute(pageState.route_id);
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
   * A clean feed renders no issue card, which would otherwise leave the home
   * panel with nothing to say about the feed's health. Shown only when the
   * feed has data and zero warnings or errors.
   */
  private renderCleanFeedEncouragement(): string {
    return `
      <div class="rounded-lg border border-success/40 bg-success/10 p-3 text-sm flex items-center justify-between gap-3">
        <span>Everything look good? Export your feed and publish.</span>
        <button type="button" class="btn btn-xs btn-success btn-outline" data-open-guide="publishing">
          Publishing guide
        </button>
      </div>
    `;
  }

  /**
   * Render home page (feed info and agencies list)
   */
  private async renderHome(): Promise<string> {
    const t0 = performance.now();

    // Edits since the last pass are not reflected in the published issues.
    await refreshFeedIssuesIfStale();
    const tIssues = performance.now();

    const agencies = await this.dependencies.relationships.getAgenciesAsync();

    // Get feed_info data
    const feedInfo = await this.getFeedInfo();
    const tMeta = performance.now();

    // Every service in the feed, rendered as the shared timeline
    const timelineSource = this.serviceTimelineSource();
    const serviceData = await loadServiceData(timelineSource);
    const serviceCount = serviceData.size;
    const tServices = performance.now();
    const tripCounts = await loadTripCounts(timelineSource);
    const tTripCounts = performance.now();
    const bounds = await feedBounds(this.dependencies.gtfsDatabase);
    const canBulkTrimExtend = Boolean(
      this.dependencies.gtfsDatabase.updateRow && this.dependencies.patchManager
    );
    const bulkTrimTitle = !canBulkTrimExtend
      ? 'No patch manager available'
      : bounds.start
        ? `Set every service's start_date to ${bounds.start}, and remove every exception before it`
        : 'feed_info has no feed_start_date';
    const bulkExtendTitle = !canBulkTrimExtend
      ? 'No patch manager available'
      : bounds.end
        ? `Set every service's end_date to ${bounds.end}, and remove every exception after it`
        : 'feed_info has no feed_end_date';

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

    const tTimelineStart = performance.now();
    const timelineHtml =
      serviceCount === 0
        ? ''
        : renderServiceTimeline(serviceData, { tripCounts });
    const tTimeline = performance.now();

    const feedIssues = getFeedIssues();
    // Only worth encouraging export once there is something to export, and
    // nothing left to clean up first.
    const feedIsEmpty = !this.dependencies.gtfsParser
      ?.getAllFileNames()
      .some(
        (f) =>
          (this.dependencies.gtfsParser!.getFileDataSync(f)?.length ?? 0) > 0
      );
    const cleanFeedEncouragement =
      !feedIsEmpty && feedIssues.every((row) => row.count === 0);

    const html = `
      <div class="p-4 space-y-4">
        ${await this.renderFeedInfoProperties(feedInfo)}

        ${await this.renderAttributionsSection()}

        ${renderIssueCard('Feed issues', feedIssues)}
        ${cleanFeedEncouragement ? this.renderCleanFeedEncouragement() : ''}

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
              <button
                type="button"
                class="btn btn-xs btn-outline"
                id="bulk-trim-all-btn"
                title="${escapeHtml(bulkTrimTitle)}"
                ${bounds.start && canBulkTrimExtend ? '' : 'disabled'}
              >Trim all to feed start</button>
              <button
                type="button"
                class="btn btn-xs btn-outline"
                id="bulk-extend-all-btn"
                title="${escapeHtml(bulkExtendTitle)}"
                ${bounds.end && canBulkTrimExtend ? '' : 'disabled'}
              >Extend all to feed end</button>
              <input
                type="text"
                class="input input-sm input-bordered"
                placeholder="New Service ID"
                data-inline-create="service"
                style="width: 150px;"
              />
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
                    ${timelineHtml}
                  </div>
                </div>`
          }
        </div>

      </div>
    `;

    console.log(
      `[PageContentRenderer] renderHome: issues=${Math.round(tIssues - t0)}ms ` +
        `meta=${Math.round(tMeta - tIssues)}ms ` +
        `services=${Math.round(tServices - tMeta)}ms ` +
        `tripCounts=${Math.round(tTripCounts - tServices)}ms ` +
        `timeline=${Math.round(tTimeline - tTimelineStart)}ms ` +
        `mapFocus=${Math.round(this.lastMapFocusMs)}ms ` +
        `total=${Math.round(tTimeline - t0)}ms ` +
        `services=${serviceCount} agencies=${agencies.length} ` +
        `html=${Math.round(html.length / 1024)}kb`
    );

    return html;
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
   * Render the attributions section of the home page.
   *
   * Read-only cards: attributions are feed metadata, so they belong next to
   * Feed Information, but editing them stays in the Feed Data modal rather than
   * being duplicated here. Renders nothing when the feed has none.
   */
  private async renderAttributionsSection(): Promise<string> {
    const rows = (await this.dependencies.gtfsDatabase.getAllRows(
      specStoreName(GTFS_TABLES.ATTRIBUTIONS)
    )) as Record<string, unknown>[];
    if (rows.length === 0) {
      return '';
    }

    const cards = await Promise.all(
      rows.map((row) => this.renderAttributionCard(row))
    );

    return `
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">Attributions</h2>
          <button class="btn btn-xs btn-outline manage-attributions-btn">Manage attributions</button>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4 space-y-3">
            ${cards.join('')}
          </div>
        </div>
      </div>
    `;
  }

  /** One attribution: organization, roles, scope, and contact links. */
  private async renderAttributionCard(
    row: Record<string, unknown>
  ): Promise<string> {
    const text = (field: string): string => String(row[field] ?? '').trim();

    const roles = [
      ['is_producer', 'Producer'],
      ['is_operator', 'Operator'],
      ['is_authority', 'Authority'],
    ]
      .filter(([field]) => text(field) === '1')
      .map(
        ([, label]) =>
          `<span class="badge badge-sm badge-outline">${label}</span>`
      )
      .join('');

    const scopeHtml = await this.renderAttributionScope(row);

    const contacts = [
      ['attribution_url', text('attribution_url'), text('attribution_url')],
      [
        'attribution_email',
        text('attribution_email'),
        `mailto:${text('attribution_email')}`,
      ],
      [
        'attribution_phone',
        text('attribution_phone'),
        `tel:${text('attribution_phone')}`,
      ],
    ]
      .filter(([, value]) => value !== '')
      .map(
        ([, value, href]) =>
          `<a class="link link-hover text-xs" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
      )
      .join('<span class="opacity-40 text-xs">·</span>');

    const organization = text('organization_name');

    return `
      <div class="space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold">${organization === '' ? '<span class="opacity-60">No organization name</span>' : escapeHtml(organization)}</span>
          ${roles}
        </div>
        <div class="text-xs opacity-70">${scopeHtml}</div>
        ${contacts === '' ? '' : `<div class="flex items-center gap-2 flex-wrap">${contacts}</div>`}
      </div>
    `;
  }

  /**
   * What an attribution applies to: the agency, route or trip it names, or the
   * whole dataset when it names none. A named entity that does not exist is
   * shown as its raw id rather than hidden, so the broken reference is visible.
   */
  private async renderAttributionScope(
    row: Record<string, unknown>
  ): Promise<string> {
    const scopes: Array<[string, string, string]> = [
      ['agency_id', 'agency', 'Agency'],
      ['route_id', 'routes', 'Route'],
      ['trip_id', 'trips', 'Trip'],
    ];

    for (const [field, table, label] of scopes) {
      const id = String(row[field] ?? '').trim();
      if (id === '') {
        continue;
      }
      const matches = (await this.dependencies.gtfsDatabase.queryRows(table, {
        [field]: id,
      })) as Record<string, string>[];
      if (matches.length === 0) {
        return `${label}: ${escapeHtml(id)} <span class="text-error">(no such ${label.toLowerCase()})</span>`;
      }
      return `${label}: ${escapeHtml(renderOptionLabel(getEntityDisplay(table, matches[0])))}`;
    }

    return 'Applies to the whole dataset';
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

    // Which timetable the header button opens: the first service this route
    // runs, falling back to the feed's first service for a route with no trips
    // yet, which opens the empty "add the first trip" timetable.
    const timetableServiceId =
      Object.keys(serviceGroups)[0] ??
      (allServices[0]?.service_id as string | undefined);

    // Render route properties section
    const routePropertiesHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2 min-w-0">
          <h2 class="text-lg font-semibold truncate">${renderCardLabel(getRouteDisplay(routeData))}</h2>
          <div class="flex items-center gap-2 shrink-0">
            <button class="btn btn-sm btn-outline open-timetable-btn" data-route-id="${route_id}" data-service-id="${escapeHtml(timetableServiceId ?? '')}" title="Timetable"${timetableServiceId ? '' : ' disabled'}>${renderNavIcon('timetable', { sizeClass: 'h-4 w-4' })}</button>
            <button class="btn btn-sm btn-error btn-outline delete-route-btn" data-route-id="${route_id}" title="Delete">${renderTrashIcon()}</button>
          </div>
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
                    No services found.
                    <button type="button" class="link link-primary create-service-link">Create one</button>.
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
        ${renderPickerTrigger({
          content: label
            ? escapeHtml(label)
            : '<span class="opacity-40">Not in a network</span>',
          // Brings its own bordered field box, so only the layout and the
          // chevron come from the shared trigger.
          variant: 'bare',
          className: `${ROUTE_NETWORK_FIELD} w-full cursor-pointer rounded-field border border-base-300 px-3 py-1.5 text-sm hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`,
          attrs: `tabindex="0" role="button" data-route-id="${escapeHtml(route_id)}" data-network-id="${escapeHtml(network_id)}"`,
        })}
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
    setPickerTriggerContent(
      span,
      network_id === ''
        ? '<span class="opacity-40">Not in a network</span>'
        : escapeHtml(await this.networkLabel(network_id))
    );
  }

  /** Ask for a new network's id and name, and write it. Returns its id. */
  private async createNetwork(existingIds: string[]): Promise<string | null> {
    const values = await promptNewEntity({
      title: 'New network',
      fields: [
        { field: 'network_id', tableName: GTFS_TABLES.NETWORKS, mono: true },
        {
          field: 'network_name',
          tableName: GTFS_TABLES.NETWORKS,
          note: 'Naming a network makes the feed export networks.txt and route_networks.txt rather than a network_id column on routes.txt.',
        },
      ],
      validate: (v) => {
        if (v.network_id === '') {
          return 'network_id cannot be empty';
        }
        if (existingIds.includes(v.network_id)) {
          return `Network "${v.network_id}" already exists`;
        }
        return null;
      },
      onCreate: async (v) => {
        const record = {
          network_id: v.network_id,
          network_name: v.network_name,
        };
        await this.dependencies.gtfsDatabase.insertRows('networks', [record]);
        await this.dependencies.patchManager?.recordInsert(
          'networks',
          v.network_id,
          record
        );
        console.log(`[Networks] created ${v.network_id}`);
      },
    });

    return values?.network_id ?? null;
  }

  addEventListeners(container: HTMLElement): void {
    // Clean-feed encouragement's link into the publishing guide.
    installGuideButtons(container);

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

    // Feed issue card row actions: a bulk fix for a whole group of issues.
    container.querySelectorAll('[data-issue-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        // The button sits inside a <summary>, which would otherwise toggle.
        event.preventDefault();
        event.stopPropagation();
        if (
          button.getAttribute('data-issue-action') === WHITESPACE_FIX_ACTION
        ) {
          void this.runWhitespaceFix(button as HTMLButtonElement);
        }
      });
    });

    // Attributions are edited in the Feed Data modal, not on the home page.
    const manageAttributionsBtn = container.querySelector(
      '.manage-attributions-btn'
    );
    if (manageAttributionsBtn) {
      manageAttributionsBtn.addEventListener('click', () => {
        void openModal(
          { type: 'feed_data', table: GTFS_TABLES.ATTRIBUTIONS },
          {
            // The cards above were rendered from the rows the modal just edited.
            onClosed: () => this.dependencies.onEntityCreated?.(),
          }
        );
      });
    }

    // Route header timetable button
    const openTimetableBtn = container.querySelector('.open-timetable-btn');
    if (openTimetableBtn) {
      openTimetableBtn.addEventListener('click', () => {
        const route_id = openTimetableBtn.getAttribute('data-route-id');
        const service_id = openTimetableBtn.getAttribute('data-service-id');
        if (route_id && service_id) {
          this.dependencies.onTimetableClick(route_id, service_id);
        }
      });
    }

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

    // Bulk trim/extend all services to feed_info bounds
    container
      .querySelector('#bulk-trim-all-btn')
      ?.addEventListener('click', () => {
        void this.handleBulkTrimOrExtend('start_date');
      });
    container
      .querySelector('#bulk-extend-all-btn')
      ?.addEventListener('click', () => {
        void this.handleBulkTrimOrExtend('end_date');
      });

    // Add inline entity creation event listeners
    this.addInlineCreationListeners(container);

    // Add service selection dropdown listener
    this.addServiceSelectionListener(container);

    // "No services found" empty state: create one here rather than sending the
    // user to the Feed page's inline input.
    container
      .querySelector('.create-service-link')
      ?.addEventListener('click', () => {
        void this.createServiceFromEmptyState();
      });

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

  /** Create a service from the route page's "no services" empty state. */
  private async createServiceFromEmptyState(): Promise<void> {
    const service_id = await showNewServiceModal({
      database: this.dependencies.gtfsDatabase,
      patchManager: this.dependencies.patchManager ?? null,
    });
    if (service_id !== null) {
      this.dependencies.onEntityCreated?.();
    }
  }

  /**
   * Add event listeners for inline entity creation
   */
  private addInlineCreationListeners(container: HTMLElement): void {
    const inlineCreator = new InlineEntityCreator(
      this.dependencies
        .gtfsDatabase as unknown as import('./gtfs-database').GTFSDatabase,
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
   * Trim or extend every `calendar` row's bound to the matching `feed_info`
   * value and drop the exceptions past that edge, as one undoable batch.
   * Mirrors the Service Calendar modal's bulk buttons so the feed page has the
   * same action.
   */
  private async handleBulkTrimOrExtend(
    field: 'start_date' | 'end_date'
  ): Promise<void> {
    const db = this.dependencies.gtfsDatabase;
    const patchManager = this.dependencies.patchManager;
    if (!db.updateRow || !patchManager) {
      return;
    }
    const bounds = await feedBounds(db);
    const value = field === 'start_date' ? bounds.start : bounds.end;
    if (!value) {
      return;
    }
    const { services, exceptions } = await trimOrExtendServices(
      db as Parameters<typeof trimOrExtendServices>[0],
      patchManager,
      field,
      value
    );
    if (services === 0 && exceptions === 0) {
      notify.info('Every service is already at that bound');
    } else {
      const verb = field === 'start_date' ? 'Trimmed' : 'Extended';
      const removed =
        exceptions > 0
          ? `, removed ${exceptions} exception${exceptions === 1 ? '' : 's'}`
          : '';
      notify.success(
        `${verb} ${services} service${services === 1 ? '' : 's'}${removed}`
      );
    }
    this.dependencies.onEntityCreated?.();
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

  /**
   * Remove a zone from locations.geojson, cascading to the stop_times that
   * reference it.
   *
   * The feature removal is an update of the single locations row, not a row
   * delete, so the cascade goes through recordBatchMixed: the stop_time deletes
   * and that update land as one patch and undo restores them together.
   */
  private async handleDeleteZone(location_id: string): Promise<void> {
    const db = this.dependencies.gtfsDatabase;
    const pm = this.dependencies.patchManager;
    const parser = this.dependencies.gtfsParser;
    if (!db || !pm || !db.deleteRow || !parser) {
      console.warn('[PageContentRenderer] handleDeleteZone: missing deps', {
        db: !!db,
        pm: !!pm,
        deleteRow: !!db?.deleteRow,
        parser: !!parser,
      });
      return;
    }

    const features = getZoneFeatures(parser);
    if (!features.some((f) => String(f.id ?? '') === location_id)) {
      console.warn(
        `[PageContentRenderer] handleDeleteZone: zone ${location_id} not in locations.geojson`
      );
      return;
    }

    const stopTimes = (await db.queryRows('stop_times', {
      location_id,
    })) as Record<string, unknown>[];

    const doDelete = async (): Promise<void> => {
      for (const st of stopTimes) {
        const key = generateCompositeKeyFromRecord('stop_times', st);
        await db.deleteRow!('stop_times', key);
      }
      const { before, after } = await applyZoneFeatures(
        parser,
        features.filter((f) => String(f.id ?? '') !== location_id)
      );

      await pm.recordBatchMixed(
        [
          ...stopTimes.map((st) => ({
            op: 'delete' as const,
            table: 'stop_times',
            id: generateCompositeKeyFromRecord('stop_times', st),
            record: st,
          })),
          {
            op: 'update' as const,
            table: LOCATIONS_TABLE,
            id: LOCATIONS_ROW_KEY,
            before,
            after,
          },
        ],
        stopTimes.length > 0
          ? `Delete zone + ${stopTimes.length} stop_time${stopTimes.length !== 1 ? 's' : ''}`
          : 'Delete zone'
      );

      console.log(
        `[PageContentRenderer] Deleted zone ${location_id}${stopTimes.length > 0 ? ` and ${stopTimes.length} stop_times` : ''}`
      );
      this.dependencies.mapController.refreshZones();
      await navigateToHome();
    };

    if (stopTimes.length === 0) {
      await doDelete();
      return;
    }

    const tripIds = [...new Set(stopTimes.map((st) => st.trip_id as string))];
    const tripSummary =
      tripIds.slice(0, 5).join(', ') +
      (tripIds.length > 5 ? ` … and ${tripIds.length - 5} more` : '');
    await showModal({
      title: 'Zone has scheduled pickups',
      body: `<p>This zone is referenced by <strong>${stopTimes.length} stop_time${stopTimes.length !== 1 ? 's' : ''}</strong> across ${tripIds.length} trip${tripIds.length !== 1 ? 's' : ''}:</p>
             <p class="text-sm opacity-70 mt-1">${tripSummary}</p>
             <p class="mt-3">You can cascade-delete the zone and all its stop_times (reversible via undo), or cancel.</p>`,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
        {
          label: `Delete zone + ${stopTimes.length} stop_times`,
          className: 'btn-error',
          onClick: () => doDelete(),
        },
      ],
    });
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
