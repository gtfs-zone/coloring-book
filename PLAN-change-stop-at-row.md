# Plan: Change Stop at Timetable Row

## How to use this plan

Work through phases in order. Check off each item (`- [x]`) as completed. Update
the plan in place if a sub-task turns out differently than expected — add notes
under the relevant item so context is preserved.

---

## Background / Problem Statement

The timetable view shows a grid: rows are stops (ordered by the Shortest Common
Supersequence of all trip stop-sequences), columns are trips. Currently the stop
name in each row header is static text. The goal is to let the user change which
stop a row represents, with the change applied to every trip in the current
direction simultaneously, recorded as a single undo/redo entry.

**Also addressed in this plan:** a related bug where the "Add stop" dropdown
filters out stops already visible in the timetable, preventing a trip from
visiting a stop that another trip in the same direction already visits.

---

## Data model notes

- `stop_times` primary key: `trip_id:stop_sequence`
- Changing a stop row means updating the `stop_id` field in every `stop_times`
  record for trips (in the current direction) that currently have
  `stop_id = oldStopId`. Only `stop_id` changes; times, sequences, and trip
  properties are untouched.
- The stop must already exist in `stops.txt` — no implicit creation.
- Trips that skip a given row (no `stop_times` record for that stop) are not
  affected.

---

## Patch system notes

Each `GTFSPatch` is currently a single-row operation (`insert` / `update` /
`delete`). One undo click = one patch. To make N row updates undo as one step,
we introduce a `BatchGTFSPatch` that wraps an array of `SingleGTFSPatch` ops
and is stored as one record in IndexedDB.

`undo` / `redo` / `jumpToVersion` need **no changes** because they delegate to
`applyPatchForward` / `applyPatchInverse`, which will gain a `'batch'` branch.
`revertPatch` does need a `'batch'` branch (see Phase 2b).

---

## Phase 0 — Fix duplicate-stop ordering bug

**Problem:** When the user adds a stop (e.g. A) that is already in the timetable (creating
a loop route A B C A), the new stop ends up at the wrong position or one of the A
entries disappears entirely — the user sees **B C A** instead of **A B C A**.

**Root cause — two interacting bugs, both keying on `stop_id` instead of `supersequencePosition`:**

### Bug 0a — `rebuildStopTimesFromTable` deduplicates by `stop_id`

**File:** `src/modules/timetable-database.ts` (~line 531)

```ts
let stopTime = stopTimesFromTable.find((st) => st.stop_id === stop_id);
```

When the timetable has both the original A row (input value `08:00`) and the pending A
row (input value `11:00`), the DOM scan finds both inputs with `data-stop-id="A"`.
The second input overwrites the first, leaving only one A entry with time `11:00`.
Sorted alongside B=`09:00`, C=`10:00`, the sequence becomes B(1) C(2) A(3) → **B C A**.

**Fix:** key entries by `(stop_id, supersequencePosition)` instead of `stop_id` alone.
The supersequence position must come from a new `data-supersequence-position` DOM attribute
on each time input. Use a composite key `"${stop_id}:${superPos}"` for the find-or-create
logic so that two A rows at different positions remain separate entries.

### Bug 0b — `isPendingStop` marks all rows with matching `stop_id` as pending

**File:** `src/modules/timetable-renderer.ts` (~line 459)

```ts
const isPendingStop = pendingStopId === stop.stop_id;
```

Since `pendingStopId = 'A'`, BOTH the original A row and the appended pending A row receive
the dashed-border / reduced-opacity styling.

**Fix:** only treat the *last* position as pending — the pending stop is always appended at
`data.stops.length - 1`:

```ts
const isPendingStop =
  pendingStopId !== undefined &&
  stop.stop_id === pendingStopId &&
  stopIndex === data.stops.length - 1;
```

### Checklist

**`src/modules/timetable-cell-renderer.ts`**
- [ ] Add `supersequencePosition: number` parameter to `renderStackedArrivalDepartureCell`
      (and any other cell-rendering methods that emit `<input>` elements)
- [ ] Emit `data-supersequence-position="${supersequencePosition}"` on every time input
      (linked, arrival, departure)

**`src/modules/timetable-renderer.ts`**
- [ ] Pass `supersequencePosition` (which is already `stopIndex`) when calling cell renderer
      methods
- [ ] Fix `isPendingStop` to only be true for the last stop index when the stop_id matches

**`src/modules/timetable-database.ts` — `rebuildStopTimesFromTable`**
- [ ] Change deduplication key from `stop_id` alone to `"${stop_id}:${superPos}"` where
      `superPos = input.dataset.supersequencePosition ?? 'new'`
