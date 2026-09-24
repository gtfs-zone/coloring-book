/**
 * Page State Manager
 *
 * The editor's hash codec and its subclass of `interlocking`'s generic
 * `PageStateManager`. The shared class owns the current state, the history
 * and the hash; what is the editor's own is here: the codec for its eight
 * page variants and seven content modals, the inline-edit flush before every
 * navigation, the same-page guard, breadcrumbs resolved against IndexedDB,
 * and the validated boot restore.
 */

import type { PageStateCodec } from 'interlocking/ui/page-state-manager';
import {
  PageStateManager as SharedPageStateManager,
  homeWithModal,
} from 'interlocking/ui/page-state-manager';
import {
  PageState,
  ModalState,
  ModalType,
  PaneModalType,
  MODAL_TYPES,
  StateValidator,
  isPageState,
} from '../types/page-state';
import { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import { BreadcrumbLookup, buildBreadcrumbs } from './breadcrumbs';
import { flushInlineEdits, hasLiveEditor } from '../utils/inline-edit';
import { followRenameInState } from '../utils/follow-rename';
import { CONFIG } from '../config';

export type { BreadcrumbLookup };

/**
 * Read the modal dimension out of a parsed hash.  An unknown modal name is
 * dropped rather than throwing: the hash is user-editable.
 */
function parseModalParams(params: URLSearchParams): ModalState | null {
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

const pageStateCodec: PageStateCodec<PageState> = {
  isPageState,

  /** Returns empty params for home state (clears the hash). */
  toParams(pageState) {
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

    return params;
  },

  /**
   * Priority: stop -> pathway -> zone -> location_group -> service (no
   * route) -> route -> agency -> home. The `load=` command param is not page
   * state and is ignored with every other unknown param.
   */
  fromParams(params) {
    const modal = parseModalParams(params);
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
  },
};

export interface PageStateManagerOptions {
  enableHistory?: boolean;
  maxHistoryLength?: number;
  enableUrlSync?: boolean;
}

/**
 * PageStateManager - Single source of truth for navigation state
 */
export class PageStateManager extends SharedPageStateManager<
  PageState,
  BreadcrumbItem<PageState>
> {
  private breadcrumbLookup: BreadcrumbLookup | null = null;
  private validator: StateValidator | null = null;
  private readonly urlSync: boolean;

  constructor(options: PageStateManagerOptions = {}) {
    super({
      codec: pageStateCodec,
      maxHistoryLength: CONFIG.MAX_NAVIGATION_HISTORY,
      ...options,
    });
    this.urlSync = options.enableUrlSync ?? false;
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
  override setStateValidator(fn: StateValidator): void {
    this.validator = fn;
    super.setStateValidator(fn);
  }

  /**
   * Update the current page state
   * Triggers navigation event and updates browser history/URL if configured
   */
  override async setPageState(newState: PageState): Promise<void> {
    if (!isPageState(newState)) {
      throw new Error('Invalid page state provided');
    }

    // Before the already-on-this-page guard: leaving a page with an editor
    // open has to write what is in it first, and this is the single funnel
    // every navigation lands in - navigateTo, the back handler, clearModal.
    if (hasLiveEditor()) {
      console.log('[PageStateManager] flushing live edit before navigation');
    }
    await flushInlineEdits();

    // Navigating to the page we are already on is a no-op: every handler
    // re-renders, and re-rendering the current page from here would throw away
    // scroll and focus for nothing. Guarded on the hash too, so a boot URL
    // carrying extra params (?load=) still gets rewritten.
    if (
      this.urlSync &&
      typeof window !== 'undefined' &&
      JSON.stringify(this.getPageState()) === JSON.stringify(newState) &&
      this.buildHash(newState) === window.location.hash.slice(1)
    ) {
      console.log(
        `[PageStateManager] already on ${newState.type}, skipping navigation`
      );
      return;
    }

    super.setPageState(newState);
  }

  /**
   * Re-point the current state at the same object under a new ID.
   *
   * Not a navigation: the user did not move, the object was renamed under
   * them. So no history entry, no navigation handlers, and no inline-edit
   * flush - this runs inside a patch emit, where a flush would record a
   * second patch. The re-render is the one the patch event already triggers.
   *
   * Returns true when the current page moved.
   */
  followRename(keyField: string, from: string, to: string): boolean {
    const moved = this.rewrite((state) =>
      followRenameInState(state, keyField, from, to)
    );
    if (moved) {
      console.log(
        `[PageStateManager] following rename ${keyField} "${from}" to "${to}"`
      );
    }
    return moved;
  }

  /**
   * Breadcrumbs for the current page state, with object names resolved
   * against the database
   */
  async resolveBreadcrumbs(): Promise<BreadcrumbItem<PageState>[]> {
    return buildBreadcrumbs(this.getPageState(), this.breadcrumbLookup);
  }

  /**
   * Navigate to a specific page state (convenience method)
   */
  async navigateTo(pageState: PageState): Promise<void> {
    await this.setPageState(pageState);
  }

  /**
   * Initialize from URL hash (call this on page load).
   * Validates the parsed state; falls back to home if the object doesn't exist.
   * Sets the state without dispatching navigation events.
   */
  async initializeFromURL(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const candidate = this.pendingStateFromURL();

    if (
      candidate.type !== 'home' &&
      this.validator &&
      !(await this.validator(candidate))
    ) {
      console.warn(
        '[PageStateManager] initializeFromURL: object not found in current feed, falling back to home'
      );
      // The modal survives: it does not depend on the object that is missing.
      this.adoptState(homeWithModal(candidate));
      return;
    }

    this.adoptState(candidate);
    console.log(
      '[PageStateManager] initializeFromURL: restored state',
      candidate
    );
  }

  /**
   * Drop the modal from the current state, leaving the page beneath it.
   * Awaits the navigation, which here flushes inline edits first.
   */
  override async clearModal(): Promise<void> {
    const current = this.getPageState();
    if (!current.modal) {
      return;
    }
    const rest = { ...current };
    delete rest.modal;
    await this.setPageState(rest as PageState);
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
  options: PageStateManagerOptions = {}
): PageStateManager {
  defaultInstance = new PageStateManager(options);
  return defaultInstance;
}
