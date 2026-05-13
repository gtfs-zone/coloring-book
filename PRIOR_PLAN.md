## Summary

This feature adds full GTFS station-hierarchy and pathways support to the editor. Stops with a `parent_station` are hidden on the main map until the parent station is selected; selecting a station zooms in and reveals all child stops with distinct icons per `location_type`. Pathways (walkways, stairs, escalators, etc.) are drawn as lines between child stops inside a station and are selectable for editing. A two-stop "add pathway" tool mirrors the existing "add stop" button. Levels are managed in a standalone modal launched from the nav bar, and `level_id` on stops becomes a dropdown. The approach leans on the existing modal system, `showModal`, the MapLibre source/layer pattern already used for stops and routes, and the existing `patchManager`-gated write flow.

## Relevant Context

**Types / spec already complete:**
- `src/gtfs-spec/files/pathways.ts` — full field spec for `pathways.txt`
- `src/gtfs-spec/files/levels.ts` — full field spec for `levels.txt`
- `src/types/gtfs.ts` — `Pathways` and `Levels` type aliases, `GTFS_TABLES.PATHWAYS / LEVELS`
- `src/utils/gtfs-primary-keys.ts` lines 172-182 — primary keys already declared

**Database (IndexedDB via `idb`):**
- `src/modules/gtfs-database.ts` — `GTFSStoreName` union (lines 40-58), `GTFSDBSchema` interface (lines 67-152), `addIndexesForTable()` (lines 405-508), schema version = 8 (line 175)
- `stops` object store already has indexes on `location_type` (line 428) and `parent_station` (lines 429-430)

**Map rendering:**
- `src/modules/layer-manager.ts` — `addStopsLayer()` (lines 87-141), `addStopsBackgroundLayer()` (lines 176-210), `addStopsClickAreaLayer()` (lines 211-230). All stops currently rendered identically.
- `src/modules/interaction-handler.ts` — `handleNavigationClick()` (lines 150-187), drag logic (lines 289-400), `handleAddStopClick()` (lines 192-284). Stop creation hardcodes `location_type: 0` and `parent_station: ''` (lines 234-241).
- `src/modules/map-controller.ts` — map state, owns `layerManager` and `interactionHandler`

**Stop detail panel:**
- `src/modules/stop-view-controller.ts` — `renderStopView()` (lines 39-69), `renderStopProperties()` (lines 74-101). Uses generic `renderEntityFields` — all stop fields already render, but no relational sections for children/pathways.

**UI / modals:**
- `src/modules/modal-utils.ts` — `showModal(options)` (lines 19-104)
- `src/modules/ui.ts` — `toggleAddStopMode()` (lines 1242-1253), `updateMapToolButtonState()`
- `src/index.html` — add-stop button at lines 433-452
- `src/modules/gtfs-parser.ts` — `createStop()` (lines 1157-1185)

**Search:**
- `src/modules/search-controller.ts` line 187 — already uses `location_type` for emoji (🚉 vs 🚏); no other use in modules

---

## Phase 1: Database Schema + Import Foundation

Add `pathways` and `levels` as first-class IndexedDB object stores so the rest of the app can read/write them, and ensure CSV import/export round-trips correctly.

- [x] In `src/modules/gtfs-database.ts` — add `'pathways'` and `'levels'` to the `GTFSStoreName` union (after line 58)
- [x] In `GTFSDBSchema` interface — add store definitions:
  ```ts
  pathways: { key: string; value: Pathways; indexes: { from_stop_id: string; to_stop_id: string; pathway_mode: number } }
  levels:   { key: string; value: Levels;   indexes: { level_index: number } }
  ```
- [x] In `addIndexesForTable()` — add `case 'pathways':` (indexes: `from_stop_id`, `to_stop_id`, `pathway_mode`) and `case 'levels':` (index: `level_index`)
- [x] Bump DB schema version from 8 → 9 (triggers `onupgradeneeded` for existing users)
- [x] Smoke-test: import a GTFS feed that contains `pathways.txt` and `levels.txt` and verify rows appear in the IndexedDB viewer (DevTools → Application → IndexedDB)

**Gotcha:** The database `initialize()` method loops through `GTFS_FILES` to create stores dynamically. Confirm `pathways.txt` and `levels.txt` are already in `GTFS_FILES` (they should be, per the spec index), otherwise add them.

---

## Phase 2: Levels Management UI

A modal accessible from the nav bar lets users create, edit, and delete levels. The `level_id` field in the stop editor becomes a dropdown populated from the levels table.

