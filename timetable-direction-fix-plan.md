# Timetable Direction Handling Fix Plan

## Problem Summary

The timetable's inbound/outbound handling is broken due to several layered issues:

1. **Critical bug**: `direction_id` is stored as a **number** (0, 1) in IndexedDB (the CSV parser coerces it), but the trip filter compares it as a **string**. `(1 || '0') === '1'` evaluates to `1 === '1'` which is `false` — so Direction 1 trips are never matched and inbound is always empty.

2. **Stale data**: `getAvailableDirections()` reads from the in-memory file cache (sync), while `generateTimetableData()` reads from IndexedDB (async). After any trip edit/create, the direction tab counts can be wrong.

3. **Confusing UI**: Tabs say "Outbound" / "Inbound" (hardcoded GTFS convention names), are hidden when only one direction exists, and show default tabs when the timetable is empty. This is opaque rather than obvious.

4. **Interface gap**: The `GTFSRelationships` interface in `timetable-data-processor.ts` doesn't declare `getTripsForRouteAsync`, even though the code calls it.

---

## Phase 1 — Fix the Critical Type Mismatch Bug

**Goal**: Make direction filtering actually work for Direction 1.

The `direction_id` field arrives from the DB as a number (0 or 1) because `gtfs-parser.ts` coerces it to numeric during CSV load, and `updateTripProperty` also stores it as `parseInt(newValue, 10)`. The filter then does:

```ts
// BROKEN: (1 || '0') === '1' → 1 === '1' → false
(trip.direction_id || '0') === direction_id
```

The `|| '0'` is also wrong for `undefined`: it works for `undefined`, but fails for `0` and `1` as shown above.

### Changes

**`timetable-data-processor.ts`**

- Fix the filter in `generateTimetableData` to normalize `direction_id` to a string before comparing:
  ```ts
  // Before
  (trip.direction_id || '0') === direction_id
  // After
  String(trip.direction_id ?? '0') === direction_id
  ```
  - `?? '0'` uses null-coalescing (not OR), so `0` stays `0`, only `null`/`undefined` falls back to `'0'`
  - `String(0)` → `'0'`, `String(1)` → `'1'`, comparison is now correct

- Add `getTripsForRouteAsync` to the local `GTFSRelationships` interface so the code matches what it actually calls:
  ```ts
  interface GTFSRelationships {
    getCalendarForService(service_id: string): Calendar | CalendarDates | null;
    getTripsForRoute(route_id: string): EnhancedTrip[];
    getTripsForRouteAsync(route_id: string): Promise<EnhancedTrip[]>;
    getStopTimesForTrip(trip_id: string): StopTimes[];
    getStopById(stop_id: string): Stops | null;
    getStopByIdAsync(stop_id: string): Promise<Stops | null>;
  }
  ```

- Also normalize in `getAvailableDirections` for consistency (already uses `.toString()`, but change `|| '0'` to `?? '0'` there too):
  ```ts
  // Before
  const dirId = (trip.direction_id || '0').toString();
  // After
  const dirId = String(trip.direction_id ?? '0');
  ```

### Checklist
- [x] `generateTimetableData` filter uses `String(trip.direction_id ?? '0') === direction_id`
- [x] `getAvailableDirections` uses `String(trip.direction_id ?? '0')`
- [x] `GTFSRelationships` interface in `timetable-data-processor.ts` includes `getTripsForRouteAsync`
- [ ] `npm run typecheck` passes (pre-existing errors in other files unrelated to Phase 1)
- [ ] Load a feed with direction_id values; navigate to Direction 1 timetable; trips appear correctly

---

## Phase 2 — Fix Stale Cache in `getAvailableDirections`

**Goal**: Direction tab counts always reflect actual DB state, not a stale in-memory snapshot.

Currently `getAvailableDirections` is synchronous and calls `this.relationships.getTripsForRoute()` which reads from the parsed file cache. This cache is populated at load time and never updated when trips are edited or created via the UI. Meanwhile, `generateTimetableData` always reads from IndexedDB via `getTripsForRouteAsync`.

### Changes

**`timetable-data-processor.ts`**

