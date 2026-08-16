# Follow-on Plan: On-Demand (GTFS Flex) polish

Follows `CURRENT_PLAN.md`, which landed flex across six phases (spec fixes,
`StopTimeRef` pipeline, inline timetable rendering, zone polygons + geojson.io,
browse pages, On-Demand modal + validation). Everything below is a gap left by
that work, plus a conformance pass against the official demand-responsive
service documentation.

## Summary

Five follow-ups. Zones and location groups are rendered and browsable but they
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

- [ ] Add a private `boundsFor(input: { stop_ids?, zone_ids?, location_group_ids?,
      route_ids?, include_shapes?: boolean }): LngLatBounds | null` to
      `src/modules/map-controller.ts`. It extends over: each stop's
      `[lon, lat]` filtered through the existing `hasValidCoords`; each zone's
      `zoneBounds(feature)` corners (both `Polygon` and `MultiPolygon` are
      already handled there); each location group's member stops via
      `stopIdsForLocationGroup`; and, when `include_shapes`, every coordinate of
      the matching features from `routeRenderer.getRouteFeatures()` filtered by
      `route_id`. Returns null when nothing contributed a coordinate.
- [ ] Add a private `refsForRoute(route_id)` returning
      `{ stop_ids, zone_ids, location_group_ids }`, built by walking the route's
      trips (`getTripsByRouteId`) and their stop_times
      (`getStopTimesByTripId`) through `stopTimeRef()`. This is the flex-aware
      counterpart to `getStopIdsForRoute`.
- [ ] Fix `src/modules/gtfs-parser.ts:1400-1413` `getStopIdsForRoute` to skip
      stop_times with no `stop_id` rather than adding `undefined` to the set.
      This is a live bug independent of the rest of the phase: the `undefined`
      currently flows into `applySpotlight` -> `withAncestors` ->
      `setRouteStops`.
- [ ] Rewrite `fitMapToData` (`:469`) to use `boundsFor({ stop_ids: all,
      zone_ids: all })` so a whole-feed fit covers every zone, and so a feed
      with no stops still fits. Keep the existing 50px + `bottomPadding`
      padding.
- [ ] Rewrite `flyToRoute` (`:1035`) and `fitToRoutes` (`:1074`) on top of
      `refsForRoute` + `boundsFor({ ..., route_ids, include_shapes: true })`.
      Keep their differing padding/duration — `flyToRoute` animates at 2000ms,
      `fitToRoutes` does not.
- [ ] Rewrite `fitMapToTrip` (`:947`) to collect that one trip's refs through
      `stopTimeRef()` and fit over stops + zones + group members. A trip's shape
      is a single `shape_id`; include it only if it is cheap to resolve from the
      already-built route features, otherwise leave shapes out of the trip fit
      and say so in a comment.
- [ ] Extend `applySpotlight` (`:715`) to reveal the zones a route touches:
      pass the route's `zone_ids` to a new
      `layerManager.setRouteZones(location_ids)` that dims non-matching zone
      polygons the way `setRouteStops` dims stops, and clears on `null`. Follow
      the existing rule in that method's doc comment — it is the sole owner of
      the spotlight, so the zone half goes here, not in the callers.
- [ ] Verify `highlightZone` (`:825`) and `highlightLocationGroup` (`:842`)
      still fit correctly once `fitToStops`/`fitToZone` are expressed through
      `boundsFor`, keeping their `maxZoom: CONFIG.STOP_FOCUS_ZOOM` clamp. A
      county-sized zone must not be clamped to stop-level zoom — check whether
      `maxZoom` should be dropped for zone fits, since it only exists to stop a
      single-point fit zooming to the street.

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

- [ ] Generalize the pending-row state in
      `src/modules/schedule-controller.ts:1534-1548` from
      `pendingStop?: { stop_id, stop_name }` to
      `pendingRow?: { ref: StopTimeRef; name: string }`. Update
      `clearPendingStop` (`:1541`) to compare refs, and the reset in `:982`.
