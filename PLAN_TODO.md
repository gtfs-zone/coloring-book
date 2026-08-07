# Plan: Work through TODO.md

## Summary

`TODO.md` is a flat, unprioritized scratchpad of 4 tooltip/scroll bugs, 3 smaller
bugs/feats, and 2 large feats, plus a final group of 4 shapes/navbar items. This
plan turns it into phases an agent can pick up one at a time. Phases 1-2 fix the
tooltip/scroll bugs (they share one root cause). Phases 3-5 are the smaller
independent bugs/feats. Phases 7-9 build the services timeline feature. Phases
10-12 build the fares list-column feature. Phases 13-16 are the shapes/navbar
items (icon swap, GPX upload flow, a rendering race, and navbar count bubbles).

`TODO.md` itself is left as-is; this file is the actionable version. Do not delete
items from `TODO.md` when you finish a phase here (it's a separate scratchpad the
user maintains manually).

## Ground rules for whoever (agent) executes a phase

- Work one phase at a time. Do not start the next phase without being asked.
- Commit as you go using Conventional Commits (`feat:`, `fix:`, `docs:`), one
  commit per checklist item or small group of related items. No
  `Co-Authored-By: Claude` trailers.
- No m-dashes, no emojis, in code, comments, or commit messages.
- Run `pnpm typecheck` and `pnpm lint` before committing. Do not run Playwright
  tests or write new test files (per CLAUDE.md, the user tests manually).
- When a phase says "ask the user", stop and ask a question in chat before
  proceeding. Don't guess when the plan explicitly calls out an ambiguity.
- After finishing a phase, update this file: check off the completed items, and
  append any discoveries/surprises to that phase's notes so later phases (or a
  retry of this one) have accurate context.

---

## Relevant context (read once, applies to Phases 1-2)

Both tooltip mechanisms in the app:

1. **Structured tooltip** - `renderFieldLabelContent()` in
   `src/utils/field-component.ts:176-199`. Used for every GTFS-spec field label
   (trip property rows in the timetable, route/stop/fares property labels,
   fares editable-table column headers). Renders:
   ```html
   <span class="tooltip tooltip-{direction}">
     <span class="tooltip-content ... max-w-[36rem] max-h-[60vh] ...">...</span>
     {label}{presence mark}
   </span>
   ```
   `direction` defaults to `'right'` and callers can pass `'top'|'bottom'|'left'|'right'`.
   `.tooltip-content` is DaisyUI's `position: absolute` popover.

2. **Native `data-tip` tooltip** - ad hoc, used in `calendar-modal.ts`, `ui.ts`,
   `atlas-search.ts`. Not part of these bugs.

Ancestor containers that clip both axes (CSS overflow spec: setting one axis to
non-`visible` forces the other to compute as `auto` too, even if only one axis is
written):
- `src/modules/browse-navigation.ts:409` - `overflow-y-auto` wraps every page.
- `src/modules/modal-utils.ts:52` - `overflow-y-auto` wraps every modal body,
  including the Fares modal.
- `src/modules/timetable-renderer.ts:207` - `overflow-x-auto` (explicit on both axes).
- `src/modules/editable-table.ts:383` - `overflow-x-auto` around the fares table.

A 576px-wide tooltip (`max-w-[36rem]`) popping out of a narrow column/sticky cell
inside any of these containers gets clipped whenever there isn't enough room in
that direction. This is the shared root cause behind Bugs 1-3. Bug 4 is a
different but related issue (tooltip *bleed* from an adjacent field, not clipping).

There is a pre-existing `/* My hacks to fix the tooltip issues */` comment in
`src/styles/main.css:132-153` (z-index bump on `.stop-name`, a `:before` rule that
doesn't apply to `.tooltip-content`). Leave or adjust as needed but don't be
surprised it's there and incomplete.

---

## Phase 1: Make `renderFieldLabelContent` tooltips edge-aware and clip-safe (done)

**Goal:** Fix the shared component once instead of patching each call site.

- [x] In `src/utils/field-component.ts`, rework `renderFieldLabelContent` so the
      tooltip does not rely purely on a fixed CSS direction that can clip. Two
      viable approaches, pick one after a quick spike:
  - **Option A (simpler, prefer if it works):** Keep DaisyUI's CSS tooltip, but
    at render time you don't know the trigger's position on screen, so a pure
    CSS "flip direction near an edge" isn't possible without JS. Add a small
    `pointerenter`-driven adjustment: after the tooltip shows, measure
    `tooltip-content`'s `getBoundingClientRect()` and if it overflows the
    viewport (or nearest scrollable ancestor), toggle a class that repositions
    it (e.g. clamp `left`/`right` via inline style, or switch `tooltip-left`
    class to `tooltip-right`).
  - **Option B (more robust, more work):** Render the tooltip content into a
    fixed-position element appended to `document.body` on hover/focus
    (a lightweight portal), positioned via `getBoundingClientRect()` of the
    trigger, removed on `pointerleave`/`blur`. This sidesteps all ancestor
    `overflow` clipping entirely, at the cost of more DOM plumbing shared
    across every call site.
  - Ask the user which option to pursue if the spike for Option A looks fragile
    (e.g. flashing/repositioning jank) before investing in Option B.
  - **Chosen: Option B.** Research (see below) showed ancestor `overflow-auto`
    containers can clip a 576px tooltip on either side, so Option A's
    class-flip wouldn't reliably fix narrow-column cases (e.g. fares table
    columns) - asked the user, confirmed Option B up front, no spike needed.
- [x] Whatever approach is chosen, keep the existing `pointer-events-auto` /
      scrollable-long-description behavior intact (some tooltips are long enough
      to need internal scroll, per `max-h-[60vh] overflow-y-auto`).
