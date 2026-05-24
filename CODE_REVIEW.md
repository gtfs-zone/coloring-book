# Code Review — `96-gtfs-pathways` vs `main`

Multi-angle review (5 finder angles, partial verify) over ~2700 added lines introducing pathways, levels, station hierarchy, and stop-coords layout.

Findings grouped by category; each is `file:line — what / why it matters`. **(C)** = confirmed by reading the code; **(P)** = plausible mechanism, not fully verified.

---

## Performance (your priority #1)

### 1. `buildStopCoordResolver` rebuilt from scratch on every map update **(C)**
`src/utils/stop-coords.ts` — `buildStopCoordResolver(stops, pathways)` walks all stops, builds `byId` Maps, finds orphans, then runs up to **50 Tutte iterations**. It is called from `createStopsGeoJSON` (every `updateStopsData`) **and** from `buildPathwaysGeoJSON` (every station expand and after every drag). For a 10k-stop feed it's a lot of needless work per drag.
**Fix:** cache the resolver keyed on a stops/pathways version counter; invalidate on patches that touch stops or pathways.

### 2. `Array.shift()` inside BFS in `stop-coords.ts` **(C)**
`src/utils/stop-coords.ts` — BFS uses `queue.shift()` which is O(n) per call → O(n²) BFS per component. Combined with #1 (rebuilt every drag) this can stall the main thread on large stations.
**Fix:** use an index pointer (`let head = 0; const cur = queue[head++]`) or a small deque.

### 3. Sequential `await` in a for-loop in `stop-view-controller.ts` **(P)**
When rendering a stop view with N connected pathway endpoints, each endpoint's stop row is fetched via a separate `await db.queryRows('stops', { stop_id })`. N round-trips serialized.
**Fix:** `Promise.all` over the set, or fetch all stops once and look up locally.

### 4. `getStopAncestors` queries each ancestor twice **(P)**
`src/modules/gtfs-breadcrumb-lookup.ts` — each loop iteration queries `currentId` and then `parentId`, and the next iteration re-queries that parent as the new `currentId`. Doubles IDB round-trips for breadcrumbs (recomputed on every navigation).
**Fix:** carry the parent row from the previous iteration forward.

### 5. `deriveExpandedStation()` calls hit `getFileDataSyncTyped` + linear `.find()` **(P)**
`src/modules/map-controller.ts` — `applyFocusedObject` calls `deriveExpandedStation()` twice per focus change; `InteractionHandler.handleAddStopClick` calls `getExpandedStationId()` again on every click. Each call returns shallow copies of all stops (copy-on-read invariant) and does an O(N) `.find()`. Hot path during add-stop / add-pathway tool use.
**Fix:** memoize the expanded-station id on `MapController`, refresh only when focus changes.

### 6. Duplicate parent-chain walks: `resolveStationId` vs `buildStopCoordResolver` **(P)**
`src/modules/layer-manager.ts` — `createStopsGeoJSON` walks parent chains per stop with its own `stopById`, while the resolver in stop-coords.ts walks the same chains with its own map. For an N-stop feed this is 2× Map builds + 2× walks per refresh.
**Fix:** have `buildStopCoordResolver` expose `resolveStationId(stopId)` and use that single source of truth.

---

## Simplicity (your priority #2)

### 7. `findCoordAncestor` called twice per stop in orphan + pinned grouping **(C)**
`src/utils/stop-coords.ts` lines ~117 and ~140 — two separate iterations over all stops, each calling `findCoordAncestor`. Same data classified twice.
**Fix:** single pass that classifies pinned-vs-orphan and updates both maps inline.

### 8. `getCurrentHighlight` silently lossy for pathways **(C)**
`src/modules/map-controller.ts` — the unified `focusedObject` supports `'pathway'`, but `getCurrentHighlight()`'s return union is still `'none' | 'route' | 'stop' | 'trip'` and the `'pathway'` branch returns `{ type: 'none', id: null }`. Either widen the type or rip out `getCurrentHighlight` entirely (the simpler move — most callers should consult `focusedObject` directly).

### 9. ~~Basemap-change handler restores stop/route/trip focus but not `pathway`~~ **FIXED**
Reset `focusedObject` to `none` before calling `applyFocusedObject(obj)` so the old→new station comparison detects a real change and re-expands the station (recreating the pathway layer). Route/trip still get their additional highlight calls after.

### 10. `StopViewDependencies` lost its `onTimetableClick` callback — now coupled to delegated `SERVICE_REF_ROW` listener in `page-content-renderer.ts` **(P)**
This makes `StopViewController` only work when embedded inside the renderer that wires the delegate. Either restore the direct callback (simpler contract) or document the coupling.

