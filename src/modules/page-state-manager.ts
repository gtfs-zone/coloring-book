/**
 * Page State Manager
 *
 * Central state management system for GTFS.zone Browse tab navigation.
 * Provides a single source of truth for page states and breadcrumb generation.
 * Replaces the fragmented navigation logic across multiple modules.
 */

import {
  PageState,
  ModalState,
  ModalType,
  PaneModalType,
  MODAL_TYPES,
  NavigationEvent,
  PageStateManagerConfig,
  StateValidator,
  isPageState,
} from '../types/page-state';
import { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import { BreadcrumbLookup, buildBreadcrumbs } from './breadcrumbs';
import { flushInlineEdits, hasLiveEditor } from '../utils/inline-edit';
import { followRenameInState } from '../utils/follow-rename';
import { CONFIG } from '../config';

/**
 * Event handler type for navigation events
 */
type NavigationEventHandler = (event: NavigationEvent) => void;

export type { BreadcrumbLookup };

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

    // Before the already-on-this-page guard: leaving a page with an editor
    // open has to write what is in it first, and this is the single funnel
    // every navigation lands in - navigateTo, the back handler, hash changes.
    if (hasLiveEditor()) {
      console.log('[PageStateManager] flushing live edit before navigation');
    }
    await flushInlineEdits();

    // Navigating to the page we are already on is a no-op: every handler
    // re-renders, and re-rendering the current page from here would throw away
    // scroll and focus for nothing. Guarded on the hash too, so a boot URL
    // carrying extra params (?load=) still gets rewritten.
    if (
      this.config.enableUrlSync &&
      typeof window !== 'undefined' &&
      JSON.stringify(this.currentState) === JSON.stringify(newState) &&
      this.pageStateToURL(newState) === window.location.hash.slice(1)
    ) {
      console.log(
        `[PageStateManager] already on ${newState.type}, skipping navigation`
      );
      return;
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
   * Re-point the current state at the same object under a new ID.
   *
   * Not a navigation: the user did not move, the object was renamed under
   * them. So no history entry (`history.replaceState` fires no `hashchange`,
   * which is why `suppressHashUpdate` stays untouched), no navigation
   * handlers, and no inline-edit flush - this runs inside a patch emit, where
   * a flush would record a second patch. The re-render is the one the patch
   * event already triggers.
   *
   * Returns true when the current page moved.
   */
  followRename(keyField: string, from: string, to: string): boolean {
    // Entries naming the old ID would send navigateBack to a page that no
    // longer exists, so they follow too.
    this.navigationHistory = this.navigationHistory.map((event) => ({
      ...event,
      from: followRenameInState(event.from, keyField, from, to) ?? event.from,
      to: followRenameInState(event.to, keyField, from, to) ?? event.to,
    }));

    const next = followRenameInState(this.currentState, keyField, from, to);
    if (!next) {
      return false;
    }

    console.log(
      `[PageStateManager] following rename ${keyField} "${from}" to "${to}"`
    );
    this.currentState = next;

    if (this.config.enableUrlSync && typeof window !== 'undefined') {
      const hash = this.pageStateToURL(next);
      if (hash !== window.location.hash.slice(1)) {
        window.history.replaceState(
          null,
          '',
          hash === ''
            ? window.location.pathname + window.location.search
            : `#${hash}`
        );
      }
    }

    return true;
  }

  /**
   * Generate breadcrumbs for the current page state
   */
  async getBreadcrumbs(): Promise<BreadcrumbItem<PageState>[]> {
    return buildBreadcrumbs(this.currentState, this.breadcrumbLookup);
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
   * What the current hash points at, without validating it against feed data.
   *
   * Boot needs the page type before there is a feed to validate against: a
   * deep link into an object means the stored feed is the one wanted, so the
   * load modal is skipped entirely.
   */
  peekURLPageState(): PageState {
    if (typeof window === 'undefined') {
      return { type: 'home' };
    }
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.delete('load');
    return this.urlToPageState(params.toString());
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
        // The modal survives: it does not depend on the object that is missing.
        this.currentState = {
          type: 'home',
          ...(candidate.modal && { modal: candidate.modal }),
        };
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
   * Convert page state to a URL hash string (no leading `#`).
   * Returns empty string for home state (clears the hash).
   */
  pageStateToURL(pageState: PageState): string {
    const params = new URLSearchParams();

    switch (pageState.type) {
      case 'agency':
        params.set('agency', pageState.agency_id);
        break;

      case 'route':
        params.set('route', pageState.route_id);
        break;

      case 'stop':
        params.set('stop', pageState.stop_id);
        break;

      case 'service':
        params.set('service', pageState.service_id);
        break;

      case 'pathway':
        params.set('pathway', pageState.pathway_id);
        break;

      case 'zone':
        params.set('zone', pageState.location_id);
        break;

      case 'location_group':
        params.set('location_group', pageState.location_group_id);
        break;

      default:
        break;
    }

    // The modal rides on top of whatever page is beneath it, home included.
    // Its own params are prefixed so they cannot collide with the page's: a
    // timetable modal over a service page carries two different service ids.
    const modal = pageState.modal;
    if (modal) {
      params.set('modal', modal.type);
      if (modal.type === 'timetable') {
        params.set('modal_route', modal.route_id);
        params.set('modal_service', modal.service_id);
        if (modal.direction_id) {
          params.set('modal_direction', modal.direction_id);
        }
      } else if (modal.table) {
        params.set('modal_table', modal.table);
      }
    }

    return params.toString();
  }

  /**
   * Convert a hash string (no leading `#`) to a PageState.
   * Parses with URLSearchParams.  Priority: stop -> service (no route) ->
   * route -> agency -> home.
   * Always returns a valid PageState (never null).
   */
  urlToPageState(hash: string): PageState {
    const params = new URLSearchParams(hash);
    const modal = this.parseModalParams(params);
    const withModal = (state: PageState): PageState =>
      modal ? { ...state, modal } : state;

    if (params.has('stop')) {
      return withModal({ type: 'stop', stop_id: params.get('stop')! });
    }

    if (params.has('pathway')) {
      return withModal({ type: 'pathway', pathway_id: params.get('pathway')! });
    }

    if (params.has('zone')) {
      return withModal({ type: 'zone', location_id: params.get('zone')! });
    }

    if (params.has('location_group')) {
      return withModal({
        type: 'location_group',
        location_group_id: params.get('location_group')!,
      });
    }

    if (params.has('service') && !params.has('route')) {
      return withModal({ type: 'service', service_id: params.get('service')! });
    }

    if (params.has('route')) {
      return withModal({ type: 'route', route_id: params.get('route')! });
    }

    if (params.has('agency')) {
      return withModal({ type: 'agency', agency_id: params.get('agency')! });
    }

    return withModal({ type: 'home' });
  }

  /**
   * Read the modal dimension out of a parsed hash.  An unknown modal name is
   * dropped rather than throwing: the hash is user-editable.
   */
  private parseModalParams(params: URLSearchParams): ModalState | null {
    const type = params.get('modal');
    if (type === null) {
      return null;
    }
    if (!MODAL_TYPES.includes(type as ModalType)) {
      console.warn(`[PageStateManager] unknown modal in hash: ${type}`);
      return null;
    }
    if (type === 'timetable') {
      const route_id = params.get('modal_route');
      const service_id = params.get('modal_service');
      if (route_id === null || service_id === null) {
        console.warn(
          '[PageStateManager] timetable modal in hash is missing route or service'
        );
        return null;
      }
      const direction_id = params.get('modal_direction');
      return {
        type: 'timetable',
        route_id,
        service_id,
        ...(direction_id !== null && { direction_id }),
      };
    }
    const table = params.get('modal_table');
    return {
      type: type as PaneModalType,
      ...(table !== null && { table }),
    };
  }

  /**
   * Drop the modal from the current state, leaving the page beneath it.
   * A no-op when no modal is open, so a modal that navigated away before
   * closing does not bounce the page.
   */
  async clearModal(): Promise<void> {
    const current = this.getPageState();
    if (!current.modal) {
      return;
    }
    const rest = { ...current };
    delete rest.modal;
    await this.setPageState(rest as PageState);
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
        newState = {
          type: 'home',
          ...(newState.modal && { modal: newState.modal }),
        };
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
