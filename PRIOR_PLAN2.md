## Summary

The current implementation maintains two separate pieces of map state — `expandedStationId` (which station is showing its children) and `currentHighlight` (`{ type, id }`) — that are kept in sync manually and breed special-casing throughout `MapController`. In practice the expanded station is always derivable from the focused object (e.g. a child stop's `parent_station`, a pathway's `from_stop_id`'s `parent_station`), so the two fields should be one. This refactor introduces a single `FocusedObject` discriminated union to replace both; derives station expansion from it; and adds proper visual feedback for node clicks (enlarged in-place, same color) and pathway clicks (widened in-place, same color) using MapLibre feature state, which avoids the current approach of creating separate highlight sources/layers that hardcode white.

Tradeoff considered: we could keep the separate `stops-highlight` layer and just fix its color. Feature state is cleaner — no source duplication, no layer ordering issues — but requires MapLibre to support feature state on the source (it does, and the source already sets `id: stop_id` on each feature).

## Relevant Context

**State being replaced:**
- `MapController.expandedStationId: string | null` (line 64, `map-controller.ts`)
- `MapController.currentHighlight: { type: 'none' | 'route' | 'stop' | 'trip'; id: string | null }` (lines 67–70)
- `MapController.expandStation()` / `collapseStation()` (lines 892, 964) — these become internals

**Key callsites:**
- `page-content-renderer.ts` line 653: `mapController.highlightStop(stop_id)` — the external entry point for focusing a stop from the panel
- `page-content-renderer.ts` line 486: `mapController.highlightRoute(route_id)`
- `interaction-handler.ts` line 265: `setGetExpandedStationId(() => this.expandedStationId)` — the IH reads expanded station to contextualise new-stop creation; this becomes a getter over `deriveExpandedStation()`

**Layer plumbing:**
- `layer-manager.ts` `addStopsBackgroundLayer()` (line 197) — paint expressions drive stop circle size by `location_type`; needs feature-state-aware radius + stroke-width
- `layer-manager.ts` `highlightStop()` (line 296) — creates a separate `stops-highlight` source+layer with hardcoded white; to be retired for single-stop focus (trip path stops still use `stops-highlight`, so the trip variant stays)
- `layer-manager.ts` `buildPathwaysGeoJSON()` (line 593) — features lack a GeoJSON `id`; needed for feature state
- `layer-manager.ts` `updatePathwaysLayer()` (line 657) — `pathways-lines` paint needs feature-state-aware `line-width`

**Invariants:**
- Feature state on the `'stops'` source uses string IDs because `buildStopsGeoJSON` already sets `id: feature.properties?.stop_id` on each feature (lines 126–131).
- The `'pathways'` source is only present when a station is expanded; `setFocusedPathway` must guard against the source being absent.
- Trip highlighting (`highlightTrip`) uses `stops-highlight` source/layer for the path stops — keep that untouched. Only the single-stop `highlightStop()` path is replaced.

---

## Phase 1: Unified Focus State

Goal: one field (`focusedObject`) drives all map focus/expansion state. No more `expandedStationId` + `currentHighlight` duality.

- [x] In `src/modules/map-controller.ts`: define `type FocusedObject = { type: 'stop'; id: string } | { type: 'pathway'; id: string } | { type: 'route'; id: string } | { type: 'trip'; id: string } | { type: 'none' }` (export it — `InteractionHandler` doesn't need it but `getCurrentHighlight` callers may)
- [x] Remove `expandedStationId: string | null = null` and `currentHighlight: {...}` fields; add `private focusedObject: FocusedObject = { type: 'none' }`
- [x] Add `private deriveExpandedStation(): string | null`:
  - `type === 'stop'`: look up stop; if `location_type === 1` return `stop.stop_id`; else if `parent_station` is non-empty return `parent_station`; else return null
  - `type === 'pathway'`: look up pathway, then look up `from_stop_id` stop; return its `parent_station` if non-empty, else `from_stop_id` itself if it's a station, else null
  - all other types: return null
- [x] Add `private applyFocusedObject(obj: FocusedObject): void`:
  - Capture `const oldStation = this.deriveExpandedStation()`
  - Set `this.focusedObject = obj`
  - Capture `const newStation = this.deriveExpandedStation()`
  - If `oldStation !== newStation`:
    - If `newStation`: call `layerManager.setStopsFilter([...station+children filter...])` and `layerManager.updatePathwaysLayer(newStation)`; fly to station bounds (extract from `expandStation` logic)
    - Else: call `layerManager.setStopsFilter(null)` and `layerManager.clearPathwaysLayer()`
    - Fire `callbacks.onStationExpandChange?.()`
- [x] Refactor `handleStopClick`: remove `locationType === 1` special-case; call `applyFocusedObject({ type: 'stop', id: stop_id })` before navigation
- [x] Refactor `handlePathwayClick`: call `applyFocusedObject({ type: 'pathway', id: pathway_id })`
- [x] Refactor `handleRouteClick`: call `applyFocusedObject({ type: 'route', id: route_id })`
- [x] Refactor `highlightStop(stop_id)`: call `applyFocusedObject({ type: 'stop', id: stop_id })` (visual part arrives in phase 2)
- [x] Refactor `highlightTrip(trip_id)`: call `applyFocusedObject({ type: 'trip', id: trip_id })` then existing `layerManager.highlightTrip` for path stops
- [x] Refactor `highlightRoute(route_id)`: call `applyFocusedObject({ type: 'route', id: route_id })` then existing route renderer highlight
- [x] Refactor `clearHighlights()`: call `applyFocusedObject({ type: 'none' })`; still call `layerManager.clearHighlights()` (for trip-path stops-highlight) and `routeRenderer.clearHighlight()`
- [x] Expose `public getExpandedStationId(): string | null` getter returning `deriveExpandedStation()` (replaces direct `this.expandedStationId` reads); update `initializeModules` line: `this.interactionHandler.setGetExpandedStationId(() => this.getExpandedStationId())`
- [x] Update `getCurrentHighlight()`: derive from `focusedObject` (map type through; `'pathway'` has no prior analog — return `{ type: 'none', id: null }` or add 'pathway' to the return type)
- [x] `updateMap()`: replace `this.expandedStationId = null` with `this.focusedObject = { type: 'none' }` (no `applyFocusedObject` call needed here; layers are being fully rebuilt anyway)
- [x] Remove public `expandStation()` and `collapseStation()` — or keep private if still useful as helpers called from `applyFocusedObject`
- [x] `onEmptyClick` in `setupModuleCallbacks`: simplify to just `this.clearHighlights(); this.callbacks.onEmptyClick?.()` (no separate `collapseStation()` since `clearHighlights` → `applyFocusedObject({ type: 'none' })` handles collapse)
- [x] Basemap change handler (~line 352): restore from `focusedObject` instead of `currentHighlight`

**Gotcha:** `handlePathwayCreated` calls `layerManager.rebuildPathwaysSource(this.expandedStationId!)` — change to `this.deriveExpandedStation()`. Same for `handleStopDragComplete` (line 1023).

---

## Phase 2: Feature-State Node Highlighting

Goal: the focused stop grows in-place (larger circle + thicker stroke) using MapLibre feature state. Color stays the same per `location_type`. The old single-stop `stops-highlight` source/layer is removed.

- [x] In `src/modules/layer-manager.ts`: add `private focusedStopId: string | null = null`
- [x] Add `public setFocusedStop(stop_id: string | null): void`:
  - If `this.focusedStopId !== null` and source exists: `map.setFeatureState({ source: 'stops', id: this.focusedStopId }, { focused: false })`
  - Set `this.focusedStopId = stop_id`
  - If `stop_id !== null` and source exists: `map.setFeatureState({ source: 'stops', id: stop_id }, { focused: true })`
  - Wrap entire body in try/catch (source may not exist during initialisation)
- [x] In `addStopsBackgroundLayer`: replace the `circle-radius` paint expression with a feature-state-aware outer wrapper:
  ```
  'circle-radius': ['case',
    ['boolean', ['feature-state', 'focused'], false],
    <focused-sizes>,   // ~1.7× the normal sizes
    <normal-sizes>,    // current expression
  ]
  ```
  Where `<focused-sizes>` mirrors the existing type-based case but with values `17 / 8 / 8 / 11 / options.radius * 1.7` for types `1/2/3/4/default` respectively.
  Also apply to `circle-stroke-width`: `['case', ['boolean', ['feature-state', 'focused'], false], 4, options.strokeWidth]`
- [x] In `MapController.applyFocusedObject()` (from phase 1): add calls to `layerManager.setFocusedStop(obj.type === 'stop' ? obj.id : null)`
- [x] In `LayerManager.clearHighlights()`: add `this.setFocusedStop(null)` (clears focus when trips are highlighted, etc.)
- [x] Remove the single-stop branch of `LayerManager.highlightStop()` — the method can remain but should just delegate to `setFocusedStop` and skip the source/layer creation. The `stops-highlight` source+layer in that method is only created for the single-stop case; the trip path case lives in `addTripHighlightLayers`. So: gut `highlightStop()` body and replace with `this.setFocusedStop(stop_id)`; the layer-ordering and routing logic for trips stays in `addTripHighlightLayers` untouched.

**Gotcha:** `setFocusedStop` sets feature state by string ID. The 'stops' source already assigns `id: feature.properties?.stop_id` to each GeoJSON feature (line 129). No `promoteId` config is needed. But confirm `stop_id` strings are used as the feature ID (not coerced to numbers) — MapLibre string feature IDs work fine with `setFeatureState`.

---

## Phase 3: Feature-State Pathway Highlighting

Goal: the focused pathway grows wider in-place using MapLibre feature state on the 'pathways' source. Color stays the same per `pathway_mode`.

- [x] In `LayerManager.buildPathwaysGeoJSON()`: add `id: pw.pathway_id` to each feature object (as a top-level property alongside `type`, `geometry`, `properties`):
  ```ts
  { type: 'Feature', id: pw.pathway_id, geometry: {...}, properties: {...} }
  ```
- [x] Add `private focusedPathwayId: string | null = null` to `LayerManager`
- [x] Add `public setFocusedPathway(pathway_id: string | null): void`:
  - Clear old feature state on 'pathways' source if source exists and `focusedPathwayId !== null`: `map.setFeatureState({ source: 'pathways', id: this.focusedPathwayId }, { focused: false })`
  - Set `this.focusedPathwayId = pathway_id`
  - If `pathway_id !== null` and source exists: `map.setFeatureState({ source: 'pathways', id: pathway_id }, { focused: true })`
  - Wrap in try/catch
- [x] In `updatePathwaysLayer`: change `pathways-lines` paint `line-width` from `3` to:
  ```
  ['case', ['boolean', ['feature-state', 'focused'], false], 6, 3]
  ```
- [x] In `clearPathwaysLayer()`: call `this.setFocusedPathway(null)` before removing layers/source
- [x] In `MapController.applyFocusedObject()` (phase 1): add `layerManager.setFocusedPathway(obj.type === 'pathway' ? obj.id : null)` alongside the `setFocusedStop` call

**Discovery:** Added an extra `else if (newStation)` branch in `applyFocusedObject` to handle the case where the station stays expanded but you click a different pathway within it — pathway highlight updates without any station transition.

**Gotcha:** `setFocusedPathway` is called from `applyFocusedObject` on every focus change, but the 'pathways' source only exists when a station is expanded. The try/catch in `setFocusedPathway` handles the "not yet added" case. When the focused object is a pathway and the source doesn't exist yet, the pathway focus highlighting will be applied correctly because `updatePathwaysLayer` is called (in `applyFocusedObject`) after setting the new `focusedPathwayId`, and the feature IDs are present in the built GeoJSON, so subsequent `setFeatureState` calls will succeed once the source exists.

Actually — order matters: `applyFocusedObject` calls `updatePathwaysLayer` to add the source, then immediately sets the feature state. So: ensure `setFocusedPathway` is called *after* `updatePathwaysLayer` within `applyFocusedObject`.

**Post-merge note (merged main 2026-05-11):** Resolved conflicts in `gtfs-database.ts` (kept both `Pathways`/`Levels` from branch and `RiderCategories`/`FareMedia`/`FareProducts` from main), `map-controller.ts` (merged `Pathways` + `Agency` imports and agency-helpers), and `stop-view-controller.ts` (merged `LevelOption`/`escapeAttr` from branch with `normalizeAgencyId` from main). All phases 1–3 checklist items remain accurate.