---

## Correctness Bugs

### 11. Falsy-zero on stop coords (4 sites, all introduced by this branch) **(C)**
`src/modules/map-controller.ts:692`, `:762`, `:873`, `:924` — all have shape `if (stop.stop_lat && stop.stop_lon)`. A stop at lat=0 or lon=0 (equator / prime meridian / unset numeric coord) is silently skipped from flyTo / fit-bounds. CLAUDE.md explicitly calls this out as a pattern to avoid.
**Fix:** `Number.isFinite(stop.stop_lat) && Number.isFinite(stop.stop_lon)`, or reuse `hasValidCoords()` from `stop-coords.ts`.

### 12. Pathway hover listeners leak on every expand→collapse cycle **(C)**
`src/modules/layer-manager.ts:835-842` — `updatePathwaysLayer` adds `mouseenter`/`mouseleave` on `pathways-lines` and `pathways-clickarea` inside the `!getLayer` guard, but `clearPathwaysLayer` (line 854) only removes the **layers**. On re-add the guard re-fires and stacks another pair of handlers. After N expand/collapse cycles you have 4N closures retained, all firing on cursor over pathways.
**Fix:** in `clearPathwaysLayer`, also `map.off('mouseenter'/'mouseleave', layerId, ...)` — or use stable, top-level handler functions so `off` works without leaking references.

### 13. Delete-pathway click listener leaks on every pathway render **(C)**
`src/modules/pathway-view-controller.ts:168` — `addEventListeners(container)` does `container.addEventListener('click', ...)`. The container DIV is reused across renders (only `innerHTML` is replaced), so after N pathway navigations a single delete click fires the handler N times → N `onDeletePathway` calls with the same id.
**Fix:** mirror the other delegated listeners in `page-content-renderer.ts:711` — query `.delete-pathway-btn` inside the container and attach to the button (or attach to container once at construction, not per render).

### ~~14. `levels-controller.ts` — `Number(levelIndex)` of garbage input silently stores `NaN` **(C)**~~
~~Validation only rejects `levelIndex === ''`. `Number('abc')` returns NaN, gets written to IndexedDB, and the sort comparator `Number(a.level_index ?? 0) - Number(b.level_index ?? 0)` returns NaN for any NaN row → `Array.sort` leaves order undefined.~~
~~**Fix:** reject `Number.isNaN(Number(levelIndex))` at input time, and treat non-finite `level_index` defensively in the comparator.~~ **Fixed.**

### ~~15. `interaction-handler.ts:366` — `queryRenderedFeatures` without the existence guard used elsewhere **(C)**~~
~~The other call sites (line 123, 177) route through `queryFeaturesOnLayers` (defensive against missing layers — added in commit `637058f`). The add-pathway handler bypasses that and will throw on basemap-change or transient teardown.~~
~~**Fix:** route through `queryFeaturesOnLayers`.~~ **Fixed.**

### 16. Unescaped HTML in level rows and data-stop-id / data-pathway-id attrs **(C)**
- `src/modules/levels-controller.ts` interpolates `${l.level_name}` and `${l.level_id}` raw into table cells / `data-level-id`.
- `src/utils/entity-references.ts:144,174,177` interpolates `${stop.stop_id}` / `${pathway.pathway_id}` raw into `data-*` attributes.
GTFS CSV permits these strings to contain `"` and `<`. With a malicious or just unusual feed, attributes break and downstream click handlers read truncated ids.
**Fix:** apply `escapeAttr` / `escapeHtml` (already used elsewhere in this branch — e.g. `pathway-view-controller.ts`).

---

## Lower-confidence / worth a look

- **`createPathway` defensive branch allocates a fresh `data: []` that is not the same reference as the virtual table's registered `flat`** — if `gtfsData['pathways.txt']` is ever missing when this runs, writes go to one array and reads to another. Either drop the defensive branch (fail loudly) or re-register the virtual table.
- **`handleDeletePathway` updates the DB but not `pathways.txt` content blob or the live pathways layer** — `createPathway` calls `updatePathwaysFileContent` + `rebuildPathwaysSource`; the symmetric delete path should too.
- **Validator builds the full Tutte resolver just to ask "does this stop reach a coord-having ancestor?"** — cheaper boolean variant suffices; same compute hit on every validation run.
- **Stop validator collapsed two separate "stop_lat required" / "stop_lon required" errors into one joint check** — a half-filled row (one coord present, one empty) may now be reported as fully missing or downgraded to a warning. Worth a manual check against a half-coord fixture.

---

Total: 16 findings (10 perf/simplicity, 6 correctness) + 4 lower-confidence.
