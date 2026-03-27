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

let globalBreadcrumbLookup: GTFSBreadcrumbLookup | null = null;

/**
 * Initialize the page state system with GTFS integration
 */
export function initializePageStateWithGTFS(
  gtfsParser: GTFSParser
): PageStateManager {
  // Create breadcrumb lookup
  globalBreadcrumbLookup = createGTFSBreadcrumbLookup(gtfsParser.getDatabase());

  // Initialize PageStateManager with default config (URL sync disabled per user request)
  const pageStateManager = initPageStateManager({
    enableHistory: true,
    maxHistoryLength: 50,
    enableUrlSync: false,
    enableBrowserHistory: false,
  });

  // Set up breadcrumb lookup
  pageStateManager.setBreadcrumbLookup(globalBreadcrumbLookup);

  return pageStateManager;
}

/**
 * Update breadcrumb lookup when GTFS data is reloaded
 */
export function updateBreadcrumbLookup(_gtfsParser: GTFSParser): void {
  // No caching, so no need to clear cache or preload
  // Data is always loaded fresh from the database
}
