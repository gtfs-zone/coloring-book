## Summary

A follow-up polish pass on the GTFS pathways feature (after PRIOR_PLAN, PRIOR_PLAN2, and CURRENT_PLAN). Several visual and navigation regressions emerged during use, plus a few small gaps. The biggest issue: clicking a stop now does NOTHING visually — the circle stays at 1× (no growth at all), even though the feature-state-driven paint expression and `setFocusedStop` calls look correct on inspection. Additionally, the station ✕ overlay symbol layer isn't rendering at all — likely a missing-glyphs / wrong-font problem with the current basemaps. Both of these need to be debugged in-browser, not just edited blindly. We also have a broken pathway-row primary click (the dependency was added but never wired in `browse-navigation.ts`), missing stop_id in breadcrumbs/pathway labels (only name shown — and stop names are often non-descriptive), and a feed-fit bounds calculation that gets dragged toward (0,0) by null-island stops.

The plan is split into six small phases. They are mostly independent — the dependency graph is shallow.

**Tradeoffs considered:**
- For the inline stop label format, considered `"Name<br>id"` (current `renderCardLabel`) vs `"Name (id)"` inline. The user picked inline because breadcrumbs and pathway-row text are single-line contexts where the stacked form doesn't fit cleanly. Stop list rows will switch from stacked to inline too for consistency.
- For null-coord stops (lat/lon === 0 or null): the data model already treats them as navigable but invisible. The map highlight should stay on the nearest coord-having ancestor (typically the parent station) so the user has visual feedback about which area of the map the focused null-stop belongs to. Alternative was to draw a placeholder at the parent's location — rejected as visually noisy and easily confused with the real stop.
- For "station click zooms to all stops": the existing `flyToStation` already exists but only fits direct children (`parent_station == stationId`). Using the new `station_id` derived property (added in CURRENT_PLAN Phase 1) lets it include grandchildren (boarding areas) for free.

## Relevant Context

**Stop highlight regression (Phase 1):**
- `src/modules/layer-manager.ts`:
  - `addStopsBackgroundLayer()` (lines 239–307) — current `circle-radius` case expression: focused location_type=0 → `options.radius * 1.7` ≈ 6.8; unfocused → `options.radius` = 4. Other location types also have small growth (5→8 for entrances/generic nodes, 7→11 for boarding areas, 6→10 for stations).
  - `setFocusedStop()` (lines 588–610) — sets feature-state `focused: true/false` via `map.setFeatureState`. Works correctly; the issue is purely the magnitude of the radius change in the paint expression.
  - `defaultHighlightOptions` (lines 54–59) — `radius: 8` was the OLD highlight size (when the separate `stops-highlight` layer existed). That layer was replaced in commit c3496c6 by feature-state. We can revisit the multipliers to roughly match the old visual size (4 → 8, i.e. 2×) without re-introducing a separate layer.
  - `addStationXLayer()` (lines 313–344) — focused `text-size: 16`, unfocused: 10. Should grow with the circle proportionally.
- The `stops-background` circle stroke-width grows on focus from `options.strokeWidth` (2) to 4. Keep this — it amplifies the focused look.

**Null-coord stops (Phase 2):**
- `src/modules/map-controller.ts` `applyFocusedObject()` (lines 610–639) — calls `layerManager.setFocusedStop(obj.id)` for stop type. For a null-coord stop the map feature doesn't exist; `setFeatureState` silently no-ops (the try/catch in `setFocusedStop` swallows errors).
- `src/modules/layer-manager.ts` `createStopsGeoJSON()` (lines 167–234) — already filters out coord-less stops from rendered features (via the `validStops` filter in `addStopsLayer` line 116). The full stops list IS passed as `allStops` so `station_id` can climb the chain even for invisible stops. Good — no schema change needed for this phase.
- Empty-click navigate-up (CURRENT_PLAN Phase 3, `handleEmptyClick` at map-controller.ts lines 783–812) — already navigates to `parent_station` when focused stop has one. For null-coord stops this means: empty-click on the map → return to parent station focus. That matches the user's mental model.