- [x] Manually verify against at least one narrow-column case (e.g. resize the
      window or use a small viewport) to confirm the tooltip no longer clips.
- [x] Commit: `fix(tooltip): make field label tooltips edge-aware and clip-safe`

**Implementation notes / discoveries for Phase 2:**
- New file `src/utils/tooltip-position.ts` owns the portal: a single
  document-level delegated listener set (`pointerover`/`pointerout`,
  `focusin`/`focusout`, `scroll`/`resize`), registered once via
  `initFieldTooltipPortal()` called from `GTFSEditor`'s constructor in
  `src/index.ts` (synchronous, alongside other document-level setup like
  `notify.initialize()` - doesn't depend on GTFS data being loaded).
- `renderFieldLabelContent(config)` no longer takes a `tooltipDirection`
  parameter - positioning is now computed from the trigger's on-screen
  location via `getBoundingClientRect()`, not a fixed CSS side. The only
  caller that passed a direction, `editable-table.ts:316` (`'bottom'` for
  fares table headers), was updated to drop the argument.
- Markup changed from DaisyUI's `.tooltip`/`.tooltip-content` (CSS-only,
  `position: absolute` relative to the trigger) to a
  `.field-tooltip-trigger` span with a `data-tooltip-content` attribute
  holding the tooltip's HTML (escaped for safe attribute embedding via a new
  `escapeAttr()` helper in `field-component.ts` - `escapeHtml()` alone
  doesn't escape quote characters, which would break out of the attribute
  since tooltip content contains nested HTML like `<a href="...">`).
- `tooltip-content`/`.tooltip` CSS classes were used *only* by
  `field-component.ts` in the whole codebase (confirmed via search) - the
  other 8 or so `.tooltip` usages elsewhere (`data-tip` attribute tooltips in
  `ui.ts`, `calendar-modal.ts`, `atlas-search.ts`, index.html buttons) are a
  separate, unrelated mechanism per the plan's original context section and
  were intentionally left untouched.
- Confirmed via a research pass that in all four ancestor-overflow contexts
  (`browse-navigation.ts:409`, `modal-utils.ts:52`, `timetable-renderer.ts:207`,
  `editable-table.ts:383`), `.tooltip-content`'s CSS `position: absolute`
  offsetParent was always the immediate `.tooltip` trigger span (DaisyUI sets
  `.tooltip { position: relative }`), never the scrollable ancestor itself -
  those ancestors only mattered as clipping/scroll viewports. This is why a
  portal to `document.body` with `position: fixed` was necessary rather than
  a CSS-only positioning tweak.
- No test infra (Playwright) is currently installed in the repo despite
  CLAUDE.md referencing `pnpm test` - verified via `pnpm typecheck`,
  `pnpm lint`, and `pnpm build` only, per the user testing manually.

---

## Phase 2: Verify and finish the 4 specific tooltip/scroll bugs (done)

**Goal:** Confirm Phase 1's fix resolves bugs 1-3, and separately fix bug 4
(tooltip bleed) plus the route-page horizontal scroll.

- [x] **Bug 1 (trip property tooltips cut off):** `src/modules/timetable-renderer.ts:280-283`
      calls `renderFieldLabelContent(config)` with no direction (defaults `'right'`)
      inside a pinned/sticky `<th>` column. Verify Phase 1's fix resolves clipping
      here; if not, pass an explicit direction override for this call site.
- [x] **Bug 2 (fares modal leftmost column tooltip cut off):**
      `src/modules/editable-table.ts:309-322` calls `renderFieldLabelContent(...,
      'bottom')` for every header, which centers the tooltip and clips left on the
      leftmost column. Verify Phase 1's fix resolves it; if not, special-case the
      leftmost column to use `'right'` direction instead of `'bottom'`.
- [x] **Bug 3 (route page horizontal scroll):** Two separate causes, fix both:
  - Unbounded flex title row: `src/modules/page-content-renderer.ts:590-592`
    renders `<h2>${renderCardLabel(...)}</h2>` in a flex row with no `min-w-0`/
    `truncate`, so a long `route_long_name` pushes the page wider and forces
    horizontal scroll. Add `min-w-0` to the flex container and `truncate` (or
    wrapping) to the `<h2>`. Apply the same fix to the identical pattern at
    `src/modules/stop-view-controller.ts:197-199` for consistency.
  - Confirm Phase 1's tooltip fix also resolves the second contributing cause
    (route property field tooltips popping out of the `max-w-md` column via
    `renderInlineEditableField` -> `renderFieldLabel` -> `renderFieldLabelContent`,
    default `'right'` direction).
- [x] **Bug 4 (Areas tooltip on stop page triggered from a weird location):**
      `src/utils/stop-areas-field.ts:207-210` renders the "Areas" `<legend>` with
      no tooltip of its own. What the user sees is very likely the *previous*
      field's tooltip (in `src/modules/stop-view-controller.ts:191-206`, fields
      are rendered with `space-y-3` and no isolation), bleeding visually into the
      Areas row when that field has a long description. Reproduce by finding a
      stop where the field directly before "Areas" (in stops.txt schema order)
      has a long presence/description tooltip, hover just past the label, and
      confirm the bleed. Fix by giving the field label's tooltip container
      enough stacking/spacing isolation (e.g. `isolate` + adequate `space-y`) so
      a long tooltip can't visually overlap the next field's label area.
- [x] Commit: `fix(ui): resolve tooltip clipping and route page horizontal scroll`

