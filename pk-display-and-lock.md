# Plan: PK Display, Locking, and Stop Creation Modal

## Objectives

1. **Display PKs prominently everywhere** — Users need to see both the human-readable name and
   the technical ID together. Two stops may have identical names but different `stop_id` values;
   the ID is the distinguishing piece of information and must never be hidden.

2. **Lock PKs after creation everywhere** — Primary key fields are immutable once a record
   exists. The raw CSV file editor currently has no awareness of PKs and allows editing them,
   which can silently corrupt the feed. All views must treat PKs as read-only consistently.

3. **Give users control over PKs at creation time** — The only auto-generated PK in the app
   is for stops (map click → `stop_${Date.now()}`). Users must be able to set a meaningful ID
   before the record is committed. All other entities (routes, trips, services, agencies) already
   ask for a user-provided ID at creation and need no changes.

4. **Consistent abstraction** — Every entity type should have a single function that returns its
   display information (`{ primary, secondary }`), and two shared rendering helpers handle
   card/list context vs. dropdown/inline context. No ad-hoc name fallback logic scattered across
   modules.

---

## Key Research Notes

- **`src/utils/gtfs-primary-keys.ts`** — already contains the definitive `GTFS_PRIMARY_KEYS`
  array and `getGTFSPrimaryKey(tableName)` helper. Use this as the source of truth for PK field
  names in the CSV editor locking phase.

- **`src/modules/modal-utils.ts`** — `showModal({ title, body, actions })` is the existing
  modal abstraction. The `body` is an HTML string injected into a `<p class="py-4">` wrapper.
  For Phase 3 we need form inputs in the body, so the wrapper must be changed to
  `<div class="py-4">` (a `<p>` cannot contain block/form elements). This is the only change
  needed to the modal utility itself.

- **`src/modules/interaction-handler.ts`** — `handleAddStopClick` currently generates
  `stop_${Date.now()}` and inserts the stop immediately. This is the only place that needs a
  creation modal.

- **`src/modules/editor.ts`** — the CSV table editor renders all columns as identical
  `<input type="text">` elements with no PK awareness. Fix in Phase 2.

- **`src/utils/field-component.ts`** — form views already render PKs as `<input disabled>`
  with a lock icon. No changes needed there.

- **`crypto.randomUUID()`** — available natively in all target browsers; no library needed.
  Use for the suggested stop ID in the creation modal.

- **No `route-view-controller.ts` exists** — route detail rendering lives inside
  `page-content-renderer.ts` and `agency-view-controller.ts`. Check both during Phase 1.

---

## How to Keep This Plan Updated

After completing each checklist item, mark it `[x]`. After completing a full phase, add
`✅ DONE` to the phase heading. If a file path turns out to be wrong, correct it inline.

---

## Phase 1 — Entity Display Abstraction ✅ DONE

Create the `EntityDisplayInfo` type and per-entity getter functions in a new utility file.
Then create the two rendering helpers used by all phases.

### 1.1 — Create `src/utils/entity-display.ts`

**`EntityDisplayInfo` type:**
```typescript
export interface EntityDisplayInfo {
  primary: string;   // shown prominently (name, short name, or ID as fallback)
  secondary?: string; // shown as subtext/parens — only set if different from primary
}
```

**Rule for `secondary`:** only populate it when there is a meaningful human-readable `primary`
that is distinct from the PK. If the primary IS the PK (no name field), leave `secondary`
undefined to avoid repeating it.

**Per-entity getters** (inputs are plain record objects, not typed GTFS types, for flexibility):

| Entity | `primary` | `secondary` |
|--------|-----------|-------------|
| agency | `agency_name \|\| agency_id` | `agency_id` if name exists |
| stop | `stop_name \|\| stop_id` | `stop_id` if name exists |
| route | `route_short_name \|\| route_long_name \|\| route_id` | `route_id` if name exists |
| trip | `trip_headsign \|\| trip_short_name \|\| trip_id` | `trip_id` if name exists |
| calendar/service | `service_id` | `undefined` |
| shape | `shape_id` | `undefined` |
| level | `level_name \|\| level_id` | `level_id` if name exists |
| pathway | `pathway_id` | `undefined` |
| fare_attribute | `fare_id` | `undefined` |
| network | `network_id` | `undefined` |
| area | `area_id` | `undefined` |