**Inline stop labels (Phase 3):**
- `src/utils/entity-display.ts`:
  - `getStopDisplay()` (lines 20–29) — returns `{primary: name, secondary: id}` when name exists, else `{primary: id}`.
  - `renderCardLabel()` (lines 53–58) — produces stacked `<span>name<br><span class="text-xs opacity-60">id</span></span>`.
  - `renderOptionLabel()` (lines 63–68) — already produces inline `"name (id)"`. Reuse this for breadcrumbs and inline references; no new helper needed.
- `src/utils/entity-references.ts`:
  - `renderStopReference()` (lines 134–149) — currently uses stacked `renderCardLabel`. Switch to inline so list rows are tighter and the id is on the same line.
  - `renderPathwayReference()` (lines 159–180) — primary text builds via `getStopDisplay(otherStop).primary`, losing the id. Switch to `renderOptionLabel(getStopDisplay(otherStop))` so it shows `"Stairs to Platform A (TS_P1)"`.
- `src/modules/page-state-manager.ts`:
  - `buildBreadcrumbs()` `case 'stop'` (lines 350–371) — ancestor labels use `ancestor.stop_name` and leaf uses `stopName` from `getObjectName`. Both need to be `"{stop_name} ({stop_id})"` (or just `stop_id` when no name). Easiest: change `BreadcrumbLookup.getStopAncestors` to return objects with a `display` field already formatted, OR have `buildBreadcrumbs` format inline.
  - `getObjectName()` (lines 441–466) — for type 'stop' returns just the name. Either change this to return the inline form, or compute it in buildBreadcrumbs from the lookup result.
- `src/modules/gtfs-breadcrumb-lookup.ts` `getStopName()` (lines 72–89) — returns plain `stop_name`. Plus `getStopAncestors` (lines 94–133) and `getPathwayAncestors` already return `{stop_id, stop_name}` rows. We can format inline inside `buildBreadcrumbs` (cleaner) or change the lookup to return `display` strings.

**Pathway primary click (Phase 4):**
- `src/modules/browse-navigation.ts` (lines 327–357) — sets up the `dependencies` passed to `PageContentRenderer`. Has `onStopClick`, `onRouteClick`, etc. — but **no `onPathwayClick`**. That's the bug. `navigateToPathway` already exists in `src/modules/navigation-actions.ts:92`.
- `src/modules/page-content-renderer.ts` (lines 198, 776–784) — already wires `onPathwayClick` through to `StopViewController` and adds the row click listener. The handler simply skips if undefined, which is why pathway-card primary click silently does nothing.

**Station click zooms to descendants (Phase 5):**
- `src/modules/map-controller.ts` `flyToStation()` (lines 555–605) — filter is `s.stop_id === stationId || s.parent_station === stationId`. Only direct children. Switch to: use the same `station_id` derived property computation we already do for the layer-manager filter — climb each stop's `parent_station` chain to find its top-most station ancestor, include if it matches `stationId`.
- `applyFocusedObject` (lines 610–639) — `flyToStation` is called only when `oldStation !== newStation`. So clicking an already-focused station (e.g., re-clicking via panel) doesn't re-fit. **Decision:** add a public `focusOnStation(stationId)` path that always fits, used when the user explicitly clicks a station via the map or a reference. The internal applyFocusedObject path keeps its current "only on change" behavior to avoid mid-interaction re-flying.
- Alternative considered: just remove the `oldStation !== newStation` guard. Rejected — that would cause `applyFocusedObject` to re-fly every time the user clicks a child stop within the expanded station, which is annoying. Keep the guard, but add an explicit fly call on direct station map-click.

**fitMapToData lat/lon=0 filter (Phase 6):**
- `src/modules/map-controller.ts` `fitMapToData()` (lines 457–492) — filter: `lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)`. Need to also exclude `lat === 0 && lon === 0`.