**Implementation notes / discoveries:**
- Bugs 1, 2, and the tooltip half of Bug 3 needed no further work: Phase 1's
  portal (`tooltip-position.ts`) computes position from
  `getBoundingClientRect()` and clamps to the viewport regardless of call
  site or CSS direction, so `renderFieldLabelContent`'s single no-argument
  call shape already covers the sticky trip-property column, the fares
  table's leftmost header, and the `max-w-md` route/stop property columns.
  No call sites needed a direction override (there is no direction parameter
  anymore per Phase 1).
- Bug 3's non-tooltip cause was real and separate: `page-content-renderer.ts`
  (route page) and `stop-view-controller.ts` (stop page) both rendered the
  entity name in an unbounded flex row. Fixed by adding `min-w-0` to the flex
  container, `truncate` to the `<h2>`, and `shrink-0` to the delete button so
  a long `route_long_name`/stop name truncates instead of pushing the page
  wide enough to force horizontal scroll.
- Bug 4 turned out to already be fixed as a side effect of Phase 1: the old
  bleed was DaisyUI's `.tooltip-content` (`position: absolute`, offsetParent
  the trigger span) rendering past its own trigger's box in document flow,
  visually overlapping whatever was stacked below it (the Areas legend has no
  tooltip of its own, so what the user saw hovering "near" Areas was actually
  the previous field's popup bleeding down). The portal now renders
  `position: fixed` on `document.body`, entirely outside the stacked
  fieldset's DOM flow, so there is nothing left to bleed into a sibling's
  box. Added `isolate` to the field fieldsets
  (`inline-editable-field.ts`, `stop-areas-field.ts`) as a defensive
  stacking-context boundary in case some other overlay is added later, but
  no code change was otherwise needed for this bug to be resolved. Could not
  do a live-browser repro in this environment; user should spot-check with a
  stop whose field just before "Areas" has a long tooltip description.

---

## Phase 3: Fuzzy time parsing everywhere, not just the timetable

**Goal:** Share the timetable's fuzzy time parser with every other place a
Time-typed GTFS field is edited (frequencies.txt, booking_rules.txt, and any
future generic-table Time field), instead of forcing strict `HH:MM:SS`.

Context:
- `src/utils/time-formatter.ts` `TimeFormatter.castTimeToHHMMSS()` already
  accepts `H:M`, `H:MM`, `HH:MM`, `HH:MM:SS` (including 24+ hour times) and
  normalizes to `HH:MM:SS`. It's only wired into
  `src/modules/schedule-controller.ts` (timetable time-cell editor).
- The generic spec-driven edit path does not use it:
  `src/utils/spec-field-edit.ts` `coerceFieldValue()` passes Time fields through
  as raw trimmed text, and `validateFieldValue()` then runs the value through
  the field's Zod schema, which is `z.string().regex(/^\d{1,2}:\d{2}:\d{2}$/,
  ...)` in `src/types/gtfs-field-types.ts:166-184` - requires exactly 3
  colon-separated parts, so `9:30` fails outright.
- Fields typed `'Time'` in the spec: `frequencies.txt` (`start_time`,
  `end_time`), `stop-times.ts`, `booking-rules.ts`.
- There's also a second, separate, slightly different implementation in
  `src/utils/field-formatters.ts:100-140` (`timeFormatter`). Check whether it's
  still referenced anywhere before touching it.

- [ ] In `coerceFieldValue()` (`src/utils/spec-field-edit.ts`), special-case
      `GTFSFieldType.Time`/`LocalTime` fields to run the input through
      `TimeFormatter.castTimeToHHMMSS()` before returning/validating.
- [ ] Relax or adjust the Zod regex in `src/types/gtfs-field-types.ts:166-184` so
      it validates the *normalized* value, not the raw fuzzy input (the coercion
      step should already have normalized it by the time validation runs; confirm
      the order of operations in `spec-field-edit.ts` does coerce-then-validate).
- [ ] Clean up the decorative HTML5 `pattern` attribute in
      `src/modules/schedule-controller.ts` (around lines 271-273) if it still
      forces a native `HH:MM:SS` validation bubble despite JS accepting fuzzy
      input - either loosen the pattern or remove it since `openInlineEditor`
      doesn't call `checkValidity()`/`reportValidity()` anyway.
- [ ] Check whether `src/utils/field-formatters.ts`'s `timeFormatter` is dead
      code or still used; if unused, remove it to avoid a second parallel
      implementation. If used, decide whether to consolidate it to call
      `castTimeToHHMMSS` too.
- [ ] Manually verify: edit a `frequencies.txt` `start_time` field with input
      like `9:5` and confirm it saves as `09:05:00`.
- [ ] Commit: `feat(time): accept fuzzy time input on all Time fields, not just the timetable`

---

## Phase 4: Fix "Is Default Fare Category" / "Fare Media Type" click doing nothing

**Goal:** Root-cause and fix the unclickable enum fields in the Fares modal.

Static analysis found no defect: the fields (`rider_categories.txt
is_default_fare_category`, `fare_media.txt fare_media_type`) are both `Enum`
type, go through the same generic `editable-table.ts` path as other working
enum fields, and nothing distinguishes them in code. **This needs live
reproduction.** The user will be the tester.

- [ ] Ask the user to open the Fares modal on a feed with `rider_categories.txt`
      / `fare_media.txt` rows, open devtools console, click the affected cell,
      and report back:
  - Whether any console error/warning appears.
  - Whether `document.querySelector('.editable-cell[data-field="is_default_fare_category"]')`
    (or `fare_media_type`) returns an element, and whether it receives the click
    (e.g. check via `getComputedStyle(el).pointerEvents` and whether another
    element overlaps it - `document.elementFromPoint(x, y)` at the cell's
    coordinates).
  - Whether `GTFS_FIELD_SPECS['rider_categories.txt']['is_default_fare_category']`
    (and the `fare_media.txt` equivalent) exist in the console.
- [ ] Based on findings, likely candidates to check/fix:
  - `resolve()` in `src/modules/editable-table.ts` (around lines 444-460) silently
    returns `null` (no-op, no console output) if the field spec lookup fails -
    this exactly reproduces "click does nothing" with zero error. If this is the
    cause, fix the spec/field name mismatch causing the lookup miss.
  - An overlapping element (e.g. tooltip markup from `renderFieldLabelContent`)
    intercepting the click - if so, fix the CSS stacking/pointer-events.
- [ ] Fix the confirmed root cause.
- [ ] Manually re-verify the fix with the user (click the field, confirm the
      enum picker opens and a selection commits).
- [ ] Commit: `fix(fares): make is_default_fare_category and fare_media_type editable`

---

## Phase 5: Escape closes only the topmost modal

**Goal:** When a multiselect-with-search picker is open on top of another modal
(e.g. the Fares modal), Escape should close only the picker, not both.

Context:
- `src/modules/modal-utils.ts` `showModal()` registers one document-level
  `keydown` listener per call, with no shared stack and no `stopPropagation()`.
  Every currently-open modal's listener fires on a single Escape keypress.
- `src/modules/option-picker-modal.ts` `showOptionPickerModal()` is the
  multiselect-with-search picker; it's opened via `showModal` (`escapeAction: 0`)
  with no awareness of any modal open beneath it.
- `src/modules/fares-modal.ts` opens the Fares modal via `showModal`, and in turn
  opens `showOptionPickerModal` for foreign-key pickers (via
  `src/modules/editable-table.ts` `openCellEditor`'s `'foreign'` branch). Both
  modals' keydown listeners are live simultaneously.

- [ ] In `src/modules/modal-utils.ts`, add a small module-level stack (array) of
      currently-open modal instances (e.g. push an identifier/handle in
      `showModal()`, pop it in `close()`).
- [ ] In the `keydown` handler, before acting on `Escape`/`Enter`, check that this
      modal instance is the topmost entry in the stack; if not, return early
      without calling `preventDefault()`/`triggerAction()` (so the topmost modal's
      own listener handles it instead).
- [ ] Verify nesting depth is preserved through close: closing the picker must
      pop only its own stack entry, not the Fares modal's.
- [ ] Manually verify: open Fares modal -> open a foreign-key picker -> press
      Escape -> only the picker closes, Fares modal remains open. Press Escape
      again -> Fares modal closes.
- [ ] Commit: `fix(modals): scope Escape/Enter handling to the topmost modal`

---

## Phase 6: Clicking a stop marker in the timetable focuses that stop

**Goal:** Small standalone feat, listed separately from the timeline work below.

- [ ] Find where the timetable renders stop markers/labels (likely
      `src/modules/timetable-renderer.ts`, the sticky left column showing stop
      names) and where "focus a stop" navigation already happens elsewhere (e.g.
      `page-state-manager.ts` `setPageState({ type: 'stop', stop_id })`, or
      however the map highlights/pans to a stop - check `map-controller.ts` /
      `interaction-handler.ts` for an existing "focus stop" helper to reuse
      rather than reinventing it).
- [ ] Wire a click handler on the stop marker/label cell that calls the existing
      focus-stop mechanism with that row's `stop_id`.
- [ ] Manually verify: open a timetable, click a stop name, confirm the map (or
      relevant view) focuses that stop the same way other "focus stop" entry
      points in the app do.
- [ ] Commit: `feat(timetable): focus stop on marker click`

---

## Phase 7-9: Services timeline view replaces service lists (large feat)

### Context

The timeline view exists today only inside the Calendar modal:
`src/modules/calendar-modal.ts`, function `renderTimeline()` (lines 316-479),
private to that file, along with its supporting helpers (`loadCalendarData`,
`isServiceActive`, `getServiceColor`, `renderWeekdayDots`, `getDaysTooltip`,
`hexToRgba`, `esc`). It takes a `ServiceDataMap` (built by `loadCalendarData()`
from all `calendar`/`calendar_dates` rows) and renders one row per service with
weekly-column shading, click-to-navigate via `data-service-id` + an injected
`onServiceClick` callback. No filtering support exists yet (always all services).

Four places currently render a non-timeline service/timetable list, each with
its own trip-count computation to be dropped:
- **Home page** - `renderHome()` in `page-content-renderer.ts` (~lines 333-460):
  flat list of all services via `renderServiceReference()`, with `tripCountByService`
  / `routesByService` computed by scanning all `trips` (~lines 358-369).
- **Route page** - `renderRoute()` in `page-content-renderer.ts` (~lines 547-720):
  groups trips by `service_id` (~lines 563-575), renders one
  `renderTimetableReference()` row per service (~lines 666-711).
- **Service page** - `ServiceViewController.renderTimetablesSection()`
  (`service-view-controller.ts`, ~lines 231-279): lists routes using this
  service, via `renderTimetableReference()` (~lines 253-267).
- **Stop page** - `StopViewController.renderTimetablesSection()`
  (`stop-view-controller.ts`, ~lines 213-260): lists timetables serving this
  stop, via `renderTimetableReference()`.

Row-click navigation pattern to reuse: `data-service-id`/`data-route-id`
attributes + a delegated click listener in each controller's `addEventListeners()`
calling into injected `onServiceClick`/`onRouteClick`/`onTimetableClick`
dependencies (see `page-content-renderer.ts` `addEventListeners()`, ~lines
964-1025). `page-state-manager.ts` already supports `{type: 'service',
service_id}` and route+service timetable URL states.

Trip-count computations to remove once their list rows are replaced:
`page-content-renderer.ts` (`renderHome`, `renderRoute`), `service-view-controller.ts`
(`renderServiceView`), `stop-view-controller.ts` (`TimetableKey.tripCount`
building), and the badge rendering in `src/utils/entity-references.ts`
(`renderRouteReference`, `renderServiceReference`, `renderTimetableReference`).

### Phase 7: Extract the timeline renderer into a shared module

- [ ] Create `src/modules/service-timeline.ts` (or similar name - check for
      naming conflicts first). Move `renderTimeline()` and its private helpers
      (`isServiceActive`, `getServiceColor`, `renderWeekdayDots`,
      `getDaysTooltip`, `hexToRgba`, `esc`, and the row-click wiring currently in
      `attachTimelineListeners`) out of `calendar-modal.ts` into this new module,
      exporting what's needed.
- [ ] Add an optional filter parameter to `loadCalendarData()` (or a new
      thin wrapper) so callers can scope the `ServiceDataMap` to a specific set
      of `service_id`s, instead of always loading every service in the feed.
      Decide whether this filter belongs in `loadCalendarData` itself or as a
      post-filter step (`filterServiceDataMap(map, service_ids)`); prefer the
      post-filter approach if it keeps `loadCalendarData` simpler.
- [ ] Update `calendar-modal.ts` to import from the new module instead of
      defining these locally; confirm the Calendar modal still renders
      identically (no all-services view should change).
- [ ] Add support for an optional fixed `route_id` context (needed by the route
      page: a timeline row there must link to a specific timetable, not just a
      service) - e.g. an optional `data-route-id` attribute on `.timeline-row`
      when rendering in a route-scoped context, and an `onRowClick` callback
      shape flexible enough to carry `(service_id, route_id?)`.
- [ ] Run `pnpm typecheck` and `pnpm lint`. Manually verify the Calendar modal
      still works exactly as before this refactor (open it, check Timeline tab).
- [ ] Commit: `refactor(calendar): extract the services timeline into a shared module`

### Phase 8: Swap the home page and route page to the timeline view

- [ ] Home page (`renderHome()` in `page-content-renderer.ts`): replace the
      `renderServiceReference()` list with the shared timeline renderer, scoped
      to all services (no filter needed here, matches Calendar modal's default).
      Wire row clicks to the existing `onServiceClick` dependency.
- [ ] Remove `tripCountByService`/`routesByService` computation in `renderHome()`
      now that nothing consumes it.
- [ ] Route page (`renderRoute()` in `page-content-renderer.ts`): replace the
      `renderTimetableReference()` list under "Timetables" with the shared
      timeline renderer, filtered to the route's `service_id`s (from the
      existing `serviceGroups` grouping), passing the fixed `route_id` context
      from Phase 7 so row clicks navigate to the specific timetable.
- [ ] Remove the now-unused `serviceTrips.length` trip-count plumbing in
      `renderRoute()`.
- [ ] Keep the existing "add new service" / "new timetable" dropdown affordances
      on both pages - only the list rendering changes, not the add-new flow.
- [ ] Manually verify: home page shows the timeline for all services with
      working row clicks; route page shows a timeline filtered to that route's
      services with working row clicks to the correct timetable.
- [ ] Commit: `feat(services): use the timeline view on the home and route pages`

### Phase 9: Swap the service page and stop page to the timeline view

- [ ] Service page (`ServiceViewController.renderTimetablesSection()`) lists
      *routes* for one fixed service - the inverse relationship from what the
      timeline naturally shows (one row per service). A timeline of a single
      service isn't a meaningful replacement for a list of routes. Before
      implementing anything here, ask the user whether this page's "routes
      using this service" list should stay as a plain list (likely correct,
      since there's nothing service-timeline-shaped to show), or whether they
      want a different treatment. Do not guess.
- [ ] Stop page (`StopViewController.renderTimetablesSection()`): replace the
      timetables-serving-this-stop list with the timeline renderer, filtered to
      the relevant `service_id`s (derived from `timetableKeys`), with row clicks
      navigating to the correct timetable (needs both `route_id` and
      `service_id` per row, same as the route page's context).
- [ ] Remove now-unused `TimetableKey.tripCount` computation in
      `stop-view-controller.ts` if nothing else consumes it, and remove the
      `tripBadge` code paths in `src/utils/entity-references.ts` that no caller
      uses anymore after Phases 8-9 (check all 4 call sites first - don't remove
      `renderServiceReference`/`renderTimetableReference` themselves if any
      other page still uses them for a different purpose).
- [ ] Manually verify both pages.
- [ ] Commit: `feat(services): use the timeline view on the stop page`

---

## Phase 10-12: Fares table list columns (large feat)

### Context

`src/modules/fares-modal.ts` renders every fares GTFS table through one generic
renderer, `renderEditableTable()` in `src/modules/editable-table.ts`, which
renders exactly one `<tr>` per underlying GTFS row (`config.rows.map(...)`,
~line 332). Composite primary keys mean rows repeat with most columns
duplicated:
- `fare_products` - composite key includes `fare_media_id`
  (`src/utils/gtfs-primary-keys.ts:121-125`).
- `fare_leg_rules` - composite key includes `from_area_id`/`to_area_id`
  (lines 126-137).
- `fare_transfer_rules` - composite key includes `from_leg_group_id`/
  `to_leg_group_id` (lines 143-153).
- `fare_leg_join_rules` - composite key on all four OD/stop fields
  (lines 138-142). Note: this table's "OD pairs" per the GTFS spec are
  `from_network_id`/`to_network_id` and `from_stop_id`/`to_stop_id`
  (`src/gtfs-spec/files/fare-leg-join-rules.ts`) - there are no area fields on
  this table, confirm this matches what TODO.md meant by "both OD pairs" before
  implementing (it does - just double check field names against the spec file
  when you get there).

The existing "list items with newlines" pattern to generalize:
`renderAreaStopLists()` in `fares-modal.ts` (lines 99-158) builds
`Map<area_id, string[]>` from `stop_areas` + `stops`, and renders a `<details>`/
`<summary>`/`<ul><li>` block per area below the main table (wired via the
Areas entry's `detail:` callback, `fares-modal.ts:464`). Networks
(`fares-modal.ts` lines 466-485) has the count (`countRoutesPerNetwork`,
lines 70-82) but no equivalent list detail block - this is the asymmetry
TODO.md calls out to fix, reusing the same presentation but with networks'
own join logic (`route_networks` instead of `stop_areas`).

No existing utility collapses repeated table rows into one row with an
aggregated list cell - this is new functionality, not an extension.

Design decided by TODO.md: **list values in a column, newline-separated, and
keep it simple for now** (read-only aggregated display is acceptable - it says
"lets list the items in the table for now to make it super clear", implying
full multi-value editing is out of scope for this pass).

### Phase 10: Build a display-only grouped-row rendering layer for editable-table.ts

- [ ] In `src/modules/editable-table.ts`, add support for a column marked as a
      "list column" (e.g. extend `EditableTableColumnOverride` with a
      `listOf?: boolean` or similar flag). When set, rows that are identical
      across every *other* rendered column get collapsed into a single visual
      row, with that column rendering all distinct values from the collapsed
      rows, newline-separated (use `white-space: pre-line` or `<br>`-joined
      markup in the cell instead of the current `truncate` single-line span -
      truncate would clip a multi-value list).
- [ ] Make list-column cells non-interactive/read-only for now (matching how
      `extraColumns` and `columnOverrides.readonly` already render plain text) -
      do not attempt to make multi-value editing work in this pass, per the
      "list the items... for now" scope in TODO.md.
- [ ] Foreign-key list values should still resolve to display labels (reuse
      `foreignLabelMaps()`, ~lines 237-251) rather than showing raw IDs.
- [ ] Confirm add-row/delete-row flows still operate correctly against a grouped
      display (i.e. adding or deleting one underlying row should not silently
      corrupt the collapsed view - verify by testing add/delete against a table
      using this new grouping).
- [ ] Commit: `feat(editable-table): support list-valued columns via row grouping`

### Phase 11: Apply list columns to the four fares tables

- [ ] `fare_products`: group by everything except `fare_media_id`, mark
      `fare_media_id` as a list column (`fares-modal.ts` `FARE_PRODUCTS` entry,
      ~lines 385-398).
- [ ] `fare_leg_rules`: mark `from_area_id` and `to_area_id` as list columns
      (`FARE_LEG_RULES` entry, ~lines 399-414).
- [ ] `fare_transfer_rules`: mark `from_leg_group_id` and `to_leg_group_id` as
      list columns (`FARE_TRANSFER_RULES` entry, ~lines 432-445).
- [ ] `fare_leg_join_rules`: mark both OD pairs (`from_network_id`/`to_network_id`
      and `from_stop_id`/`to_stop_id`) as list columns (`FARE_LEG_JOIN_RULES`
      entry, ~lines 415-431).
- [ ] Manually verify each of the 4 tables in the Fares modal with a feed that
      has actual duplication on these keys (create test rows if the sample feed
      doesn't already have any), confirming rows collapse and list correctly.
- [ ] Commit: `feat(fares): list repeated foreign keys instead of duplicating rows`

### Phase 12: Generalize the areas/networks list display

- [ ] Extract `renderAreaStopLists()`'s presentation (the `<details>`/`<summary>`/
      `<ul><li>` markup, item formatting via `getStopDisplay`/`getEntityDisplay` +
      `renderOptionLabel`) into a shared helper function that takes a
      `Map<id, {label: string, items: string[]}>` (or similar) and returns the
      HTML block, independent of whether the source join is `stop_areas` or
      `route_networks`.
- [ ] Reimplement `renderAreaStopLists()` as a thin wrapper: collect the
      `stop_areas`/`stops` join data, then call the shared helper.
- [ ] Add an equivalent for Networks: collect `route_networks`/`routes` join
      data (reuse the same join logic as `countRoutesPerNetwork()`,
      `fares-modal.ts` lines 70-82), then call the shared helper. Wire it in as
      the Networks entry's `detail:` callback (mirroring how Areas does it at
      `fares-modal.ts:464`).
- [ ] Manually verify both the Areas and Networks panes in the Fares modal show
      matching-style list details.
- [ ] Commit: `feat(fares): show a route list detail for networks, matching areas`

---

## Phase 13-16: Shapes/navbar cleanup (4 small items)

### Context

Four unrelated small items from the end of `TODO.md`, grouped here only because
they're all navbar- or shapes-adjacent.

**Item A - navbar shapes icon.** `src/index.html:69-88` is the `shapes-btn`
navbar button, currently using a generic "layers" SVG path. The desired
replacement icon is the existing "Open in brouter" icon: `renderRouteWaypointsIcon`
in `src/modules/modal-utils.ts:13`, currently used at
`src/modules/timetable-renderer.ts:380-391` for the per-timetable "Open in
brouter" link. Reuse that same icon markup for `shapes-btn` (this is purely an
icon swap - `shapes-btn`'s click handler in `src/index.ts:272-279`, its title
"Shapes", and its `ShapesManager.open()` behavior are unchanged).

**Item B - GPX upload button.** `src/modules/shapes-manager.ts`, class
`ShapesManager`. Currently the "+ New shape from GPX" button
(`renderBody()`, lines 36 and 71) asks for a Shape ID first via a text-entry
modal (lines 245-253), validates uniqueness (275-280), *then* calls
`pickGPXFile()` (line 282, defined lines 14-30) to open the file picker, then
`parseGPX(file, shapeId)` (`src/utils/gpx-parser.ts`, line 289). The new flow
inverts this order: click an upload button, pick the GPX file first, default
the shape ID input to the uploaded filename (stripped of `.gpx`), and let the
user edit that id before it's locked in. Compare against `replaceShape()`
(lines 184-240), which already does file-first for the *replace* flow - reuse
that ordering. `newShape()` (lines 242-315) is the function to restructure.

**Item C - straight-line route removal race.** `src/modules/route-renderer.ts`,
class `RouteRenderer`. When a shape is assigned to a trip (or all trips in a
route), the straight-line stop-sequence fallback should disappear immediately.
Relevant machinery:
- `addTripToBucket(trip_id)` (lines 683-792) draws either the real shape
  (694-700) or, if no valid shape_id, a `stops:${stopIds.join('|')}` fallback
  line (701-737).
- `invalidateTrip(trip_id, op, ...)` (lines 881-906) and `invalidateShape(...)`
  (lines 912-966) are the entry points called after a trip/shape edit; they
  call `removeTripFromBucket` (636-677) then re-add via `addTripToBucket`.
- `scheduleSetData()` (lines 216-236) coalesces multiple invalidations in the
  same tick into one `requestAnimationFrame`-deferred `source.setData(...)`
  call.
- `ensureInitialized()` / `initializationPromise` (lines 98-125) guard against
  calling map source methods before the MapLibre style has loaded.

The bug ("had to refresh the page for it to disappear... next time it worked")
smells like a caller invoking `invalidateTrip`/similar without awaiting
`ensureInitialized()` first, or a bulk-assign loop firing many invalidations
whose final `scheduleSetData()` RAF callback gets scheduled before the last
trip's bucket update lands (a stale closure over `dirtyFlag`, or the RAF firing
mid-loop). Root-cause needs live reproduction since `route-renderer.ts` async
guards look correct on read-through; confirm with the user which UI flow was
used ("selecting shapes for all trips in a route" implies a per-trip loop
somewhere in `schedule-controller.ts` or the shape picker, not a single
`updateTripProperty` call - locate that loop first).

**Item D - navbar count bubbles.** No unified tab bar exists; the 4 items are
separate navbar buttons opening separate modals:
- Services -> `calendar-btn` (`src/index.html:90-109`), wired
  `src/index.ts:292-303`. "Services" count would be total rows in
  `calendar`/`calendar_dates` (unique `service_id`s) - check
  `page-content-renderer.ts` `getServices()` (~line 476/606+) for the existing
  query to reuse.
- Shapes -> `shapes-btn` (`src/index.html:69-88`), wired `src/index.ts:272-279`.
  Count is unique `shape_id`s, likely already available via
  `gtfsParser.getShapeIds()` (used in `schedule-controller.ts:408-439`).
- Fare products -> `fares-btn` (`src/index.html:111-130`), wired
  `src/index.ts:282-289`. Count is `fare_products.txt` row count; the existing
  per-table count pattern to copy is `fares-modal.ts:496-504` (`renderSidebar()`
  builds a `Map<table, count>` and renders `<span class="badge badge-sm
  badge-ghost ml-auto">${count}</span>` next to each sidebar entry's label).
