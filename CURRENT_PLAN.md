# Plan: More Logical and Robust Highlighting (#47)

## Summary

Three tightly related changes to map interaction:

1. **Empty map click → home**: clicking anywhere on the map where there are no stops or routes navigates to `{ type: 'home' }`, clearing the current highlight.
2. **Highlighted stop is always draggable**: remove the separate `EDIT_STOPS` mode entirely. In pointer mode, only the currently highlighted stop shows a `grab` cursor and can be dragged; all other stops cannot.
3. **Radio toolbar**: replace the two independent toggle buttons (add-stop, edit-stops) with a joined radio group — pointer tool and add-point tool — where the active tool is styled `btn-primary` (same blue as the Load button), and inactive is unstyled.

## Relevant Context

- `src/modules/interaction-handler.ts` — all map event handling. Key methods: `handleNavigationClick()` (empty case at line 141), `handleMouseDown/Move/Up()` (drag logic, currently gated on `MapMode.EDIT_STOPS`), `enableStopDragging()` / `disableStopDragging()` (add/remove mouseenter/leave hover handlers), `setMapMode()`.
- `src/modules/map-controller.ts` — `MapMode` enum (line 16), `highlightStop()` (line 357), `clearHighlights()`, `toggleEditStopsMode()` / `toggleAddStopMode()`.
- `src/modules/ui.ts` — button wiring at line 141–147, `toggleAddStopMode()` (line 1279), `toggleEditStopsMode()` (line 1325), `updateAddStopButtonState()` / `updateEditStopsButtonState()`.
- `src/index.html` — toolbar at lines 327–372: two `<button>` elements with ids `add-stop-btn` and `edit-stops-btn` inside a `card`.
- `src/modules/schedule-controller.ts:993` — positions a dropdown using `getBoundingClientRect()` on `#add-stop-btn`. Keep that ID on the add-point button.
- `InteractionCallbacks` interface (interaction-handler.ts line 7) — where new `onEmptyClick` callback goes.
- `MapControllerCallbacks` interface (map-controller.ts line 23) — where the forwarded `onEmptyClick` goes.
- In `index.ts`, the map callbacks are wired up with `mapController.setCallbacks(...)` or similar — this is where `onEmptyClick` gets bound to `pageStateManager.setPageState({ type: 'home' })`.

---

## Phase 1: Empty Map Click → Navigate Home

**Goal:** When the user clicks the map and hits nothing (no stop, no route), navigate to the home page state. Only fires in `NAVIGATE` mode (add-stop mode clicks create a stop, not navigate home).

- [x] Add `onEmptyClick?: () => void` to the `InteractionCallbacks` interface in `interaction-handler.ts`.
- [x] In `handleNavigationClick()`, replace the "no features found" comment at line 141 with:
  ```typescript
  this.callbacks.onEmptyClick?.();
  ```
- [x] Add `onEmptyClick?: () => void` to `MapControllerCallbacks` in `map-controller.ts`.
- [x] In `map-controller.ts`, in the block where `interactionHandler.setCallbacks(...)` is called, add:
  ```typescript
  onEmptyClick: () => {
    this.clearHighlights();
    this.callbacks.onEmptyClick?.();
  },
  ```
- [x] In `src/index.ts`, in the `mapController` callbacks setup, add:
  ```typescript
  onEmptyClick: () => {
    pageStateManager.setPageState({ type: 'home' });
  },
  ```

**Gotchas:**
- `clearHighlights()` in map-controller must be called before the page state changes, otherwise highlight lingers during navigation.
- This only fires in `MapMode.NAVIGATE` because `handleMapClick` routes to `handleNavigationClick` only in that mode — no extra guard needed.

---

## Phase 2: Highlighted Stop Always Draggable (Remove EDIT_STOPS)

**Goal:** The currently highlighted stop is draggable in pointer mode. No separate edit mode. `MapMode.EDIT_STOPS` is removed.

### interaction-handler.ts

- [x] Remove `MapMode.EDIT_STOPS` from the `MapMode` enum in `map-controller.ts` (see below), then remove all references in `interaction-handler.ts`:
  - Remove the `EDIT_STOPS` case from `updateCursor()`.
  - Remove `enableStopDragging()` and `disableStopDragging()` calls from `handleModeChange()`.
  - Remove `enableStopDragging()` and `disableStopDragging()` methods entirely.
  - Remove `toggleEditStopsMode()` method.
- [x] Add `private highlightedStopId: string | null = null` field.
- [x] Add public method `setHighlightedStop(stop_id: string | null): void`.
- [x] In `setupEventListeners()`, add always-on hover handlers for the stop layers.
- [x] Rewrite `handleMouseDown()` — allow drag only when in NAVIGATE mode and the clicked stop is the highlighted one.
- [x] In `handleMouseMove()`: remove `this.currentMode !== MapMode.EDIT_STOPS` guard.

### map-controller.ts

- [x] Remove `EDIT_STOPS = 'edit_stops'` from the `MapMode` enum.
- [x] In `highlightStop()`, call `this.interactionHandler?.setHighlightedStop(stop_id)`.
- [x] In `clearHighlights()`, call `this.interactionHandler?.setHighlightedStop(null)`.
- [x] Remove `toggleEditStopsMode()` public method.

**Gotchas:**
- The existing `disableStopDragging()` uses `(this.map as any).off('mouseenter', layerId)` which removes ALL mouseenter listeners on that layer — this is the existing workaround for MapLibre's API. The new always-on approach avoids this by never removing the listeners. Make sure no other code calls `off` on those layers.
- After drag completes (`handleMouseUp`), `updateCursor(this.currentMode)` is called — in NAVIGATE mode this resets to `''`, which is correct.
- The `handleStopDragComplete` in `map-controller.ts` already handles the coordinate update and calls `layerManager.updateStopsData()`. Since `highlightStop()` is not re-called after the drag, the visual highlight on the stop may disappear momentarily when `updateStopsData()` re-renders. Check whether `layerManager` preserves the highlight state on re-render; if not, re-call `highlightStop(stop_id)` at the end of `handleStopDragComplete`.

