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
export type PageState =
  | { type: 'home' }
  | { type: 'agency'; agency_id: string }
  | { type: 'route'; route_id: string }
  | {
      type: 'timetable';
      route_id: string;
      service_id: string;
      direction_id?: string;
    }
  | { type: 'stop'; stop_id: string }
  | { type: 'service'; service_id: string };

/**
 * Represents a single item in the breadcrumb trail.
 * Links a human-readable label to the page state it represents.
 */
export type BreadcrumbItem = {
  label: string;
  pageState: PageState;
};

/**
 * Type guard to check if a value is a valid PageState
 */
export function isPageState(value: unknown): value is PageState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as { type?: string };
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

    case 'timetable': {
      const timetableState = state as {
        type: string;
        route_id?: string;
        service_id?: string;
        direction_id?: string;
      };
      const hasRequiredFields =
        typeof timetableState.route_id === 'string' &&
        typeof timetableState.service_id === 'string';
      const hasValidDirectionId =
        timetableState.direction_id === undefined ||
        typeof timetableState.direction_id === 'string';
      const keyCount = Object.keys(state).length;
      return (
        hasRequiredFields &&
        hasValidDirectionId &&
        (keyCount === 3 || keyCount === 4)
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
 * Simplified: URL sync disabled for cleaner user experience
 */
export type PageStateManagerConfig = {
  enableHistory: boolean;
  maxHistoryLength: number;
  enableUrlSync: boolean;
  enableBrowserHistory: boolean;
};