- [ ] Use a `Map<string, Partial<StopTimes>>` (keyed by the composite string) instead of
      the `Array.find` approach to ensure O(1) lookup and no accidental merging

**Sign-off:**
- [ ] `npm run typecheck` — passes
- [ ] `npm run lint` — passes
- [ ] Manual test: trip A B C A (loop) — adding a second A shows A B C A in timetable while
      pending, entering time for the pending A preserves A B C A order in DB
- [ ] Manual test: the original A row does NOT have pending styling (only the last A does)
- [ ] Manual test: entering a time for the original A row still works correctly (no regression)

---

## Phase 1 — Fix stop-adding bug

**File:** `src/modules/schedule-controller.ts`

**Why:** `openAddStopDropdown` builds a `currentStopIds` set from the visible
timetable rows, then filters the full stops list down to stops *not* already in
the timetable. This prevents adding a stop that any other trip in the direction
already visits, which blocks loops and any shared stops. The fix is to remove
the filter — all stops in `stops.txt` are always valid candidates.

**Checklist:**
- [x] In `openAddStopDropdown` (~line 888), delete the block that builds
      `currentStopIds` (the `timetableData` query + the `new Set(...)`)
- [x] Delete the `.filter()` on `allStops`; rename `availableStops` → `allStops`
      or just pass `allStops` directly to `this.availableStops` and
      `populateAddStopList`
- [x] Remove the now-dead `console.log` lines for `currentStopIds`
- [x] In `populateAddStopList` (~line 957), update the "no stops" message from
      `"All stops are already in this timetable"` to `"No stops in database"`
      (the old message is now factually wrong)
- [x] `npm run typecheck` — passes (pre-existing errors only, none introduced)
- [x] `npm run lint` — passes
- [ ] Manual test: open a timetable with ≥2 trips, verify the Add Stop dropdown
      shows stops that are already present as rows

---

## Phase 2 — Batch patch type

**Files:** `src/types/patch.ts`, `src/modules/patch-manager.ts`,
`src/utils/patch-label.ts`, `src/modules/history-controller.ts`

### 2a — `src/types/patch.ts`

- [ ] Rename the existing `GTFSPatch` interface to `SingleGTFSPatch`
- [ ] Add:
  ```ts
  export interface BatchGTFSPatch {
    op: 'batch';
    ops: SingleGTFSPatch[];
    label?: string;
  }
  ```
- [ ] Re-export the union:
  ```ts
  export type GTFSPatch = SingleGTFSPatch | BatchGTFSPatch;
  ```
- [ ] `PatchRecord.patch: GTFSPatch` already covers both — no change needed there

### 2b — `src/modules/patch-manager.ts`

- [ ] `applyPatchForward`: add a `'batch'` branch — iterate `patch.ops` in order,
      recursively call `applyPatchForward(op)` for each
- [ ] `applyPatchInverse`: add a `'batch'` branch — iterate `patch.ops` **in
      reverse**, recursively call `applyPatchInverse(op)` for each
- [ ] `revertPatch`: add a `'batch'` branch — build a new `BatchGTFSPatch` with
      each op's `forward` and `inverse` swapped (op type stays `'update'`
      since we only batch updates for now), then call `applyPatchForward` +
      `appendAndPush` on the inverted batch
- [ ] Add `recordBatch` public method:
  ```ts
  async recordBatch(
    ops: Array<{
      table: string;
      id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>,
    label: string
  ): Promise<void>
  ```
  Logic:
  1. Build a `SingleGTFSPatch` for each op using the same forward/inverse diff
     logic as `recordUpdate` (only store changed fields)
  2. Filter out ops where the diff is empty (no actual change)
  3. If zero ops remain, return early
  4. If exactly one op remains, fall through to a normal single-patch path
     (call `applyPatchForward` + `appendAndPush` on the single patch)
  5. Otherwise wrap in `BatchGTFSPatch` and call `applyPatchForward` +
     `appendAndPush` on it

### 2c — `src/utils/patch-label.ts`

- [ ] Add `'batch'` case:
  ```ts
  if (patch.op === 'batch') {
    return patch.label ?? `Batch update (${patch.ops.length} rows)`;
  }
  ```

### 2d — `src/modules/history-controller.ts`

- [ ] `opBadgeClass`: add `'batch'` → `'badge-info'`
- [ ] `renderFieldDiffs`: add `'batch'` case — render a summary line such as
      `<div class="text-xs mt-0.5">${patch.ops.length} rows updated</div>`