**Two rendering helpers:**

```typescript
// For cards, list items, and detail headers — secondary on its own line, muted
export function renderCardLabel(info: EntityDisplayInfo): string
// Returns: '<span>Primary<br><span class="text-xs opacity-60">secondary</span></span>'
// If no secondary: just the primary string wrapped in a span

// For dropdowns and inline text — secondary in parens on the same line
export function renderOptionLabel(info: EntityDisplayInfo): string
// Returns: 'Primary (secondary)'  — or just 'Primary' if no secondary
```

**Checklist:**
- [x] Create `src/utils/entity-display.ts` with `EntityDisplayInfo` type
- [x] Implement `getAgencyDisplay`, `getStopDisplay`, `getRouteDisplay`, `getTripDisplay`
- [x] Implement `getServiceDisplay`, `getShapeDisplay`, `getLevelDisplay`,
      `getPathwayDisplay`, `getFareAttributeDisplay`, `getNetworkDisplay`, `getAreaDisplay`
- [x] Implement `renderCardLabel(info)`
- [x] Implement `renderOptionLabel(info)`
- [x] Export all getters and helpers; run `npm run typecheck` to confirm no issues

---

## Phase 2 — Apply Display Labels Everywhere ✅ DONE

Update every place in the UI that currently shows a name without an ID (or an ID without a
name). Use the getters and helpers from Phase 1.

### 2.1 — Home page (`src/modules/page-content-renderer.ts`)

Currently: `agency_name || agency_id` (name OR id, never both).

- [x] Agency cards: use `getAgencyDisplay` + `renderCardLabel`
- [x] Service/calendar cards: use `getServiceDisplay` + `renderCardLabel`
  - Services have no name field, so only `service_id` is shown — no change in visual output,
    but now goes through the consistent abstraction

### 2.2 — Agency view (`src/modules/agency-view-controller.ts`)

Currently: `route_short_name || route_id` for route cards.

- [x] Route list cards: use `getRouteDisplay` + `renderCardLabel` so both short name and
      `route_id` appear when a short name exists

### 2.3 — Timetable (`src/modules/timetable-renderer.ts`)

- [x] **Trip column headers**: currently shows raw `trip_id` as cell text with headsign as
      tooltip. Change to `getTripDisplay` + `renderCardLabel` so headsign (if present) is
      primary and `trip_id` is the subtext. Keep the existing title attribute for full hover.
- [x] **Stop rows in timetable body**: currently `stop_name || stop_id`. Change to
      `getStopDisplay` + `renderOptionLabel` for the `<option>` text (stop-change dropdown).
- [x] **Stop-change dropdown** (timetable stop selector): currently `stop_name || stop_id`.
      Change to `getStopDisplay` + `renderOptionLabel` for the `<option>` text.

### 2.4 — Stop detail panel (`src/modules/stop-view-controller.ts`)

The panel header currently shows stop name. The PK is shown only in the disabled form field
below. Make the ID visible in the panel header itself.

- [x] Panel title/header area: use `getStopDisplay` + `renderCardLabel` so `stop_id` appears
      as subtext directly under the stop name in the header.

### 2.5 — Route/trip detail headers

Identify where route and trip detail headers are rendered (likely in `page-content-renderer.ts`
or inline in controller HTML strings) and apply `getRouteDisplay`/`getTripDisplay` +
`renderCardLabel`.

- [x] Find and update route detail header (in `renderRoute` in `page-content-renderer.ts`)
- [x] Find and update trip detail header (no dedicated trip detail view exists)

### 2.6 — Service dropdowns

Any `<select>` that lists services (e.g., the service filter in the timetable/schedule view)
currently shows only `service_id`. Apply `getServiceDisplay` + `renderOptionLabel`.

- [x] Audit all `<select>` elements that populate with services and update them
      (route view service selector in `page-content-renderer.ts`)

---

## Phase 3 — Lock PKs in CSV File Editor ✅ DONE

The raw CSV editor in `src/modules/editor.ts` renders every cell as an editable `<input>`.
PK-component fields must be rendered as read-only.

