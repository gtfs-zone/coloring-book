# Patch Integrity Plan

## Problem Statement

Several places in the codebase call `gtfsDatabase.updateRow()` directly without recording a corresponding patch via `patchManager.recordUpdate()`. This means those edits are persisted to IndexedDB but are invisible to the undo/redo system and the Changes history panel.

The goal is to ensure **every user-initiated edit goes through the patch system**, and to do this with a consistent, DRY pattern so the same mistake can't easily recur.

---

## Root Cause Analysis

### The "gold standard" path (routes, feed_info)
1. Form fields are rendered with `data-field`, `data-table`, and `data-record-id` attributes.
2. `attachFormPatchListeners(container, deps)` is called after render, wiring up `change` listeners.
3. On change: reads before-value from parser in-memory data → calls `patchManager.recordUpdate()` → patch manager writes to DB and records history.

### Who is broken and why

| Location | What it updates | Problem |
|----------|----------------|---------|
| `stop-view-controller.ts:402` | Stop properties | Renders fields without `recordId` → no `data-record-id` attr → `form-patch-bridge` ignores them. Has its own custom `updateStopProperty()` that calls DB directly. |
| `service-days-controller.ts:155,216` | `calendar` rows (day toggles, date ranges) | No `patchManager` injected. Custom handlers write DB directly. |
| `schedule-controller.ts:339` | `trips` rows (trip property fields) | No `patchManager` injected. Custom handler writes DB directly. |
| `timetable-database.ts:284,387` | `stop_times` rows (time cell edits) | No `patchManager` injected. Writes DB directly. |

### Already correct (do not change)
- `patch-manager.ts` — the patch system itself
- `editor.ts` — records a patch immediately after each `updateRow`
- `gtfs-parser.ts` (map drag) — records a patch right after `updateRow`
- `database-fallback-manager.ts`, `gtfs-database.ts` — internal infrastructure

---

## Architecture Decision: Two Tracks

**Track A — Form-based inputs** (stop, agency):
- Fix is to add `recordId` to field configs and let `form-patch-bridge` handle saves automatically.
- Remove the hand-rolled save logic entirely.

**Track B — Custom interaction widgets** (calendar day toggles, trip fields, timetable cells):
- These are not standard form inputs, so `form-patch-bridge` can't cover them.
- Fix is to inject `patchManager` and call `recordUpdate` directly in each handler, mirroring how `editor.ts` does it.

**Track C — Abstraction cleanup**:
- The three view controllers (`StopViewController`, `AgencyViewController`, `ServiceViewController`) share the same structural pattern (fetch entity → render fields → render related entities → handle navigation clicks) but diverge in their dependency interfaces, making it hard to apply changes consistently.
- Consolidate the shared rendering pattern into a utility or base class so future fixes are applied once.

---

## Phase 1: Audit & Baseline

**Goal:** Confirm the complete list of patch-violating writes. No code changes yet.