**Phase 2 sign-off checklist:**
- [ ] `npm run typecheck` — passes
- [ ] `npm run lint` — passes
- [ ] Manual test: make a regular single-field edit; undo/redo still works;
      history panel shows the entry correctly

---

## Phase 3 — Change stop at timetable row

**Files:** `src/modules/timetable-data-processor.ts` (or wherever `TimetableData`
is defined), `src/modules/timetable-renderer.ts`,
`src/modules/schedule-controller.ts`

### 3a — Add `allStops` to `TimetableData`

The renderer needs the full stop list to populate `<option>` tags.

- [ ] Find the `TimetableData` interface and add `allStops: Stops[]`
- [ ] In `TimetableDataProcessor.generateTimetableData`, call
      `queryRows('stops', {})` and include the result as `allStops` in the
      returned object

### 3b — `src/modules/timetable-renderer.ts`

The stop row header (~lines 517–519) currently renders:
```html
<th class="stop-name p-2 font-medium border-r border-base-300">
  <div class="stop-name-text">${stop.stop_name || stop.stop_id}</div>
  <div class="stop-id text-xs opacity-70">${stop.stop_id}</div>
</th>
```

- [ ] Replace with a `<select>` populated from `data.allStops`:
  ```html
  <th class="stop-name p-2 font-medium border-r border-base-300">
    <select
      class="select select-xs w-full font-medium"
      data-old-stop-id="${escapeHtml(stop.stop_id)}"
      onchange="gtfsEditor.scheduleController.changeStopAtRow(this.dataset.oldStopId, this.value, this)"
    >
      ${data.allStops.map(s =>
        `<option value="${escapeHtml(s.stop_id)}"${s.stop_id === stop.stop_id ? ' selected' : ''}>
          ${escapeHtml(s.stop_name || s.stop_id)}
        </option>`
      ).join('')}
    </select>
  </th>
  ```
  Note: `data-old-stop-id` captures the stop being replaced at render time.
  `this.value` in the `onchange` is already the new value, so we need the
  `data-` attribute to know what we're replacing.

### 3c — `src/modules/schedule-controller.ts`

- [ ] Add public method:
  ```ts
  async changeStopAtRow(
    oldStopId: string,
    newStopId: string,
    selectEl: HTMLSelectElement
  ): Promise<void>
  ```
  Logic:
  1. If `oldStopId === newStopId`, return
  2. Guard: if `!this.currentRouteId || !this.currentServiceId`, log error and
     reset `selectEl.value = oldStopId`, return
  3. Load timetable data for current route/service/direction
  4. For each trip in `data.trips`, query `stop_times` where
     `trip_id = trip.trip_id` and `stop_id = oldStopId`
  5. For each found record, build an op:
     `{ table: 'stop_times', id: generateCompositeKeyFromRecord('stop_times', record), before: { stop_id: oldStopId }, after: { stop_id: newStopId } }`
  6. If no ops were collected, log a warning and reset `selectEl.value = oldStopId`,
     return
  7. Call `await this.patchManager.recordBatch(ops, \`Changed stop ${oldStopId} → ${newStopId}\`)`
  8. Call `await this.refreshCurrentTimetable()`

**Phase 3 sign-off checklist:**
- [ ] `npm run typecheck` — passes
- [ ] `npm run lint` — passes
- [ ] Manual test: load timetable with ≥2 trips; change a stop row via dropdown;
      verify all trip cells now show the new stop
- [ ] Manual test: history panel shows one "batch" entry with label
      `"Changed stop X → Y"`
- [ ] Manual test: undo reverts all rows in one step
- [ ] Manual test: redo re-applies all rows in one step
- [ ] Manual test: changing a stop that only one trip visits creates a single
      non-batch history entry (falls through to single-patch path in `recordBatch`)

---

## Phase 4 — Tests

**Files:** `tests/`

- [ ] Test for Phase 1 fix: open a timetable, verify a stop already shown as a
      row appears in the "Add stop" dropdown
- [ ] Test for Phase 3 feature: change a stop row, assert the new stop_id
      appears in all trip cells for that row, assert one undo reverts everything

---

## Open questions / notes

- If the same `stop_id` appears at multiple positions in the supersequence
  (loop route), `changeStopAtRow` as specified will update **all** instances for
  each trip. This is acceptable for now; a more targeted approach (keying by
  supersequence position) can be added later if needed.
- `revertPatch` for a batch currently only handles the all-updates case. If
  batches ever contain `insert` or `delete` ops the swap logic needs revisiting.