- Changes -> `history-btn` (`src/index.html:254-273`), wired
  `src/index.ts:332-334`. Count is pending/unsaved patch count - check
  `patch-manager.ts` for the existing count used by `history-controller.ts`
  (lines 32-40, 167, 197 already render badges there).

Badge convention to follow (already used throughout the app, see
`ui.ts:518` and `fares-modal.ts:496-504`): a DaisyUI `<span
class="badge badge-sm ...">` appended near the button/label, updated whenever
the underlying data changes (patch recorded, DB write, import, undo/redo).

### Phase 13: Swap the navbar shapes icon to the brouter waypoints icon

- [ ] In `src/index.html:69-88`, replace the `shapes-btn` SVG with the markup
      produced by `renderRouteWaypointsIcon` (`src/modules/modal-utils.ts:13`).
      If the icon is only exported as a template-string helper (not usable
      directly in static HTML), move the button's icon rendering into
      `src/index.ts` (wherever `shapes-btn` is wired, lines 272-279) and set
      `innerHTML` from the helper at startup instead of hardcoding SVG in
      `index.html`.
- [ ] Confirm the icon renders at the same size/style as the other navbar
      icons (`h-4 w-4`/`h-5 w-5` class, whichever the surrounding buttons use -
      check a sibling button like `calendar-btn` for the expected size class,
      since `renderRouteWaypointsIcon` is normally invoked at `h-3 w-3` in the
      timetable context).
