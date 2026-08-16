# Follow-on Plan: On-Demand (GTFS Flex) polish

Follows `CURRENT_PLAN.md`, which landed flex across six phases (spec fixes,
`StopTimeRef` pipeline, inline timetable rendering, zone polygons + geojson.io,
browse pages, On-Demand modal + validation). Everything below is a gap left by
that work, plus a conformance pass against the official demand-responsive
service documentation.

## Summary

Six follow-ups (Phase 6 was added after the first five landed, to close the
multi-trip gap that Phases 3 and 5 both recorded and neither fixed). Zones and
location groups are rendered and browsable but they
are not yet *first-class objects in the interaction model*: the route diagram
will not open them, hovering them lights nothing on the map, fitting the
viewport ignores their geometry entirely, and there is no way to create an
on-demand stop_time from the timetable at all (Phase 3 of the previous plan
explicitly deferred that: "creating an on-demand stop_time is Phase 6's job,
not the grid's", and Phase 6 did not do it either). The zone geometry editor is
also write-only — a one-line paste box, with no way to read or hand-edit the
GeoJSON that is actually stored.

**Chosen approach and tradeoffs:**

- **Parity, not new mechanisms.** Every item is an extension of a path that
  already exists for stops: `ROUTE_DIAGRAM_ROW` clicks, `installStopRowHover`,
  `setHoveredStop` feature-state, `pendingStop`, `fitToRoutes`. Nothing here
  needs a new subsystem.
- **One combined picker for stop/zone/group**, not a kind chooser first.
  `showOptionPickerModal` is a flat searchable list with a `secondary` line, so
  the three kinds coexist in one list with the kind as the secondary text and a
  `kind:id` value. That is exactly `StopTimeRef`'s wire form, so the picked
  value drops straight into the pending-row state.
- **Viewport fitting gets one shared geometry collector.** `fitMapToData`,
  `flyToRoute`, `fitToRoutes` and `fitMapToTrip` each build a
  `LngLatBounds` from stops by hand today, four near-identical loops. They
  collapse into one `boundsFor(...)` helper that takes stop ids, zone ids and
  route ids and extends over stop coords, zone bboxes, location-group member
  stops and shape coordinates. Per the user's decision, route fitting includes
  `shapes.txt` geometry.
- **The zone page edits one feature.** The textarea holds this zone's feature
  only, and Apply merges (`mergeZoneFeatures(..., removeMissing=false)`), so a
  round trip can never delete other zones. URL import is the same merge with a
  fetch in front of it. Whole-collection editing stays out of scope.

## Relevant context

### Interaction / navigation

- `src/modules/route-diagram.ts:39` `ROUTE_DIAGRAM_ROW`, `:103-116` the row.
  Flex rows already render a label (`:89-97`) but deliberately omit
  `data-stop-id`.
- `src/modules/page-content-renderer.ts:1068-1076` — the diagram row click
  handler, which reads `data-stop-id` and calls `dependencies.onStopClick`.
  `ContentRendererDependencies` (`:157-158`) has `onStopClick` and
  `onPathwayClick` and deliberately has no zone/location-group callbacks (see
  the Phase 5 findings in `CURRENT_PLAN.md`).
- `src/modules/navigation-actions.ts:104,116` — `navigateToZone`,
  `navigateToLocationGroup`, module-level functions, already imported directly
  by `schedule-controller.ts`.
- `src/modules/schedule-controller.ts:290-305` — the `.flex-label-span`
  delegated click that already routes a timetable flex label to those two.
  `:451-477` `installStopRowHover` is delegated to `document` on
  `.strip-stop-row` + `data-stop-id`, so it covers the route diagram rows too
  (they carry `STRIP_ROW_CLASS = 'strip-stop-row group/strip'`,
  `route-strip.ts:29`).
- `src/index.ts:161-164` — `setStopHighlightHandlers` wires hover to
  `mapController.hoverStop`.

### Map

- `src/modules/layer-manager.ts:262-300` `updateZonesLayer` (source `zones`,
  `promoteId: 'location_id'`), `:305-360` `addZoneLayers` (fill + outline,
  `feature-state.focused` drives opacity/width), `:365-395` `setFocusedZone`,
  `:1115-1139` `setHoveredStop` (the template for a `hovered` feature state).
- `src/modules/map-controller.ts` — `fitMapToData` (`:469-499`, stops only,
  returns early when the feed has no stops), `flyToRoute` (`:1035-1073`),
  `fitToRoutes` (`:1074-1112`), `fitMapToTrip` (`:947-991`), `fitToStops`
  (`:871-901`), `fitToZone` (`:903-921`), `hoverStop` (`:764-766`),
  `highlightZone` (`:825-836`), `highlightLocationGroup` (`:842-860`),
  `stopIdsForLocationGroup` (`:863-869`), `applySpotlight` (`:715-732`).
- `src/modules/gtfs-parser.ts:1400-1413` `getStopIdsForRoute` — pushes
  `st.stop_id` unconditionally, so a flex stop_time contributes `undefined` to
  the returned array. Every caller (`applySpotlight`, `flyToRoute`,
  `fitToRoutes`) then carries that `undefined` through.
- `src/modules/route-renderer.ts:593` `getRouteFeatures()` returns the
  deduplicated route line features, each carrying `route_id` — the source of
  shape geometry for fitting, already built and cached.
- `src/modules/zone-store.ts` — `getZoneFeatures`, `getZoneFeature`,
  `zoneBounds`, `zoneName`, `mergeZoneFeatures(current, incoming, removeMissing)`,
  `writeZoneFeatures(parser, recorder, features)`.

### Timetable editing

- `src/modules/schedule-controller.ts:806-817` `openAddStopPicker`,
  `:1658-1697` `addStopFromSelector` (sets `pendingStop`, refreshes),
  `:1534-1548` the `pendingStop` field and `clearPendingStop`,
  `:1455-1470` where the pending stop is appended to `data.stops`,
  `:1135+` `updateFlexWindow` (addresses a row by trip_id + stop_sequence,
  `patchUpdate` only, never inserts), `WINDOW_FIELDS`.
- `src/modules/timetable-renderer.ts:695-707` the "Add stop..." row,
  `:465-520` `renderStopLabelCell` (pending rows have no sequence entry and get
  `renderPlainStopLabel`), `renderFlexNameBlock`.
- `src/modules/timetable-database.ts:60-143` `planStopTimeEdit` with
  `forceInsert`, `:152-172` `reorderByTime` — untimed rows keep their slot, so
  an appended flex row stays at the end.
- `src/modules/timetable-cell-renderer.ts` — window branch, `data-time-type`
  of `window-start` / `window-end`, `flex-window` class, `.time-span` reuse.
- `src/utils/flex-rules.ts` — `validateFlexStopTimeRow`,
  `validateBookingRuleRow`, `validateLocationGroupId`.

### Zone geometry

- `src/modules/zone-geometry-editor.ts` (158 lines) — summary `<dl>`, the
  geojson.io anchor, the 3-row paste box, `attachZoneGeometryHandlers`.
- `src/utils/geojson-io.ts:66` `encodeGeojsonIoUrl`, `:92` `parseGeojsonIoInput`
  (accepts a geojson.io URL *or* raw GeoJSON text).
- `src/modules/feed-selection.ts:16,89-105` — `CORS_PROXY` and
  `withCorsProxy(url, useCors)`, the existing pattern for fetching a
  user-supplied URL.
- `src/modules/zone-view-controller.ts:128-150` `addEventListeners`.

### Spec semantics this plan newly depends on

From the official demand-responsive documentation (the four worked examples):

- **Single zone**: two stop_times on one trip with the *same* `location_id`,
  `(pickup_type=2, drop_off_type=1)` then `(pickup_type=1, drop_off_type=2)`.
  This is the canonical shape and the one most likely to be broken by
  deduplication.
- **Multiple zones**: two rows, different `location_id`, same type pattern.
- **Location group**: identical to the single-zone shape with
  `location_group_id` in place of `location_id`.
- **Deviated route**: one trip interleaving timed `stop_id` rows and windowed
  `location_id` rows, with `(pickup_type=1, drop_off_type=3)` on the deviation
  zones and `shape_dist_traveled` on the fixed stops.
- Under a window, `pickup_type` ∈ {1,2} and `drop_off_type` ∈ {1,2,3}; 0 is
  forbidden for both, and 3 is additionally forbidden for `pickup_type`.

---

## Phase 1: Zones and location groups are clickable and hoverable everywhere

The route diagram is the one place a flex row is inert: `route-diagram.ts`
renders the label but the row carries no id, so both the click handler and the
document-level hover handler skip it. This phase gives flex rows the same two
affordances stops have, in the diagram and in the timetable, and gives the map
a hover state for a zone. Sequenced first because it is self-contained and the
data attributes it introduces are reused by Phase 3's pending row.

- [x] In `src/modules/route-diagram.ts:103-116`, emit
      `data-flex-kind="${ref.kind}" data-flex-id="${ref.id}"` on the row for a
      non-stop ref, alongside the existing `data-stop-id` branch. Keep exactly
      one of the two attribute sets on any row.
- [x] Add a kind badge to the flex label in `renderRow` (`:91-97`) matching the
      one `timetable-renderer.renderFlexNameBlock` uses, so the diagram and the
      timetable name a zone the same way.
- [x] In `src/modules/page-content-renderer.ts:1068-1076`, extend the
      `ROUTE_DIAGRAM_ROW` handler: if `data-stop-id` is absent, read
      `data-flex-kind`/`data-flex-id` and call `navigateToZone` /
      `navigateToLocationGroup` imported from `navigation-actions.js`
      **directly**, not through `ContentRendererDependencies`. The Phase 5
      finding in `CURRENT_PLAN.md` rejected adding those callbacks because
      nothing in the renderer used them; a direct import keeps that decision
      intact and matches how `schedule-controller` already navigates.
- [x] Add `setHoveredZone(location_id: string | null)` to
      `src/modules/layer-manager.ts`, copied from `setHoveredStop` (`:1115`)
      but against `ZONE_SOURCE`, with a `hoveredZoneId` field initialized to
      null next to `focusedZoneId`, and reset to null in `updateZonesLayer`
      when the source is re-added (the same `setStyle` reasoning as `:293-296`).
- [x] Extend the `zones-fill` and `zones-outline` paint expressions
      (`:320-360`) to a three-way `case`: focused wins, then hovered, then the
      base value. Do not collapse hover into the focused state — hovering must
      not disturb the selection, same as stops.
- [x] Add `hoverZone(location_id: string | null)` to
      `src/modules/map-controller.ts` next to `hoverStop` (`:764`): purely
      visual, no fly-to, no focus change, delegating to `setHoveredZone`.
- [x] Add `hoverLocationGroup(location_group_id: string | null)`: resolve the
      member stops through the existing `stopIdsForLocationGroup` (`:863`) and
      call a new `layerManager.setHoveredStops(stop_ids)`. Generalize
      `setHoveredStop` into a set-based `setHoveredStops` and keep
      `setHoveredStop` as a one-element wrapper so the existing call sites and
      the `hoveredStopId` early-return stay honest (compare sets, not scalars).
- [x] In `src/modules/schedule-controller.ts:451-477`, widen
      `installStopRowHover` to read `data-flex-kind`/`data-flex-id` when
      `data-stop-id` is absent, tracking the hovered ref as a
      `StopTimeRef | null` instead of `hoveredStopId: string | null`. Preserve
      the same-row guard and the `relatedTarget` check verbatim — they are what
      stop the highlight flickering.
- [x] Extend `setStopHighlightHandlers` (`:484-490`) with an `onRefHover`
      callback, and wire it in `src/index.ts:161-164` to dispatch to
      `hoverStop` / `hoverZone` / `hoverLocationGroup` by kind.
- [x] Give the timetable flex row header (`timetable-renderer.ts`, the `<th>` at
      `:678-684`) the same `data-flex-kind`/`data-flex-id` pair, so the hover
      works from the timetable as well as the diagram.

**Findings:** `setStopHighlightHandlers` ended up with `onRefHover` *replacing*
`onStopHover` rather than sitting beside it: the pointerout path only knows the
ref it is clearing, so keeping a second stop-only callback would have meant
index.ts dispatching stop hover from two places. `index.ts` clears all three
kinds on a null ref for the same reason. The zone kind on the wire is
`'location'`, not `'zone'` (`StopTimeRefKind` in `src/types/gtfs-flex.ts`), so
that is the value both the diagram and the timetable emit in `data-flex-kind`.
`clearHighlights` now also clears the hovered zone, matching what it already did
for the hovered stop.

**Gotchas:** `installStopRowHover` is bound to `document`, once, and fires for
*any* `.strip-stop-row` on the page — the route diagram and the timetable share
it. Both must agree on the attribute names or one of them silently stops
hovering. A location group hover lights several stops at once; make sure
clearing it clears all of them, or a stop stays lit after the pointer leaves.

---

## Phase 2: Fit the viewport to everything an object actually covers

Fitting is stop-coordinate-only today, in four separate hand-rolled loops. A
flex feed can legally contain zero rows in `stops.txt` (the Heartland Express
example is exactly that), in which case `fitMapToData` returns early and the
map never moves off its default view. A route whose trips only reference zones
has no stops either, so selecting it fits nothing. This phase introduces one
collector and points all four call sites at it.

- [x] Add a private `boundsFor(input: { stop_ids?, zone_ids?, location_group_ids?,
      route_ids?, include_shapes?: boolean }): LngLatBounds | null` to
      `src/modules/map-controller.ts`. It extends over: each stop's
      `[lon, lat]` filtered through the existing `hasValidCoords`; each zone's
      `zoneBounds(feature)` corners (both `Polygon` and `MultiPolygon` are
      already handled there); each location group's member stops via
      `stopIdsForLocationGroup`; and, when `include_shapes`, every coordinate of
      the matching features from `routeRenderer.getRouteFeatures()` filtered by
      `route_id`. Returns null when nothing contributed a coordinate.
- [x] Add a private `refsForRoute(route_id)` returning
      `{ stop_ids, zone_ids, location_group_ids }`, built by walking the route's
      trips (`getTripsByRouteId`) and their stop_times
      (`getStopTimesByTripId`) through `stopTimeRef()`. This is the flex-aware
      counterpart to `getStopIdsForRoute`.
- [x] Fix `src/modules/gtfs-parser.ts:1400-1413` `getStopIdsForRoute` to skip
      stop_times with no `stop_id` rather than adding `undefined` to the set.
      This is a live bug independent of the rest of the phase: the `undefined`
      currently flows into `applySpotlight` -> `withAncestors` ->
      `setRouteStops`.
- [x] Rewrite `fitMapToData` (`:469`) to use `boundsFor({ stop_ids: all,
      zone_ids: all })` so a whole-feed fit covers every zone, and so a feed
      with no stops still fits. Keep the existing 50px + `bottomPadding`
      padding.
- [x] Rewrite `flyToRoute` (`:1035`) and `fitToRoutes` (`:1074`) on top of
      `refsForRoute` + `boundsFor({ ..., route_ids, include_shapes: true })`.
      Keep their differing padding/duration — `flyToRoute` animates at 2000ms,
      `fitToRoutes` does not.
- [x] Rewrite `fitMapToTrip` (`:947`) to collect that one trip's refs through
      `stopTimeRef()` and fit over stops + zones + group members. A trip's shape
      is a single `shape_id`; include it only if it is cheap to resolve from the
      already-built route features, otherwise leave shapes out of the trip fit
      and say so in a comment.
- [x] Extend `applySpotlight` (`:715`) to reveal the zones a route touches:
      pass the route's `zone_ids` to a new
      `layerManager.setRouteZones(location_ids)` that dims non-matching zone
      polygons the way `setRouteStops` dims stops, and clears on `null`. Follow
      the existing rule in that method's doc comment — it is the sole owner of
      the spotlight, so the zone half goes here, not in the callers.
- [x] Verify `highlightZone` (`:825`) and `highlightLocationGroup` (`:842`)
      still fit correctly once `fitToStops`/`fitToZone` are expressed through
      `boundsFor`, keeping their `maxZoom: CONFIG.STOP_FOCUS_ZOOM` clamp. A
      county-sized zone must not be clamped to stop-level zoom — check whether
      `maxZoom` should be dropped for zone fits, since it only exists to stop a
      single-point fit zooming to the street.

**Findings:** `refsForRoute` needs no cache. `applySpotlight` already called
`getStopIdsForRoute`, which walks exactly the same indexed data
(`getTripsByRouteId` + `getStopTimesByTripId`), so `refsForRoute` *replaces*
that call at equal cost rather than adding a second walk;
`getStopIdsForRoute` itself stays for its other callers, with the `undefined`
bug fixed. `fitMapToTrip` leaves shapes out and says so in a comment: route
features are keyed by `route_id`, not `shape_id`, so resolving one trip's own
shape would be a second lookup for geometry its stops and zones already cover.
The zone half of the spotlight mirrors `setRouteStops` exactly: an `onRoute`
feature-state plus a paint-property swap, with the fill/outline opacity
expressions factored into `zoneFillOpacity(dimmed)` / `zoneOutlineOpacity(dimmed)`
so `addZoneLayers` and `setRouteZones` cannot drift apart;
`routeZoneIds` resets in `updateZonesLayer` when the source is re-added, and
`clearHighlights` clears it. `maxZoom: CONFIG.STOP_FOCUS_ZOOM` stays on the zone
and stop fits: it clamps zoom-*in* only, so a county-sized zone never reaches
it, and it still protects a degenerate zero-area polygon.

**Gotchas:** `getStopIdsForRoute` is on the hot path (it is called per route in
`applySpotlight`) and is indexed for that reason — `refsForRoute` walks the
same data, so cache it per route id or accept the cost only on fit, never on
render. `zoneBounds` returns `[west, south, east, north]`; extending a
`LngLatBounds` needs both corners, not the raw array. Feeds crossing the
antimeridian are already broken for stops and this phase does not fix that.

---

## Phase 3: "Add stop" becomes "Add stop or zone"

There is currently no way to create an on-demand stop_time anywhere in the app:
`updateFlexWindow` only ever updates, the On-Demand modal edits booking rules,
location groups and zone metadata but not `stop_times`, and the grid's add-stop
row is stop-only. This is the largest gap left by `CURRENT_PLAN.md` and it is
what makes the four documented examples unbuildable from scratch. Sequenced
after Phase 1 because it reuses the flex row data attributes.

- [x] Generalize the pending-row state in
      `src/modules/schedule-controller.ts:1534-1548` from
      `pendingStop?: { stop_id, stop_name }` to
      `pendingRow?: { ref: StopTimeRef; name: string }`. Update
      `clearPendingStop` (`:1541`) to compare refs, and the reset in `:982`.
- [x] Replace `getStopOptions()`'s use in `openAddStopPicker` (`:806`) with a
      combined option list: every stop (as today), then every zone from
      `getZoneFeatures`, then every location group from
      `GTFS_TABLES.LOCATION_GROUPS`. Encode the value as `` `${kind}:${id}` ``
      and put the kind in `secondary` ("On-demand zone", "Location group").
      Leave `openStopPicker` (the row-label swap, `:782`) stop-only — repointing
      a timed row at a zone is not a stop swap, which is the reasoning already
      recorded at `:290-292`.
- [x] Retitle the button (`timetable-renderer.ts:702`) to "Add stop or zone..."
      and the picker to "Add stop or zone".
- [x] Rewrite `addStopFromSelector` (`:1658`) as `addRefFromSelector(value)`:
      parse the `kind:id` value, resolve a display name per kind (stop name,
      `zoneName(feature)`, `location_group_name`), set `pendingRow`, refresh.
      Keep the "enter a time to save" notification, wording it as "enter a
      pickup window" for the two flex kinds.
- [x] In `timetable-renderer.ts:1455-1470` (the pending append) and
      `renderStopLabelCell` (`:465`), render a pending flex row with the flex
      name block and kind badge rather than `renderPlainStopLabel`.
- [x] In `timetable-cell-renderer.ts`, make a pending flex row's cells render
      the two window spans (`data-time-type="window-start"|"window-end"`,
      `flex-window`, `data-pending="true"`) rather than arrival/departure spans,
      so the first typed value lands in the right field.
- [x] Add an insert path for flex rows. `updateFlexWindow` (`:1135`) currently
      returns early when no row matches; when the edit comes from the pending
      row it must instead build a new stop_time and record an **insert** patch.
      Do not extend `planStopTimeEdit` for this: it locates rows by
      `stop_id` and renumbers by time, neither of which applies. Add a sibling
      `planFlexStopTimeInsert(trip_id, ref, field, value)` in
      `timetable-database.ts` that appends the row and renumbers
      `stop_sequence` from 0 over the trip's existing order (`reorderByTime`
      leaves untimed rows in place, so an appended flex row stays last).
