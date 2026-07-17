# Code Review — Map restyle (uncommitted working-tree changes)

Reviewed: 2026-07-17, on `main` at `4f826d2`, working-tree diff of:
`src/modules/interaction-handler.ts`, `src/modules/layer-manager.ts`,
`src/modules/map-controller.ts`, `src/modules/route-renderer.ts`
(plus an unrelated `pnpm-lock.yaml` bump — ignored).

## What the diff does

A visual overhaul of the map plus a "spotlight" selection treatment:

- **Route lines**: cased look — a new `routes-casing` layer (darker shade of the
  route color, derived per-feature via new `getCasingColor` and stored as a new
  `colorDark` feature property) drawn under `routes-background` (the colored
  line, now full opacity). Widths are zoom-interpolated via a new `zoomWidth()`
  helper with `ROUTE_WIDTH_STOPS` / `CASING_WIDTH_STOPS` constants.
- **Route selection**: the old `routes-highlight` layer (filter-based overlay)
  is deleted. `highlightRoute`/`highlightRoutes`/`clearHighlight` now go
  through a new `applySpotlight(route_ids | null)` that mutates paint
  properties on the two base layers: non-matching routes dim to
  `SPOTLIGHT_ROUTE_DIM = 0.2`, matching routes get width bumps
  (`SPOTLIGHT_LINE_BUMP = 1.35`, `SPOTLIGHT_CASING_BUMP = 1.3`).
- **Stops**: zoom-interpolated radii (per-location-type via new `stopRadiusAt`),
  new default styling (`strokeColor #37474f`, `radius 5.5`), focused stops get
  an `#e74c3c` accent ring and 1.7x size. Plain stops (location_type 0) fade
  out below ~z12.5 via new `stopFadeOpacity(dim)` (interpolate z10.5→z12.5);
  stations/child nodes always render.
- **Hit-testing**: `stops-clickarea` is now the *sole* hit-test layer — its
  radius collapses to 0 for stops hidden by the low-zoom fade, so invisible
  stops don't hover/click. `stops-background` was removed from all
  `queryRenderedFeatures` lists and hover handlers in interaction-handler.ts
  and layer-manager.ts.
- **Route-stop spotlight**: new `LayerManager.setRouteStops(stop_ids)` marks
  route stops with an `onRoute` feature-state (`SPECIAL_STOP` expression =
  focused OR onRoute → always visible + clickable at any zoom) and dims all
  other stops to `SPOTLIGHT_STOP_DIM = 0.15`. `MapController.highlightRoute`
  computes stop ids via new private `getStopIdsForRoute(route_id)`
  (trips.txt filter → stop_times.txt scan).
- **API cleanup**: `renderRoutes(options)` → `renderRoutes()` (the
  `RouteRenderingOptions` interface and `defaultOptions` deleted); the two
  `addStopsLayer` call sites in map-controller.ts drop explicit style values
  (defaults in `LayerManager.defaultStopOptions` cover them — `addStopsLayer`
  takes `Partial<StopLayerOptions>`).

## Verification already done (don't redo)

- `pnpm typecheck` passes clean.
- No remaining references anywhere in `src/` to the deleted `routes-highlight`
  layer, `RouteRenderingOptions`, or `defaultOptions`.
- `renderRoutes()` callers all updated (map-controller.ts:348, :415;
  route-renderer.ts `setRenderMode`).
- `setFeatureState({source:'stops'})` works: the stops source is created with
  `promoteId: 'stop_id'` (layer-manager.ts:140–147). Unknown ids are silent
  no-ops in MapLibre.
- Every map-controller highlight entry point (`highlightRoute` :668,
  `highlightStop` :687, `highlightPathway` :738, `highlightTrip` :751,
  `clearHighlights` :848) pairs `layerManager.clearHighlights()` with
  `routeRenderer.clearHighlight()`. All external callers (search-controller,
  page-content-renderer, browse-navigation, keyboard-shortcuts) route through
  these methods.
- `StopLayerOptions` fields are ALL still consumed (backgroundColor :385,
  strokeColor, strokeWidth, radius, clickAreaRadius) — the interface is not
  dead; dropping explicit values at call sites was correct.
- `getCasingColor` covers everything `getRouteColor` (route-renderer.ts:442)
  can produce: `#rrggbb` (from a valid 6-hex `route_color`) or
  `hsl(h, 70%, 50%)` hash fallback. The warn path is defensive only.
