# Plan: Work through TODO.md

## Summary

`TODO.md` is a flat, unprioritized scratchpad. This file is the actionable
version, ordered small-fixes-first. Phases 1-5 are quick, independent bugs and
feats. Phases 6-8 unify dangling reference handling into one coherent feature
(detect generically, find from the home page, fix at the use site). Phases 9-10
are the two stop/route diagram features shared with `../test-track`. Phases 11-12
build the services timeline; Phases 13-15 build the fares list-column feature.
Phases 16-17 are blocked on live reproduction and sit at the end deliberately.

`TODO.md` itself stays as the user's raw scratchpad. Do not delete items from it
when you finish a phase here.

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
- `src/modules/page-content-renderer.ts` contains a literal NUL byte (see
  Phase 10), so `rg`/`grep` silently skip it as binary. Use `rg --text` when
  searching that file until Phase 10 fixes it.

---

## Phase 1: Don't open the Files modal after loading a feed

**Goal:** Loading a feed should leave you on the map, not behind the raw-file
editor.

`src/modules/ui.ts` (~lines 299-303) unconditionally calls
`document.getElementById('files-modal').showModal()` at the end of the post-load
path, so the Files modal pops open every single time a feed is loaded.

- [ ] Delete that `showModal()` call only. Keep the `this.showFileList()` call
      immediately above it so the list stays populated for when the modal is
      opened deliberately.
- [ ] Leave the other open sites alone: `ui.ts:217-222` (the `files-btn` click
      handler), `ui.ts:564` (`showFileInEditor`) and `bottom-sheet.ts:219` are
      all explicit user actions.
- [ ] Manually verify: load a feed, confirm the map is visible and no modal
      appears; then click the Files button and confirm the list is populated.
- [ ] Commit: `fix(ui): stop opening the files modal after loading a feed`

---

## Phase 2: Escape closes only the topmost modal

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
      currently-open modal instances (push an identifier/handle in `showModal()`,
      pop it in `close()`).
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

## Phase 3: Swap the navbar shapes icon to the brouter waypoints icon

**Goal:** Purely an icon swap. `shapes-btn`'s click handler
(`src/index.ts:272-279`), its title "Shapes", and `ShapesManager.open()` are all
unchanged.

`src/index.html:69-88` is the `shapes-btn` navbar button, currently using a
generic "layers" SVG path. The desired replacement is the existing "Open in
brouter" icon: `renderRouteWaypointsIcon` in `src/modules/modal-utils.ts:13`,
used at `src/modules/timetable-renderer.ts:385`.

- [ ] Replace the `shapes-btn` SVG with the markup produced by
      `renderRouteWaypointsIcon`. Since the icon is a template-string helper
      rather than static markup, set `innerHTML` from `src/index.ts` (where
      `shapes-btn` is wired, lines 272-279) at startup instead of hardcoding SVG
      in `index.html`.
- [ ] Confirm the icon renders at the same size as sibling navbar icons: check
      `calendar-btn` for the expected size class, since `renderRouteWaypointsIcon`
      is normally invoked at `h-3 w-3` in the timetable context.
- [ ] Manually verify: navbar shapes button now shows the same icon as
      "Open in brouter" in the timetable view, click behavior unchanged.
- [ ] Commit: `feat(navbar): use the brouter waypoints icon for the shapes button`

---

## Phase 4: File-first GPX upload flow for new shapes

**Goal:** Pick the GPX file first, then name the shape, defaulting to the
filename.

Currently the "+ New shape from GPX" button (`src/modules/shapes-manager.ts`
`renderBody()`, lines 36 and 71) asks for a Shape ID first via a text-entry modal
(lines 245-253), validates uniqueness (275-280), *then* calls `pickGPXFile()`
(line 282, defined lines 14-30), then `parseGPX(file, shapeId)`
(`src/utils/gpx-parser.ts`, line 289). `replaceShape()` (lines 184-240) already
does file-first for the *replace* flow: reuse that ordering. `newShape()`
(lines 242-315) is the function to restructure.