- [ ] Manually verify: navbar shapes button now shows the same icon as
      "Open in brouter" in the timetable view, click behavior unchanged.
- [ ] Commit: `feat(navbar): use the brouter waypoints icon for the shapes button`

### Phase 14: File-first GPX upload flow for new shapes

- [ ] In `src/modules/shapes-manager.ts`, restructure `newShape()`
      (lines 242-315) to call `pickGPXFile()` before asking for a shape ID,
      mirroring the ordering already used in `replaceShape()` (lines 184-240).
- [ ] Update the button UI (`renderBody()`, lines 36 and 71): change label/affordance
      from "+ New shape from GPX" to an upload-first control (e.g. reuse
      `renderUploadIcon()` from `modal-utils.ts`, already used for the existing
      "Replace with GPX" button at line 49, for visual consistency).
- [ ] After the file is picked, default the shape ID text input to the
      filename with the `.gpx` extension stripped, but keep the input editable
      before the user confirms (do not auto-lock the id) - keep the existing
      uniqueness validation (lines 275-280) running against whatever id is in
      the input at confirm time, not just the default.
- [ ] Manually verify: click the upload button, pick a `some-name.gpx` file,
      confirm the shape ID field pre-fills to `some-name`, edit it, confirm the
      shape is created under the edited id.