- [ ] Replace `getStopOptions()`'s use in `openAddStopPicker` (`:806`) with a
      combined option list: every stop (as today), then every zone from
      `getZoneFeatures`, then every location group from
      `GTFS_TABLES.LOCATION_GROUPS`. Encode the value as `` `${kind}:${id}` ``
      and put the kind in `secondary` ("On-demand zone", "Location group").
      Leave `openStopPicker` (the row-label swap, `:782`) stop-only — repointing
      a timed row at a zone is not a stop swap, which is the reasoning already
      recorded at `:290-292`.
- [ ] Retitle the button (`timetable-renderer.ts:702`) to "Add stop or zone..."
      and the picker to "Add stop or zone".
- [ ] Rewrite `addStopFromSelector` (`:1658`) as `addRefFromSelector(value)`:
      parse the `kind:id` value, resolve a display name per kind (stop name,
      `zoneName(feature)`, `location_group_name`), set `pendingRow`, refresh.
      Keep the "enter a time to save" notification, wording it as "enter a
      pickup window" for the two flex kinds.
- [ ] In `timetable-renderer.ts:1455-1470` (the pending append) and
      `renderStopLabelCell` (`:465`), render a pending flex row with the flex
      name block and kind badge rather than `renderPlainStopLabel`.
- [ ] In `timetable-cell-renderer.ts`, make a pending flex row's cells render
      the two window spans (`data-time-type="window-start"|"window-end"`,
      `flex-window`, `data-pending="true"`) rather than arrival/departure spans,
      so the first typed value lands in the right field.
- [ ] Add an insert path for flex rows. `updateFlexWindow` (`:1135`) currently
      returns early when no row matches; when the edit comes from the pending
      row it must instead build a new stop_time and record an **insert** patch.
      Do not extend `planStopTimeEdit` for this: it locates rows by
      `stop_id` and renumbers by time, neither of which applies. Add a sibling
      `planFlexStopTimeInsert(trip_id, ref, field, value)` in
      `timetable-database.ts` that appends the row and renumbers
      `stop_sequence` from 0 over the trip's existing order (`reorderByTime`
      leaves untimed rows in place, so an appended flex row stays last).
- [ ] Defaults for a newly created flex stop_time: the ref field
      (`location_id` or `location_group_id`), the edited window field, and
      `pickup_type=2` / `drop_off_type=2` — both booking directions allowed,
      which is valid under the window rules (0 forbidden for both, 3 forbidden
      for pickup) and is the least surprising default. `arrival_time` and
      `departure_time` stay empty, and both booking rule ids stay empty. Run
      the row through `validateFlexStopTimeRow` from `src/utils/flex-rules.ts`
      before writing, and surface a failure through `showTimeError` rather than
      writing an invalid row.
- [ ] A pending row for `kind === 'stop'` must keep going through the existing
      `planStopTimeEdit(..., forceInsert)` path unchanged. Do not unify the two.
- [ ] Clear the pending row after the first successful write, on the same path
      that `:1101` already uses (before the patch is recorded, for the reason
      the comment there gives).
- [ ] Confirm the two-rows-on-the-same-zone case: adding the same zone twice
      must produce occurrence 0 and 1, two distinct rows, not one. The
      occurrence counter in `route-sequence.ts` keys on `kind:id`, so this
      should hold — verify it against a real add rather than assuming.

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

- [ ] In `src/modules/zone-geometry-editor.ts`, replace the paste box with a
      tall scrollable `<textarea>` (`rows="14"`, `font-mono text-xs`,
      `resize-y`) pre-filled with
      `JSON.stringify(feature, null, 2)` for this zone. Treat it like the app's
      other inputs: `textarea textarea-bordered w-full`, an inline error line
      under it, and a disabled Save until the content differs from what was
      loaded.
- [ ] Keep the summary `<dl>` (type / vertices / bounds) above the textarea —
      it is the fast read that the raw JSON is not.