### 3.1 — Detect PK columns

When the editor opens a file, resolve the table name from the filename (strip `.txt`), then
call `getGTFSPrimaryKey(tableName)` from `src/utils/gtfs-primary-keys.ts`. Store the resulting
`fields` array (may be empty for `all_fields` tables).

- [x] Import `getGTFSPrimaryKey` in `editor.ts`
- [x] When building the table, compute `pkFields: Set<string>` from the PK config
- [x] For `all_fields` type tables, treat every column as a PK (lock all cells)
- [x] For `none` type tables (feed_info), lock nothing (single row, no identity concept)

### 3.2 — Render PK cells as read-only

For each cell, if `pkFields.has(header)`, render a read-only cell instead of an input:

```html
<!-- Read-only PK cell -->
<td class="bg-base-200 opacity-70 px-2 select-text">
  <span class="font-mono text-sm flex items-center gap-1">
    <svg ...lock-icon...></svg>
    {value}
  </span>
</td>
```

The cell should be visually distinct (muted background) but the value should be selectable
and copyable. Do not use `<input disabled>` here — disabled inputs are not selectable in
all browsers.

- [x] Implement read-only cell template in `editor.ts`
- [x] Apply to all PK-component columns during table render
- [x] Verify composite PK tables (`stop_times`, `shapes`, `calendar_dates`, `frequencies`,
      `fare_products`, `fare_leg_rules`, `translations`) all lock the correct fields
- [x] Verify `all_fields` tables (`transfers`, `fare_rules`, `fare_transfer_rules`,
      `stop_areas`, `route_networks`, `attributions`, etc.) lock every column

### 3.3 — Ensure change events skip PK cells

The editor's change/input event listener currently fires for all cells. Confirm it cannot
receive events from the new read-only cells (they are `<span>`, not `<input>`, so no
change events will fire — verify this is sufficient).

- [x] Confirm event delegation in `editor.ts` targets `input` elements, not `td` elements

---

## Phase 4 — Stop Creation Modal ✅ DONE (pending smoke test)

Replace the auto-generate-and-insert flow with a modal that collects the stop ID before
inserting.

### 4.1 — Extend `modal-utils.ts`

Two minimal changes needed:

**a) Body wrapper**: change `<p class="py-4">` → `<div class="py-4">` so form inputs inside
the body are valid HTML (a `<p>` cannot contain block/form elements).

**b) Keep-open support**: change the `onClick` return type from `void | Promise<void>` to
`boolean | void | Promise<boolean | void>`. If the callback returns `true`, the modal stays
open and buttons are re-enabled. Any other return value (including `undefined`) closes the
modal as before. This lets validation failures keep the modal alive without restructuring
the abstraction.

```typescript
// Updated ModalAction
export interface ModalAction {
  label: string;
  className?: string;
  onClick: () => boolean | void | Promise<boolean | void>;
}
```

In the event listener, after `await options.actions[idx].onClick()`, check the return value:
```typescript
const keepOpen = await options.actions[idx].onClick();
if (keepOpen === true) {
  // re-enable buttons, do not remove modal or resolve
  modal.querySelectorAll('button').forEach((b) => (b.disabled = false));
  return;
}
document.body.removeChild(modal);
resolve();
```

**c) `onMount` hook**: add `onMount?: () => void` to the options, called immediately after
`document.body.appendChild(modal)`. Used for auto-focusing the stop ID input.

- [x] Edit `src/modules/modal-utils.ts`: `<p class="py-4">` → `<div class="py-4">`
- [x] Update `ModalAction.onClick` return type to `boolean | void | Promise<boolean | void>`
- [x] Update the click handler to check the return value and conditionally stay open
- [x] Add `onMount?: () => void` to the options interface and call it after `appendChild`

### 4.2 — Add UUID suggestion helper

In `src/modules/interaction-handler.ts` (or a small inline function), generate the suggested
stop ID using `crypto.randomUUID()`. This gives a universally unique value the user can
accept or replace.

- [x] Add `generateSuggestedStopId(): string` that returns `crypto.randomUUID()`

### 4.3 — Replace auto-insert with modal flow

