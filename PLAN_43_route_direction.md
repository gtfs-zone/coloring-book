# Plan: Show Direction of Trip on Map (Issue #43)

## Summary

Currently `createRouteFeatures()` emits one GeoJSON feature per trip — a route with 100 trips sharing the same shape_id creates 100 identical stacked lines, with zero direction indication. This plan fixes both problems in three phases: (1) deduplicate to one feature per unique shape per route; (2) run a segment proximity algorithm to split each shape into labeled runs (one-way forward, one-way backward, bidirectional); (3) add MapLibre symbol layers with auto-rotated arrow glyphs showing direction. No offset lines (deferred). Scope: same-route shapes only.

Approach chosen: arrows along the line (`symbol-placement: 'line'`), not offset parallel lines. Algorithm: segment midpoint snapping + antiparallel angle detection, O(S) total where S = total shape points across all unique shapes.

---

## Relevant Context

**Primary file:** `src/modules/route-renderer.ts`
- All logic changes are here. No new files needed.
- `createRouteFeatures()` (line 171) — the method to refactor. Currently: one `RouteFeature` per trip.
- `initializeMapLayers()` (line 86) — where new MapLibre layers are added.
- `renderRoutes()` (line 369) — where the GeoJSON source is populated.
- `RouteFeature` interface (line 11) — needs `direction_type` and `shape_id` added to properties.

**Config:** `src/config.ts` — add tunables for proximity threshold, angle tolerance, snap resolution.

**Types:** All GTFS types are `Record<string, any>`. Fields used:
- `trip.shape_id`, `trip.direction_id`, `trip.route_id`
- `shape.shape_pt_lon`, `shape.shape_pt_lat`, `shape.shape_pt_sequence`

**MapLibre:** `symbol-placement: 'line'` places symbols along a line, auto-rotating to the line's bearing. Use `text-field` with Unicode glyphs — no bitmap icons needed. The existing `'routes'` source (GeoJSONSource) can carry the new segment features alongside the existing ones, or a second source `'route-segments'` can be added. Prefer a second source for clean separation (background lines stay on `'routes'`, arrows sit on `'route-segments'`).

**No existing tests to worry about.** Manual testing only.

---

## Phase 1: Deduplicate trips → unique shapes

**Goal:** Eliminate the primary source of visual clutter. A route with 100 trips all sharing `shape_id='S001'` currently creates 100 identical stacked lines; after this phase it creates 1.

**Steps:**

- [ ] In `createRouteFeatures()`, after building `tripsByRoute`, build a second index:
  `uniqueShapesByRoute: Map<route_id, Map<shape_id, { direction_id: string | undefined }>>` — for each route, track each unique `shape_id` and the `direction_id` of the first trip that uses it.
