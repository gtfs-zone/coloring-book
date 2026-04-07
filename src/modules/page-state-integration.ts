/**
 * Page State Integration
 *
 * Integration layer between PageStateManager and GTFS data.
 * Sets up breadcrumb lookup and provides convenience functions.
 */

import {
  PageStateManager,
  initPageStateManager,
} from './page-state-manager.js';
import {
  GTFSBreadcrumbLookup,
  createGTFSBreadcrumbLookup,
} from './gtfs-breadcrumb-lookup.js';
import { GTFSParser } from './gtfs-parser.js';
import { GTFSRelationships } from './gtfs-relationships.js';

let globalBreadcrumbLookup: GTFSBreadcrumbLookup | null = null;

/**
 * Initialize the page state system with GTFS integration
 */
export function initializePageStateWithGTFS(
  gtfsParser: GTFSParser,
  relationships: GTFSRelationships
): PageStateManager {
  // Create breadcrumb lookup
  globalBreadcrumbLookup = createGTFSBreadcrumbLookup(gtfsParser.getDatabase());

  // Initialize PageStateManager with hash-based URL sync enabled
  const pageStateManager = initPageStateManager({
    enableHistory: true,
    maxHistoryLength: 50,
    enableUrlSync: true,
  });

  // Set up breadcrumb lookup
  pageStateManager.setBreadcrumbLookup(globalBreadcrumbLookup);

  // Inject state validator so restored hash states are checked against live data
  pageStateManager.setStateValidator(async (state) => {
    switch (state.type) {
      case 'route':
        return (await relationships.getRouteByIdAsync(state.route_id)) !== null;
      case 'stop':
        return (await relationships.getStopByIdAsync(state.stop_id)) !== null;
      case 'agency':
        return (
          (await relationships.getAgencyByIdAsync(state.agency_id)) !== null
        );
      case 'service':
        return (
          (await relationships.getCalendarForServiceAsync(state.service_id)) !==
          null
        );
      case 'timetable':
        return (await relationships.getRouteByIdAsync(state.route_id)) !== null;
      default:
        return true;
    }
  });

  return pageStateManager;
}

/**
 * Update breadcrumb lookup when GTFS data is reloaded
 */
export function updateBreadcrumbLookup(_gtfsParser: GTFSParser): void {
  // No caching, so no need to clear cache or preload
  // Data is always loaded fresh from the database
}
