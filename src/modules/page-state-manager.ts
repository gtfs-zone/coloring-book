/**
 * Page State Manager
 *
 * Central state management system for GTFS.zone Browse tab navigation.
 * Provides a single source of truth for page states and breadcrumb generation.
 * Replaces the fragmented navigation logic across multiple modules.
 */

import {
  PageState,
  BreadcrumbItem,
  NavigationEvent,
  PageStateManagerConfig,
  StateValidator,
  isPageState,
} from '../types/page-state.js';
import { CONFIG } from '../config.js';

/**
 * Event handler type for navigation events
 */
type NavigationEventHandler = (event: NavigationEvent) => void;

/**
 * Breadcrumb lookup functions interface
 * These will be injected to allow the manager to resolve object names
 */
export interface BreadcrumbLookup {
  getAgencyName: (agency_id: string) => Promise<string>;
  getRouteName: (route_id: string) => Promise<string>;
  getStopName: (stop_id: string) => Promise<string>;
  getAgencyIdForRoute: (route_id: string) => Promise<string>;
  getStopAncestors: (
    stop_id: string
  ) => Promise<Array<{ stop_id: string; label: string }>>;
  getPathwayAncestors: (
    pathway_id: string
  ) => Promise<Array<{ stop_id: string; label: string }>>;
  getZoneName: (location_id: string) => Promise<string>;
  getLocationGroupName: (location_group_id: string) => Promise<string>;
}

/**
 * PageStateManager - Single source of truth for navigation state
 */
export class PageStateManager {
  private currentState: PageState = { type: 'home' };
  private navigationHistory: NavigationEvent[] = [];
  private eventHandlers: NavigationEventHandler[] = [];
  private config: PageStateManagerConfig;
  private breadcrumbLookup: BreadcrumbLookup | null = null;
  private stateValidator: StateValidator | null = null;
  private suppressHashUpdate = false;