- [ ] Restructure `newShape()` to call `pickGPXFile()` before asking for a
      shape ID, mirroring `replaceShape()`.
- [ ] Update the button UI (`renderBody()`, lines 36 and 71): change the
      label/affordance from "+ New shape from GPX" to an upload-first control,
      reusing `renderUploadIcon()` from `modal-utils.ts` (already used for the
      "Replace with GPX" button at line 49) for visual consistency.
- [ ] After the file is picked, default the shape ID text input to the filename
      with the `.gpx` extension stripped, but keep the input editable before the
      user confirms. Do not auto-lock the id. Keep the existing uniqueness
      validation (lines 275-280) running against whatever id is in the input at
      confirm time, not just the default.
- [ ] Manually verify: click the upload button, pick a `some-name.gpx` file,
      confirm the shape ID field pre-fills to `some-name`, edit it, confirm the
      shape is created under the edited id.
- [ ] Commit: `feat(shapes): upload GPX first and default the shape id to the filename`

---

## Phase 5: Navbar item count bubbles

**Goal:** Show a notification-style count bubble on each of the 4 navbar items.

There is no unified tab bar; the 4 items are separate navbar buttons opening
separate modals:
- Services -> `calendar-btn` (`src/index.html:90-109`), wired `src/index.ts:292-303`.
  Count is unique `service_id`s across `calendar`/`calendar_dates`; check
  `page-content-renderer.ts` `getServices()` for the existing query to reuse.
- Shapes -> `shapes-btn` (`src/index.html:69-88`), wired `src/index.ts:272-279`.
  Count is unique `shape_id`s, available via `gtfsParser.getShapeIds()` (used in
  `schedule-controller.ts:408-439`).
- Fare products -> `fares-btn` (`src/index.html:111-130`), wired
  `src/index.ts:282-289`. Count is `fare_products.txt` row count; the existing
  per-table count pattern to copy is `fares-modal.ts:496-504`.
- Changes -> `history-btn` (`src/index.html:254-273`), wired `src/index.ts:332-334`.
  Count is pending/unsaved patch count; check `patch-manager.ts` for the count
  already used by `history-controller.ts` (lines 32-40, 167, 197).

Badge convention to follow (already used throughout, see `ui.ts:518` and
`fares-modal.ts:496-504`): a DaisyUI `<span class="badge badge-sm ...">`.

- [ ] Implement the four count sources, reusing the existing query helpers above.
- [ ] Add a `badge badge-sm` bubble to each of the 4 navbar buttons.
- [ ] Wire count updates to fire whenever the underlying data changes (patch
      recorded, DB write, feed import, undo/redo). Check how
      `history-controller.ts` already refreshes its own badges as a model for
      hooking into the right update events.
- [ ] Manually verify: import a feed, confirm all 4 bubbles show correct initial
      counts; make an edit affecting one category, confirm its bubble updates
      without a page refresh.
- [ ] Commit: `feat(navbar): show item counts as badge bubbles`

---

## Phases 6-8: Unified dangling reference handling

### Guiding principle: surface, don't repair

Nothing in this phase group may auto-blank, auto-remap, or hide a broken
reference. The straight-line geometry fallback for a dangling `shape_id` already
renders and stays. A route with a bad `agency_id` must become *visible*, not
silently reparented. The goal is that a dangling reference is impossible to miss,
easy to locate, and straightforward to repoint by hand.

### Context: work already in progress

There is uncommitted work in the tree that is the foundation for this. **Keep all
of it**, do not revert it:

- `src/modules/gtfs-validator.ts` - `ValidationMessage`/`ValidationResults` are
  now exported, and `code` is propagated through `addError`/`addWarning`/
  `addInfo` instead of being discarded as `_code`.
- `src/modules/feed-issues.ts` (new) - `deriveFeedIssues()` groups error and
  warning messages by `${file}:${code}` into label/count rows, with a
  `CODE_LABELS` map and a `NOTES` map for consequences worth spelling out.
  Module-level `setFeedIssues`/`getFeedIssues` cache the result so the panel does
  not re-validate on every render (a full pass walks `stop_times`).