---

## Phase 3: Radio Toolbar UI

**Goal:** Replace the two toggle buttons with a pointer tool and add-point tool styled as a joined radio group. Active tool = `btn-primary`. The edit-stops button disappears entirely.

### index.html (lines 327–372)

- [x] Replace the map tools card contents with a joined button group:
  ```html
  <!-- Map Tools -->
  <div class="card card-bordered bg-base-100 shadow-lg p-1">
    <div class="join">
      <button
        id="pointer-btn"
        class="btn btn-sm btn-square join-item btn-primary tooltip"
        data-tip="Pointer"
      >
        <!-- Mouse cursor SVG (outline style, h-5 w-5) -->
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M6 2l12 10-6 1-3 6L6 2z" />
        </svg>
      </button>
      <button
        id="add-stop-btn"
        class="btn btn-sm btn-square join-item tooltip"
        data-tip="Add stop"
      >
        <!-- Plus/point SVG — keep existing plus icon -->
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </button>
    </div>
  </div>
  ```
  Keep id `add-stop-btn` on the add-point button (schedule-controller uses its bounding rect at line 993).
  Remove `edit-stops-btn` entirely.

### ui.ts

- [x] Replace the click listeners at lines 141–147 with:
  ```typescript
  document.getElementById('pointer-btn')?.addEventListener('click', () => {
    this.mapController.setMapMode(MapMode.NAVIGATE);
    this.updateMapToolButtonState();
  });
  document.getElementById('add-stop-btn')?.addEventListener('click', () => {
    this.toggleAddStopMode();
  });
  ```
- [x] Replace `updateAddStopButtonState()` and `updateEditStopsButtonState()` with a single `updateMapToolButtonState()`:
  ```typescript
  updateMapToolButtonState() {
    if (!this.mapController) return;
    const mode = this.mapController.getCurrentMode();
    const pointerBtn = document.getElementById('pointer-btn');
    const addStopBtn = document.getElementById('add-stop-btn');
    pointerBtn?.classList.toggle('btn-primary', mode === MapMode.NAVIGATE);
    addStopBtn?.classList.toggle('btn-primary', mode === MapMode.ADD_STOP);
  }
  ```
- [x] Update `toggleAddStopMode()` to call `updateMapToolButtonState()` instead of `updateAddStopButtonState()`.
- [x] Remove `toggleEditStopsMode()`, `updateAddStopButtonState()`, and `updateEditStopsButtonState()` methods.
- [x] Wherever `onModeChange` callback is handled in ui.ts (if present), call `updateMapToolButtonState()`.

**Gotchas:**
- On initial load, pointer mode is the default (`MapMode.NAVIGATE`), so `pointer-btn` must start with `btn-primary` in the HTML (already in the markup above). No JS init call needed.
- `toggleAddStopMode()` in `MapController` toggles between `ADD_STOP` and `NAVIGATE`. After toggle, calling `updateMapToolButtonState()` will correctly reflect the new mode. When it returns to `NAVIGATE`, pointer btn goes blue and add-stop btn goes un-colored.

---

## Phase 4: Fix Drag Visual — Highlight Circle Follows the Stop

**Goal:** When dragging a highlighted stop, the large highlight circle (from the `stops-highlight` layer) should move with the cursor, not stay at the original position.

**Root cause:** `handleMouseMove` in `interaction-handler.ts` only updates the `stops` GeoJSON source (small circle, radius 4). The `stops-highlight` layer has a completely separate source (`stops-highlight`) that is never updated during the drag, so the big circle sits frozen at the original coordinates while the small one follows the mouse.

**Relevant context:**
- `src/modules/interaction-handler.ts` — `handleMouseMove()` (around line 306): updates `stops` source only.
- `src/modules/layer-manager.ts` — `highlightStop()` (line 247): creates the `stops-highlight` source with a GeoJSON FeatureCollection containing a single feature at the stop's current coordinates.
- The `stops-highlight` source is a MapLibre `GeoJSONSource`; calling `.setData()` on it mid-drag is sufficient to move it.

**Implementation steps:**

- [x] In `interaction-handler.ts`, in `handleMouseMove()`, after `source.setData(data)` updates the `stops` source, also update the `stops-highlight` source:
  ```typescript
  const highlightSource = this.map.getSource('stops-highlight') as GeoJSONSource | undefined;
  if (highlightSource) {
    const hData = highlightSource._data as GeoJSON.FeatureCollection; // cast via (highlightSource as any)
    // safer: just build a minimal FeatureCollection with the new coords
    highlightSource.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] },
        properties: (hData?.features?.[0]?.properties ?? {}),
      }],
    });
  }
  ```
  Use `(this.map.getSource('stops-highlight') as any)` to avoid type friction if needed — the `GeoJSONSource` type does expose `setData`.

**Gotchas:**
- `stops-highlight` source may not exist if no stop is highlighted (e.g., drag was initiated some other way). The `if (highlightSource)` guard handles this.
- No need to update `stops-highlight` in `handleMouseUp` — after the drag, `callbacks.onStopDragComplete` triggers `layerManager.updateStopsData()` and then `highlightStop()` is re-called (or should be — verify in `map-controller.ts`'s `handleStopDragComplete`), which rebuilds the source at the final coordinates.
- Read the actual `properties` from the existing feature so stop_name/stop_code survive the drag.

---

## Original Issue

I think most of the issues have to do with escaping the highlighted object reasonably
