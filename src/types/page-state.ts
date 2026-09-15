/**
 * Page State Types for GTFS.zone Browse Tab Navigation
 *
 * This module defines the core types for the unified page state management system.
 * Every page in the application should be uniquely identified by a PageState,
 * making breadcrumbs deterministic and navigation predictable.
 */

/**
 * Union type representing all possible page states in the application.
 * Each state contains the minimal set of object keys needed to uniquely
 * identify and restore the page content.
 *
 * Simplified: route_id and stop_id are unique across the entire GTFS feed,
 * so we don't need to track agency_id for routes/timetables.
 */
export type PageLocation =
  | { type: 'home' }
  | { type: 'agency'; agency_id: string }
  | { type: 'route'; route_id: string }
  | { type: 'stop'; stop_id: string }
  | { type: 'service'; service_id: string }
  | { type: 'pathway'; pathway_id: string }
  | { type: 'zone'; location_id: string }
  | { type: 'location_group'; location_group_id: string };

/**
 * The content modals that live in the URL hash.  Transient modals (guide,
 * load, option pickers, confirms, files, history) stay out of the hash.
 */
export const MODAL_TYPES = [
  'timetable',
  'shapes',
  'calendar',
  'fares',
  'on_demand',
  'feed_data',
  'levels',
] as const;

export type ModalType = (typeof MODAL_TYPES)[number];

/** Which route, service and direction the timetable modal is showing. */
export interface TimetableModalState {
  type: 'timetable';
  route_id: string;
  service_id: string;
  direction_id?: string;
}

/** Every content modal but the timetable: a single optional pane selector. */
export type PaneModalType = Exclude<ModalType, 'timetable'>;

/**
 * Written as a mapped type over the pane modal types rather than one interface
 * with a union `type`, so a single member can be picked out of it by `type`
 * (which is how `modal-router.ts` narrows an opener's argument).
 */
export type PaneModalState = {
  [T in PaneModalType]: {
    type: T;
    /** Which pane a multi-table modal opens on. */
    table?: string;
  };
}[PaneModalType];

/**
 * A modal is orthogonal to the page beneath it: closing one returns to that
 * page rather than to a separate modal page state.
 */
export type ModalState = TimetableModalState | PaneModalState;

/** Distributed so that narrowing on `type` still works through the modal field. */
type WithModal<T> = T extends unknown ? T & { modal?: ModalState } : never;

export type PageState = WithModal<PageLocation>;

export function isModalState(value: unknown): value is ModalState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const modal = value as {
    type?: unknown;
    table?: unknown;
    route_id?: unknown;
    service_id?: unknown;
    direction_id?: unknown;
  };
  if (!MODAL_TYPES.includes(modal.type as ModalType)) {
    return false;
  }

  if (modal.type === 'timetable') {
    if (
      typeof modal.route_id !== 'string' ||
      typeof modal.service_id !== 'string'
    ) {
      return false;
    }
    if (
      modal.direction_id !== undefined &&
      typeof modal.direction_id !== 'string'
    ) {
      return false;
    }
    return Object.keys(modal).every((k) =>
      ['type', 'route_id', 'service_id', 'direction_id'].includes(k)
    );
  }

  if (modal.table !== undefined && typeof modal.table !== 'string') {
    return false;
  }
  return Object.keys(modal).every((k) => k === 'type' || k === 'table');
}

/**
 * Type guard to check if a value is a valid PageState
 */
export function isPageState(value: unknown): value is PageState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  // The modal dimension is validated on its own; the checks below count the
  // keys of the page underneath it.
  const { modal, ...state } = value as { modal?: unknown; type?: string };
  if (modal !== undefined && !isModalState(modal)) {
    return false;
  }
  if (!state.type || typeof state.type !== 'string') {
    return false;
  }

  switch (state.type) {
    case 'home':
      return Object.keys(state).length === 1;

    case 'agency': {
      const agencyState = state as { type: string; agency_id?: string };
      return (
        Object.keys(state).length === 2 &&
        typeof agencyState.agency_id === 'string'
      );
    }

    case 'route': {
      const routeState = state as { type: string; route_id?: string };
      return (
        Object.keys(state).length === 2 &&
        typeof routeState.route_id === 'string'
      );
    }

    case 'stop': {
      const stopState = state as { type: string; stop_id?: string };
      return (
        Object.keys(state).length === 2 && typeof stopState.stop_id === 'string'
      );
    }

    case 'service': {
      const serviceState = state as { type: string; service_id?: string };
      return (
        Object.keys(state).length === 2 &&
        typeof serviceState.service_id === 'string'
      );
    }

    case 'pathway': {
      const pathwayState = state as { type: string; pathway_id?: string };
      return (
        Object.keys(state).length === 2 &&
        typeof pathwayState.pathway_id === 'string'
      );
    }

    case 'zone': {
      const zoneState = state as { type: string; location_id?: string };
      return (
        Object.keys(state).length === 2 &&
        typeof zoneState.location_id === 'string'
      );
    }

    case 'location_group': {
      const groupState = state as {
        type: string;
        location_group_id?: string;
      };
      return (
        Object.keys(state).length === 2 &&
        typeof groupState.location_group_id === 'string'
      );
    }

    default:
      return false;
  }
}

/**
 * Navigation event types for the page state manager
 */
export type NavigationEvent = {
  from: PageState;
  to: PageState;
  timestamp: number;
};

/**
 * Configuration options for page state manager
 */
export type PageStateManagerConfig = {
  enableHistory: boolean;
  maxHistoryLength: number;
  enableUrlSync: boolean;
};

/**
 * Async validator that checks whether a non-home page state refers to an
 * object that actually exists in the current feed.  Returns true if the state
 * is valid, false if the object is missing (caller falls back to home).
 */
export type StateValidator = (state: PageState) => Promise<boolean>;