Rewrite `handleAddStopClick` in `src/modules/interaction-handler.ts`:

**New flow:**
1. Capture `{ lng, lat }` from the click event.
2. Generate `suggestedId = crypto.randomUUID()`.
3. Call `showModal` with:
   - **title**: `"New Stop"`
   - **body** (HTML string):
     ```html
     <label class="label"><span class="label-text">Stop ID</span></label>
     <input
       id="new-stop-id-input"
       type="text"
       class="input input-bordered w-full font-mono"
       value="{suggestedId}"
     />
     <p class="text-xs opacity-60 mt-2">
       The Stop ID cannot be changed after creation.
     </p>
     ```
   - **actions**: `[{ label: "Cancel", onClick: () => {} }, { label: "Create Stop", className: "btn-primary", onClick: createStop }]`
4. In the `createStop` action callback:
   a. Read `(document.getElementById('new-stop-id-input') as HTMLInputElement).value.trim()`
   b. If empty: show an inline error message in the modal body (e.g., set a `<p id="stop-id-error">` element's text to `"Stop ID is required"`) and **return `true`** to keep the modal open.
   c. If the ID already exists (check against `gtfsParser.getFileDataSync('stops.txt')`): show the same inline error `"Stop ID already exists"` and **return `true`**.
   d. Otherwise: build and insert the `GTFS.Stop` record as before, call
      `this.callbacks.onStopCreated(stopId)`, and return `undefined` to close the modal.
5. On Cancel: return `undefined` (modal closes, nothing inserted). Additionally, exit "add
   stop" mode (call `this.callbacks.onCancelAddStop()` or equivalent so the map cursor
   resets and the toolbar reflects that we are no longer in add-stop mode).
6. On successful Create Stop: after inserting the record and calling
   `this.callbacks.onStopCreated(stopId)`, ensure the UI navigates to / focuses the newly
   created stop (e.g., open the stop detail panel for that stop).

The inline error element should be present in the body HTML from the start (empty text,
hidden via `class="hidden"`), and toggled visible on failure. This avoids layout shift
from injecting new elements.

- [x] Rewrite `handleAddStopClick` to defer insertion until modal confirmation
- [x] Implement `createStop` callback that reads input, validates, and inserts
- [x] Add empty-ID and duplicate-ID error notifications
- [x] Remove the old `stop_${Date.now()}` generation logic entirely
- [x] On Cancel: exit add-stop mode (reset cursor/toolbar state)
- [x] On Create Stop success: navigate to / focus the newly created stop
- [x] Smoke-test: add a stop, verify it appears with the chosen ID and is focused; cancel a
      stop, verify nothing is inserted and add-stop mode is exited; try a duplicate ID,
      verify error notification appears

### 4.4 — Auto-focus the input

Use the `onMount` hook added in 4.1 to focus and select the stop ID input immediately after
the modal appears, so the user can type a replacement ID without manually clicking or
clearing the UUID.

- [x] In `handleAddStopClick`, pass `onMount: () => { (document.getElementById('new-stop-id-input') as HTMLInputElement).focus(); (document.getElementById('new-stop-id-input') as HTMLInputElement).select(); }`

---

## Phase 5 — QA and Cleanup

- [ ] Run `npm run typecheck` — fix all type errors
- [ ] Run `npm run lint` — fix all lint warnings
- [ ] Run `npm test` — confirm existing tests pass
- [ ] Manual smoke test each entity type:
  - Create agency, route, trip, service — confirm IDs cannot be changed in form views
  - Create stop via map click — confirm modal appears, UUID pre-filled, input focused,
    cancel works, duplicate ID is rejected, valid ID inserts and navigates correctly
  - Open `stops.txt` in Files view — confirm `stop_id` column is visually locked
  - Open `stop_times.txt` in Files view — confirm `trip_id` and `stop_sequence` are locked
  - Open `transfers.txt` — confirm all columns are locked
  - Open `feed_info.txt` — confirm no columns are locked
- [ ] Confirm PKs are visible alongside names in:
  - Home page agency cards
  - Route list under an agency
  - Timetable trip headers (trip_id as subtext under headsign)
  - Timetable stop rows (stop_id as subtext under stop name)
  - Stop detail panel header