- [x] In `src/index.html` — add a "Levels" nav button (near the existing nav items), e.g. `<button id="levels-btn" class="btn btn-sm">Levels</button>`
- [x] Create `src/modules/levels-controller.ts` — a controller class with:
  - `showLevelsModal()` — fetches all levels from DB, renders them in a `showModal` call as an editable table (level_id, level_index, level_name) with Add / Delete row actions. Each cell edit triggers `patchManager.recordUpdate()` + DB write.
  - `addLevel()` — creates a new level via `showModal` (level_id, level_index, level_name fields), calls `gtfsParser`-style `insertRows` + `patchManager.recordInsert()`
  - `deleteLevel(level_id)` — removes from DB + `patchManager.recordDelete()`
  - `getLevelOptions()` — returns `Array<{value: string, label: string}>` for dropdown use
- [x] Wire `levels-btn` click → `levelsController.showLevelsModal()` in `src/index.ts`
- [x] In `src/modules/stop-view-controller.ts` — override the rendering of the `level_id` field: after `renderEntityFields` runs, replace the `level_id` text input with a `<select>` populated from `levelsController.getLevelOptions()`. On change, write via the patch system.

**Gotcha:** If no levels exist, the `level_id` dropdown should show an empty option plus a hint "Add levels via nav bar".

**Implementation notes:**
- `LevelsController` is wired through `index.ts → browseNavigation.setLevelsController() → PageContentRenderer dependency → StopViewDependencies.getLevelOptions`. The levels button in the nav is hidden on mobile (md:flex).
- The `level_id` select uses a regex replace on the HTML string returned by `renderEntityFields`, targeting `data-field="level_id"`. The resulting `<select>` keeps all data attributes so the existing `attachFormPatchListeners` bridge handles change events automatically.
- `showLevelsModal` shows the table then chains to `showAddLevelModal` for creation — no inline cell editing (add/delete only). This is simpler and sufficient for the use case.
- The `savedLevel*` pattern in `showAddLevelModal` pre-fills inputs if the modal is re-opened (after a validation failure), but since `showModal` always creates fresh DOM this pattern doesn't actually matter in practice — left in as harmless.

---

## Phase 3: Stop Hierarchy on the Map

Child stops (location_type ≠ 1, with a `parent_station`) are hidden on the main map. Clicking a station zooms in and reveals its children with distinct icons. Clicking elsewhere returns to normal view.

### 3a: Default rendering — hide child stops