**Invariants to preserve:**
- All user-initiated DB writes still go through `patchManager.record*` (no DB changes in this plan).
- Feature-state highlighting on focused stop/pathway must keep working.
- `setFocusedStop` for a null-coord stop should NOT throw; it should silently no-op for the missing feature and apply focused state to the nearest coord-having ancestor instead (Phase 2 logic).
- The expanded-station filter and pathways-layer logic from CURRENT_PLAN must continue to work; we're only adjusting visual scale and a few callbacks.

---

## Phase 1: Debug and fix broken stop-focus visual + missing station ✕

Goal: Two real visual bugs to fix here, not just a magnitude tweak.
1. **Stops don't grow at all (1×) when clicked.** The paint expression on `stops-background` reads `feature-state.focused`, and `setFocusedStop` calls `map.setFeatureState({source:'stops', id: stop_id}, {focused: true})`. Something in that chain is broken — the focused case branch never evaluates to true. The radius math (1.7× vs 2×) is irrelevant if the focused branch isn't firing.
2. **No ✕ symbol on station circles.** The `stops-station-x` symbol layer is being added (visible in `addStopsLayer` → `addStationXLayer`) but the glyph doesn't render. Most likely cause: the active basemap's style has no `glyphs` URL, OR doesn't ship the `'Open Sans Regular'` / `'Arial Unicode MS Regular'` fonts referenced in the layer's `text-font`. MapLibre silently drops symbol layers when no font can render the text.

This phase is debug-driven — instrument first, then fix. Do NOT batch the radius tweaks with the bug fix; we want to isolate "the focused state is now firing" from "the size jump is now bigger." After the bug fix, the user must verify before we move to magnitude adjustments or Phase 2.

### 1a. Diagnose: why isn't `feature-state.focused` flipping the circle?