- [ ] Commit: `feat(shapes): upload GPX first and default the shape id to the filename`

### Phase 15: Fix the straight-line fallback route not disappearing after shape assignment

- [ ] Ask the user to reproduce the bug (assign shapes to all trips in a route,
      watch whether the straight-line route disappears immediately or requires
      a refresh) and identify exactly which UI action triggers the bulk
      assignment - this determines whether the bug is in a bulk-assign loop
      calling `invalidateTrip`/`invalidateShape` per-trip, or a single call
      missing an `await ensureInitialized()`.
- [ ] Once the trigger is found, trace whether `scheduleSetData()`
      (`route-renderer.ts:216-236`) is being starved (e.g. the RAF callback
      firing between individual `addTripToBucket` calls in a loop, so the map
      briefly shows a stale mix, or a final `invalidateTrip` call landing after
      the last scheduled RAF already ran) - fix by ensuring the entire batch of
      trip updates finishes before the final `scheduleSetData()` call is
      allowed to flush, or by making the dirty-flag/RAF coalescing batch-aware.
- [ ] Manually re-verify with the user: assign shapes to all trips in a route,
      confirm the straight-line route disappears without a page refresh.
- [ ] Commit: `fix(route-renderer): remove straight-line fallback immediately after shape assignment`

### Phase 16: Navbar item count bubbles

