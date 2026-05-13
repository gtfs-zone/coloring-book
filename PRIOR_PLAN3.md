## Summary

Polish pass on the GTFS pathways feature. The station/pathways infrastructure from PRIOR_PLAN.md (DB, modal levels editor, expansion filter, pathway lines/clickarea) and PRIOR_PLAN2.md (unified `FocusedObject` + MapLibre feature-state-driven highlighting) is in place. This plan addresses the remaining UX gaps:

1. **Idle station icon** — currently a solid blue circle; replace with a slightly-larger white circle + black ✕ overlay so unfocused stations read as a marker rather than competing with stops.
2. **Coord-less nodes** — entrances/generic-nodes/platforms that lack `stop_lat`/`stop_lon` are currently silently dropped from the map and from pathway endpoints. Keep them in the station's child list and route their pathway endpoints up through the nearest ancestor that has coords.
3. **Hierarchy depth in breadcrumbs + navigate-up on empty click** — clicking a child stop should produce `Home → Station → Platform`; clicking a boarding area should produce `Home → Station → Platform → Boarding Area`. Empty-click while a child/pathway is focused walks one level up (back to its parent_station); empty-click on the station itself clears focus.
4. **Reuse related-object renderers** — stop view's child-list and pathway-list rows are bespoke. Add `STOP_REF_ROW` / `PATHWAY_REF_ROW` + `renderStopReference` / `renderPathwayReference` in `entity-references.ts` (mirroring `renderRouteReference`, `renderServiceReference`) and switch stop view to them.
5. **Station view groupings** — split the single "Child Stops" list into three sections: **Entrances/Exits** (`location_type=2`), **Platforms** (`location_type=0`), **Generic Nodes** (`location_type=3`). Boarding areas (`location_type=4`) do NOT appear here — they live under their parent platform, per GTFS spec.
6. **Platform view: Boarding Areas section** — when viewing a platform, list its boarding-area children.
7. **Pathways Out / Pathways In** — split the existing combined Pathways section into two: outgoing (`from_stop_id == stop_id`) and incoming (`to_stop_id == stop_id`). Row primary content = pathway mode label + the other stop ("Stairs to platform_a"); row click → pathway page; right-side "View Stop" button → the other stop. Mirrors the route-reference pattern (clickable row + explicit View button).

We also need to verify that focused-stop and focused-pathway feature-state visual growth (already implemented in PRIOR_PLAN2) still reads correctly with the new station-X icon — the X symbol's `text-size` will need to grow alongside the circle.

**Tradeoff considered for the station icon:** could use a raster `map.addImage()` for the X (more pixel-perfect at all zooms) but text labels with a Unicode ✕ glyph are simpler, scale via `text-size`, and avoid bundling an asset. Going with text.

## Relevant Context