- Make `getAvailableDirections` async, rename it `getAvailableDirectionsAsync`:
  ```ts
  async getAvailableDirectionsAsync(
    route_id: string,
    service_id: string
  ): Promise<DirectionInfo[]>
  ```
- Inside, call `await this.relationships.getTripsForRouteAsync(route_id)` instead of the sync version

**`schedule-controller.ts`**

- Update `renderSchedule` to `await` the new async version:
  ```ts
  const availableDirections = await this.dataProcessor.getAvailableDirectionsAsync(
    route_id,
    service_id
  );
  ```

### Checklist
- [x] `getAvailableDirectionsAsync` exists and uses `getTripsForRouteAsync`
- [x] `schedule-controller.ts` awaits it
- [x] Old sync `getAvailableDirections` removed (renamed — no other callers)
- [ ] `npm run typecheck` passes (pre-existing errors in other files unrelated to Phase 2)
- [ ] Create a new trip in the UI; direction tab counts update on refresh

---

## Phase 3 — UI: Always Show Direction 0 and Direction 1

**Goal**: Direction tabs are always visible, always say "Direction 0" / "Direction 1", and show trip counts clearly. No magic disappearing tabs. No opinionated "Outbound"/"Inbound" labels.

### Design

- Always show exactly two tabs: **Direction 0** and **Direction 1**
- Show trip count in the tab label: `Direction 0 (12)` / `Direction 1 (0)`
- A tab with 0 trips is visually dimmed (opacity), but still clickable (user can add trips to it)
- Remove the "hide if only one direction" logic
- Remove the "show default Inbound/Outbound if no trips" fallback (just show Direction 0 (0) / Direction 1 (0))

### Changes

**`timetable-renderer.ts`** — `renderDirectionTabs`

- Remove the early-return when `directions.length === 1`
- Remove the `defaultDirections` fallback — instead, always construct a full 2-tab list by merging `availableDirections` with the static set `['0', '1']` (adding any with count 0 that aren't in the available list)
- Change `getDirectionDisplayName` to return `Direction ${id} (${tripCount})` format

**`timetable-data-processor.ts`** — `getDirectionName`

- Return `Direction ${direction_id}` instead of `Outbound`/`Inbound`
- This method is also used in `generateTimetableData` for the `directionName` field — update accordingly

**`schedule-controller.ts`** — `renderSchedule`

- When `availableDirections` is empty or missing direction '0' or '1', ensure both are always present in the array passed to the renderer (pad with 0-count entries)

### Checklist
- [x] Direction tabs always show, always show exactly Direction 0 and Direction 1
- [x] Tab label includes trip count
- [x] Tab with 0 trips is visually dimmed but clickable
- [x] No "Outbound" / "Inbound" labels anywhere in timetable context
- [ ] Clicking Direction 1 when it has 0 trips renders an empty timetable (not an error)
- [ ] `npm run typecheck` passes (pre-existing errors in other files unrelated to Phase 3)
- [ ] Manual test: route with only direction 0 trips → Direction 0 tab active, Direction 1 shows (0)
- [ ] Manual test: route with trips in both directions → both tabs show correct counts

---

## Phase 4 — Verify End-to-End and Edge Cases

**Goal**: Confirm everything works together including edge cases.

### Edge Cases to Test

1. **Feed with no `direction_id` on any trip**: All trips have `direction_id = undefined` → should appear in Direction 0 (per GTFS default)
2. **Trips with `direction_id` stored as number vs string**: Both should work identically after Phase 1 fix
3. **Newly created trip**: After `createTripFromInput`, the new trip gets the current `direction_id`. Refresh should show it in the correct tab.
4. **Changing a trip's `direction_id`**: Via the trip property editor in the timetable. After save + refresh, trip should move to the new direction's tab.
5. **Empty timetable on load**: A route with no trips at all should show Direction 0 (0) / Direction 1 (0) tabs and an empty table.

### Checklist
- [ ] All edge cases above tested manually
- [ ] `npm run typecheck` passes
- [ ] Playwright tests pass (`npm test`)
- [ ] No regressions in stop-time editing, linked/unlinked time toggling
