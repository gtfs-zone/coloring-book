/**
 * Application-wide configuration constants.
 * All magic numbers live here: import CONFIG rather than inlining literals.
 */
export const CONFIG = {
  // IndexedDB
  DB_NAME: 'GTFSZoneDB',

  // IndexedDB: how long an open or delete request may sit unanswered before we
  // treat the database as wedged. A request queued behind a blocked
  // version-change operation fires no event at all, so without this the boot
  // hangs forever with nothing logged.
  DB_REQUEST_TIMEOUT_MS: 8_000,

  // Feed blobs: rows per file_blobs chunk. Keeps every serialized JSON string
  // far below the engine's max string length (SpiderMonkey: ~1.07 GB, which a
  // 4.5M-row stop_times.txt exceeds as a single string) and small enough to
  // parse inside one frame budget.
  BLOB_CHUNK_ROWS: 50_000,

  // Feed loading: rows hydrated between awaits of a macrotask, so the event
  // loop drains and the progress bar keeps painting during a large import.
  HYDRATE_YIELD_ROWS: 25_000,

  // Route rendering: trips built between yields to the event loop. Lower than
  // HYDRATE_YIELD_ROWS because a trip costs far more than a row: each one
  // walks its stop_times and joins them into a geometry key.
  ROUTE_BUILD_TRIP_CHUNK: 2_000,

  // Feed loading: how long to wait for a message from the parse worker before
  // treating the load as dead, terminating the worker and failing loudly.
  LOAD_WATCHDOG_MS: 60_000,

  // Feed loading: thresholds above which the user is warned and offered a
  // bailout before the expensive work starts. Bytes are the zip's uncompressed
  // size; rows are the estimated total across all tables.
  LARGE_FEED_WARN_BYTES: 250_000_000,
  LARGE_FEED_WARN_ROWS: 2_000_000,

  // Feed loading: bytes of CSV per row, used to turn a zip entry's uncompressed
  // size into a row estimate without inflating it. Measured on MBTA's
  // stop_times.txt (210 MB, 4,494,139 rows).
  FEED_CSV_BYTES_PER_ROW: 48,

  // Feed loading: in-memory cost of one parsed row (the object, its keys and
  // its string values). Measured against the same table, whose 4.5M rows hold
  // roughly 1.8 GB. Only used to size the large-feed warning.
  FEED_ROW_MEMORY_BYTES: 400,

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

  // Map spotlight: zoom range over which the direction arrows on the single
  // spotlighted route fade in, and their opacity once faded in. Sits above
  // STOP_FADE_ZOOM_MAX so arrows are the last thing to appear as you zoom in.
  ROUTE_ARROW_FADE_ZOOM_MIN: 12,
  ROUTE_ARROW_FADE_ZOOM_MAX: 13.5,
  ROUTE_ARROW_OPACITY: 0.85,

  // Map spotlight: line-sort-key applied to the focused route so it paints
  // above every other route. Far above any natural key (max ~90999).
  SPOTLIGHT_SORT_KEY: 1_000_000,

  // Boot timing: set to true locally to emit console.time measurements for each
  // init stage. Leave false in production (logs are noisy and measured overhead
  // accumulates in tight loops).
  DEBUG_BOOT: true,

  // Where the feed catalog and any path-only feed URL resolve to. Always the
  // deployed feed server: unlike test-track, this app has no local realtime
  // stack to talk to in dev, so pointing it at localhost would only produce a
  // failed catalog fetch on every load modal open.
  RT_BASE: 'https://rt.gtfs.zone',
} as const;