  constructor(config: Partial<PageStateManagerConfig> = {}) {
    this.config = {
      enableHistory: true,
      maxHistoryLength: CONFIG.MAX_NAVIGATION_HISTORY,
      enableUrlSync: false,
      ...config,
    };

    // Set up hash-based URL sync if enabled
    if (this.config.enableUrlSync && typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        void this.handleHashChange();
      });
    }
  }

  /**
   * Set the breadcrumb lookup functions for resolving object names
   */
  setBreadcrumbLookup(lookup: BreadcrumbLookup): void {
    this.breadcrumbLookup = lookup;
  }

  /**
   * Set the async validator used to check whether a restored page state still
   * refers to an existing object.  Returns false to fall back to home.
   */
  setStateValidator(fn: StateValidator): void {
    this.stateValidator = fn;
  }

  /**
   * Get the current page state
   */
  getPageState(): PageState {
    return { ...this.currentState };
  }

  /**
   * Update the current page state
   * Triggers navigation event and updates browser history/URL if configured
   */
  async setPageState(newState: PageState): Promise<void> {
    if (!isPageState(newState)) {
      throw new Error('Invalid page state provided');
    }

    const previousState = this.currentState;
    this.currentState = { ...newState };

    // Record navigation event
    const navigationEvent: NavigationEvent = {
      from: previousState,
      to: newState,
      timestamp: Date.now(),
    };

    if (this.config.enableHistory) {
      this.navigationHistory.push(navigationEvent);

      // Limit history size
      if (this.navigationHistory.length > this.config.maxHistoryLength) {
        this.navigationHistory = this.navigationHistory.slice(
          -this.config.maxHistoryLength
        );
      }
    }

    // Update browser hash if enabled
    if (this.config.enableUrlSync && typeof window !== 'undefined') {
      const hash = this.pageStateToURL(newState);
      const currentHash = window.location.hash.slice(1);
      if (hash !== currentHash) {
        this.suppressHashUpdate = true;
        window.location.hash = hash;
        // suppressHashUpdate is reset in handleHashChange once the event fires
      }
    }

    // Notify event handlers
    this.eventHandlers.forEach((handler) => {
      try {
        handler(navigationEvent);
      } catch (error) {
        console.error('Error in navigation event handler:', error);
      }
    });
  }

  /**
   * Generate breadcrumbs for the current page state
   */
  async getBreadcrumbs(): Promise<BreadcrumbItem[]> {
    return this.buildBreadcrumbs(this.currentState);
  }

  /**
   * Navigate to a specific page state (convenience method)
   */
  async navigateTo(pageState: PageState): Promise<void> {
    await this.setPageState(pageState);
  }

  /**
   * Check if navigation back is possible
   */
  canNavigateBack(): boolean {
    return this.navigationHistory.length > 0;
  }

  /**
   * Navigate back to the previous page state
   */
  async navigateBack(): Promise<boolean> {
    if (!this.canNavigateBack()) {
      return false;
    }

    // Find the last different state
    const currentStateStr = JSON.stringify(this.currentState);
    for (let i = this.navigationHistory.length - 1; i >= 0; i--) {
      const historyItem = this.navigationHistory[i];
      const fromStateStr = JSON.stringify(historyItem.from);

      if (fromStateStr !== currentStateStr) {
        await this.setPageState(historyItem.from);
        return true;
      }
    }

    return false;
  }

  /**
   * Add a navigation event handler
   */
  addNavigationHandler(handler: NavigationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove a navigation event handler
   */
  removeNavigationHandler(handler: NavigationEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index >= 0) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Get navigation history
   */
  getNavigationHistory(): NavigationEvent[] {
    return [...this.navigationHistory];
  }

  /**
   * Clear navigation history
   */
  clearNavigationHistory(): void {
    this.navigationHistory = [];
  }

  /**
   * Initialize from URL hash (call this on page load).
   * Parses the hash, skipping any `load=` command param (handled separately).
   * Validates the parsed state; falls back to home if the object doesn't exist.
   * Sets currentState directly without dispatching navigation events.
   */
  async initializeFromURL(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const rawHash = window.location.hash.slice(1);
    const params = new URLSearchParams(rawHash);
    params.delete('load'); // `load=` is a command, not state
    const cleanHash = params.toString();

    const candidate = this.urlToPageState(cleanHash);

    if (candidate.type !== 'home' && this.stateValidator) {
      const valid = await this.stateValidator(candidate);
      if (!valid) {
        console.warn(
          '[PageStateManager] initializeFromURL: object not found in current feed, falling back to home'
        );
        this.currentState = { type: 'home' };
        return;
      }
    }

    this.currentState = candidate;
    console.log(
      '[PageStateManager] initializeFromURL: restored state',
      candidate
    );
  }

  /**
   * Build breadcrumbs for a given page state
   */
  private async buildBreadcrumbs(
    pageState: PageState
  ): Promise<BreadcrumbItem[]> {
    const breadcrumbs: BreadcrumbItem[] = [];

    try {
      switch (pageState.type) {
        case 'home':
          // Home page has no breadcrumbs
          break;

        case 'agency': {
          const agencyName = await this.getObjectName(
            'agency',
            pageState.agency_id
          );
          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          breadcrumbs.push({
            label: agencyName,
            pageState: { type: 'agency', agency_id: pageState.agency_id },
          });
          break;
        }

        case 'route': {
          // Look up the agency for this route
          const agency_id = this.breadcrumbLookup
            ? await this.breadcrumbLookup.getAgencyIdForRoute(
                pageState.route_id
              )
            : 'unknown';
          const agencyName = await this.getObjectName('agency', agency_id);
          const routeName = await this.getObjectName(
            'route',
            pageState.route_id
          );

          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          breadcrumbs.push({
            label: agencyName,
            pageState: { type: 'agency', agency_id },
          });
          breadcrumbs.push({
            label: routeName,
            pageState: { type: 'route', route_id: pageState.route_id },
          });
          break;
        }

        case 'timetable': {
          // Look up the agency for this route
          const agency_id = this.breadcrumbLookup
            ? await this.breadcrumbLookup.getAgencyIdForRoute(
                pageState.route_id
              )
            : 'unknown';
          const agencyName = await this.getObjectName('agency', agency_id);
          const routeName = await this.getObjectName(
            'route',
            pageState.route_id
          );
          const serviceName = await this.getObjectName(
            'service',
            pageState.service_id
          );

          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          breadcrumbs.push({
            label: agencyName,
            pageState: { type: 'agency', agency_id },
          });
          breadcrumbs.push({
            label: routeName,
            pageState: { type: 'route', route_id: pageState.route_id },
          });

          const timetableLabel = serviceName;

          breadcrumbs.push({
            label: timetableLabel,
            pageState: pageState,
          });
          break;
        }

        case 'stop': {
          const stopName = await this.getObjectName('stop', pageState.stop_id);
          const ancestors = this.breadcrumbLookup
            ? await this.breadcrumbLookup.getStopAncestors(pageState.stop_id)
            : [];

          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          for (const ancestor of ancestors) {
            breadcrumbs.push({
              label: ancestor.label,
              pageState: { type: 'stop', stop_id: ancestor.stop_id },
            });
          }
          breadcrumbs.push({
            label: stopName,
            pageState: { type: 'stop', stop_id: pageState.stop_id },
          });
          break;
        }

        case 'service': {
          const serviceName = await this.getObjectName(
            'service',
            pageState.service_id
          );

          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          breadcrumbs.push({
            label: serviceName,
            pageState: { type: 'service', service_id: pageState.service_id },
          });
          break;
        }

        case 'pathway': {
          const pathwayAncestors = this.breadcrumbLookup
            ? await this.breadcrumbLookup.getPathwayAncestors(
                pageState.pathway_id
              )
            : [];

          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          for (const ancestor of pathwayAncestors) {
            breadcrumbs.push({
              label: ancestor.label,
              pageState: { type: 'stop', stop_id: ancestor.stop_id },
            });
          }
          breadcrumbs.push({
            label: `Pathway ${pageState.pathway_id}`,
            pageState: {
              type: 'pathway',
              pathway_id: pageState.pathway_id,
            },
          });
          break;
        }

        case 'zone': {
          // A zone has no parent object: it is a standalone polygon.
          const zoneName = this.breadcrumbLookup
            ? await this.breadcrumbLookup.getZoneName(pageState.location_id)
            : pageState.location_id;

          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          breadcrumbs.push({
            label: zoneName,
            pageState: { type: 'zone', location_id: pageState.location_id },
          });
          break;
        }

        case 'location_group': {
          // No stop parent: a group has many member stops, none of them owning it.
          const groupName = this.breadcrumbLookup
            ? await this.breadcrumbLookup.getLocationGroupName(
                pageState.location_group_id
              )
            : pageState.location_group_id;

          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
          breadcrumbs.push({
            label: groupName,
            pageState: {
              type: 'location_group',
              location_group_id: pageState.location_group_id,
            },
          });
          break;
        }

        default:
          // Unknown page state - return just Home
          breadcrumbs.push({
            label: 'Home',
            pageState: { type: 'home' },
          });
      }
    } catch (error) {
      console.error('Error building breadcrumbs:', error);

      // Return fallback breadcrumbs on error
      breadcrumbs.length = 0;
      breadcrumbs.push({
        label: 'Home',
        pageState: { type: 'home' },
      });
    }

    return breadcrumbs;
  }

  /**
   * Get object name with fallback handling
   */
  private async getObjectName(
    type: 'agency' | 'route' | 'stop' | 'service',
    id: string
  ): Promise<string> {
    if (!this.breadcrumbLookup) {
      return `${type.charAt(0).toUpperCase() + type.slice(1)} ${id}`;
    }

    try {
      switch (type) {
        case 'agency':
          return await this.breadcrumbLookup.getAgencyName(id);
        case 'route':
          return await this.breadcrumbLookup.getRouteName(id);
        case 'stop':
          return await this.breadcrumbLookup.getStopName(id);
        case 'service':
          return id;
        default:
          return `Unknown ${type} ${id}`;
      }
    } catch (error) {
      console.warn(`Failed to lookup ${type} name for ID ${id}:`, error);
      return `${type.charAt(0).toUpperCase() + type.slice(1)} ${id}`;
    }
  }

  /**
   * Convert page state to a URL hash string (no leading `#`).
   * Returns empty string for home state (clears the hash).
   */
  pageStateToURL(pageState: PageState): string {
    const params = new URLSearchParams();

    switch (pageState.type) {
      case 'home':
        return '';

      case 'agency':
        params.set('agency', pageState.agency_id);
        return params.toString();

      case 'route':
        params.set('route', pageState.route_id);
        return params.toString();

      case 'timetable':
        params.set('route', pageState.route_id);
        params.set('service', pageState.service_id);
        if (pageState.direction_id) {
          params.set('direction', pageState.direction_id);
        }
        return params.toString();

      case 'stop':
        params.set('stop', pageState.stop_id);
        return params.toString();

      case 'service':
        params.set('service', pageState.service_id);
        return params.toString();

      case 'pathway':
        params.set('pathway', pageState.pathway_id);
        return params.toString();

      case 'zone':
        params.set('zone', pageState.location_id);
        return params.toString();

      case 'location_group':
        params.set('location_group', pageState.location_group_id);
        return params.toString();

      default:
        return '';
    }
  }

  /**
   * Convert a hash string (no leading `#`) to a PageState.
   * Parses with URLSearchParams.  Priority: stop -> service (no route) ->
   * timetable (route + service) -> route -> agency -> home.
   * Always returns a valid PageState (never null).
   */
  urlToPageState(hash: string): PageState {
    const params = new URLSearchParams(hash);

    if (params.has('stop')) {
      return { type: 'stop', stop_id: params.get('stop')! };
    }

    if (params.has('pathway')) {
      return { type: 'pathway', pathway_id: params.get('pathway')! };
    }

    if (params.has('zone')) {
      return { type: 'zone', location_id: params.get('zone')! };
    }

    if (params.has('location_group')) {
      return {
        type: 'location_group',
        location_group_id: params.get('location_group')!,
      };
    }

    if (params.has('service') && !params.has('route')) {
      return { type: 'service', service_id: params.get('service')! };
    }

    if (params.has('route') && params.has('service')) {
      const direction_id = params.get('direction') ?? undefined;
      return {
        type: 'timetable',
        route_id: params.get('route')!,
        service_id: params.get('service')!,
        ...(direction_id !== undefined && { direction_id }),
      };
    }

    if (params.has('route')) {
      return { type: 'route', route_id: params.get('route')! };
    }

    if (params.has('agency')) {
      return { type: 'agency', agency_id: params.get('agency')! };
    }

    return { type: 'home' };
  }

  /**
   * Handle browser hashchange event (user navigated back/forward or changed hash manually).
   * Ignored when the change was triggered programmatically by setPageState.
   */
  private async handleHashChange(): Promise<void> {
    if (this.suppressHashUpdate) {
      this.suppressHashUpdate = false;
      return;
    }

    const rawHash = window.location.hash.slice(1);
    const params = new URLSearchParams(rawHash);
    params.delete('load');
    const cleanHash = params.toString();

    let newState = this.urlToPageState(cleanHash);

    if (newState.type !== 'home' && this.stateValidator) {
      const valid = await this.stateValidator(newState);
      if (!valid) {
        console.warn(
          '[PageStateManager] hashchange: object not found, falling back to home'
        );
        newState = { type: 'home' };
      }
    }

    const previousState = this.currentState;
    this.currentState = { ...newState };

    const navigationEvent: NavigationEvent = {
      from: previousState,
      to: newState,
      timestamp: Date.now(),
    };

    if (this.config.enableHistory) {
      this.navigationHistory.push(navigationEvent);
      if (this.navigationHistory.length > this.config.maxHistoryLength) {
        this.navigationHistory = this.navigationHistory.slice(
          -this.config.maxHistoryLength
        );
      }
    }

    this.eventHandlers.forEach((handler) => {
      try {
        handler(navigationEvent);
      } catch (error) {
        console.error('Error in navigation event handler:', error);
      }
    });
  }
}

/**
 * Default singleton instance for convenience
 */
let defaultInstance: PageStateManager | null = null;

/**
 * Get or create the default PageStateManager instance
 */
export function getPageStateManager(): PageStateManager {
  if (!defaultInstance) {
    defaultInstance = new PageStateManager();
  }
  return defaultInstance;
}

/**
 * Initialize the default PageStateManager instance with custom config
 */
export function initPageStateManager(
  config: Partial<PageStateManagerConfig> = {}
): PageStateManager {
  defaultInstance = new PageStateManager(config);
  return defaultInstance;
}
