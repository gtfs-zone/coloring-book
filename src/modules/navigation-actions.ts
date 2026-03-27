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
 * Get the current page state
 */
export function getCurrentPageState(): PageState {
  return getPageStateManager().getPageState();
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