**Map rendering (idle station icon, hierarchy filter, pathway routing through ancestor):**
- `src/modules/layer-manager.ts`:
  - `addStopsBackgroundLayer()` (lines 199–262) — circle paint expressions: change station case (`location_type === 1`) to white fill + black stroke, smaller radius (~6 idle / ~10 focused vs current 10/17).
  - `createStopsGeoJSON()` (lines 165–194) — properties currently include `parent_station`. Need a new derived `station_id` property (the topmost station ancestor) so the expanded-station filter can include grandchildren (boarding areas).
  - `setStopsFilter()` (lines 291–299) called from `map-controller.applyFocusedObject` with `parent_station` filter. Change to filter on `station_id` (climbs full chain).
  - `addStopsLayer()` (lines 106–160) — currently `validStops` filter drops coord-less stops. Need to keep coord-less stops in the underlying data list (for the panel) but not emit a Point feature for them. Either pre-split or just include them with a sentinel and filter in the layer paint. **Decision:** keep `validStops` as-is for map rendering (no-coord stops still don't render as circles), but have `buildPathwaysGeoJSON` fall back to ancestor coords for those endpoints. The panel queries the DB directly, so coord-less stops will appear there regardless.
  - `buildPathwaysGeoJSON()` (lines 606–665) — `coordMap` only contains stops with coords. For a missing endpoint, walk `parent_station` up the chain to find an ancestor with coords; use those coords as the endpoint.
- New layer: `stops-station-x` symbol layer rendering text ✕ centered on each station feature. Paint `text-color: #000000`, `text-size: ['case', ['boolean', ['feature-state', 'focused'], false], 18, 10]`, `text-allow-overlap: true`, `text-ignore-placement: true`. Filter: `['==', ['get', 'location_type'], 1]`. Insert above `stops-background` so the X paints on top of the white circle.

**Hierarchy depth (breadcrumbs + empty-click navigate-up):**
- `src/modules/page-state-manager.ts`:
  - `BreadcrumbLookup` interface (lines 28–33) — currently `getStopName(stop_id)`. Add `getStopAncestors(stop_id): Promise<Array<{ stop_id: string; stop_name: string }>>` returning the chain from outermost (closest-to-station) to immediate parent (excluding `stop_id` itself).
  - `buildBreadcrumbs()` (lines 250–409):
    - `case 'stop'` (lines 344–356) — replace flat `Home → Stop` with `Home → [ancestor breadcrumbs...] → Stop`. Each ancestor breadcrumb is `{ label: ancestorName, pageState: { type: 'stop', stop_id: ancestorId } }`.
    - `case 'pathway'` (lines 375–388) — look up the pathway's `from_stop_id`, get its ancestors + itself, then append `Pathway X` as the leaf. Adds a new lookup; see below.
- `src/modules/gtfs-breadcrumb-lookup.ts` (existing file — confirm via Read) — implementation of `BreadcrumbLookup`. Add `getStopAncestors` that queries `stops` table, follows `parent_station` recursively (max ~5 hops as safety), returns the chain ordered station-first.
- For pathway breadcrumbs we also need `getPathwayFromStopId(pathway_id)` (or expose the pathway row). Simplest: extend `BreadcrumbLookup` with `getPathwayAncestors(pathway_id): Promise<Array<{stop_id, stop_name}>>` that internally queries pathways → finds from_stop_id → calls `getStopAncestors` + appends from_stop itself.
- `src/modules/map-controller.ts`:
  - `setupModuleCallbacks` `onEmptyClick` (lines 305–308) — currently calls `clearHighlights()` unconditionally. Replace with `handleEmptyClick()`:
    - If `focusedObject.type === 'stop'`: look up the stop; if `parent_station` is non-empty, call `applyFocusedObject({type:'stop', id: parent_station})` AND navigate via pageStateManager. Else (station or root stop): clearHighlights + onEmptyClick callback.
    - If `focusedObject.type === 'pathway'`: look up pathway, find from_stop_id's parent_station; navigate there. (If somehow no parent, clear.)
    - Else: clearHighlights as before.

**Related-object renderers (shared helpers):**
- `src/utils/entity-references.ts` — currently exports `renderRouteReference`, `renderServiceReference`, `ROUTE_REF_ROW`, `SERVICE_REF_ROW`, `ENTITY_REF_BTN`. Add `renderStopReference` and `renderPathwayReference`, plus `STOP_REF_ROW`, `PATHWAY_REF_ROW`.
- `src/utils/entity-display.ts` — already has `getStopDisplay`. No pathway display helper exists; pathways don't have a `pathway_name` field — display is mode label + endpoints.
- `src/modules/page-content-renderer.ts` `addEventListeners` (lines 708–797) — currently wires `ROUTE_REF_ROW` and `SERVICE_REF_ROW` clicks. Add wiring for `STOP_REF_ROW` (calls `dependencies.onStopClick`) and `PATHWAY_REF_ROW` (calls `dependencies.onPathwayClick`).

**Stop view restructuring:**
- `src/modules/stop-view-controller.ts`:
  - `renderStopView()` (lines 63–133) — current decision tree: if station, show child stops + timetables; else show pathways + timetables. Expand to:
    - Station (loc_type=1): three sections (Entrances/Exits, Platforms, Generic Nodes) + timetables.
    - Platform (loc_type=0): Boarding Areas section + Pathways Out + Pathways In + timetables.
    - Other non-station (loc_type 2/3/4): Pathways Out + Pathways In + timetables.
  - `renderChildStopsSection()` (lines 341–387) — replace with three `renderTypedChildSection()` calls keyed by location_type. Each uses `renderStopReference`.
  - `renderPathwaysSection()` (lines 300–336) — split into `renderPathwaysOutSection()` and `renderPathwaysInSection()`, both using `renderPathwayReference`. Each row label = "{mode} {to|from} {other stop display}".
  - `getChildStops()` (lines 235–247) — keep as-is (returns `parent_station == station_id`).
  - `getConnectedPathways()` (lines 269–295) — refactor to return `{out: Pathways[], in: Pathways[]}`.
  - `PATHWAY_MODE_LABELS` (lines 249–257) and `LOCATION_TYPE_LABELS` (lines 259–264) — keep; move PATHWAY_MODE_LABELS to a shared util if cleaner (it's also duplicated in `pathway-view-controller.ts` lines 12–20).
  - `addEventListeners()` (lines 459–509) — `child-stop-btn` and `pathway-view-btn` handlers are bespoke; will be replaced by the global `STOP_REF_ROW` / `PATHWAY_REF_ROW` wiring in page-content-renderer. Delete the bespoke handlers.

**Invariants to preserve:**
- All user-initiated DB writes still go through `patchManager.record*` — this plan doesn't add new DB writes, only renders, queries, and map filter changes.
- Feature-state highlighting on focused stop/pathway must keep working — when the station-X symbol layer is added, ensure its `text-size` paint expression also reads `feature-state.focused` so the X grows with the circle.
- The "stops" source already promotes `stop_id` as the GeoJSON feature `id` (layer-manager.ts line 131) — keep that. Same for "pathways" with `pathway_id` (line 649).
- Coord-less stop handling: a stop with no coords still has a DB row (queried by name in the panel) but no GeoJSON feature on the map. Pathways referencing it route through its nearest coord-having ancestor.

---

## Phase 1: Idle station icon (white + ✕) and ancestor-aware stops filter

Goal: Stations idle as slightly-larger white circles with a centered black ✕. The filter that shows "the station + its full descendant tree" works for grandchildren (boarding areas) too.

- [x] In `src/modules/layer-manager.ts` `createStopsGeoJSON()`: add a derived property `station_id` to each feature's `properties`. Compute it by walking `parent_station` up the chain: for a stop with `location_type=1`, `station_id = stop_id`; otherwise climb `parent_station` until reaching a `location_type=1` ancestor (or hit a coord-less root); cap at 5 hops as a safety. Store empty string if no ancestor station is found.
- [x] In `addStopsBackgroundLayer()`: update the `circle-radius` and `circle-color` case expressions so stations are:
  - idle: `circle-color: #ffffff` (white fill), `circle-stroke-color: #000000`, `circle-stroke-width: 2`, `circle-radius: 6`
  - focused: `circle-radius: 10` (vs current focused 17 — smaller, "slightly bigger than non-station focused size" which is `radius * 1.7 ≈ 6.8`)
  - non-station idle/focused unchanged
- [x] Add a new method `addStationXLayer()` called from `addStopsLayer()` after the background layer is added. It adds a `symbol` layer with id `stops-station-x`:
  - `source: 'stops'`
  - `filter: ['==', ['get', 'location_type'], 1]`
  - `layout`: `text-field: '✕'`, `text-allow-overlap: true`, `text-ignore-placement: true`, `text-anchor: 'center'`, `text-size: ['case', ['boolean', ['feature-state', 'focused'], false], 16, 10]`, `text-font: ['Open Sans Regular', 'Arial Unicode MS Regular']`
  - `paint`: `text-color: '#000000'`
  - Include this layer id in `clearAllLayers()` and `setStopsFilter()` so filter updates and teardowns include it.
- [x] In `setStopsFilter()`: extend to also update `stops-station-x` layer's filter (compose with the location_type=1 base filter — when active filter is the default, the station-x filter is just `['==', ['get', 'location_type'], 1]`; when active filter is the station-expanded `station_id == X` filter, combine with `all`: `['all', ['==', ['get', 'location_type'], 1], ...activeStopsFilter]`).
- [x] In `MapController.applyFocusedObject()` (`src/modules/map-controller.ts`): change the station-expanded filter from filtering on `parent_station` to filtering on the new `station_id` derived property (uses `any` + `stop_id == newStation || station_id == newStation` to also include the station itself).
- [x] In `layer-manager.ts` `clearAllLayers()`: add `'stops-station-x'` to `layersToRemove`.

**Discoveries:** `createStopsGeoJSON` was updated to accept an optional `allStops` parameter so `station_id` traversal can walk stops that lack coords (which are excluded from `validStops`). Both callers (`addStopsLayer` and `updateStopsData`) now pass the full stops array. The `circle-stroke-color` became a case expression so stations get `#000000` while other stop types keep the default stroke.

**Gotcha:** the station's circle paint now has `circle-color: #ffffff`. The existing focused state for stations should still grow it (radius 10) but the color should NOT change. The `circle-color` case expression already only checks `location_type`, not `feature-state.focused`, so this is unchanged — just confirm the case order.

**Gotcha 2:** `text-font` may not be available depending on basemap. If MapLibre throws on missing glyph, fall back to omitting `text-font` or providing a definitely-shipped font. Check the active basemap's `glyphs` URL first.

---

## Phase 2: Coord-less nodes routed through ancestor coords for pathway endpoints

Goal: A pathway endpoint that has no `stop_lat`/`stop_lon` (typically an entrance or generic node with missing data) still draws — its line endpoint snaps to the nearest ancestor that has coords.

- [x] In `src/modules/layer-manager.ts` `buildPathwaysGeoJSON()` (lines 606–665):
  - Build a parent-chain lookup: `parentByStopId: Map<string, string>` where value is `parent_station` (skipping empty strings).
  - Add a helper `resolveCoord(stop_id: string): [number, number] | null` that returns `coordMap.get(stop_id)` if present; otherwise walks `parentByStopId` up the chain (cap 5 hops) and returns the first ancestor's coord, or null if none found.
  - Replace the `const from = coordMap.get(pw.from_stop_id)` / `coordMap.get(pw.to_stop_id)` calls with `resolveCoord(pw.from_stop_id)` / `resolveCoord(pw.to_stop_id)`.
  - [x] Keep the "return early if either is null" guard — pathways that still can't resolve get skipped.

**Gotcha:** The pathway line will visually appear to start/end at the ancestor station. That's intentional. If both endpoints resolve to the same ancestor (degenerate zero-length line), still emit it — MapLibre will simply not render anything visible but it should not crash. (Optional safety: filter out zero-length lines by comparing coords; not required.)

---

## Phase 3: Breadcrumb depth and empty-click navigate-up

Goal: Selecting a child stop or pathway shows the full ancestor chain in the breadcrumbs. Empty-click while a child/pathway is focused walks one level up rather than clearing focus entirely.

- [x] In `src/modules/page-state-manager.ts` `BreadcrumbLookup` interface (lines 28–33): add
  ```ts
  getStopAncestors: (stop_id: string) => Promise<Array<{ stop_id: string; stop_name: string }>>;
  getPathwayAncestors: (pathway_id: string) => Promise<Array<{ stop_id: string; stop_name: string }>>;
  ```
  Each returns the chain ordered outermost-first (topmost station first), EXCLUDING the leaf object itself.
- [x] In `buildBreadcrumbs()`:
  - `case 'stop'` (lines 344–356): if `getStopAncestors` is present, fetch ancestors, prepend each as a breadcrumb (`{ label: ancestor.stop_name, pageState: { type: 'stop', stop_id: ancestor.stop_id } }`) between `Home` and the leaf stop. Leaf stop entry unchanged.
  - `case 'pathway'` (lines 375–388): fetch `getPathwayAncestors(pathway_id)` to get the chain (station → ... → from_stop), prepend each. Leaf stays as `Pathway {pathway_id}`. If lookup returns empty, fall back to flat `Home → Pathway X`.
- [x] In `src/modules/gtfs-breadcrumb-lookup.ts` (Read first to confirm shape): implement `getStopAncestors`:
  - Fetch the stop. If no `parent_station`, return `[]`.
  - Walk up: at each step query `stops.txt` for the parent's row, push `{stop_id, stop_name}`, follow its `parent_station`. Cap at 5 iterations. Reverse the list before returning so outermost ancestor is first.
  - Cache results in a per-call map if performance matters (probably not — chains are 1–3 deep).
- [x] In `gtfs-breadcrumb-lookup.ts` `getPathwayAncestors`:
  - Query `pathways.txt` for the row by `pathway_id`. If not found, return `[]`.
  - Call `getStopAncestors(from_stop_id)`. Then push `{stop_id: from_stop_id, stop_name}` as the last ancestor (since the pathway's "parent" is the from-stop). Return.
- [x] In `src/modules/map-controller.ts`: replace the `onEmptyClick` arrow at lines 305–308 with a call to a new private method `handleEmptyClick()`. Logic:
  ```ts
  private async handleEmptyClick(): Promise<void> {
    const obj = this.focusedObject;
    const stops = this.gtfsParser?.getFileDataSyncTyped<Stops>('stops.txt') || [];
    const pathways = this.gtfsParser?.getFileDataSyncTyped<Pathways>('pathways.txt') || [];

    let parentStopId: string | null = null;
    if (obj.type === 'stop') {
      const stop = stops.find((s) => s.stop_id === obj.id);
      parentStopId = stop?.parent_station ? String(stop.parent_station) : null;
    } else if (obj.type === 'pathway') {
      const pw = pathways.find((p) => p.pathway_id === obj.id);
      const from = pw ? stops.find((s) => s.stop_id === pw.from_stop_id) : null;
      // Pathway's "parent" = its from-stop; navigate up to that stop (not its parent)
      parentStopId = from?.stop_id ?? null;
    }

    if (parentStopId) {
      this.applyFocusedObject({ type: 'stop', id: parentStopId });
      if (this.pageStateManager) {
        await this.pageStateManager.setPageState({ type: 'stop', stop_id: parentStopId });
      }
    } else {
      this.clearHighlights();
      this.callbacks.onEmptyClick?.();
    }
  }
  ```
  Wire this via `onEmptyClick: () => { void this.handleEmptyClick(); }` in `setupModuleCallbacks`.

**Gotcha:** Going from a pathway → its from-stop (not its from-stop's parent) is one level up. From the from-stop, another empty-click then goes to its parent_station. This matches the user's mental model where pathway depth = stop depth + 1.

**Gotcha 2:** The `onEmptyClick` callback used to call `this.callbacks.onEmptyClick?.()` (passing the empty click up to UI). Keep that for the cleared case (top-level), but NOT when we navigate-up — the panel will re-render via the page state change naturally.

---

## Phase 4: Shared `renderStopReference` and `renderPathwayReference` helpers

Goal: Stop view's child-list and pathway-list rows use the same `entity-references.ts` helpers as agency/service views.

- [x] In `src/utils/entity-references.ts`:
  - Add `STOP_REF_ROW = 'stop-ref-row'` and `PATHWAY_REF_ROW = 'pathway-ref-row'` constants.
  - Add `renderStopReference(stop: Record<string, unknown>, opts: { locationTypeLabel?: string; viewLabel?: string }): string`:
    ```ts
    // Renders: <div class="...flex... STOP_REF_ROW" data-stop-id="X">
    //   <stop name (id)> <badge locationTypeLabel> <button "View"/>?>
    // </div>
    ```
    Uses `renderCardLabel(getStopDisplay(stop as Record<string, string>))` for the label. If `viewLabel` is passed, render a "View" button with class `ENTITY_REF_BTN` and `data-stop-id` so existing wiring picks it up; otherwise the whole row is the click target.
  - Add `renderPathwayReference(pathway: Record<string, unknown>, opts: { modeLabel: string; otherStop?: Record<string, unknown>; direction: 'to' | 'from'; viewStopButton?: boolean }): string`:
    - Primary label: `"{modeLabel} {direction} {otherStop display}"`, e.g. "Stairs to platform_a (platform_a)".
    - If `otherStop` is undefined (orphan reference), just show the other stop id from the pathway row.
    - Adds `data-pathway-id="..."` on the row.
    - If `viewStopButton` is true, render a "View Stop" button with class `ENTITY_REF_BTN` and `data-stop-id="<other_stop_id>"` so the same wiring picks it up.
- [x] In `src/modules/page-content-renderer.ts` `addEventListeners()` (lines 708–797): add two new selector blocks:
  - `STOP_REF_ROW` clicks → call `dependencies.onStopClick(stop_id)`.
  - `PATHWAY_REF_ROW` clicks → call `dependencies.onPathwayClick(pathway_id)` (only if defined).
  - Also extend the existing `ENTITY_REF_BTN` handler (lines 746–755) to handle `data-stop-id` (call `dependencies.onStopClick`) in addition to the existing `data-service-id` case. `e.stopPropagation()` already prevents the row click from also firing.

**Gotcha:** `ENTITY_REF_BTN` is reused across route/service/stop "View" buttons. The handler currently checks `data-service-id`. Add an `if (stop_id)` branch first, fall through to `service_id` case. Keep `e.stopPropagation()` so the row click handler doesn't also fire.

---

## Phase 5: Station view with three grouped child-stop sections

Goal: The station view (`location_type=1`) displays its children in three labeled sections: Entrances/Exits, Platforms, Generic Nodes. Boarding areas are NOT shown here.

- [x] In `src/modules/stop-view-controller.ts`:
  - Add a private helper `groupChildrenByLocationType(children: Stops[]): { entrances: Stops[]; platforms: Stops[]; genericNodes: Stops[] }`. Match by integer `location_type`: 2 → entrances, 0 → platforms, 3 → genericNodes. Skip 4 (boarding areas) silently — they don't belong here.
  - Replace `renderChildStopsSection()` with three calls to `renderTypedChildSection(title: string, children: Stops[]): string`. Each uses `renderStopReference` from `entity-references.ts`. Sections are omitted if their group is empty.
  - Updated `renderStopView()` station branch to call `renderChildStopsSections(childStops)`.
  - Deleted the bespoke `.child-stop-btn` event handler; global `STOP_REF_ROW` wiring in page-content-renderer covers it.
  - Removed `LOCATION_TYPE_LABELS` (now unused).

**Gotcha:** Empty groups produce an empty section (don't render the heading). If a station has only platforms, only that section appears.

---

## Phase 6: Non-station stop view — Pathways Out / In + Boarding Areas (if platform)

Goal: Non-station stop view shows two pathway sections (out + in), with rich labels. Platform stops additionally show their boarding-area children.

- [x] In `src/modules/stop-view-controller.ts`:
  - Refactor `getConnectedPathways()` (lines 269–295) to return `{ out: Pathways[]; in: Pathways[] }`. Currently de-dups across both — keep separate from now on. Also handle bidirectional pathways: a pathway with `is_bidirectional === 1` and `from_stop_id == stop_id` shows in BOTH Out and In sections (because traffic flows both ways); similarly if `to_stop_id == stop_id`. **Decision:** for simplicity in v1, treat the row direction strictly by `from`/`to` regardless of bidirectionality. The mode label is the visual cue. (Revisit if confusing.)
  - Add a helper `renderPathwaySection(title: string, pathways: Pathways[], direction: 'to' | 'from', currentStopId: string, otherStopLookup: Map<string, Stops>): string` that:
    - Empties → skips the section.
    - Each row: compute `otherStopId = direction === 'to' ? pathway.to_stop_id : pathway.from_stop_id`. Look up `otherStop` in `otherStopLookup`. Render with `renderPathwayReference({ modeLabel, otherStop, direction, viewStopButton: true })`.
  - Build `otherStopLookup` once per render: collect all `from_stop_id`/`to_stop_id` from `out + in` lists, batch-query stops table (already O(N) — using existing `queryRows` with a stop_id-by-stop_id loop is fine for typical pathway counts).
  - Add `renderBoardingAreasSection(platformId: string): Promise<string>`: query `stops` for `parent_station == platform_id`, filter to `location_type === 4`, render as a section using `renderStopReference`. Empty → skip.
  - Update `renderStopView()` non-station branch (line 123):
    - If `locationType === 0` (platform): render Boarding Areas section first, then Pathways Out, then Pathways In, then timetables.
    - Else (entrance/exit, generic node, boarding area): render Pathways Out, Pathways In, timetables.
  - Delete the bespoke `.pathway-view-btn` handler in `addEventListeners()` (lines 473–484); the global `PATHWAY_REF_ROW` wiring in page-content-renderer takes over for the row, and the `ENTITY_REF_BTN` handler takes over for the "View Stop" button.

**Gotcha — boarding area parent:** Per GTFS spec, a boarding area's `parent_station` is the platform_id (not the station_id). So when we list boarding areas, we query `parent_station == platform_id` (not the full station chain). The Phase 1 `station_id` derived property on stops is still the top-level station, used only for the map filter.

**Gotcha — pathway label:** Use the pathway mode label (e.g., "Stairs") + direction word + other stop display. Example primary text: `"Stairs to Platform A (platform_a)"`. If the other stop has no `stop_name`, falls back to `(stop_id)` only.

**Gotcha — eventListener cleanup:** the existing `pathway-view-btn` selector and `child-stop-btn` selector handlers in `stop-view-controller.ts` add listeners on individual elements. Removing those without replacing breaks current behavior — make sure to land Phase 4 (which adds the global row-click wiring) before / together with Phase 5 and 6.

---

## Notes / sequencing

- Phases 1 and 2 are map-layer-only and can land in either order; both are independent of phases 3–6.
- Phase 3 (breadcrumb + empty-click) depends on the existing focused-object infra from PRIOR_PLAN2 — should be straightforward. Recommend after Phase 1 so visual confirms the navigation feel.
- Phase 4 must land before (or with) Phases 5 and 6 because they delete the bespoke handlers.
- After all phases: smoke-test with a feed that has nested boarding areas, coord-less entrances, and pathways crossing station boundaries to confirm nothing regresses.