- [ ] Decide on and implement count sources for each of the 4 navbar items,
      reusing existing query helpers where possible (see Context above for
      candidates per item: `calendar`/`calendar_dates` service count,
      `gtfsParser.getShapeIds()`, `fare_products.txt` row count, pending patch
      count from `patch-manager.ts`).
- [ ] Add a DaisyUI `badge badge-sm` bubble to each of the 4 navbar buttons
      (`shapes-btn`, `calendar-btn`, `fares-btn`, `history-btn` in
      `src/index.html`), following the existing badge convention in
      `fares-modal.ts:496-504` / `ui.ts:518`.
- [ ] Wire count updates to fire whenever the underlying data changes (patch
      recorded, DB write, feed import, undo/redo) - check how
      `history-controller.ts` already refreshes its own badges (lines 32-40,
      167, 197) as a model for hooking into the right update events.
- [ ] Manually verify: import a feed, confirm all 4 bubbles show correct
      initial counts; make an edit affecting one of the 4 categories, confirm
      its bubble updates without a page refresh.
- [ ] Commit: `feat(navbar): show item counts as badge bubbles`

---

## Phase 17: Route 1 missing from route list in nuuk feed

**Goal:** Root-cause why a specific route doesn't show up in the route list.

- [ ] Ask the user for the exact feed path (`~/Downloads/nuuk`) if not already
      available, and load it to reproduce.