- [x] Defaults for a newly created flex stop_time: the ref field
      (`location_id` or `location_group_id`), the edited window field, and
      `pickup_type=2` / `drop_off_type=2` — both booking directions allowed,
      which is valid under the window rules (0 forbidden for both, 3 forbidden
      for pickup) and is the least surprising default. `arrival_time` and
      `departure_time` stay empty, and both booking rule ids stay empty. Run
      the row through `validateFlexStopTimeRow` from `src/utils/flex-rules.ts`
      before writing, and surface a failure through `showTimeError` rather than
      writing an invalid row.
- [x] A pending row for `kind === 'stop'` must keep going through the existing
      `planStopTimeEdit(..., forceInsert)` path unchanged. Do not unify the two.
- [x] Clear the pending row after the first successful write, on the same path
      that `:1101` already uses (before the patch is recorded, for the reason
      the comment there gives).
- [x] Confirm the two-rows-on-the-same-zone case: adding the same zone twice
      must produce occurrence 0 and 1, two distinct rows, not one. The
      occurrence counter in `route-sequence.ts` keys on `kind:id`, so this
      should hold — verify it against a real add rather than assuming.

**Findings:** the pending row is now `pendingRow: { ref, name }` and the whole
renderer chain takes a `pendingRef?: StopTimeRef` in place of `pendingStopId`.
`planFlexStopTimeInsert` does **not** take the edited window field: a window is
only valid with both ends set (`validateFlexStopTimeRow` rejects one end alone),
so the first edit seeds *both* ends with the typed value, creating a zero-length
window the second edit widens. Without that the insert could never pass its own
validation. `FlexWindowField` moved from `schedule-controller.ts` to
`timetable-database.ts`, which now needs it too. The occurrence counter was
verified by reading `route-sequence.ts:109,164` - it keys on `kind:id`, so the
same zone twice on one trip is occurrence 0 and 1; not yet exercised against a
real add.