- [ ] Save parses the textarea with `JSON.parse`, accepts either a bare Feature
      or a single-feature FeatureCollection, forces `id` back to the zone's
      `location_id`, and writes through
      `mergeZoneFeatures(current, [edited], false)` + `writeZoneFeatures`,
      exactly as the current Apply button does. Report a parse failure inline
      with the character offset from the `SyntaxError`, and do not clear the
      textarea on failure.
- [ ] Keep the "Edit in geojson.io" anchor (`encodeGeojsonIoUrl` on a
      single-feature collection, `target="_blank" rel="noopener"`).
- [ ] Add an "Import from URL" button next to it that prompts for a URL, fetches
      it through `withCorsProxy(url, useCors)` from
      `src/modules/feed-selection.ts`, parses the body with
      `parseGeojsonIoInput` (it already accepts raw GeoJSON *and* a geojson.io
      URL, so pasting either into the prompt works), and loads the resulting
      feature **into the textarea** rather than writing straight to the store.
      The user then reviews and presses Save. Fetch failures surface through the
      same inline error line, using the CORS-hint wording
      `feed-selection.ts:33` already produces.
- [ ] When the fetched collection has several features, pick the one whose `id`
      matches `location_id`; if none matches and there is exactly one feature,
      take it (the existing "geojson.io drops the feature id" reasoning at
      `zone-geometry-editor.ts:122-131`); otherwise error with the list of ids
      found.
- [ ] Rework `attachZoneGeometryHandlers` for the new controls, keeping its
      shape (`container` + deps, called from
      `zone-view-controller.addEventListeners`). It must stay idempotent per
      render — the page re-renders wholesale via `onGeometryChanged`.
- [ ] After a successful save, `onGeometryChanged` already re-renders the page;
      confirm the map layer refreshes too (`updateZonesLayer`) and that the
      focused/hovered feature state from Phase 1 survives the source
      `setData`.

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

- [ ] Build a fixture for each of the four documented shapes (they can be
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
- [ ] Verify for each: the route page renders without throwing, the diagram and
      the timetable show one row per stop_time (crucially **two** rows for the
      same-zone cases, not one), the window renders in the two time spans, and
      the feed validator reports no false positives.
- [ ] Verify the deviated-route fixture specifically keeps its interleaved
      order: timed and windowed rows share one `stop_sequence` run, so any
      re-sort that moves untimed rows would scramble it.
- [ ] Verify export round-trips each fixture byte-for-byte on the flex columns,
      including empty `arrival_time`/`departure_time` on flex rows and empty
      window columns on timed rows.
- [ ] Make `pickup_type` and `drop_off_type` editable per flex row from the
      timetable (a small enum menu on the flex cell, reusing
      `openTripPropEnumMenu`'s pattern), restricted to the values the window
      rules allow: pickup {1,2}, drop-off {1,2,3}. Without this the documented
      `(2,1)` / `(1,2)` pattern cannot be produced from the UI, only from the
      raw editor.
- [ ] Make `pickup_booking_rule_id` / `drop_off_booking_rule_id` assignable from
      the flex row. The badges are navigation-only today
      (`schedule-controller.ts:317-327`); add an assign action (a picker over
      `booking_rules.txt`) that keeps the existing click-to-open behaviour for
      an already-set rule.
- [ ] Check `booking_type=0` (real-time booking) renders sensibly in the
      On-Demand modal — the documentation's examples only cover types 1 and 2,
      so type 0's field matrix is the least exercised.
- [ ] Cross-check the documentation's phrasing against the presence conditions
      corrected in Phase 1 of `CURRENT_PLAN.md`, and re-run `pnpm check-spec`.

**Gotchas:** the documentation's own `stop_times` example for the RufBus service
contains a typo (`flächenrufbus-angermünde_weekdays` with a hyphen in some rows,
underscore in others). Do not encode either spelling as a rule — it is a
dangling foreign key, which `validateForeignKeys` should already report, and
that is the correct behaviour under the standing "surface, don't fix" rule.

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