- [x] In `layer-manager.ts` `addStopsBackgroundLayer()` and `addStopsClickAreaLayer()` — add a MapLibre filter expression. Filter stored as `activeStopsFilter` on LayerManager; default shows empty-parent-station stops and all stations (location_type=1).
- [x] Differentiate stop symbols by `location_type` via `circle-color` case expressions: station=blue (#3b82f6), entrance=amber (#f59e0b), generic node=purple (#8b5cf6), boarding area=green (#10b981), platform=white. Fixed existing bug where comparisons used string `'1'` instead of number `1`.

### 3b: Station-expanded view state

- [x] Add `expandedStationId: string | null` to `MapController`
- [x] `expandStation(stationId)` — filters map to station+children only, flies to bounding box; `collapseStation()` — resets to default filter
- [x] `handleStopClick()` in `MapController` checks location_type; if station, calls expand/collapse before navigating to stop view (both expand and navigate happen together)
- [x] `onEmptyClick` callback calls `collapseStation()`; `updateMap()` also resets filter on feed reload
- [x] Station stop view shows "Child Stops" section; child stop rows have View buttons that call `onStopClick` (wired via `ContentRendererDependencies.onStopClick`)

### 3c: Stop creation in station context

- [x] `handleAddStopClick()` — checks `getExpandedStationId` callback; if a station is expanded, shows location_type dropdown (Platform/Entrance/Generic Node/Boarding Area) and pre-fills `parent_station`; modal title changes to "New Child Stop"

**Implementation notes:**
- `parent_station` field added to GeoJSON properties in `createStopsGeoJSON` so filters can operate on it
- `FilterSpecification` imported from maplibre-gl for proper typing; `setStopsFilter(filter: FilterSpecification | null)` on LayerManager
- `setGetExpandedStationId` callback pattern used in InteractionHandler to avoid circular dependency with MapController

---

## Phase 4: Pathway Visualization

When a station is expanded, draw pathway lines between its child stops. Pathway lines are selectable and open the pathway in the editor panel.

- [x] In `layer-manager.ts` — add `addPathwaysLayer()`:
  - Build a GeoJSON FeatureCollection of LineStrings: for each pathway row, fetch the `from_stop` and `to_stop` coordinates from the stops source, create a line feature with all pathway fields as properties
  - Add MapLibre source `'pathways'` and a line layer `'pathways-lines'`
  - Style by `pathway_mode` with different colors (green=walkway, orange=stairs, cyan=moving sidewalk, purple=escalator, blue=elevator, red=fare gate, gray=exit gate)
  - Add a wider invisible click-area line layer `'pathways-clickarea'`
- [x] In `layer-manager.ts` — add `updatePathwaysLayer(stationId)` called when a station is expanded: builds pathway GeoJSON for the expanded station, adds layers underneath stops; also `clearPathwaysLayer()` and `rebuildPathwaysSource(stationId)` for cleanup and drag updates
- [x] In `interaction-handler.ts` — in `handleNavigationClick()`, add a query against `'pathways-clickarea'`. If a pathway feature is hit, emit an `onPathwayClick(pathway_id)` callback (stop clicks take priority)
- [x] Create `src/modules/pathway-view-controller.ts` — renders pathway detail in the right panel:
  - Uses `renderEntityFields(GTFSSchemas['pathways.txt'], pathway, 'pathways.txt', pathway_id)` for all fields
  - Shows a delete button (patch-gated via `handleDeletePathway` in page-content-renderer)
  - `from_stop_id` / `to_stop_id` displayed as clickable buttons linking to stop views

**Implementation notes:**
- `{ type: 'pathway'; pathway_id: string }` added to `PageState` union in `page-state.ts`; `isPageState()`, `pageStateToURL()`, `urlToPageState()`, and `getBreadcrumbs()` all updated accordingly
- `navigateToPathway(pathway_id)` added to `navigation-actions.ts`
- `map-controller.ts`: `expandStation()` calls `layerManager.updatePathwaysLayer(stationId)`; `collapseStation()` calls `layerManager.clearPathwaysLayer()`; `handleStopDragComplete()` calls `layerManager.rebuildPathwaysSource(expandedStationId)` if a station is expanded; `handlePathwayClick()` navigates via `pageStateManager`
- `page-content-renderer.ts`: `PathwayViewController` instantiated and wired; `renderPathway()` case added to switch; `handleDeletePathway()` does DB delete + patch record
- `attachFormPatchListeners` in page-content-renderer handles `data-table="pathways.txt"` fields automatically — no extra wiring needed for inline field edits
- `line-dasharray` data-driven expression removed (MapLibre compatibility); colors alone differentiate modes

---

## Phase 5: Pathway Creation

An "Add Pathway" button in the map toolbar, enabled only when a stop is selected, lets the user pick a second stop to connect.

- [x] In `src/index.html` — add `<button id="add-pathway-btn" class="btn btn-sm btn-square join-item tooltip" disabled>` next to the add-stop button, with an appropriate icon (e.g. a line/connection icon)
- [x] In `src/modules/ui.ts` — add `toggleAddPathwayMode()`: mirrors `toggleAddStopMode()`, updates button active state; disable the button when no station is expanded
- [x] Add `ADD_PATHWAY` to the map interaction mode enum (alongside `NAVIGATE` and `ADD_STOP`) in `interaction-handler.ts`
- [x] In `interaction-handler.ts` — new `handleAddPathwayClick()` method with two-click flow:
  - First click: stores `from_stop_id` in `addPathwayFirstStopId`, shows info notification "From: X. Now click the second stop."
  - Second click: opens `showModal` for `pathway_mode` + `is_bidirectional`; on confirm calls `gtfsParser.createPathway()` + fires `onPathwayCreated` callback; exits ADD_PATHWAY mode
  - Mode change away from ADD_PATHWAY clears `addPathwayFirstStopId`
- [x] In `stop-view-controller.ts` — non-station stops show a "Pathways" section with connected pathways (queried via two `queryRows` calls: `from_stop_id` + `to_stop_id`), each linking to the pathway view via `onPathwayClick`
- [x] Enable the "Add Pathway" button only when `mapController.expandedStationId` is non-null via `onStationExpandChange` callback

**Implementation notes:**
- `createPathway()` added to `GTFSParser` (mirrors `createStop`): handles `gtfsData` init, `insertRows`, `patchManager.recordInsert`, and `updatePathwaysFileContent`
- `onStationExpandChange` callback added to `MapControllerCallbacks`; called from `expandStation()` and `collapseStation()`; wired in `UIController.setupMapCallbacks()` to call `updateMapToolButtonState()`
- `onPathwayCreated` added to `InteractionCallbacks`; `MapController.handlePathwayCreated()` rebuilds pathways layer and navigates via `pageStateManager`
- `onPathwayClick` passed into `StopViewDependencies` from `page-content-renderer.ts`
- Pathways section only renders when there are connected pathways (empty = section hidden)
- Exit gate (mode 7) + bidirectional validation in the modal

---

## Original Issue

> This is probably a big step, but it would be super cool.
>
> We need to leverage location_type much more. If the stop has a parent_station, it should be hidden behind the parent_station unless the station is selected. When the parent_station is selected, we should zoom in and show all of the child stops. The child stops should also be selectable/movable/etc as the parent stations are. When a station is selected, we should use different symbols or something to show the station, the generic nodes, and the boarding areas.
>
> Then, we should show pathways with direct lines between each of the nodes. These should be selectable as well, opening them up in the browser.
>
> We should have an add pathway button that is greyed out when a stop is not selected. This should allow the selecting of two stops and be similar to the add stop button.
>
> We should also support levels, in that the level_id can be a dropdown. Lets have levels be a modal that gets opened from the nav bar.
