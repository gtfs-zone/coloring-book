/**
 * Application-wide configuration constants.
 * All magic numbers live here — import CONFIG rather than inlining literals.
 */
export const CONFIG = {
  // IndexedDB
  DB_NAME: 'GTFSZoneDB',
  DB_VERSION: 4,

  // Editor (table view)
  DEBOUNCE_DELAY: 500, // ms before flushing pending cell updates to IndexedDB
  CLUSTERIZE_ROWS_IN_BLOCK: 50,
  CLUSTERIZE_BLOCKS_IN_CLUSTER: 4,

  // Search
  SEARCH_RESULTS_LIMIT: 10,
  SEARCH_MIN_QUERY_LENGTH: 2,

  // Navigation history
  MAX_NAVIGATION_HISTORY: 50,

  // Patch system (used from Phase 3 onward)
  SNAPSHOT_INTERVAL: 50, // take a full snapshot every N patches
  MAX_UNDO_HISTORY: 200, // in-memory undo stack cap
} as const;
