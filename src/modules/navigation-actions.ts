/**
 * Navigation Actions
 *
 * Unified navigation methods for GTFS.zone Browse tab.
 * Provides high-level navigation functions that work with PageStateManager.
 * Replaces scattered navigation logic across multiple modules.
 */

import { PageState } from '../types/page-state.js';
import { getPageStateManager } from './page-state-manager.js';

/**
 * Navigate to home page (agencies list)
 */
export async function navigateToHome(): Promise<void> {
  const pageState: PageState = { type: 'home' };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to agency details page
 * @param agency_id - The agency ID to display
 */
export async function navigateToAgency(agency_id: string): Promise<void> {
  const pageState: PageState = {
    type: 'agency',
    agency_id: agency_id,
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to route details page
 * @param route_id - The route ID to display
 */
export async function navigateToRoute(route_id: string): Promise<void> {
  const pageState: PageState = {
    type: 'route',
    route_id: route_id,
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to timetable view for a route service
 * @param route_id - The route ID
 * @param service_id - The service ID for the timetable
 * @param direction_id - Optional direction ID (0 or 1)
 */
export async function navigateToTimetable(
  route_id: string,
  service_id: string,
  direction_id?: string
): Promise<void> {
  const pageState: PageState = {
    type: 'timetable',
    route_id: route_id,
    service_id: service_id,
    ...(direction_id && { direction_id: direction_id }),
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to stop details page
 * @param stop_id - The stop ID to display
 */
export async function navigateToStop(stop_id: string): Promise<void> {
  const pageState: PageState = {
    type: 'stop',
    stop_id: stop_id,
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to service details page
 * @param service_id - The service ID to display
 */
export async function navigateToService(service_id: string): Promise<void> {
  const pageState: PageState = {
    type: 'service',
    service_id: service_id,
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to pathway details page
 * @param pathway_id - The pathway ID to display
 */
export async function navigateToPathway(pathway_id: string): Promise<void> {
  const pageState: PageState = {
    type: 'pathway',
    pathway_id: pathway_id,
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to on-demand zone details page
 * @param location_id - The locations.geojson feature id to display
 */
export async function navigateToZone(location_id: string): Promise<void> {
  const pageState: PageState = {
    type: 'zone',
    location_id: location_id,
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Navigate to location group details page
 * @param location_group_id - The location group ID to display
 */
export async function navigateToLocationGroup(
  location_group_id: string
): Promise<void> {
  const pageState: PageState = {
    type: 'location_group',
    location_group_id: location_group_id,
  };
  await getPageStateManager().navigateTo(pageState);
}

/**
 * Get the current page state
 */
export function getCurrentPageState(): PageState {
  return getPageStateManager().getPageState();
}

let pendingFocusSelector: string | null = null;

/**
 * Request that a selector be focused after the next page render completes.
 * Navigation triggers an async re-render that isn't awaited by navigateTo*,
 * so a caller can't just navigate then query the DOM immediately after.
 */
export function focusAfterNextRender(selector: string): void {
  pendingFocusSelector = selector;
}

/**
 * Consume (and clear) the pending focus selector, if any was requested.
 */
export function consumePendingFocusSelector(): string | null {
  const selector = pendingFocusSelector;
  pendingFocusSelector = null;
  return selector;
}

/**
 * Navigation event listener type
 */
export type NavigationListener = (pageState: PageState) => void;

/**
 * Add a listener for navigation changes
 * @param listener - Function to call when navigation occurs
 */
export function addNavigationListener(listener: NavigationListener): void {
  getPageStateManager().addNavigationHandler((event) => {
    listener(event.to);
  });
}
