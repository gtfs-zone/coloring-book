/**
 * Application-wide configuration constants.
 * All magic numbers live here: import CONFIG rather than inlining literals.
 */
export const CONFIG = {
  // IndexedDB
  DB_NAME: 'GTFSZoneDB',

  // Editor (table view)
  DEBOUNCE_DELAY: 500, // ms before flushing pending cell updates to IndexedDB
  CLUSTERIZE_ROWS_IN_BLOCK: 50,
  CLUSTERIZE_BLOCKS_IN_CLUSTER: 4,

  // Navigation history
  MAX_NAVIGATION_HISTORY: 50,

  // Patch system: how often to compress and store a full-state snapshot
  SNAPSHOT_INTERVAL: 50, // take a full snapshot every N patches

  // Map navigation: zoom level used when focusing a single stop or station.
  // For stations with multiple child stops, this is the max zoom; fitBounds
  // will zoom out further if children don't fit at this level so subsidiaries
  // aren't cut off.
  STOP_FOCUS_ZOOM: 19,

  // Map spotlight: zoom range over which plain stops fade in/out. Shared
  // between LayerManager's fade-opacity expression and its click-area hit
  // radius so hidden stops are never hoverable/clickable.
  STOP_FADE_ZOOM_MIN: 10.5,
  STOP_FADE_ZOOM_MAX: 12.5,

  // Map spotlight: the same fade applied to stations and child nodes, but
  // pitched lower. Stations are far more spaced out than plain stops, so they
  // can stay legible well past the zoom where a pile of stops turns to mush.
  // Must sit below STOP_FADE_ZOOM_MIN or the two bands overlap and stations
  // fade back out as plain stops fade in.
  STATION_FADE_ZOOM_MIN: 7.5,
  STATION_FADE_ZOOM_MAX: 9.5,

  // Map spotlight: below this many stops both fade bands are skipped and every
  // stop draws at full opacity. The fade exists to stop thousands of dots
  // piling up; a feed being authored from scratch has no pile to avoid.
  STOP_FADE_MIN_STOPS: 50,

  // Map spotlight: opacity/width treatment applied when a route (and its
  // stops) is selected. Non-matching routes/stops dim; the matched route's
  // line and casing get a width bump.
  SPOTLIGHT_STOP_DIM: 0.15,
  SPOTLIGHT_ROUTE_DIM: 0.2,
  SPOTLIGHT_LINE_BUMP: 1.35,
  SPOTLIGHT_CASING_BUMP: 1.3,

  // Map spotlight: line-sort-key applied to the focused route so it paints
  // above every other route. Far above any natural key (max ~90999).
  SPOTLIGHT_SORT_KEY: 1_000_000,

  // Boot timing: set to true locally to emit console.time measurements for each
  // init stage. Leave false in production (logs are noisy and measured overhead
  // accumulates in tight loops).
  DEBUG_BOOT: false,

  // Where the feed catalog and any path-only feed URL resolve to. Always the
  // deployed feed server: unlike test-track, this app has no local realtime
  // stack to talk to in dev, so pointing it at localhost would only produce a
  // failed catalog fetch on every load modal open.
  RT_BASE: 'https://rt.gtfs.zone',
} as const;