Possible root causes (verify each with dipsticks, don't assume):
- The feature `id` set in `createStopsGeoJSON` (`feature.id = properties.stop_id`) doesn't match what `setFeatureState` is targeting (e.g. type mismatch, or `id` got stripped during a later `setData` call).
- The source was recreated after the layer was added (e.g. basemap-change re-adds layers), and the layer is now pointing at a stale source, OR the feature state lookup is keyed by a different source instance.
- The `'case'` expression's outer condition `['boolean', ['feature-state', 'focused'], false]` is being short-circuited because `setFeatureState` errored silently (the try/catch in `setFocusedStop` swallows the error).
- A later layer with the same source/filter is painting OVER the focused circle without honoring feature-state (the clickarea is transparent, so probably not it — but verify).
- Promote-id mismatch: the `stops` source doesn't have `promoteId` set, but features have a top-level `id` field, which IS the correct way to enable feature-state per MapLibre docs. Confirm the `id` is in fact present after `setData` (it gets re-added each time in `updateStopsData`).

Steps:
- [x] In `setFocusedStop()` (`src/modules/layer-manager.ts:588`), add `console.log('[LayerManager] setFocusedStop', { prev: this.focusedStopId, next: stop_id, hasSource: !!this.map.getSource('stops') })` at the top. Upgraded the catch from `console.debug` to `console.warn` so silent failures surface.
- [x] After calling `setFeatureState`, immediately call `this.map.getFeatureState({source:'stops', id: stop_id})` and log the result (with `idType: typeof stop_id` so we can detect type mismatch).
- [x] **User verified by console:** for a numeric stop id (e.g. 2807), feature-state IS applied and the circle grows correctly. For a string id (`place-jfk`), readback returns `focused: true` BUT `queryRenderedFeatures` shows the rendered feature has `id: 0` and `state: {}` — meaning the vector-tile encoder coerced our non-numeric string id to 0, breaking the feature-state lookup.
- [x] **Root cause:** the `id: feature.properties?.stop_id` injection works only for numeric-looking ids. Non-numeric stop ids (typical for MBTA-style `place-*` station ids) get coerced to 0 internally. Result: every station with a non-numeric id silently loses its feature-state, so the focused branch of the circle-radius case never fires, the station stays at r=6, and surrounding child stops (r=4–7) cluster and visually swallow it. That's why the station appeared to "disappear" on click.
- [x] **Fix:** add `promoteId: 'stop_id'` to the stops GeoJSON source. promoteId tells MapLibre to use the named property (string-preserving) as the feature id for feature-state, bypassing the auto-coercion path. Removed the now-redundant manual `id` injection in both `addStopsLayer` and `updateStopsData`. Also added `promoteId: 'pathway_id'` to the pathways source for the same reason.
- [ ] After user re-verifies the fix end-to-end (Phase 1d gate), REMOVE the diagnostic console.logs (keep one summary `[LayerManager] setFocusedStop` log at info level since the project's style is to log at state transitions per CLAUDE.md).

### 1b. Diagnose: why isn't the station ✕ rendering? → switched to inner-dot

**Root cause:** all 6 basemaps in `src/modules/basemap-styles.ts` are raster-only with no `glyphs` URL. Symbol layers with `text-field` silently fail without glyphs.

**First attempted fix:** canvas-rendered ✕ via `map.addImage` + symbol layer with `icon-image`. Worked but hit a second issue: `icon-size` is a LAYOUT property and cannot use `feature-state`, so we couldn't scale the ✕ on focus.

**Final fix (user-chosen, simpler):** drop the symbol layer entirely. Add a small black inner-circle layer (`stops-station-dot`) filtered to `location_type === 1`. Circle layers are pure paint-side so `circle-radius` can use feature-state without restriction — the dot grows from r=2.5 to r=4 on focus. No `map.addImage`, no canvas, no font dependency. Works on every basemap.

- [x] Removed `ensureStationXIcon()` and the symbol-based `addStationXLayer()` entirely.
- [x] Added `addStationDotLayer()`: a `circle` layer with `circle-radius` feature-state case (2.5/4), solid black fill, no stroke, filtered to `location_type === 1`.
- [x] Renamed every reference: `stops-station-x` → `stops-station-dot` in `clearAllLayers`, `setStopsFilter`, and the comment in `addStopsBackgroundLayer`.
- [ ] **User: verify on each basemap option (standard/satellite/light/dark/watercolor/topo) that every station shows a small black dot in the center of its white circle** (both before and after click — the dot should always be visible on every station, and grow slightly on click).

### 1c. Tune magnitudes only after the bug is fixed and verified by the user

- [x] Updated focused `circle-radius` case branch values in `addStopsBackgroundLayer()`:
  - location_type 0 (default stop): `options.radius * 2` (8 — was 6.8) ✓
  - location_type 2 (entrance): 10 (was 8) ✓
  - location_type 3 (generic node): 10 (was 8) ✓
  - location_type 4 (boarding area): 13 (was 11) ✓
  - location_type 1 (station): 12 (was 10) ✓
- [x] Bumped focused station-dot radius from 4 → 5 (~25% larger, scaling with the now-larger station circle).
- [x] Bumped focused `circle-stroke-width` 4 → 5.
- [x] Pathway focused `line-width` is already 6 (unfocused 3) — a 2× jump, plenty bold. Left as-is.
- [x] Trimmed setFocusedStop diagnostics: dropped the readback log and the hasSource field; kept the single state-transition log; added early-return when prev===next so no log fires on no-op calls.
- [x] For consistency, mirrored the same shape on setFocusedPathway (single transition log, early-return, console.debug→warn).

### 1d. User verification gate

- [x] **User verified** that the fixes work end-to-end on their feed:
  - Clicking a stop visibly grows the circle.
  - Stations show a black inner-dot on every basemap.
  - Clicking a station grows the white circle AND its dot.
- [x] All magnitude bumps and diagnostic trims landed afterward.

**Gotcha:** The `options.radius` is passed as 4 from `map-controller.updateMap` (line 425). Using `options.radius * 2` keeps the multiplier explicit, but the absolute values for other location types are literals — don't accidentally regress those.

**Gotcha 2:** The clickarea radius (`options.clickAreaRadius` = 15) is the click hit-test area; it doesn't affect the visible circle. Don't touch it.

**Gotcha 3:** The `try/catch` in `setFocusedStop` uses `console.debug` for errors, which is suppressed by default in many browsers. While debugging, temporarily upgrade to `console.warn` to ensure silent failures surface.

---

## Phase 2: Null-coord stops keep parent station focused on map

Goal: When the user navigates to a stop that has no `stop_lat`/`stop_lon` (typically an entrance or generic node with missing data), the map should keep the nearest coord-having ancestor (usually the parent station) highlighted so there's visual feedback about which part of the map this stop belongs to. The user can still see the stop's properties in the panel, and the breadcrumb chain still works. Empty-clicking returns focus to the parent station.

- [ ] In `src/modules/layer-manager.ts`, add a helper `private resolveCoordHavingStop(stop_id: string): string | null` that:
  - Looks up the stop. If it has valid coords (lat and lon present, not null, not NaN, not both 0), return its own id.
  - Otherwise walk `parent_station` up the chain (cap 5 hops). Return the first ancestor with valid coords.
  - Return `null` if no ancestor has coords.
  - Reuse this lookup logic — it's similar to what `buildPathwaysGeoJSON` already does for pathway endpoints. Consider extracting a shared util `src/utils/stop-coord-resolver.ts` if the logic looks duplicated.
- [ ] In `src/modules/layer-manager.ts` `setFocusedStop(stop_id)`: when `stop_id` is non-null, route through `resolveCoordHavingStop(stop_id)`. Set the feature-state `focused: true` on the RESOLVED id (the ancestor with coords), not on the original `stop_id`. Also update `this.focusedStopId` to track the resolved id so unfocusing later works correctly.
  - **Important:** the public method signature stays the same. Callers still pass the actual `stop_id` they care about; the layer manager handles the redirect internally.
- [ ] Smoke-test: create a station with an entrance child that has empty `stop_lat`/`stop_lon`. Navigate to the entrance from the parent station's child list. The station circle should grow on the map. The breadcrumb chain shows `Home → Station → Entrance`. The properties panel shows the entrance's fields. Empty-click on the map should navigate back to the station.

**Gotcha:** `applyFocusedObject` separately drives station expansion via `deriveExpandedStation`. That logic ALREADY climbs to the parent station for non-station child stops, so expansion behavior is correct regardless of coords. Phase 2 only fixes the visual-focus aspect (which circle grows).

**Gotcha 2:** The `lat=0 && lon=0` case is the user's main null-island concern (Phase 6). The `resolveCoordHavingStop` helper should treat (0,0) as "invalid coords" alongside null/NaN — otherwise a null-island stop would visually look "valid" to this resolver but get clipped from the bounds calc, which is inconsistent.

**Gotcha 3:** When unfocusing, `setFocusedStop(null)` already sets the prior focused id's state to false. Since we tracked the resolved id, this still works. But if the same ancestor is re-focused later (e.g. user clicks a different child of the same station), we end up doing set-false-then-set-true on the same id — fine, just a no-op visually.

---

## Phase 3: Inline "Name (id)" stop labels in references and breadcrumbs

Goal: Stop labels in lists, pathway-row text, and breadcrumbs all show both the name and id in a compact inline form. Stop names are often non-descriptive (e.g., generic "Platform" or empty) so the id is critical for disambiguation.

- [ ] In `src/utils/entity-references.ts` `renderStopReference()`: replace `renderCardLabel(getStopDisplay(stop))` with `renderOptionLabel(getStopDisplay(stop))` wrapped in `<div class="font-medium truncate">…</div>` so it matches the visual weight of other reference rows. Import `renderOptionLabel` from `entity-display`.
- [ ] In `src/utils/entity-references.ts` `renderPathwayReference()`: change `otherDisplay` computation from `getStopDisplay(otherStop).primary` to `renderOptionLabel(getStopDisplay(otherStop))`. Falls back to `otherStopId` if no `otherStop` row is found. Result: `"Stairs to Platform A (TS_P1)"`.
- [ ] In `src/modules/page-state-manager.ts` `buildBreadcrumbs()` `case 'stop'`:
  - For each ancestor, label becomes `"{ancestor.stop_name} ({ancestor.stop_id})"` if `stop_name` is non-empty, else just `ancestor.stop_id`.
  - For the leaf stop, fetch the row (we already have `stopName` via `getObjectName`, but we don't have the id-only fallback path). Easiest: replace the `stopName = await getObjectName(...)` line with a direct lookup that returns `{stop_name, stop_id}` and format inline. Or extend `BreadcrumbLookup` with `getStopDisplay(stop_id): Promise<string>` that does the inline formatting.
  - **Decision:** keep it simple — format inline in `buildBreadcrumbs` using existing `stop_id` (we already have it) and the result of `getStopName` (the name). If name === `Stop ${stop_id}` (the fallback), don't append the id again — show just `Stop ${stop_id}`.
- [ ] In `src/modules/page-state-manager.ts` `buildBreadcrumbs()` `case 'pathway'`: ancestor labels in the chain go through the same inline format. The leaf `Pathway ${pageState.pathway_id}` is fine as-is (pathways don't have names).
- [ ] Verify: navigate to a deeply-nested stop (e.g., a boarding area). Breadcrumb should read `Home → Station Name (S1) → Platform A (TS_P1) → BA Name (BA1)`.

**Gotcha — getStopDisplay fallback:** `getStopDisplay` returns `{primary: id}` (no secondary) when name is empty. `renderOptionLabel` then returns just the id. Good — no `"(id)"` duplication.

**Gotcha — stacked label callers:** `renderCardLabel` is still used in stop-properties header (`renderStopProperties`, stop-view-controller.ts line 218). That's the big detail header where stacked form is fine. Don't change it. Only `renderStopReference` and `renderPathwayReference` switch to inline.

**Gotcha — agency/route/service refs:** Other reference renderers (`renderRouteReference`, `renderServiceReference`) use `renderCardLabel` and stack the secondary line. Leave them alone — only stops need the inline form because stop ids are typically the disambiguator.

---

## Phase 4: Wire onPathwayClick in browse-navigation so primary pathway-row click works

Goal: Clicking the body of a pathway row in the stop view (anywhere except the "View Stop" button) navigates to the pathway page. Currently this silently no-ops.

- [ ] In `src/modules/browse-navigation.ts` (the dependencies block around lines 327–357): import `navigateToPathway` from `./navigation-actions.js`. Add `onPathwayClick: (pathway_id: string) => navigateToPathway(pathway_id)` to the dependencies object passed to `PageContentRenderer`.
- [ ] Verify: in the stop view of a non-station stop with pathways, clicking a pathway row body (not the "View Stop" button) navigates to that pathway's detail page; URL hash updates; breadcrumb shows ancestors.
- [ ] No other changes required — `PageContentRenderer` already forwards `onPathwayClick` to `StopViewController` and wires the `PATHWAY_REF_ROW` click listener.

**Gotcha:** The "View Stop" button inside the same row uses `e.stopPropagation()` on its handler, so it won't also trigger the row's pathway-click. Confirm by clicking the button — should navigate to the other stop, not the pathway.

---

## Phase 5: Clicking a station zooms to all descendant stops (incl. boarding areas)

Goal: When the user clicks a station (on the map, or via a reference), the map fits to the bounding box of the station + all descendants (platforms, entrances, generic nodes, AND boarding areas). Currently `flyToStation` only includes direct children.

- [ ] In `src/modules/map-controller.ts` `flyToStation()` (lines 555–605): replace the filter `s.stop_id === stationId || s.parent_station === stationId` with one that includes all descendants. Easiest approach:
  - Build a `stopById = new Map(stops.map(s => [s.stop_id, s]))` lookup.
  - For each stop, climb `parent_station` chain (cap 5 hops). Include the stop if `stationId` appears anywhere in the chain (or equals the stop's own id).
  - Alternative: reuse the same `resolveStationId` logic that `layer-manager.createStopsGeoJSON` already implements — copy or extract to a shared util. (Recommendation: extract `resolveStationId(stop, stopById): string | null` to a shared util `src/utils/stop-hierarchy.ts` so both call sites stay in sync.)
- [ ] In `flyToStation()`: also exclude stops with invalid coords (lat/lon null/NaN/both-0), consistent with Phase 6. A descendant entrance with no coords shouldn't break the bounds.
- [ ] Verify: navigate to a station that has nested boarding areas under its platforms. The map should frame the full extent of the station, not just zoom on the platform centroid.

**Gotcha — re-clicking same station:** `applyFocusedObject` (the only caller of `flyToStation`) skips the fly when `oldStation === newStation`. So re-clicking a focused station does NOT re-fit. This is intentional (avoids jarring re-fly when navigating to children within an expanded station). If the user reports they want re-click to re-fit too, add an explicit "always fly" path later — but defer that until requested.

**Gotcha — shared helper:** If extracting `resolveStationId` to a util, update both `layer-manager.createStopsGeoJSON` and the new `flyToStation` filter to use it. Keep the 5-hop safety cap.

---

## Phase 6: Skip lat=0,lon=0 stops in fitMapToData bounds

Goal: A feed with placeholder/null-island stops at (0,0) shouldn't drag the whole-feed bounds out into the ocean off west Africa.

- [ ] In `src/modules/map-controller.ts` `fitMapToData()` (lines 457–492): extend the `validStops` filter to also exclude stops where `stop_lat === 0 && stop_lon === 0`. Keep the existing null/NaN guards.
- [ ] Verify with a feed containing a stop at (0,0): zoom-to-feed should frame the real stops without including the null island.

**Gotcha:** Do NOT use `lat === 0 || lon === 0` — that would drop valid stops on the equator (lat=0) or prime meridian (lon=0). The conjunction (`&&`) treats only the (0,0) point as the null sentinel.

**Gotcha — consistency with Phase 2:** Phase 2's `resolveCoordHavingStop` helper uses the same "(0,0) is invalid" rule. Phase 5's updated `flyToStation` also uses it. Three places — consider extracting `hasValidCoords(stop): boolean` to `src/utils/stop-hierarchy.ts` (or wherever Phase 5's `resolveStationId` lands).

---

## Notes / sequencing

- Phases 1, 4, and 6 are independent one-liner-ish fixes; land them first for quick wins.
- Phase 3 (inline labels) is independent and self-contained.
- Phase 2 (null-coord focus redirect) and Phase 5 (station zoom) share the "resolve coord-having ancestor" / "resolve station id" logic. Recommend extracting a shared util `src/utils/stop-hierarchy.ts` with `hasValidCoords`, `resolveStationId`, `resolveCoordHavingStop` during whichever of these phases lands first.
- After all phases land: smoke-test the regression scenarios:
  1. Load a simple feed with no pathways/stations, click a stop → it grows clearly.
  2. Load a station feed with a null-coord entrance, click the entrance reference in the station view → station stays highlighted on map, panel shows entrance properties, breadcrumbs are correct, empty-click on map → station re-focused.
  3. Click a pathway row (not the View Stop button) → navigates to pathway page.
  4. Click a station with nested boarding areas → map zooms to fit the full hierarchy.
  5. Load a feed with a stop at (0,0) → "zoom to feed" frames the real stops only.
  6. Navigate via panel through several stop levels → breadcrumbs show `Name (id)` at each step.