### Steps
1. Search codebase for all `.updateRow(` calls outside of `patch-manager.ts` and `database-fallback-manager.ts`.
2. For each call, determine: does a `patchManager.recordUpdate()` call accompany it (either before or after)?
3. Confirm the six broken locations listed above and check for any others.
4. Verify that `attachFormPatchListeners` is called after every view renders (it currently runs in `page-content-renderer.ts:727` for all content).
5. Check if `AgencyViewController` fields actually save via `form-patch-bridge` today (they have `recordId`, so they should — verify this works or identify if it's also broken).

### Phase 1 Checklist
- [x] All `updateRow` calls catalogued with patch-aware status
- [x] Confirmed 6 broken locations (or updated list if others found)
- [x] Confirmed agency fields DO save via form-patch-bridge (or added to fix list)
- [x] Confirmed `attachFormPatchListeners` scope covers all rendered views

### Phase 1 Findings

> **Note:** The original audit only searched for `updateRow`. A full search of `insertRows`, `deleteRow`, and `updateRow` reveals 5 additional broken sites. The plan's Phase 3 checklist needs updating accordingly.

**All mutation call sites (updateRow / insertRows / deleteRow):**

| File | Line | Op | Patch-aware? | Notes |
|------|------|----|-------------|-------|
| `patch-manager.ts` | 55, 102, 110, 125, 143, 151, 167 | all | ✅ n/a | Internal patch replay/undo — correct by definition |
| `gtfs-database.ts` | 1134 | insert | ✅ n/a | DB snapshot restore — internal |
| `gtfs-database.ts` | 1221 | insert | ✅ n/a | `insertTrip()` helper — no callers found (dead code) |
| `gtfs-database.ts` | 1239 | update | ✅ n/a | `updateTrip()` helper — no callers found (dead code) |
| `gtfs-database.ts` | 1314 | insert | ✅ n/a | `duplicateTrip()` — no callers found (dead code) |
| `database-management.ts` | 422 | insert | ✅ n/a | Backup restore — not a user-initiated edit |
| `gtfs-parser.ts` | 618, 727 | insert | ✅ n/a | Feed import/load — not user-initiated edits |
| `gtfs-parser.ts` | 1186 | insert | ✅ yes | Add stop on map click: `recordInsert` called immediately after |
| `gtfs-parser.ts` | 1243 | update | ✅ yes | Map drag: `recordUpdate` called immediately after |
| `editor.ts` | 308 | update | ✅ yes | CSV editor: `recordUpdate` called immediately after |
| `inline-entity-creator.ts` | 74 | insert | ✅ yes | Create agency: `recordInsert` called immediately after |
| `inline-entity-creator.ts` | 117 | insert | ✅ yes | Create service: `recordInsert` called immediately after |
| `inline-entity-creator.ts` | 169 | insert | ✅ yes | Create route: `recordInsert` called immediately after |
| `stop-view-controller.ts` | 402 | update | ❌ **broken** | `updateStopProperty()` — no patchManager |
| `service-days-controller.ts` | 147 | insert | ❌ **broken** | `toggleDay()` creates calendar row when none exists — no patchManager |
| `service-days-controller.ts` | 155 | update | ❌ **broken** | `toggleDay()` — no patchManager |
| `service-days-controller.ts` | 214 | insert | ❌ **broken** | `updateDateRange()` creates calendar row when none exists — no patchManager |
| `service-days-controller.ts` | 216 | update | ❌ **broken** | `updateDateRange()` — no patchManager |
| `service-days-controller.ts` | 254 | insert | ❌ **broken** | `addException()` — no patchManager |
| `service-days-controller.ts` | 279 | delete | ❌ **broken** | `removeException()` — no patchManager |
| `schedule-controller.ts` | 339 | update | ❌ **broken** | `updateTripProperty()` — no patchManager |
| `schedule-controller.ts` | 1023 | insert | ❌ **broken** | `createTrip()` — no patchManager |
| `timetable-database.ts` | 284 | update | ❌ **broken** | `updateTime()` — no patchManager |
| `timetable-database.ts` | 387 | update | ❌ **broken** | `updateBothTimes()` — no patchManager |

Note: `browse-navigation.ts:228` exposes `updateRow` as a passthrough dependency injected into `StopViewController` — it is the path used by `stop-view-controller.ts:402`, not an independent broken site.

**Total broken call sites: 11** (original plan predicted 6; missed all `insertRows`/`deleteRow` mutations)

**Broken by module:**
- `stop-view-controller.ts` — 1 (update)
- `service-days-controller.ts` — 6 (2 inserts + 2 updates + 1 insert + 1 delete)
- `schedule-controller.ts` — 2 (1 update + 1 insert)
- `timetable-database.ts` — 2 (2 updates)

**Agency fields (`AgencyViewController`):** `renderAgencyProperties()` at line 106 sets `.map((c) => ({ ...c, recordId: this.currentAgencyId ?? '' }))`. `addEventListeners()` contains only route-click handlers — no duplicate field-change listeners. Agency fields correctly save via `form-patch-bridge`. ✅ No code changes needed.

**`attachFormPatchListeners` scope:** Called once in `page-content-renderer.ts:727` after all view-controller `addEventListeners()` calls, covering the full rendered container. Coverage is correct. However, the bridge's selector requires `data-record-id` — stop fields currently lack this attribute, which is exactly why Phase 2 adds it.

---

## Phase 2: Fix Form-Based View Controllers (Track A)

**Goal:** Stop and Agency property forms save through `form-patch-bridge`, not custom handlers.

The `form-patch-bridge` is already wired up in `page-content-renderer.ts:727` — it just needs `data-record-id` present on the inputs.

### 2a: Fix `StopViewController`

In `stop-view-controller.ts`, `renderStopProperties()`:
```ts
// Before
const fieldConfigs = generateFieldConfigsFromSchema(StopsSchema, stop, GTFS_TABLES.STOPS);

// After
const fieldConfigs = generateFieldConfigsFromSchema(StopsSchema, stop, GTFS_TABLES.STOPS)
  .map((c) => ({ ...c, recordId: this.currentStopId ?? '' }));
```

Then delete:
- `updateStopProperty()` method (~40 lines)
- The field-change event listeners in `addEventListeners()` (lines 435–458) — keep only the agency/route navigation click listeners
- `this.fieldValues` map and all references to it
- `getFieldDisplayName()` helper (only used by the deleted method)
- `updateRow` from `StopViewDependencies` interface (no longer needed)

### 2b: Verify `AgencyViewController`

Agency already sets `recordId`. Confirm `AgencyViewController.addEventListeners()` does NOT attach duplicate field change listeners (it shouldn't — it only does route navigation clicks). No code changes expected here, just verification.

### 2c: Remove dead dependency wiring

`StopViewDependencies.gtfsDatabase.updateRow` will no longer be used. Remove it from the interface to enforce the invariant.

### Phase 2 Checklist
- [x] `StopViewController.renderStopProperties()` adds `recordId` to all field configs
- [x] `updateStopProperty()` deleted
- [x] `fieldValues` map deleted
- [x] `getFieldDisplayName()` deleted
- [x] Field change listeners removed from `StopViewController.addEventListeners()`
- [x] `updateRow` removed from `StopViewDependencies`
- [x] Agency fields verified working (no code changes needed)
- [ ] TypeScript compiles clean (`npm run typecheck`) — pre-existing errors exist on branch; no new errors introduced by Phase 2
- [ ] Manual test: edit a stop name → confirm patch appears in Changes panel → confirm undo works

---

## Phase 3: Fix Custom Interaction Controllers (Track B)

**Goal:** Service day toggles, date range edits, trip property edits, and timetable time edits all record patches.

These widgets have their own custom event handling and can't use `form-patch-bridge`. The fix is to inject `patchManager` and call `recordUpdate()` wrapping each `updateRow()`.

### 3a: `ServiceDaysController` — calendar edits

Inject `patchManager` into `ServiceDaysController`. In `toggleDay()` and `updateDateRange()`:
```ts
// Pattern to follow (same as editor.ts):
const beforeRow = { [field]: oldValue };
await this.gtfsParser.gtfsDatabase.updateRow('calendar', service_id, { [field]: newValue });
await this.patchManager.recordUpdate('calendar', service_id, beforeRow, { [field]: newValue });
```

Wire `patchManager` through from `index.ts` → wherever `ServiceDaysController` is constructed.

### 3b: `ScheduleController` — trip field edits

Inject `patchManager` into `ScheduleController`. In the trip property update handler:
```ts
const before = { [field]: previousValue };
await this.gtfsParser.gtfsDatabase.updateRow('trips', trip_id, { [field]: processedValue });
await this.patchManager.recordUpdate('trips', trip_id, before, { [field]: processedValue });
```

Need to capture the before-value before writing (read from parser in-memory data, same approach as `form-patch-bridge`).

### 3c: `TimetableDatabase` — stop_times time edits

`TimetableDatabase` currently takes a raw `database` reference. Options:
- Option A: Also inject `patchManager`, capture before/after values, call `recordUpdate` after each `updateRow`.
- Option B: Promote these writes up to the caller which has `patchManager` context.

Option A is simpler and consistent with the other fixes. Inject `patchManager` into `TimetableDatabase` and record patches in `updateTime()` and `updateBothTimes()`.

### Phase 3 Checklist
- [ ] `patchManager` injected into `ServiceDaysController`
- [ ] `toggleDay()` records patch (before/after both fields)
- [ ] `updateDateRange()` records patch
- [ ] `patchManager` injected into `ScheduleController`
- [ ] Trip property update handler records patch with correct before/after
- [ ] `patchManager` injected into `TimetableDatabase`
- [ ] `updateTime()` records patch
- [ ] `updateBothTimes()` records patch
- [ ] TypeScript compiles clean
- [ ] Manual test: toggle a service day → undo → confirm calendar reverts
- [ ] Manual test: edit a trip property → undo → confirm trip reverts
- [ ] Manual test: edit a timetable time cell → undo → confirm time reverts

---

## Phase 4: Abstraction Cleanup (Track C)

**Goal:** Eliminate structural duplication across view controllers so the same pattern doesn't fork again.

### 4a: Unify view controller dependencies

All three view controllers (`Stop`, `Agency`, `Service`) currently define their own `*ViewDependencies` interfaces. After the Phase 2/3 fixes, these can be consolidated or at minimum share a common base:

```ts
interface BaseViewDependencies {
  gtfsDatabase: { queryRows: ...; }; // read-only after Phase 2
  patchManager: { recordUpdate: ...; }; // Phase 3 additions
}
```

This also makes it impossible to accidentally create a controller without `patchManager`.

### 4b: Extract a shared form-rendering helper

All three controllers do the same sequence:
```ts
const fieldConfigs = generateFieldConfigsFromSchema(Schema, entity, TABLE)
  .map((c) => ({ ...c, recordId: currentId ?? '' }));
return renderFormFields(fieldConfigs);
```

Extract a small utility:
```ts
function renderEntityFields(
  schema: ZodSchema,
  entity: Record<string, unknown>,
  table: GTFSTable,
  recordId: string
): string
```

This ensures `recordId` is always set and can't be forgotten.

### 4c: Simplify `EnhancedStop` / `EnhancedAgency`

These types duplicate the GTFS types with convenience aliases (`id`, `name`). The convenience aliases are only used internally to build headings. Consider removing the `EnhancedStop` interface and using the raw `Stops` type directly, adding `stop_id` as the label inline where needed.

### Phase 4 Checklist
- [ ] Shared base dependency interface (or at minimum `patchManager` in all view deps)
- [ ] `renderEntityFields()` utility extracted and used by all three controllers
- [ ] `EnhancedStop` / `EnhancedAgency` simplified or eliminated
- [ ] `updateDependencies()` pattern reviewed — consider whether it's still needed or can be simplified
- [ ] TypeScript compiles clean
- [ ] `npm run lint` passes
- [ ] All existing Playwright tests pass

---

## Phase 5: Regression Prevention

**Goal:** Make it structurally hard to add a new `updateRow` that bypasses patches.

### 5a: Wrap `updateRow` in a patch-enforcing helper

Create a thin wrapper used by all interactive update sites:

```ts
/** Write a single-field update to the DB and record a patch. */
async function patchUpdate(
  db: GTFSDatabase,
  pm: PatchManager,
  table: string,
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<void> {
  await db.updateRow(table, id, after);
  await pm.recordUpdate(table, id, before, after);
}
```

All interactive update handlers use this instead of calling `db.updateRow` directly.

### 5b: Document the invariant

Add a comment block at the top of `gtfs-database.ts` and `patch-manager.ts` stating:
> All user-initiated writes MUST go through `patchManager.recordUpdate()`.
> Direct `updateRow()` calls are only for: internal DB initialization, patch replay, and feed import.

### Phase 5 Checklist
- [ ] `patchUpdate` helper created in a shared utility file
- [ ] All Phase 2/3 fix sites converted to use `patchUpdate`
- [ ] Invariant documented in relevant files
- [ ] Final `npm run typecheck && npm run lint` passes
- [ ] Final Playwright test run passes

---

## Summary Table

| Phase | What | Risk | Effort |
|-------|------|------|--------|
| 1 | Audit | Low — read-only | Small |
| 2 | Fix stop/agency forms | Low — deleting code, adding `recordId` | Small |
| 3 | Fix calendar/trip/timetable | Medium — injecting deps, capturing before-values | Medium |
| 4 | Abstraction cleanup | Medium — refactoring across 3 controllers | Medium |
| 5 | Prevention wrapper | Low | Small |

---

## Implementation Log

Running notes on modifications made and problems encountered during implementation.

### Changes Made

- **Phase 2** — `stop-view-controller.ts`: added `recordId` to field configs in `renderStopProperties()`; deleted `updateStopProperty()`, `getFieldDisplayName()`, `fieldValues` map, and the field-change listener block from `addEventListeners()`; removed `updateRow` from `StopViewDependencies`; removed unused `notifications` import.

### Problems & Surprises

<!-- Append entries as issues are discovered, e.g.:
- **Phase 1** — Audit found 11 broken sites vs. 6 predicted; `insertRows`/`deleteRow` were not in scope of original search.
-->

- **Phase 1** — Audit found 11 broken sites vs. 6 predicted; `insertRows`/`deleteRow` were not in scope of original search. `service-days-controller` alone has 6 broken call sites (2 inserts + 2 updates + 1 insert + 1 delete across `toggleDay`, `updateDateRange`, `addException`, `removeException`). `schedule-controller` has an additional broken `insertRows` in `createTrip`.