**Discovered gap (not in this phase's scope):** once the pending row is saved to
its first trip, the *other* trips' cells in that row fall back to
arrival/departure spans, because `editableStopTimes` has no entry at that
position for them and only a saved stop_time carries `isFlex`. So a zone can be
added to one trip from the grid, not to the rest. Fixing it means rendering a
window cell for every trip in a flex *row* and keying the insert off the row's
ref rather than off `pendingRow`.

**Gotchas:** `refreshCurrentTimetable` rebuilds the sequence from the database,
and a pending row exists only in this controller, so anything that reads
`sequence.stops[index]` must keep the `index >= sequence.stops.length` guard at
`timetable-renderer.ts:470`. `validateFlexStopTimeRow` is also called mid-edit
from the modal with partial rows — the insert path passes a fully-populated row,
so it is the strict caller. Every write here is a user edit and needs a
`patchManager.record*()` call per the standing rule.

---

## Phase 4: A real GeoJSON editor on the zone page

The zone page shows a 3-row paste box and nothing else: the geometry that is
actually stored is invisible, and the only way to change it is a round trip
through geojson.io. This phase makes the stored GeoJSON the primary editing
surface, with geojson.io and a URL import as the two side doors. Per the
decision above, the textarea holds **this zone's feature only** and every write
merges, so other zones are never touched.

- [x] In `src/modules/zone-geometry-editor.ts`, replace the paste box with a
      tall scrollable `<textarea>` (`rows="14"`, `font-mono text-xs`,
      `resize-y`) pre-filled with
      `JSON.stringify(feature, null, 2)` for this zone. Treat it like the app's
      other inputs: `textarea textarea-bordered w-full`, an inline error line
      under it, and a disabled Save until the content differs from what was
      loaded.
- [x] Keep the summary `<dl>` (type / vertices / bounds) above the textarea —
      it is the fast read that the raw JSON is not.
- [x] Save parses the textarea with `JSON.parse`, accepts either a bare Feature
      or a single-feature FeatureCollection, forces `id` back to the zone's
      `location_id`, and writes through
      `mergeZoneFeatures(current, [edited], false)` + `writeZoneFeatures`,
      exactly as the current Apply button does. Report a parse failure inline
      with the character offset from the `SyntaxError`, and do not clear the
      textarea on failure.
- [x] Keep the "Edit in geojson.io" anchor (`encodeGeojsonIoUrl` on a
      single-feature collection, `target="_blank" rel="noopener"`).
- [x] Add an "Import from URL" button next to it that prompts for a URL, fetches
      it through `withCorsProxy(url, useCors)` from
      `src/modules/feed-selection.ts`, parses the body with
      `parseGeojsonIoInput` (it already accepts raw GeoJSON *and* a geojson.io
      URL, so pasting either into the prompt works), and loads the resulting
      feature **into the textarea** rather than writing straight to the store.
      The user then reviews and presses Save. Fetch failures surface through the
      same inline error line, using the CORS-hint wording
      `feed-selection.ts:33` already produces.
- [x] When the fetched collection has several features, pick the one whose `id`
      matches `location_id`; if none matches and there is exactly one feature,
      take it (the existing "geojson.io drops the feature id" reasoning at
      `zone-geometry-editor.ts:122-131`); otherwise error with the list of ids
      found.
- [x] Rework `attachZoneGeometryHandlers` for the new controls, keeping its
      shape (`container` + deps, called from
      `zone-view-controller.addEventListeners`). It must stay idempotent per
      render — the page re-renders wholesale via `onGeometryChanged`.
- [x] After a successful save, `onGeometryChanged` already re-renders the page;
      confirm the map layer refreshes too (`updateZonesLayer`) and that the
      focused/hovered feature state from Phase 1 survives the source
      `setData`.

**Findings:** the "prompt for a URL" step is a `showModal` from
`modal-utils.ts` with a URL input and a "Use CORS proxy" checkbox, not a native
`prompt()`: the proxy is a per-source choice everywhere else in the app and a
bare prompt has nowhere to put it. The helper in `feed-selection.ts` is
`maybeProxy(url, useCors)`, not `withCorsProxy` as the plan named it, and its
error wording comes from `describeNetworkError` / `describeHttpError`. Save is
gated on `textarea.value !== textarea.defaultValue`, which needs no extra state:
`defaultValue` is the JSON that was rendered into the element, and a URL import
sets `value` so the button enables itself. The map layer did **not** refresh
after a geometry save: `onGeometryChanged` only reached
`browse-navigation.render()`. Fixed by adding `MapController.refreshZones()`
(a `layerManager.updateZonesLayer()` wrapper) and calling it from the
`onGeometryChanged` wiring in `page-content-renderer.ts`, which required
threading `refreshZones` through the two `mapController` structural types in
`browse-navigation.ts`. `updateZonesLayer` uses `source.setData` on the existing
source, so the Phase 1 focused/hovered feature state survives the refresh -
only a `setStyle` (which re-adds the source) resets it, and that path already
nulls the ids.

**Gotchas:** `locations.geojson` is stored as one IDB row holding the whole
FeatureCollection, and it has no virtual table — writes reach memory only via
`syncGeoJSONMemory` in `patch-manager.ts` (see the Phase 4 findings in
`CURRENT_PLAN.md`). Undo of a geometry save must be checked by eye, it is the
least-exercised write path in the app. Do not add a whole-collection editor
here; bulk editing was explicitly scoped out.

---

## Phase 5: Conformance pass against the demand-responsive documentation

The previous plan encoded the spec's field rules; this phase checks the app
against the four *worked examples* in the official demand-responsive service
documentation end to end — load, render, edit, export. It is last because it
needs Phase 3's create path to be able to build the examples at all.

- [x] Build a fixture for each of the four documented shapes (they can be
      hand-written minimal feeds; the datasets themselves need not be
      downloaded):
      1. **Single zone** — one trip, two stop_times, same `location_id`,
         `(2,1)` then `(1,2)`, windows equal.
      2. **Multiple zones** — one trip, two stop_times, `area_713` `(2,1)` then
         `area_714` `(1,2)`.
      3. **Location group** — as (1) with `location_group_id`, plus
         `location_groups.txt` and `location_group_stops.txt`.
      4. **Deviated route** — one trip interleaving timed `stop_id` rows with
         windowed `location_id` rows at `(1,3)`, with `shape_dist_traveled` on
         the fixed rows.
- [x] Verify for each: the route page renders without throwing, the diagram and
      the timetable show one row per stop_time (crucially **two** rows for the
      same-zone cases, not one), the window renders in the two time spans, and
      the feed validator reports no false positives.
- [x] Verify the deviated-route fixture specifically keeps its interleaved
      order: timed and windowed rows share one `stop_sequence` run, so any
      re-sort that moves untimed rows would scramble it.
- [x] Verify export round-trips each fixture byte-for-byte on the flex columns,
      including empty `arrival_time`/`departure_time` on flex rows and empty
      window columns on timed rows.
- [x] Make `pickup_type` and `drop_off_type` editable per flex row from the
      timetable (a small enum menu on the flex cell, reusing
      `openTripPropEnumMenu`'s pattern), restricted to the values the window
      rules allow: pickup {1,2}, drop-off {1,2,3}. Without this the documented
      `(2,1)` / `(1,2)` pattern cannot be produced from the UI, only from the
      raw editor.
- [x] Make `pickup_booking_rule_id` / `drop_off_booking_rule_id` assignable from
      the flex row. The badges are navigation-only today
      (`schedule-controller.ts:317-327`); add an assign action (a picker over
      `booking_rules.txt`) that keeps the existing click-to-open behaviour for
      an already-set rule.
- [x] Check `booking_type=0` (real-time booking) renders sensibly in the
      On-Demand modal — the documentation's examples only cover types 1 and 2,
      so type 0's field matrix is the least exercised.
- [x] Cross-check the documentation's phrasing against the presence conditions
      corrected in Phase 1 of `CURRENT_PLAN.md`, and re-run `pnpm check-spec`.

**Findings:** the fixtures live in `fixtures/flex/<name>/` as loose `.txt` +
`locations.geojson` sources, with `fixtures/flex/build.sh` zipping each into
`fixtures/flex/dist/` (gitignored) because the Load dialog only accepts `.zip`.
`single-zone` and `multiple-zones` ship a header-only `stops.txt`, which is what
turned up the one real conformance bug in this phase: the validator treated
`stops.txt` as unconditionally required and fired **two** errors
(`MISSING_REQUIRED_FILE` and `EMPTY_FILE`) on a legal zone-only feed. The
reference makes it Conditionally Required - optional when locations.geojson
defines demand-responsive zones - so both sites now go through
`hasDemandResponsiveZones()`.

The three "verify" items were checked by reading the code, not by driving the
browser (per the project's testing convention); the fixtures exist so the user
can confirm by eye. What the reading established: `tripStops`
(`route-sequence.ts:130-168`) only collapses consecutive refs when both are
`kind === 'stop'`, so two stop_times on one zone stay two elements - the
same-zone cases render two rows. `validateFlexStopTimeRow` returns null early
for a timed row with no window, so the deviated-route fixture's fixed stops draw
no conditional-presence error. Export builds each file's header as the union of
the stored rows' keys and the rows are stored under natural keys with no
synthetic fields added, so empty flex columns on timed rows and empty
`arrival_time`/`departure_time` on flex rows survive a round trip.

`booking_type=0` needed no change: the spec's enum labels it "Real time", the
Booking Rules pane's note already spells out the three types' field matrices,
and `validateBookingRuleRow` forbids `prior_notice_duration_min`,
`prior_notice_last_day`, `prior_notice_start_day` and `prior_notice_service_id`
for it. `location-group` is the fixture that carries a type 0 rule.

The two editing items landed on the flex cell rather than the row label, because
both fields are per stop_time and so vary trip by trip: two `.flex-type-badge`
buttons (`PU 2` / `DO 1`) opening an `openInlineMenu` filtered to the allowed
values, and a `.booking-rule-assign` badge next to each rule badge opening a
searchable picker over `booking_rules.txt`. The existing `.booking-rule-badge`
click-to-open is untouched. Both write through one new
`updateFlexStopTimeField`, which addresses the row by trip_id + stop_sequence
like `updateFlexWindow` does and runs the whole row through
`validateFlexStopTimeRow` with the change applied before recording the patch.
The badges are suppressed on the pending row: there is no stop_time to address
until the first window is typed.

**Not done:** the Phase 3 "discovered gap" still stands - a flex row added to
one trip cannot be filled in for the *other* trips from the grid, because those
cells fall back to arrival/departure spans. It is unchanged by this phase and
still wants its own follow-up.

**Gotchas:** the documentation's own `stop_times` example for the RufBus service
contains a typo (`flächenrufbus-angermünde_weekdays` with a hyphen in some rows,
underscore in others). Do not encode either spelling as a rule — it is a
dangling foreign key, which `validateForeignKeys` should already report, and
that is the correct behaviour under the standing "surface, don't fix" rule.

---

## Phase 6: A flex row is editable on every trip, not just the one that made it

The gap Phase 3 discovered and Phase 5 left standing. Timetable rows are the
route's supersequence keyed `kind:id occurrence` (`route-sequence.ts:107`);
columns are trips. A zone row therefore spans every trip on the route, but only
the trips that already have a `stop_times` record there are editable. Heartland
Express is the canonical case: four trips, two zones, each zone appearing twice
per trip (the pickup record then the drop-off record), and no trip serves more
than one zone.

```
row                       | A t_..944   | B t_..945   | C t_..946   | D t_..947
                          | New Ulm AM  | County day  | New Ulm PM  | Sunday
--------------------------+-------------+-------------+-------------+------------
area_715 #0  (PU 2, DO 1) | 06:15-08:00 |    dead     | 17:00-17:45 | 08:00-12:00
area_715 #1  (PU 1, DO 2) | 06:15-08:00 |    dead     | 17:00-17:45 | 08:00-12:45
area_708 #0  (PU 2, DO 1) |    dead     | 08:00-17:00 |    dead     |    dead
area_708 #1  (PU 1, DO 2) |    dead     | 08:00-17:00 |    dead     |    dead
```

Ten of the sixteen cells are dead, and worse than inert:

1. **They render a lie.** `timetable-cell-renderer.ts:45` selects the window
   cell on `editableStopTime?.isFlex`, which comes from a *saved* stop_time
   (`timetable-data-processor.ts:369`). With no saved row the cell falls to the
   arrival/departure branch, so a zone row shows two `--:--:--` arrival and
   departure spans. Under a window the spec forbids both fields.
2. **Typing in one corrupts the trip.** The span carries
   `data-stop-id="area_715"` — a flex row's synthetic stop takes the ref id as
   its `stop_id` (`timetable-data-processor.ts:250`) — and an empty
   `data-stop-sequence`. `updateArrivalDepartureTime` -> `planStopTimeEdit`
   falls through to the `st.stop_id === stop_id` lookup, matches nothing, takes
   `isInsert`, and writes `{trip_id: B, stop_id: "area_715", arrival_time: ...}`,
   renumbering the whole trip. That is a dangling `stops.txt` foreign key on a
   zone id.
3. **There is no other way in.** `insertFlexStopTime` (`:1498`) keys entirely
   off `this.pendingRow`, which the picker sets once and
   `clearPendingRowIfMatches` deletes on the first successful write. Heartland's
   four trips cannot be built from the grid: you get one, then finish in the raw
   editor.

**Governing principle for this phase — the grid is a see-through layer over
`stop_times.txt`.** A cell shows the record that exists or shows nothing; an
empty cell means *no record*, never a record with blank fields. Typing creates
exactly one record and clearing removes exactly one record, both visible in the
Changes panel as a single patch. Nothing here writes a row the user did not
type: the pair-completion prompt was rejected for that reason, and the sibling
copy below is a *default for fields the user would otherwise have to retype*,
announced when it happens, never an inference the user cannot see.

**Chosen approach and decisions:**

- **Cells route on the row's ref, not on the saved stop_time.** The row ref is
  already computed in `renderTimetableBody` (`:693-702`) for the hover
  attributes; it just never reaches the cell renderer. Passing it down removes
  the arrival/departure fallback for flex rows entirely, which is what makes
  the bad write in (2) unreachable rather than merely guarded.
- **An unserved flex cell renders as empty window spans**, the same shape a
  skipped stop already has, with no type or booking-rule badges (there is no
  record to address them to). Grid navigation and the roving tabindex stay
  uniform.
- **New records inherit the row's shape from a sibling trip.** `pickup_type`,
  `drop_off_type` and both booking rule ids are copied from any existing
  stop_time on the same ref+occurrence row, falling back to `2`/`2` and empty
  rules when the row is empty everywhere. The window is **never** copied — a
  differing window per trip is the entire reason Heartland has four trips.
  Copying within one row into a different trip cannot create a zone-overlap
  violation, since that constraint is scoped to a single `trip_id`.
- **The new record lands where the supersequence says**, not appended.
  `sequence.positionOf(trip_id, i)` already maps each of a trip's stop_times
  indices to a strip position, so the insert point is the first of the trip's
  rows whose position exceeds the edited row's. Appending would scramble the
  deviated-route shape, where a deviation zone must sit between its two timed
  stops.
- **Clearing either window end deletes that trip's record.** A flex stop_time
  with no window fails `validateFlexStopTimeRow`, so "clear" can only mean
  "this trip does not serve this zone".

### Relevant context

- `src/modules/timetable-cell-renderer.ts:35` `renderStackedArrivalDepartureCell`
  (the `editableStopTime?.isFlex || isPendingFlex` branch at `:45`), `:111`
  `renderFlexWindowCell` (already handles a null `editableStopTime` for the
  pending row, and suppresses badges on it at `:189`).
- `src/modules/timetable-renderer.ts:646-717` the row map: `isPendingStop` /
  `isPendingFlex` at `:648-654`, the per-trip cell call at `:658-685`, and
  `rowRef` at `:693-702` — the value this phase needs to thread into the cell.
- `src/modules/timetable-data-processor.ts:330-395` — where `editableStopTimes`
  is keyed by supersequence position and `isFlex` is set (`:369`).
- `src/modules/route-sequence.ts:94` `positionOf(tripId, stopIndex)`,
  `:107` `elementKey` (the `kind:id occurrence` row key), `:69` `stops`.
- `src/modules/schedule-controller.ts:1334` `updateFlexWindow`,
  `:1498` `insertFlexStopTime`, `:1433` `updateFlexStopTimeField` (the
  addressing pattern to reuse), `:1552+` `commitStopTimePlan` (writes a plan as
  one patch, deletes-then-inserts when keys move), `:1879` `pendingRow`.
- `src/modules/timetable-database.ts:170` `planFlexStopTimeInsert` (appends and
  renumbers from 0), `:245` `reorderByTime` (untimed rows keep their slot).
- `src/modules/gtfs-validator.ts:896` `validateFlexLocations`, `:1233`
  `addWarning` — where the unpaired-row warning goes.
- `src/utils/flex-rules.ts` `validateFlexStopTimeRow`.

### Steps

- [x] Thread the row's `StopTimeRef` into the cell. Pass the `rowRef` already
      computed at `timetable-renderer.ts:693-702` into
      `renderStackedArrivalDepartureCell` as a new `rowRef?: StopTimeRef`
      parameter, and select the flex branch on
      `rowRef !== undefined && rowRef.kind !== 'stop'` **or**
      `editableStopTime?.isFlex` (a timed stop row that carries a window is
      still flex) **or** `isPendingFlex`. Compute `rowRef` once per row, above
      the `data.trips.map`, rather than per cell.
- [x] In `renderFlexWindowCell`, keep the existing null-`editableStopTime`
      handling but stop treating "no record" as "pending": take an explicit
      `hasRecord: boolean`. No record means empty spans, no badges, and
      `data-stop-sequence=""`. Add `data-flex-kind`/`data-flex-id` from the row
      ref to the two spans so the insert path knows what to create without
      re-deriving it from `data-stop-id`.
- [x] Stop emitting `data-stop-id` on a flex cell's spans. It is the zone id
      today, which is precisely what feeds the bad `planStopTimeEdit` insert.
      Check every reader of `data-stop-id` on a `.time-span`
      (`installTimeCellEditor` around `schedule-controller.ts:560`,
      `showTimeError`, the selection helpers) and make each one tolerate its
      absence on a flex cell, keyed on the flex id instead.
- [x] In `installTimeCellEditor`'s `onCommit` (`:589-608`), route a window edit
      with no `data-stop-sequence` to a new insert path rather than to
      `updateFlexWindow`'s update path. Keep `pending === 'true'` working as it
      does — the pending row is still the only way to add a ref that no trip on
      the route uses yet.
- [x] Add `planFlexStopTimeInsertAt(trip_id, ref, window, insertIndex, shape)`
      to `timetable-database.ts` beside `planFlexStopTimeInsert` — or give the
      existing function the two new parameters, if the pending path can pass
      `insertIndex = beforeRows.length` and an empty shape without contortion.
      Prefer widening the existing one; two nearly identical planners is the
      abstraction this codebase says not to build. `shape` carries
      `pickup_type`, `drop_off_type`, `pickup_booking_rule_id`,
      `drop_off_booking_rule_id`. Both window ends are still seeded with the
      typed value, for the reason `:160-164` already records.
- [x] Compute `insertIndex` in `schedule-controller`, not in the database
      module: walk the trip's stop_times in `stop_sequence` order, map each
      through `sequence.positionOf(trip_id, i)`, and take the first index whose
      position exceeds the edited row's supersequence position; fall back to
      `beforeRows.length` when none does or when `positionOf` returns null.
      The renumber in the planner already rewrites every `stop_sequence` from 0,
      so the insert only has to land in the right array slot.
- [x] Compute the inherited shape from `sequence` + the route's trips: for the
      edited row's supersequence position, find the first other trip with an
      `editableStopTimes` entry at that position and read its four fields.
      `TimetableData` is already in hand at edit time; do not re-query the
      database for this. Fall back to `pickup_type: 2, drop_off_type: 2` and
      empty rule ids.
- [x] Surface the inheritance in the success notification: "Added area_715 to
      trip C (pickup 2, drop-off 1 copied from t_5374944)" versus the plain
      wording when nothing was copied. The user must be able to see that four
      fields were written from one keystroke without opening the Changes panel.
- [x] Validate the assembled row through `validateFlexStopTimeRow` before
      writing, exactly as `insertFlexStopTime` does at `:1525`, and surface a
      failure through `showTimeError` instead of writing.
- [x] Add the delete path: in `updateFlexWindow`, when the new value is empty
      **and** the row is a saved flex row, delete that stop_time and renumber
      the trip rather than writing `''`. Build it as a plan
      (`beforeRows`/`afterRows` with the row removed and sequences renumbered
      from 0) and push it through `commitStopTimePlan` so it lands as one patch
      and undo restores the row with its types and rules intact. Confirm by eye
      that undo works — a delete-plus-renumber moves every later row's primary
      key.
- [x] Do not delete on an empty value for a *timed* row that happens to carry a
      window (the deviated-route fixed stops). Only a row whose ref is a zone or
      location group is deletable this way; a timed row clearing its window is a
      plain field clear.
- [x] Add an unpaired-row warning to `validateFlexLocations` in
      `gtfs-validator.ts`: for each trip, a stop_time whose ref appears exactly
      once on that trip with `pickup_type=2, drop_off_type=1` (or the mirror)
      and whose route has trips using both halves of the pair gets an
      `addWarning`, not an `addError`. Pickup-only service in a zone is legal —
      this is a "did you mean" and must read as one. Do not auto-create the
      missing row.
- [x] Re-check the `single-zone` and `location-group` fixtures in
      `fixtures/flex/`: after this phase both should be buildable end to end
      from an empty route through the grid alone. Add a fourth trip to the
      `single-zone` fixture if that is what it takes to exercise a multi-trip
      row.

**Findings:** the cell renderer's flex branch now selects on the row ref first,
so an unserved zone cell can no longer fall through to the arrival/departure
spans — the corrupting `planStopTimeEdit` insert is unreachable rather than
merely guarded. `renderFlexWindowCell` takes the row ref and derives
`hasRecord` from `editableStopTime !== null` rather than taking a separate
boolean: the two were always the same value, and the pending row and an unserved
cell want identical treatment (empty spans, empty `data-stop-sequence`, no
badges). `isPendingRow` still reaches the span as `data-pending`, which is what
keeps the pending path distinct from the new one.

`planFlexStopTimeInsert` was widened rather than duplicated, as the plan
preferred. It gained `insertIndex` and `shape`, both optional, and the plan it
returns now carries `insertedIndex` — the pending path used to read
`afterRows[afterRows.length - 1]`, which stops being the new row once an insert
can land mid-trip. `planFlexStopTimeDelete` is a new sibling; it returns null
when no row matches rather than throwing, since a stale `data-stop-sequence`
after a concurrent patch is a miss, not a bug.

`openTimeEditor`'s guard was split: `stop_id` is now required for
arrival/departure editing only, because a flex cell deliberately carries none.
The window branch reads `data-flex-kind`/`data-flex-id` off the span and passes
the ref plus the supersequence index into `updateFlexWindow`, which routes on
"no `stop_sequence`" — the pending row to `insertFlexStopTime` (unchanged),
anything else to the new `insertFlexStopTimeOnTrip`. Clearing an unserved cell
has nothing to do, so `clearTimeCell` skips a flex cell with no `stop_sequence`
rather than warning about it.

The delete path keys off the row itself (`row.location_id ||
row.location_group_id`), not off a parameter: that is what keeps a deviated
route's timed stop clearing its window a plain field clear while a zone row
clearing its window removes the record. No new state was needed for the
distinction.

`currentTimetableData()` reads the already-cached `TimetableData` for the
route/service/direction on screen, so neither the insert index nor the inherited
shape re-queries the database. Both degrade rather than throw: a cache miss logs
and returns, `positionOf` returning null falls through to an append, and a row
that is empty on every other trip falls back to `2`/`2` with no rules.

The unpaired-row check landed as a private `validateFlexRowPairing` called from
the end of `validateFlexLocations`. It only fires when the route pairs that same
ref up on some *other* trip, which is what keeps a genuinely pickup-only zone
quiet.

Fixtures: `single-zone` gained a second trip (`dr1_weekday_pm`) so its two zone
rows span more than one trip column, and `multiple-zones` gained `dr2_evening`,
which serves `area_714` only — that is the fixture carrying the dead cells this
phase is about, and it exercises the inherit-from-sibling path without tripping
the new pairing warning. Both were preferred over a trip with no `stop_times` at
all, which would have been an invalid feed.

**Not verified by driving the browser** (per the project's testing convention):
undo of the delete-plus-renumber, and undo of a mid-trip insert. Both record as
deletes-then-inserts through `commitStopTimePlan`; the gotcha below still stands,
and the fixtures exist so it can be checked by eye.

**Gotchas:** `data.stops[i].stop_id` is the *ref id* on a flex row, not a real
stop — that conflation is the root of the corrupting write, so resist reusing it
as an identifier anywhere new. `positionOf` returns null for a trip whose
pattern was dropped from the ordering; the insert must degrade to an append
rather than throw. `commitStopTimePlan` collapses to a field update only when
every key survives — an insert or delete in the middle of a trip never does, so
both paths here record deletes plus inserts, which is also why undo needs
checking by eye. `refreshCurrentTimetable` is for pending-row state only; every
write in this phase is a patch and redraws through the `patch:change` listener,
so calling both would double-render.

---

## Out of scope

- On-map polygon drawing or reshaping. Geometry is edited as text or via
  geojson.io, as before.
- Whole-collection GeoJSON editing and bulk zone import.
- The zone overlap constraint (simultaneous overlap of geometry, window and
  pickup/drop-off type on one trip). Still needs real geometry intersection.
- Travel-time computation from `safe_duration_factor` / `safe_duration_offset`.
- The "ignore intermediate windowed stop_times" routing rule.
- `frequencies.txt`.
