/**
 * Navigation Actions
 *
 * Unified navigation methods for GTFS.zone Browse tab.
 * Provides high-level navigation functions that work with PageStateManager.
 * Replaces scattered navigation logic across multiple modules.
 */

import { ModalState, PageState } from '../types/page-state';
import { getPageStateManager } from './page-state-manager';
import { ModalTransient, getModalRouter } from 'interlocking/ui/modal-router';

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
 * Open the timetable modal on one route, service and direction.
 *
 * The timetable is a modal rather than a page, so this leaves the page
 * underneath alone: closing the modal returns to whatever the user came from.
 * Called again while the modal is open, it just re-points it, because the
 * router leaves a modal of the same type alone.
 *
 * @param route_id - The route ID
 * @param service_id - The service ID for the timetable
 * @param direction_id - Optional direction ID; the busiest one when omitted
 */
export async function openTimetable(
  route_id: string,
  service_id: string,
  direction_id?: string
): Promise<void> {
  await openModal({
    type: 'timetable',
    route_id,
    service_id,
    ...(direction_id && { direction_id }),
  });
}

/**
 * Open a content modal on top of the current page.
 *
 * The page beneath is preserved, so closing the modal returns to it. The modal
 * itself is opened by the modal router reacting to the state change, never
 * from here.
 *
 * @param modal - Which modal, and which pane it opens on
 * @param transient - Row to highlight, and what to run once it closes
 */
export async function openModal(
  modal: ModalState,
  transient: ModalTransient = {}
): Promise<void> {
  getModalRouter().setPendingTransient(transient);
  const pageState: PageState = {
    ...getPageStateManager().getPageState(),
    modal,
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
 * Navigate to a page state built by the caller.
 *
 * For a move that keeps the state's shape and only changes what it names, such
 * as following a renamed ID, where the per-entity helpers above would drop the
 * modal the state carries.
 */
export async function navigateToState(pageState: PageState): Promise<void> {
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