- `src/utils/issue-card.ts` (new) - `renderIssueCard(title, rows)`, a warning
  card that renders nothing when every count is zero.
- `src/index.ts` - `validateAndUpdateInfo()` now runs on boot, publishes the
  derived issues, and logs a summary.
- `src/modules/page-content-renderer.ts` - the home page renders the card between
  feed info and Agencies.

The gap: the card proves problems *exist* without letting you *find* or *fix*
them. Phases 6-8 close that gap.

### Context: the spec layer already knows every foreign key

`foreignKey` is a curated addition on field definitions across 20 files in
`src/gtfs-spec/files/` (~54 declarations, including all three on `trips.ts`:
`route_id`, `service_id`, `shape_id`). But `src/gtfs-spec/adapter.ts` does not
expose it, so `gtfs-validator.ts` instead hand-writes five `INVALID_REFERENCE`
checks (lines 296, 486, 538, 554, 1005). Exposing it is the unification lever:
one generic sweep replaces all five and covers `trips.shape_id` (the Nuuk
dangling-shape bug) and everything else for free.

### Context: dangling values are already labelled in pickers

`schedule-controller.ts:403-421`, `editable-table.ts:489-493` and
`inline-editable-field.ts:285-289` all render `"${current} (dangling reference)"`
as a synthetic option so an untouched dangling value is never silently blanked.
That is the existing fix path to lean on, not rebuild.

### Context: Nuuk route 1

Root cause is known: the route's `agency_id` was mistyped, orphaning it from
every agency list. It is one instance of the general problem, handled by this
phase group rather than separately.

### Phase 6: Generic spec-driven referential integrity

- [ ] Expose `foreignKey` from `src/gtfs-spec/adapter.ts` as a derived list of
      `{ file, field, targetFile, targetField }`.
- [ ] Add one generic pass in `src/modules/gtfs-validator.ts` that walks every
      declared FK, builds the target id set once per target file, and raises
      `INVALID_REFERENCE` for each non-empty value with no match. Skip empty
      values: an optional FK left blank is not dangling.
- [ ] Delete the five hand-written `INVALID_REFERENCE` checks (lines 296, 486,
      538, 554, 1005) that the sweep now subsumes. Confirm the fares v2 checks
      from `5ae5715` that are *not* plain FK checks (conditional presence, area
      assignment) are left alone.
- [ ] Extend `ValidationMessage` with the offending entity's identity,
      `entity?: { file, id, field, value }`, populated by the sweep and using
      `src/utils/gtfs-primary-keys.ts` to resolve the row's id. This is what
      removes any need to recover ids by regex from message text.
- [ ] Watch for volume: the sweep will surface references the app never checked
      before. If a real feed lights up with hundreds of new rows, report the
      counts back to the user rather than quietly narrowing the sweep.
- [ ] Commit: `feat(validation): check every spec-declared foreign key generically`

### Phase 7: Make dangling objects findable from the issue card

