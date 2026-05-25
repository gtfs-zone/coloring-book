/**
 * Application-wide configuration constants.
 * All magic numbers live here — import CONFIG rather than inlining literals.
 */
export const CONFIG = {
  // IndexedDB
  DB_NAME: 'GTFSZoneDB',

  // Editor (table view)
  DEBOUNCE_DELAY: 500, // ms before flushing pending cell updates to IndexedDB
  CLUSTERIZE_ROWS_IN_BLOCK: 50,
  CLUSTERIZE_BLOCKS_IN_CLUSTER: 4,

  // Search
  SEARCH_RESULTS_LIMIT: 10,
  SEARCH_MIN_QUERY_LENGTH: 2,

  // Navigation history
  MAX_NAVIGATION_HISTORY: 50,

  // Patch system — how often to compress and store a full-state snapshot
  SNAPSHOT_INTERVAL: 50, // take a full snapshot every N patches

  // Map navigation — zoom level used when focusing a single stop or station.
  // For stations with multiple child stops, this is the max zoom; fitBounds
  // will zoom out further if children don't fit at this level so subsidiaries
  // aren't cut off.
  STOP_FOCUS_ZOOM: 19,

  // Boot timing — set to true locally to emit console.time measurements for each
  // init stage. Leave false in production (logs are noisy and measured overhead
  // accumulates in tight loops).
  DEBUG_BOOT: false,
} as const;