- [ ] Replace the inner `routeTrips.forEach((trip) => {...})` loop: instead of iterating over all trips, iterate over the deduplicated `uniqueShapesByRoute.get(route_id)` entries. One feature per unique shape.
- [ ] For trips with no `shape_id` (fallback to stop connections): deduplicate by `trip_id` (no change needed there — each trip's stop sequence is unique).
- [ ] Add `shape_id` and `direction_id` to `RouteFeature.properties` interface.
- [ ] Commit: `feat(route-renderer): deduplicate trips to unique shapes per route`

**Gotcha:** `direction_id` in GTFS is `0` or `1` (integer or string — be defensive). Store as `string | undefined`. If two trips share the same `shape_id` but different `direction_id` values (unusual but valid), record both as separate features; key the dedup map on `shape_id + '/' + direction_id`.

---

## Phase 2: Segment proximity classification

**Goal:** For each route with opposing shapes, split each shape into labeled runs: `'forward'` (one-way in this shape's direction), `'backward'` (one-way in the opposing shape's direction — only on the opposing shape's features), or `'both'` (bidirectional corridor, present on both shapes but deduplicated to one feature).

### Config additions (`src/config.ts`)

- [ ] Add to `CONFIG`:
  ```typescript
  ROUTE_DIRECTION_PROXIMITY_M: 50,       // midpoint distance threshold for segment match
  ROUTE_DIRECTION_ANGLE_TOLERANCE_DEG: 30, // antiparallel tolerance (180° ± this)
  ROUTE_DIRECTION_SNAP_DEG: 0.001,       // ~111m snap grid for spatial index cells
  ```

### The algorithm

For each route with ≥2 unique shapes, run pairwise comparison between all shape pairs. In practice almost all routes have exactly 2 (one per direction_id). For routes with only 1 unique shape, all segments are `'forward'` (skip proximity detection).

**Build segment index for shape B** (helper function `buildSegmentIndex`):
- [ ] For each consecutive coordinate pair `(coords[i], coords[i+1])` in shape B:
  - Compute midpoint: `midLon = (lon1+lon2)/2`, `midLat = (lat1+lat2)/2`
  - Compute bearing angle: `angle = Math.atan2(lat2-lat1, lon2-lon1) * 180/Math.PI` (−180 to 180)
  - Snap midpoint to grid: `cellLat = Math.round(midLat / SNAP_DEG)`, same for lon
  - Insert into `Map<string, SegmentEntry[]>` at key `` `${cellLat},${cellLon}` ``
  - Also insert references into the 8 adjacent neighbor cells (so cross-boundary matches work)

**Classify each segment of shape A** (helper function `classifySegments`):
- [ ] For each segment `(A[i], A[i+1])`:
  - Compute its midpoint and bearing
  - Look up the grid key in shape B's index
  - For each candidate entry from B:
    - Haversine distance between midpoints (fast approximation: use flat-Earth formula `d = sqrt((Δlat*111000)² + (Δlon*111000*cos(midLat))²)` — good enough for <200m)
    - Angle difference: compute `|angle_A - angle_B|`, normalize to [0°, 180°], check if it's near 180° (i.e., `|diff - 180| < ANGLE_TOLERANCE`)
    - If distance < `PROXIMITY_M` AND antiparallel → this segment of A is `'both'`; mark it, record which B segment matched (to exclude from B's `'backward'` set later)
  - If no match → segment of A is `'forward'`
- [ ] Do the same for shape B with shape A's index, using `'backward'` for unmatched segments and skipping already-matched segments (those become `'both'` and are already captured in A's run).

**Stitch segments into runs** (helper function `stitchRuns`):
- [ ] Iterate through the labeled segments for a shape in order. Group consecutive same-type segments into a run. Each run becomes one GeoJSON Feature with a MultiPoint/LineString geometry that includes all intermediate coordinates.
  - Run boundary: share the endpoint coordinate with the next run (no gaps).
  - Example: segments `[fwd, fwd, both, both, fwd]` → 3 features: `[P0..P2]`=forward, `[P2..P4]`=both, `[P4..P5]`=forward.
- [ ] For `'both'` runs: emit only once (from shape A). When processing shape B's segments, skip the already-emitted bidirectional runs.

**New `RouteFeature` properties:**
- [ ] Add `direction_type: 'forward' | 'backward' | 'both'` to `RouteFeature.properties`.
- [ ] Update the `RouteFeature` interface accordingly.

**Output of `createRouteFeatures()`** becomes these stitched run features, not full shapes. The `'routes'` source still gets the full deduplicated shapes (for the background line layer — keep `routes-background` rendering all shapes without per-run splitting, for simplicity). The per-run features go into a new source `'route-segments'`.

Actually, simplification: just use the per-run features for BOTH the background lines and the arrows. Remove the old full-shape features. The stitched runs reconstruct the full shape perfectly (no visual gaps).

- [ ] Commit: `feat(route-renderer): classify segments as one-way or bidirectional`

**Gotcha:** Circular routes (start ≈ end of the same shape) may have unusual direction_id patterns. If a route has `direction_id=0` with a shape that is nearly identical to `direction_id=1`'s shape (even in the same direction), don't mark it as antiparallel — the angle check protects against this. Tolerance ±30° means a pair is only antiparallel if the angle difference is 150°–180°.

**Gotcha:** Some routes have only `direction_id=0` (no `direction_id=1`). In that case all segments are `'forward'`. No proximity detection needed.

**Gotcha:** For the multi-shape-pair case (>2 unique shapes per route, e.g. branching routes), run the pairwise comparison for all pairs. A segment matched by any opposing shape is `'both'`.

---

## Phase 3: Arrow rendering

**Goal:** Add MapLibre symbol layers showing direction arrows along each route segment.

### New MapLibre source and layers

- [ ] In `initializeMapLayers()`, add a second GeoJSON source `'route-segments'`:
  ```typescript
  this.map.addSource('route-segments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  ```

- [ ] Add layer `'routes-arrows'` on source `'route-segments'`:
  ```typescript
  {
    id: 'routes-arrows',
    type: 'symbol',
    source: 'route-segments',
    layout: {
      'symbol-placement': 'line',
      'text-field': [
        'match', ['get', 'direction_type'],
        'forward',  '▶',
        'backward', '◀',
        'both',     '◀▶',
        ''
      ],
      'text-size': 13,
      'text-font': ['Noto Sans Regular'],   // must be in the map style's glyph set
      'symbol-spacing': 80,                  // px between arrow symbols
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'viewport',
      'text-keep-upright': false,            // allow downward-pointing arrows
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': ['get', 'color'],
      'text-halo-width': 1,
    },
  }
  ```

  **Note on glyphs:** `text-field` with Unicode characters requires the map's style to include glyph sources. If the current map style doesn't include Noto Sans Regular (or equivalent), the arrows will silently not render. Check the active style's `glyphs` URL — if missing, fall back to using a simple line arrow via a separate raster image, or restrict to ASCII `'>'`, `'<'` characters.

  **Fallback approach if glyphs are unavailable:** Use `'>'` for forward and `'<'` for backward (ASCII, always available), `'<>'` for both. These are less visually refined but guaranteed to work.

- [ ] In `renderRoutes()`, populate `'route-segments'` source with the per-run features from `createRouteFeatures()`.

- [ ] Add `'route-segments'` to the `destroy()` cleanup (remove source and layer).

- [ ] Add `'routes-arrows'` to the highlight logic in `highlightRoute()` / `clearHighlight()` — arrows should remain visible on highlighted routes.

- [ ] Commit: `feat(route-renderer): add directional arrow symbols on route segments`

### Layer ordering

The layer order in MapLibre matters (later = on top). Current order:
1. `routes-background`
2. `routes-clickarea`  
3. `routes-highlight`

New order:
1. `routes-background`
2. `routes-clickarea`
3. `routes-arrows` ← new, above clickarea so arrows are visible
4. `routes-highlight`

The `addLayer` calls in `initializeMapLayers()` must be in this order.

---

## Out of Scope (deferred)

- **Offset parallel lines** for bidirectional corridors — separate issue as noted by user.
- **Cross-route merging** — only same-route shapes are compared.
- **Zoom-level-dependent rendering** — explicitly avoided per user guidance.
- **Stop-connection fallback geometry** — trips without shapes still get one feature per trip via the existing fallback; no direction classification applied there.

---

## Original Issue

> Show direction of trip on map
>
> Idk how to do this, but for now lets try something a bit ugly but functional and leave room for improvement