- [ ] Extend `IssueRow` in `src/utils/issue-card.ts` to carry the offending
      entities (from Phase 6's `entity` field), and render each row as an
      expandable `<details>`/`<summary>` block listing them, following the
      existing pattern in `renderAreaStopLists()` (`fares-modal.ts:99-158`).
- [ ] Each listed entity is a link to its own page, going through
      `PageStateManager` the same way existing entity lists do, and labelled via
      the `entity-display.ts` / `entity-references.ts` helpers (`getStopDisplay`
      and friends) rather than an inline-formatted string.
- [ ] Keep `deriveFeedIssues()`'s grouping and its `CODE_LABELS`/`NOTES` maps as
      they are; they only need to thread entities through alongside the counts.
- [ ] Cap the inline list at a sane length with an "and N more" tail so one
      badly broken file cannot make the home page unusable.
- [ ] Manually verify: load a feed with a dangling reference, expand the issue
      row, click through to the offending entity's page.
- [ ] Commit: `feat(issues): list the offending entities under each feed issue`

### Phase 8: Make them obviously fixable at the use site

- [ ] **Red at the use site:** wherever a foreign key value is rendered
      read-only, show a dangling value in error color with a `title` explaining
      that the target does not exist. Covers `trips.shape_id` in the timetable
      trip rows and `routes.agency_id` on the route page at minimum. This is the
      read-only counterpart to the picker labelling that already exists.
- [ ] **Contextual note on the entity page:** an entity whose own row has a
      dangling reference carries a warning note naming the broken field, so
      arriving from the issue card lands you on something that explains itself.
      Reuse `renderIssueCard` rather than inventing second warning markup.
- [ ] **Fix path:** verify that clicking the field opens a picker carrying the
      synthetic `"${current} (dangling reference)"` option for every FK type, so
      the value can be repointed without being blanked first. Find and fill any
      FK that does not reach one of the three existing paths
      (`editable-table.ts:489`, `inline-editable-field.ts:285`,
      `schedule-controller.ts:403`).
- [ ] Verify end to end with the Nuuk feed: route 1's bad `agency_id` appears in
      the home issue card, expands to a link to route 1, that page shows the note
      and a red `agency_id`, and clicking it offers a picker that fixes it.
      Separately confirm the `x3_...` dangling `shape_id` shows red on its trips
      and still draws the straight-line fallback.
- [ ] Commit: `feat(issues): surface and fix dangling references at the use site`

---

## Phase 9: Timetable stop click and hover highlight, in both repos

**Goal:** Clicking a stop in the timetable focuses it; hovering highlights it.
Shared with `../test-track`.

`src/modules/route-strip.ts` is vendored verbatim into test-track
(`../test-track/VENDORED.md`, SHA `9f1f986`), with coloring-book as the canonical
source. Put shareable highlight logic there so it flows across.

- [ ] Click a stop name/marker in the timetable stop column
      (`timetable-renderer.ts:519`, `timetable-cell-renderer.ts:56`, both already
      carry `data-stop-id`) to focus that stop. Find the existing "focus a stop"
      mechanism first (`page-state-manager.ts` `setPageState({type: 'stop', ...})`,
      or a helper in `map-controller.ts` / `interaction-handler.ts`) and reuse it
      rather than reinventing it.
- [ ] Hover highlights the stop (map and/or strip dot). Put the highlight logic
      in `src/modules/route-strip.ts` so it is shareable.
- [ ] Apply the same change to `../test-track/src/modules/route-strip.ts` and
      bump its `VENDORED.md` row from SHA `9f1f986` to the new coloring-book SHA,
      keeping `@status verbatim`. test-track already has click-on-name, so
      reconcile with what is there rather than duplicating it.
- [ ] Manually verify in both apps: click a stop name, confirm focus behaves like
      other focus-stop entry points; hover, confirm the highlight appears.
- [ ] Commit: `feat(timetable): focus and highlight stops from the stop column`

---

## Phase 10: Route page route diagram over all trips

**Goal:** The route page shows the branching route diagram covering *all* of the
route's trips, like test-track's route page.

The engine is already fully present here. `route-sequence.ts`, `route-graph.ts`,
`route-strip.ts` and `route-source.ts` are all vendored in coloring-book (it is
the canonical source; they flow *out* to test-track).
`routeSequence(source, route_id, directionId, service_id)` takes `service_id` as
optional, so passing `undefined` yields the all-trips sequence this needs.
`timetable-data-processor.ts:212-213` is the existing call site to model on, and
`GTFSRouteSource` (`gtfs-route-source.ts:23`) is the adapter. The genuinely new
code is a render function analogous to test-track's `renderStrip()`
(`../test-track/src/modules/pages/route-page.ts:219-331`), minus its realtime
chrome.

- [ ] Write the render function, modelled on test-track's `renderStrip`, stripped
      of `placeVehicles` / `vehicleChip` / `eta` / `alertPips` (none of which
      exist in a static editor).
- [ ] Data: `GTFSRouteSource` + `routeSequence(source, route_id, directionId,
      undefined)` + `routeGraph(sequence)`.
- [ ] Rows: rail SVG + stop name link + endpoint/minority facts from `StopStats`
      (test-track's `endpointNoteHtml`). No trip counts.
- [ ] Placement: a new section **below** the timetables list in `renderRoute()`
      (`page-content-renderer.ts:552`).
- [ ] Give the timetables list a max height with `overflow-y-auto` so the page
      does not run long once the diagram is below it.
- [ ] Incidental cleanup in the same file: `CREATE_NETWORK` is defined with a
      **literal NUL byte** in the source, which makes `rg`/`grep` treat the whole
      file as binary and skip it. Replace it with the `'\0create-network'` escape.
- [ ] Manually verify: open a route with branching patterns, confirm the diagram
      covers all trips (not just one service) and matches how test-track draws
      the same route.
- [ ] Commit: `feat(route): draw the full route diagram on the route page`

---

## Phases 11-12: Services timeline view replaces service lists (large feat)

### Context

The timeline view exists today only inside the Calendar modal:
`src/modules/calendar-modal.ts`, function `renderTimeline()` (lines 316-479),
private to that file, along with its supporting helpers (`loadCalendarData`,
`isServiceActive`, `getServiceColor`, `renderWeekdayDots`, `getDaysTooltip`,
`hexToRgba`, `esc`). It takes a `ServiceDataMap` (built by `loadCalendarData()`
from all `calendar`/`calendar_dates` rows) and renders one row per service with
weekly-column shading, click-to-navigate via `data-service-id` + an injected
`onServiceClick` callback. No filtering support exists yet (always all services).

Three places currently render a non-timeline service/timetable list, each with
its own trip-count computation to be dropped:
- **Home page** - `renderHome()` in `page-content-renderer.ts` (~lines 333-460):
  flat list of all services via `renderServiceReference()`, with
  `tripCountByService` / `routesByService` computed by scanning all `trips`
  (~lines 358-371).
- **Route page** - `renderRoute()` in `page-content-renderer.ts` (~lines 552-724):
  groups trips by `service_id` (~lines 564-575), renders one
  `renderTimetableReference()` row per service (~lines 666-711).
- **Stop page** - `StopViewController.renderTimetablesSection()`
  (`stop-view-controller.ts`, ~lines 213-260): lists timetables serving this
  stop, via `renderTimetableReference()`.

**The service page is deliberately excluded.** `ServiceViewController.renderTimetablesSection()`
lists *routes* using one fixed service, the inverse relationship from what the
timeline shows. A timeline of a single service is not a meaningful replacement,
so that page keeps its plain route list unchanged. This was decided; do not
re-open it.

Row-click navigation pattern to reuse: `data-service-id`/`data-route-id`
attributes + a delegated click listener in each controller's `addEventListeners()`
calling into injected `onServiceClick`/`onRouteClick`/`onTimetableClick`
dependencies (see `page-content-renderer.ts` `addEventListeners()`).
`page-state-manager.ts` already supports `{type: 'service', service_id}` and
route+service timetable URL states.

### Phase 11: Extract the timeline renderer into a shared module

- [ ] Create `src/modules/service-timeline.ts` (check for naming conflicts
      first). Move `renderTimeline()` and its private helpers (`isServiceActive`,
      `getServiceColor`, `renderWeekdayDots`, `getDaysTooltip`, `hexToRgba`,
      `esc`, and the row-click wiring currently in `attachTimelineListeners`) out
      of `calendar-modal.ts` into this new module, exporting what's needed.
- [ ] Add service-id filtering so callers can scope the `ServiceDataMap` to a
      specific set of `service_id`s. Prefer a post-filter step
      (`filterServiceDataMap(map, service_ids)`) over a parameter on
      `loadCalendarData()`, to keep the latter simple.
- [ ] Update `calendar-modal.ts` to import from the new module instead of
      defining these locally; confirm the Calendar modal still renders
      identically.
- [ ] Add support for an optional fixed `route_id` context (the route page needs
      a timeline row to link to a specific timetable, not just a service): an
      optional `data-route-id` attribute on `.timeline-row`, and an `onRowClick`
      callback shape flexible enough to carry `(service_id, route_id?)`.
- [ ] Manually verify the Calendar modal works exactly as before this refactor.
- [ ] Commit: `refactor(calendar): extract the services timeline into a shared module`

### Phase 12: Swap the home, route and stop pages to the timeline view

- [ ] Home page (`renderHome()`): replace the `renderServiceReference()` list
      with the shared timeline renderer, scoped to all services. Wire row clicks
      to the existing `onServiceClick` dependency.
- [ ] Remove `tripCountByService`/`routesByService` computation in `renderHome()`
      now that nothing consumes it.
- [ ] Route page (`renderRoute()`): replace the `renderTimetableReference()` list
      under "Timetables" with the shared timeline renderer, filtered to the
      route's `service_id`s (from the existing `serviceGroups` grouping), passing
      the fixed `route_id` context from Phase 11 so row clicks navigate to the
      specific timetable. This is the same list Phase 10 made scrollable; keep
      the scroll container.
- [ ] Remove the now-unused `serviceTrips.length` trip-count plumbing in
      `renderRoute()`.
- [ ] Stop page (`StopViewController.renderTimetablesSection()`): replace the
      timetables list with the timeline renderer, filtered to the relevant
      `service_id`s (derived from `timetableKeys`), with row clicks carrying both
      `route_id` and `service_id`.
- [ ] Keep the existing "add new service" / "new timetable" dropdown affordances
      on all pages. Only the list rendering changes, not the add-new flow.
- [ ] Remove `TimetableKey.tripCount` computation in `stop-view-controller.ts` if
      nothing else consumes it, and remove the `tripBadge` code paths in
      `src/utils/entity-references.ts` that no caller uses anymore. Check every
      call site first: do not remove `renderServiceReference`/
      `renderTimetableReference` themselves if the service page or another page
      still uses them.
- [ ] Manually verify all three pages, including row clicks landing on the right
      timetable.
- [ ] Commit: `feat(services): use the timeline view on the home, route and stop pages`

---

## Phases 13-15: Fares table list columns (large feat)

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
  (lines 138-142). Its "OD pairs" per the GTFS spec are
  `from_network_id`/`to_network_id` and `from_stop_id`/`to_stop_id`
  (`src/gtfs-spec/files/fare-leg-join-rules.ts`); there are no area fields on
  this table.

The existing "list items with newlines" pattern to generalize:
`renderAreaStopLists()` in `fares-modal.ts` (lines 99-158) builds
`Map<area_id, string[]>` from `stop_areas` + `stops`, and renders a `<details>`/
`<summary>`/`<ul><li>` block per area below the main table (wired via the Areas
entry's `detail:` callback, `fares-modal.ts:464`). Networks (lines 466-485) has
the count (`countRoutesPerNetwork`, lines 70-82) but no equivalent list detail
block: that asymmetry is what Phase 15 fixes.

No existing utility collapses repeated table rows into one row with an aggregated
list cell. That is new functionality.

Scope decision from `TODO.md`: **list values in a column, newline-separated, and
keep it simple for now.** Read-only aggregated display is acceptable; full
multi-value editing is out of scope for this pass.

### Phase 13: Display-only grouped-row rendering in editable-table.ts

- [ ] In `src/modules/editable-table.ts`, add support for a column marked as a
      "list column" (extend `EditableTableColumnOverride` with a `listOf?: boolean`
      or similar flag). When set, rows identical across every *other* rendered
      column collapse into a single visual row, with that column rendering all
      distinct values from the collapsed rows, newline-separated (use
      `white-space: pre-line` or `<br>`-joined markup, not the current `truncate`
      single-line span, which would clip a multi-value list).
- [ ] Make list-column cells non-interactive/read-only for now, matching how
      `extraColumns` and `columnOverrides.readonly` already render plain text.
- [ ] Foreign-key list values should still resolve to display labels (reuse
      `foreignLabelMaps()`, ~lines 237-251) rather than showing raw IDs.
- [ ] Confirm add-row/delete-row flows still operate correctly against a grouped
      display: adding or deleting one underlying row must not corrupt the
      collapsed view.
- [ ] Commit: `feat(editable-table): support list-valued columns via row grouping`

### Phase 14: Apply list columns to the four fares tables

- [ ] `fare_products`: group by everything except `fare_media_id`, mark
      `fare_media_id` as a list column (`FARE_PRODUCTS` entry, ~lines 385-398).
- [ ] `fare_leg_rules`: mark `from_area_id` and `to_area_id` as list columns
      (`FARE_LEG_RULES` entry, ~lines 399-414).
- [ ] `fare_transfer_rules`: mark `from_leg_group_id` and `to_leg_group_id` as
      list columns (`FARE_TRANSFER_RULES` entry, ~lines 432-445).
- [ ] `fare_leg_join_rules`: mark both OD pairs (`from_network_id`/`to_network_id`
      and `from_stop_id`/`to_stop_id`) as list columns (`FARE_LEG_JOIN_RULES`
      entry, ~lines 415-431). Double check field names against the spec file.
- [ ] Manually verify each of the 4 tables with a feed that has actual
      duplication on these keys (create test rows if the sample feed has none),
      confirming rows collapse and list correctly.
- [ ] Commit: `feat(fares): list repeated foreign keys instead of duplicating rows`

### Phase 15: Generalize the areas/networks list display

- [ ] Extract `renderAreaStopLists()`'s presentation (the `<details>`/`<summary>`/
      `<ul><li>` markup, item formatting via `getStopDisplay`/`getEntityDisplay` +
      `renderOptionLabel`) into a shared helper taking a
      `Map<id, {label: string, items: string[]}>` and returning the HTML block,
      independent of whether the source join is `stop_areas` or `route_networks`.
- [ ] Reimplement `renderAreaStopLists()` as a thin wrapper: collect the
      `stop_areas`/`stops` join data, then call the shared helper.
- [ ] Add an equivalent for Networks: collect `route_networks`/`routes` join data
      (reuse the join logic in `countRoutesPerNetwork()`, `fares-modal.ts:70-82`),
      then call the shared helper. Wire it in as the Networks entry's `detail:`
      callback, mirroring Areas at `fares-modal.ts:464`.
- [ ] Manually verify both the Areas and Networks panes show matching-style list
      details.
- [ ] Commit: `feat(fares): show a route list detail for networks, matching areas`

---

## Blocked on live reproduction

The two phases below cannot be root-caused by reading the code: static analysis
found nothing wrong in either. They are last on purpose. **An agent may skip
them and pick up the next unblocked phase rather than stalling.**

## Phase 16: Fix "Is Default Fare Category" / "Fare Media Type" click doing nothing

Static analysis found no defect: the fields (`rider_categories.txt
is_default_fare_category`, `fare_media.txt fare_media_type`) are both `Enum`
type, go through the same generic `editable-table.ts` path as other working enum
fields, and nothing distinguishes them in code.

- [ ] Ask the user to open the Fares modal on a feed with `rider_categories.txt`
      / `fare_media.txt` rows, open devtools console, click the affected cell,
      and report back:
  - Whether any console error/warning appears.
  - Whether `document.querySelector('.editable-cell[data-field="is_default_fare_category"]')`
    (or `fare_media_type`) returns an element, and whether it receives the click
    (check `getComputedStyle(el).pointerEvents`, and
    `document.elementFromPoint(x, y)` at the cell's coordinates for an overlay).
  - Whether `GTFS_FIELD_SPECS['rider_categories.txt']['is_default_fare_category']`
    (and the `fare_media.txt` equivalent) exist in the console.
- [ ] Based on findings, likely candidates:
  - `resolve()` in `src/modules/editable-table.ts` (~lines 444-460) silently
    returns `null` (no-op, no console output) if the field spec lookup fails.
    That exactly reproduces "click does nothing" with zero error. If so, fix the
    spec/field name mismatch causing the lookup miss.
  - An overlapping element intercepting the click; if so, fix the CSS
    stacking/pointer-events.
- [ ] Fix the confirmed root cause and re-verify with the user.
- [ ] Commit: `fix(fares): make is_default_fare_category and fare_media_type editable`

## Phase 17: Straight-line fallback lingers after shape assignment

`src/modules/route-renderer.ts`, class `RouteRenderer`. When a shape is assigned
to a trip (or all trips in a route), the straight-line stop-sequence fallback
should disappear immediately. Relevant machinery:
- `addTripToBucket(trip_id)` (lines 683-792) draws either the real shape
  (694-700) or, if no valid shape_id, a `stops:${stopIds.join('|')}` fallback
  line (701-737).
- `invalidateTrip(trip_id, op, ...)` (lines 881-906) and `invalidateShape(...)`
  (lines 912-966) are the entry points called after a trip/shape edit; they call
  `removeTripFromBucket` (636-677) then re-add via `addTripToBucket`.
- `scheduleSetData()` (lines 216-236) coalesces multiple invalidations in the
  same tick into one `requestAnimationFrame`-deferred `source.setData(...)` call.
- `ensureInitialized()` / `initializationPromise` (lines 98-125) guard against
  calling map source methods before the MapLibre style has loaded.

The symptom ("had to refresh the page for it to disappear... next time it
worked") smells like a caller invoking `invalidateTrip` without awaiting
`ensureInitialized()`, or a bulk-assign loop firing many invalidations whose
final `scheduleSetData()` RAF callback is scheduled before the last trip's bucket
update lands.

- [ ] Ask the user to reproduce and identify exactly which UI action triggers the
      bulk assignment. "Selecting shapes for all trips in a route" implies a
      per-trip loop somewhere in `schedule-controller.ts` or the shape picker,
      not a single `updateTripProperty` call. Locate that loop first.
- [ ] Trace whether `scheduleSetData()` is being starved (the RAF callback firing
      between individual `addTripToBucket` calls in a loop, or a final
      `invalidateTrip` landing after the last scheduled RAF already ran). Fix by
      ensuring the whole batch finishes before the final `scheduleSetData()`
      flush, or by making the dirty-flag/RAF coalescing batch-aware.
- [ ] Manually re-verify with the user: assign shapes to all trips in a route,
      confirm the straight-line route disappears without a page refresh.
- [ ] Commit: `fix(route-renderer): remove straight-line fallback immediately after shape assignment`

---

## Original Issue (verbatim from TODO.md)

```
Needs research (mine, not in the plan yet)
- Bug: if I delete all stop times, the stop should be removed. Something leaves ""

In the plan (see PLAN_TODO.md)
- Bug: "Is Default Fare Category" / "Fare Media Type" click does nothing (possibly more)
- Bug: multiselect-with-search escape should close only that modal, not the one
  beneath (ie fares modal)
- Bug: after selecting shapes for all trips in a route, it doesn't remove the
  straight line route. I had to refresh the page for it to disappear. (this
  seems to be a race, because the next time it worked)
- Bug: loading a feed pops the Files modal open, it shouldn't
- Feat: unify dangling reference handling. Present them as issues, make them
  findable and fixable, without silently making them work. Covers the nuuk
  x3_... dangling shape and the nuuk route 1 bad agency_id.
- Feat: change navbar shapes icon to match open in brouter
- Feat: instead of "New shape from GPX" lets have an upload button. After
  upload, lets default to the filename in the input and allow changes before
  locking in the id
- Feat: in nav bar show number of each item (# services, # shapes, # fare
  products, # changes) We can show it as a little notification style bubble.
- Feat: clicking stop markers in timetables should focus that stop. Hovering
  should highlight the stop in some way. Lets share the highlighting with
  ../test-track as well (they already have click on name)
- Feat: show the route diagram including all trips on the route page, just like
  we do in the realtime (../test-track), sharing code as much as possible
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
```