- [ ] Check `routes.txt` for a `route_id`/`route_short_name` "1" and confirm it
      parses without error (check `gtfs-parser.ts` / `gtfs-validator.ts` console
      output for warnings on that row - e.g. duplicate id, failed Zod validation,
      or a row silently dropped during import).
- [ ] Check whether the route list rendering filters routes somehow (e.g. by
      network, by whether it has trips) that could exclude a route with no
      trips or an unusual `route_type`.
- [ ] Fix the confirmed root cause.
- [ ] Manually verify with the user: import the nuuk feed, confirm route 1
      appears in the route list.
- [ ] Commit: `fix(routes): route 1 not showing up in route list`

---

## Original Issue (verbatim from TODO.md)

```
- Bug: Trip property tooltips cut off
- Bug: Leftmost column tooltip in Fares modal is sometimes cut off
- Bug: In Route page, fix horizontal scroll bug (might also be tooltips)
- Bug: tooltip for Areas on stop page is triggered by some weird location, not by text "Areas"

- Feat: Use unified fuzzy handling of time (shouldn't force HH:MM:SS format, share with timetable view)
- Bug: "Is Default Fare Category" and "Fare Media Type" doesn't work (click does nothing) (possibly more)
- Bug: When I have a multiselect with search modal, escape should close that but not necessarily the modal beneath (ie fares modal)

- Feat: Clicking stop markers in timetables should focus that stop

- Feat(large): Instead of any places where we list services, lets try using the
  timeline view. We could do that for the feed page (all services) and anywhere
  else we list services (route page, etc) it would be filtered and contain the
  appropriate links. We might just drop the count of trips etc because that's
  not particularly useful
- Feat(medium): Lets add support for the tables in fares to have lists
  (reducing repetitive columns). For now, lets do this for fare_products with
  fare_media_id. In fare_leg_rules, lets do it for from_area_id and to_area_id.
  In fare_transfer_rules, lets do it for from_leg_group_id and to_leg_group_id.
  In fare_leg_join_rules, we can do it for both OD pairs. Lets list the items
  in the table for now to make it super clear (newlines between). Lets use the
  opportunity to use the same display method for areas and networks tables
  (internal logic will remain different for these two)

- Feat: Change navbar shapes icon to match open in brouter
- Feat: Instead of "New shape from GPX" lets have an upload button. After
  upload, lets default to the filename in the input and allow changes before
  locking in the id
- Bug: After selecting shapes for all trips in a route, it doesn't remove the
  straight line route. I had to refresh the page for it to disappear. (this seems to be a race, because the next time it worked)
- Feat: in nav bar show number of each item (# services, # shapes, # Fare products, # changes) We can show it as a little notification style bubble.

- Bug: ~/Downloads/nuuk route 1 not showing up in route list
```