- The `routes-background` id kept its role as the colored line
  (interaction-handler.ts:222 queries it for clicks) — the rename chain
  (`routes-background`→`routes-casing`, `routes-clickarea`→`routes-background`,
  `routes-highlight`→`routes-clickarea` in the addLayer ordering) is not a
  breakage.
- No CLAUDE.md violations: map paint literals were already module-local
  practice pre-diff (CONFIG holds only `STOP_FOCUS_ZOOM` for the map); logging
  uses `[ModuleName]` prefixes correctly.
- Station dot staying full-opacity at low zoom is consistent by design —
  stations (location_type 1) never fade, only plain stops (location_type 0) do.
- Stale `routeStopIds` after a trip-focused basemap re-render is harmless
  (layers rebuilt fresh; reset on next clearHighlights).

## Findings (ranked, 8)

### 1. Half-applied spotlight from non-route entry points  — behavior gap
`src/modules/map-controller.ts:698` (highlightStop) and ~:970 (agency path).
Both call `routeRenderer.highlightRoutes(route_ids)` — which now dims all
non-matching route lines — but neither pairs it with
`layerManager.setRouteStops(...)`. Only `highlightRoute` (:673–674) applies
both halves. Previously `highlightRoutes` was additive (highlight layer on
top); the dimming asymmetry is new behavior.
**Failure**: select a stop or agency → other route lines dim to 0.2, but stops
keep their normal fade and the routes' stops aren't revealed. Inconsistent UX
depending on entry point.
**Fix direction**: a single `spotlight(route_ids)` coordinator (probably on
MapController) that owns both the line dimming and the stop feature-state, so
callers can't apply half. Decide whether stop/agency selection *should* dim
stops too, or whether those paths should skip route dimming entirely.

### 2. Basemap-change restore misses the stop case — behavior gap
`src/modules/map-controller.ts:363–368`. The restore path after a basemap
switch re-applies the spotlight only for `obj.type === 'route'` (and trip
highlight). `applyFocusedObject` (:600) never re-calls `highlightRoutes` for a
focused stop, so stop-focused route dimming silently vanishes after switching
basemaps. (Pre-existing gap for the old highlight overlay too, but the diff
special-cased route restore while leaving stop restore missing.)
**Fix direction**: same as #1 — store "current spotlight" state once and
re-apply it in the restore path regardless of focus type.

### 3. `getStopIdsForRoute` duplicates existing indexed lookups with a full scan
`src/modules/map-controller.ts:645`. Linearly scans ALL of trips.txt and
stop_times.txt on every route selection, synchronously on click.
- `GTFSParser.getRoutesForStop` (gtfs-parser.ts:1052) is the exact inverse and
  uses the in-memory `getStopTimesByStopId` index (gtfs-parser.ts:461);
  MapController already calls it at :695. The route→stops traversal belongs on
  GTFSParser as a sibling `getStopsForRoute`.
- The trips step duplicates `GTFSRelationships.getTripsForRoute`
  (gtfs-relationships.ts:90; async variant :502). That helper coerces with
  `String(trip.route_id ?? '')`; the new raw `t.route_id === route_id`
  comparison can mismatch on edge feeds, spotlighting a different stop set
  than the drawn line. RouteRenderer features also already carry
  `properties.trip_ids` per route.
**Failure**: large feed (10⁶ stop_times rows) → O(n) scan on UI thread per
click; plus potential stop-set mismatch from the missing String coercion.

### 4. Fade/hit-area invariant maintained by hand
`src/modules/layer-manager.ts:297` (`stopFadeOpacity`, zoom stops 10.5/12.5)
vs `:477` area (`addStopsClickAreaLayer`, same 10.5/12.5). The clickarea
comment promises its hit radius "mirrors the visible layer's fade", but only a
comment enforces it.
**Failure**: tune the fade to start at z12 in one place → stops become
invisible yet clickable (or visible but unclickable).
**Fix direction**: shared constants (e.g. `STOP_FADE_ZOOM_MIN/MAX`), ideally
in `CONFIG` per the config convention, used by both expressions.

### 5. Spotlight dim factors split across modules
`src/modules/layer-manager.ts:273` (`SPOTLIGHT_STOP_DIM = 0.15`) vs
`src/modules/route-renderer.ts` (`SPOTLIGHT_ROUTE_DIM = 0.2`, plus the bump
constants). One visual effect, two private consts in two files with two
values.
**Fix direction**: co-locate (CONFIG or a shared spotlight constants module).

### 6. Inline duplicate of the spotlight-dim expression
`src/modules/layer-manager.ts:~740` (in `setRouteStops`): the station-dot
opacity rebuilds `['case', SPECIAL_STOP, 1, dim]` inline — the same logic as
`stopFadeOpacity`'s `fullZoom` branch. Change one and the station center dot
dims out of step with its surrounding circle.

### 7. Single-element `forEach` wrappers
`src/modules/interaction-handler.ts:114` and
`src/modules/layer-manager.ts:535` (`addStopsHoverBehavior`): both iterate
`['stops-clickarea']` — a one-element array. Reads as "multiple layers"; a
future editor may re-add `stops-background`, reintroducing the
hidden-stop hover/click bug this diff fixes. Replace with direct calls. Note
the two sites bind mouseenter/mouseleave on the *same* layer (one sets
cursor from interaction-handler with highlighted-stop logic, one sets plain
`pointer`) — worth a cross-reference comment or consolidation.

### 8. Station-dot layer inlines the focused expression 6×
`src/modules/layer-manager.ts:439–443` (`addStationDotLayer`): repeats
`['boolean', ['feature-state', 'focused'], false]` in all six interpolate
outputs, while sibling `addStopsBackgroundLayer` (:346) extracts a `focused`
const. Extract the same const (or reuse a shared one).

## Lower-confidence observations (not ranked findings)

- Hardcoded colors (`#37474f`, `#e74c3c`, `#111111`, casing fallback
  `#333333`) are tuned for a light basemap and bypass the DaisyUI theme
  system (default theme is dark "night"). Consistent with existing map-module
  practice, but a dark basemap will swallow the near-black casing/strokes.
- The pervasive `as unknown as ExpressionSpecification` casts defeat type
  checking on the expressions most prone to shape errors; MapLibre's types
  genuinely resist array-literal inference, so this may be unavoidable, but a
  small typed builder (like `zoomWidth` already is) would catch some mistakes.
- `zoomWidth` (route-renderer) and `stopRadiusAt`/`stopFadeOpacity`
  (layer-manager) are parallel hand-built zoom-interpolate builders introduced
  in the same diff — candidates for one shared helper if they grow.
- Hex parsing exists in ≥2 places (`getCasingColor`, calendar-modal.ts:135
  `hexToRgba`) with different acceptance rules; no shared color util exists.
- `getCasingColor` is called per trip feature rather than memoized per route
  color — cheap string ops, probably fine.

## Suggested order of work

1. [x] Findings #1 + #2 together (they share a fix: single spotlight owner +
   re-appliable spotlight state). Already resolved on this branch:
   `MapController.applySpotlight` (map-controller.ts:652) is the sole caller
   of `routeRenderer.highlightRoutes`/`layerManager.setRouteStops`, backed by
   `spotlightRouteIds` state; every highlight entry point and the basemap
   restore path route through it unconditionally. No code change needed.
2. [x] Finding #3 (add `getStopsForRoute` to GTFSParser using the stop_times
   index / `getTripsForRoute`, delete the map-controller private).
   `GTFSParser.getStopIdsForRoute` (gtfs-parser.ts:1105) already existed,
   already indexed, already coerced with `String(...)` — it was already the
   sole implementation used by the spotlight path. The actual remaining
   duplication was `MapController.flyToRoute` and `fitToRoutes`, which each
   re-derived a route's stop set via manual unindexed `trips`/`stop_times`
   scans; both now call `gtfsParser.getStopIdsForRoute()` instead.
3. [x] Findings #4–#6 (shared constants + reuse `stopFadeOpacity`). Done in
   `08d3341`: `STOP_FADE_ZOOM_MIN/MAX` and `SPOTLIGHT_STOP_DIM` /
   `SPOTLIGHT_ROUTE_DIM` / `SPOTLIGHT_LINE_BUMP` / `SPOTLIGHT_CASING_BUMP`
   moved to `CONFIG` (used by both layer-manager.ts and route-renderer.ts);
   the inline spotlight-dim expression in `setRouteStops` now reuses a new
   `specialOrDim()` helper shared with `stopFadeOpacity`.
4. [ ] Findings #7–#8 (mechanical cleanups).
