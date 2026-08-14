# Plan: Work through TODO.md

## Summary

`TODO.md` is a flat, unprioritized scratchpad. This file is the actionable
version, ordered small-fixes-first. Phases 1-5 are quick, independent bugs and
feats. Phases 6-8 unify dangling reference handling into one coherent feature
(detect generically, find from the home page, fix at the use site). Phases 9-10
are the two stop/route diagram features shared with `../test-track`. Phases 11-12
build the services timeline; Phases 13-15 build the fares list-column feature.
Phases 16-17 are blocked on live reproduction and sit at the end deliberately.
Phases 18-21 are small, independent items added after the original pass (glyph
cleanup, shapes list improvements, a fares tooltip regression, Files modal
fixes, and sharing the stop map styles with `../test-track`); they can be
picked up at any time and do not depend on anything above, except that Phase 21
assumes Phase 9's stop highlighting is already in place.

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
- ~~`src/modules/page-content-renderer.ts` contains a literal NUL byte (see
  Phase 10), so `rg`/`grep` silently skip it as binary.~~ Fixed in Phase 10; the
  file searches normally now.

---

## Phase 1: Don't open the Files modal after loading a feed

**Goal:** Loading a feed should leave you on the map, not behind the raw-file
editor.

`src/modules/ui.ts` (~lines 299-303) unconditionally calls
`document.getElementById('files-modal').showModal()` at the end of the post-load
path, so the Files modal pops open every single time a feed is loaded.

- [x] Delete that `showModal()` call only. Keep the `this.showFileList()` call
      immediately above it so the list stays populated for when the modal is
      opened deliberately.
- [x] Leave the other open sites alone: `ui.ts:217-222` (the `files-btn` click
      handler), `ui.ts:564` (`showFileInEditor`) and `bottom-sheet.ts:219` are
      all explicit user actions.
- [ ] Manually verify: load a feed, confirm the map is visible and no modal
      appears; then click the Files button and confirm the list is populated.
- [x] Commit: `fix(ui): stop opening the files modal after loading a feed`

**Done** (commit `37ab63e`). Confirmed by grep that the only remaining
`files-modal` open sites are the three explicit user actions the plan listed.

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

- [x] In `src/modules/modal-utils.ts`, add a small module-level stack (array) of
      currently-open modal instances (push an identifier/handle in `showModal()`,
      pop it in `close()`).
- [x] In the `keydown` handler, before acting on `Escape`/`Enter`, check that this
      modal instance is the topmost entry in the stack; if not, return early
      without calling `preventDefault()`/`triggerAction()` (so the topmost modal's
      own listener handles it instead).
- [x] Verify nesting depth is preserved through close: closing the picker must
      pop only its own stack entry, not the Fares modal's.
- [ ] Manually verify: open Fares modal -> open a foreign-key picker -> press
      Escape -> only the picker closes, Fares modal remains open. Press Escape
      again -> Fares modal closes.
- [x] Commit: `fix(modals): scope Escape/Enter handling to the topmost modal`

**Done** (commit `433b986`). The stack holds the modal's own root `HTMLElement`,
pushed right after `document.body.appendChild(modal)` and spliced out by index in
`close()`, so an out-of-order close cannot corrupt the nesting.

Decided with the user: the stack covers **`showModal()` modals only**. `files-modal`
and `history-modal` are native `<dialog>` elements whose Escape is handled by the
browser, so a `showModal()` picker stacked on one of those would still let the
browser close the dialog underneath. The reported bug (Fares modal) is
`showModal()`-based, so it is covered.

Not changed: backdrop-click still closes whichever modal's backdrop was clicked,
regardless of stack position. Only Escape/Enter are scoped.

---

## Phase 3: Swap the navbar shapes icon to the brouter waypoints icon

**Goal:** Purely an icon swap. `shapes-btn`'s click handler
(`src/index.ts:272-279`), its title "Shapes", and `ShapesManager.open()` are all
unchanged.

`src/index.html:69-88` is the `shapes-btn` navbar button, currently using a
generic "layers" SVG path. The desired replacement is the existing "Open in
brouter" icon: `renderRouteWaypointsIcon` in `src/modules/modal-utils.ts:13`,
used at `src/modules/timetable-renderer.ts:385`.

- [x] Replace the `shapes-btn` SVG with the markup produced by
      `renderRouteWaypointsIcon`. Since the icon is a template-string helper
      rather than static markup, set `innerHTML` from `src/index.ts` (where
      `shapes-btn` is wired, lines 272-279) at startup instead of hardcoding SVG
      in `index.html`.
- [x] Confirm the icon renders at the same size as sibling navbar icons: check
      `calendar-btn` for the expected size class, since `renderRouteWaypointsIcon`
      is normally invoked at `h-3 w-3` in the timetable context.
- [ ] Manually verify: navbar shapes button now shows the same icon as
      "Open in brouter" in the timetable view, click behavior unchanged.
- [x] Commit: `feat(navbar): use the brouter waypoints icon for the shapes button`

**Done** (commit `8904e0b`). Sibling navbar icons are `h-5 w-5`, so the call site
is `renderRouteWaypointsIcon('h-5 w-5')`. The button body in `index.html` is now
just an HTML comment pointing at the injection site.

Interaction with Phase 5: because the icon is set via `innerHTML` on the button,
Phase 5's count badge was deliberately placed **outside** the button (as a sibling
inside a DaisyUI `indicator` wrapper), so the innerHTML assignment cannot wipe it.

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

- [x] Restructure `newShape()` to call `pickGPXFile()` before asking for a
      shape ID, mirroring `replaceShape()`.
- [x] Update the button UI (`renderBody()`, lines 36 and 71): change the
      label/affordance from "+ New shape from GPX" to an upload-first control,
      reusing `renderUploadIcon()` from `modal-utils.ts` (already used for the
      "Replace with GPX" button at line 49) for visual consistency.
- [x] After the file is picked, default the shape ID text input to the filename
      with the `.gpx` extension stripped, but keep the input editable before the
      user confirms. Do not auto-lock the id. Keep the existing uniqueness
      validation (lines 275-280) running against whatever id is in the input at
      confirm time, not just the default.
- [ ] Manually verify: click the upload button, pick a `some-name.gpx` file,
      confirm the shape ID field pre-fills to `some-name`, edit it, confirm the
      shape is created under the edited id.
- [x] Commit: `feat(shapes): upload GPX first and default the shape id to the filename`

**Done** (commit `538895a`). Notes:

- The primary action's label changed from "Choose GPX…" to **"Create"**, since
  the file is already chosen by the time the modal opens. Both buttons now read
  as "Upload GPX" (panel) -> "Create" (modal).
- Extension stripping is `.replace(/\.gpx$/i, '')` only. Decided with the user:
  no slugifying, no auto-dedupe. The existing uniqueness check still runs on
  confirm, so a colliding default surfaces the same inline error as before.
- The picked filename is shown above the input so it is obvious which file is
  being named.
- `onMount` focuses and selects the input so the default can be typed over
  immediately.
- Added `escAttr()` next to the existing `esc()` in `shapes-manager.ts`: `esc()`
  builds its output via `div.innerHTML`, which does **not** escape `"`, and the
  default id is interpolated into a `value="..."` attribute. A filename with a
  quote in it would otherwise break out of the attribute.

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

- [x] Implement the four count sources, reusing the existing query helpers above.
- [x] Add a `badge badge-sm` bubble to each of the 4 navbar buttons.
- [x] Wire count updates to fire whenever the underlying data changes (patch
      recorded, DB write, feed import, undo/redo). Check how
      `history-controller.ts` already refreshes its own badges as a model for
      hooking into the right update events.
- [ ] Manually verify: import a feed, confirm all 4 bubbles show correct initial
      counts; make an edit affecting one category, confirm its bubble updates
      without a page refresh.
- [x] Commit: `feat(navbar): show item counts as badge bubbles`

**Done** (commit `8e72ae0`). New module `src/modules/navbar-counts.ts` owns all
four counts; constructed in the `GTFSEditor` constructor and `initialize()`d
alongside `historyController.initialize()`.

Decisions taken with the user:

- **Changes count is `patchManager.version`** (patches currently applied), not the
  full log length. It therefore goes *down* on undo and back up on redo, matching
  what a user reads as "changes I have made".
- **Zero renders nothing.** `setBadge()` toggles `hidden` when the count is 0, so
  an empty feed shows a clean navbar.
- **Placement is a DaisyUI `indicator` wrapper.** Each of the 4 buttons in
  `index.html` is now wrapped in `<div class="indicator hidden md:inline-flex">`
  with a sibling `<span class="indicator-item badge badge-xs badge-primary hidden">`.
  The `hidden md:flex` responsive classes moved from the button to the wrapper.
  Used `badge-xs`, not the plan's `badge-sm`: `badge-sm` overhangs a `btn-sm
  btn-square` badly as a corner indicator.

Counts are read **synchronously from the parser's in-memory tables**, not via
`await gtfsDatabase.getAllRows()`. This is safe and was verified: `setupVirtual()`
registers the *same array reference* held in `gtfsData[filename].data` (see the
shared-array invariant comment at `gtfs-parser.ts:652-654`), and `getAllRows()`
delegates to the virtual table when one exists. So the sync read is never stale
relative to the DB. `shapes.txt` still goes through the cached `getShapeIds()`
because reading its rows would copy every shape point.

Refresh triggers: `patchManager.on()` for all four of `change`/`undo`/`redo`/`jump`,
plus a `navbarCounts.refresh()` at the top of `validateAndUpdateInfo()` in
`index.ts`. That last one is load coverage: feed import and boot-from-IndexedDB
write rows directly without emitting patch events, and `validateAndUpdateInfo` is
already the single hook that runs on boot and on all three `ui.ts` load paths.

---

## Phases 6-8: Unified dangling reference handling

### Guiding principle: surface, don't repair

Nothing in this phase group may auto-blank, auto-remap, or hide a broken
reference. The straight-line geometry fallback for a dangling `shape_id` already
renders and stays. A route with a bad `agency_id` must become *visible*, not
silently reparented. The goal is that a dangling reference is impossible to miss,
easy to locate, and straightforward to repoint by hand.

### Context: foundation already landed (commit `7e94bec`)

This is committed, not in-tree work. **Build on it**, do not revert it:

- `src/modules/gtfs-validator.ts` - `ValidationMessage`/`ValidationResults` are
  now exported, and `code` is propagated through `addError`/`addWarning`/
  `addInfo` instead of being discarded as `_code`. The `routes.agency_id`
  `INVALID_REFERENCE` message now names the offending route.
- `src/modules/feed-issues.ts` (new) - `deriveFeedIssues()` groups error and
  warning messages by `${file}:${code}` into label/count rows, sorted by count
  descending. A `CODE_LABELS` map gives per-code wording (falling back to a
  humanized code), and an `OVERRIDES` map keyed `${file}:${code}` supplies
  `{ label?, note? }` where the generic phrasing is too vague to act on -
  currently only `routes.txt:INVALID_REFERENCE`. Module-level
  `setFeedIssues`/`getFeedIssues` cache the result so the panel does not
  re-validate on every render (a full pass walks `stop_times`).
- `src/utils/issue-card.ts` (new) - `renderIssueCard(title, rows)`, a warning
  card that renders nothing when every count is zero. Deliberately generic and
  free of coloring-book types. **Already vendored into `../test-track`** (its
  commit `7b21d32`, recorded in its `VENDORED.md` against coloring-book
  `7e94bec`), where `renderMapIssues` and `renderStationIssues` in
  `status-page.ts` now call it. Its markup is therefore shared: changing the
  card's classes here means re-vendoring there. The card is deliberately
  escaping-only, which is why test-track's `renderPaddedColumns` stayed bespoke
  (its label and note carry inline `font-mono` markup).
- `src/index.ts` - `validateAndUpdateInfo()` now runs on boot, publishes the
  derived issues, and logs a summary. Boot was the missing trigger: previously a
  feed restored from IndexedDB was never validated at all.
- `src/modules/ui.ts` - all three load paths now validate *before* refreshing
  the panel. They used to refresh first, which would render the card stale.
- `src/modules/page-content-renderer.ts` - the home page renders the card between
  feed info and Agencies.

The gap: the card proves problems *exist* without letting you *find* or *fix*
them. It also only counts what the five hand-written checks happen to look at.
Phases 6-8 close both gaps.

Two known rough edges for Phase 6/7 to clean up rather than preserve:

- Generic labels read mechanically (`"stops.txt rows missing a required field"`).
  Once Phase 6 makes the sweep generic, revisit whether `CODE_LABELS` should be
  keyed by `${file}:${code}` throughout instead of code alone.
- `deriveFeedIssues()` splits its grouping key on `:` with
  `key.split(':')`, which is safe only because GTFS filenames contain no colon.
  Phase 6 should carry `file`/`code` as a structured tuple instead, which falls
  out naturally from adding the `entity` field.

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

- [x] Expose `foreignKey` from `src/gtfs-spec/adapter.ts` as a derived list of
      `{ file, field, targetFile, targetField }`.
- [x] Add one generic pass in `src/modules/gtfs-validator.ts` that walks every
      declared FK, builds the target id set once per target file, and raises
      `INVALID_REFERENCE` for each non-empty value with no match. Skip empty
      values: an optional FK left blank is not dangling.
- [x] Delete the five hand-written `INVALID_REFERENCE` checks (lines 296, 486,
      538, 554, 1005) that the sweep now subsumes. Confirm the fares v2 checks
      from `5ae5715` that are *not* plain FK checks (conditional presence, area
      assignment) are left alone.
- [x] Extend `ValidationMessage` with the offending entity's identity,
      `entity?: { file, id, field, value }`, populated by the sweep and using
      `src/utils/gtfs-primary-keys.ts` to resolve the row's id. This is what
      removes any need to recover ids by regex from message text.
- [ ] Watch for volume: the sweep will surface references the app never checked
      before. If a real feed lights up with hundreds of new rows, report the
      counts back to the user rather than quietly narrowing the sweep.
- [x] Commit: `feat(validation): check every spec-declared foreign key generically`

**Done** (commit `2316f46`). Notes:

- `deriveGTFSForeignKeys()` returns `{ file, field, targets }`, not the flat
  `targetFile`/`targetField` the plan sketched: several fields legitimately name
  two tables (`trips.service_id`, `fare_leg_rules.network_id`), and the value
  matches if it is present in **either**. Exported as `GTFS_FOREIGN_KEYS` from
  `src/types/gtfs.ts` next to `GTFS_FIELD_SPECS`.
- `validateFaresReferences()` was already a spec-driven sweep over 7 fares
  tables. It was renamed `validateForeignKeys()` and widened to all 54
  declarations; the declarations are grouped by file first so each table is
  walked once no matter how many FKs it carries (stop_times has 5).
- **Two declarations are deliberately skipped**, via `SKIPPED_FOREIGN_KEYS` in
  the validator, both would be pure false positives:
  - `calendar_dates.service_id`: the reference type is "Foreign ID referencing
    `calendar.service_id` **or ID**", so a service that exists only in
    `calendar_dates.txt` is valid. Without this every calendar_dates-only feed
    would light up entirely.
  - `stop_times.location_id`: targets `locations.geojson`, which is not a row
    table, so there is no column to collect ids from.
  They stay on the spec because `spec-field-edit.ts` uses `foreignKey` to build
  pickers, which is still the right behavior for both.
- Deleting the hand-written checks left `agency_ids`, `route_ids`, `trip_ids`
  and `stop_ids` unused in `validateRoutes`/`validateTrips`/`validateStopTimes`
  (plus the now-unused `getFileDataSyncTyped` reads that fed them). Removed,
  which is also a small win: `validateStopTimes` no longer builds two sets over
  the whole feed that the sweep builds again.
- The volume item is left unchecked deliberately: it needs a real feed, so it is
  part of the manual test pass.

### Phase 7: Make dangling objects findable from the issue card

- [x] Extend `IssueRow` in `src/utils/issue-card.ts` to carry the offending
      entities (from Phase 6's `entity` field), and render each row as an
      expandable `<details>`/`<summary>` block listing them, following the
      existing pattern in `renderAreaStopLists()` (`fares-modal.ts:99-158`).
- [x] Each listed entity is a link to its own page, going through
      `PageStateManager` the same way existing entity lists do, and labelled via
      the `entity-display.ts` / `entity-references.ts` helpers (`getStopDisplay`
      and friends) rather than an inline-formatted string.
- [x] Keep `deriveFeedIssues()`'s grouping and its `CODE_LABELS`/`NOTES` maps as
      they are; they only need to thread entities through alongside the counts.
- [x] Cap the inline list at a sane length with an "and N more" tail so one
      badly broken file cannot make the home page unusable.
- [x] `issue-card.ts` is vendored into `../test-track`, which has no concept of
      GTFS entity pages. Keep the entity list optional so a row that carries only
      a label and a count still renders exactly as it does today, then re-vendor
      and bump the `@sha` in that repo's `VENDORED.md`. If entity linking cannot
      be made optional cleanly, split it into a coloring-book-only wrapper rather
      than forking the shared card.
- [ ] Manually verify: load a feed with a dangling reference, expand the issue
      row, click through to the offending entity's page.
- [x] Commit: `feat(issues): list the offending entities under each feed issue`

**Done** (commit `a515310`). Notes:

- **Grouping changed after all.** The key is now `${file}:${code}:${field}`, not
  `${file}:${code}`: one file raises `INVALID_REFERENCE` on several different
  columns now that the sweep is generic, and "stop_times.txt rows with a stop_id
  that does not exist" is actionable where the merged row was not. The key is
  also carried as a structured `IssueGroup` tuple, so the `key.split(':')` rough
  edge the plan flagged is gone. `OVERRIDES` is rekeyed to match
  (`routes.txt:INVALID_REFERENCE:agency_id`).
- The card stayed generic: `IssueItem` is `{ label, detail?, data? }` where
  `data` is an opaque bag of `data-*` attributes. The card knows nothing about
  navigation; `page-content-renderer.addEventListeners()` matches
  `[data-issue-nav]` and dispatches to the existing `onAgencyClick`/
  `onRouteClick`/`onStopClick`/`onServiceClick`/`onPathwayClick` dependencies.
  test-track's copy passes no items and renders exactly as before.
- Only files with their own page get a link (`ENTITY_PAGES` in
  `feed-issues.ts`: agency, routes, stops, calendar, calendar_dates, pathways).
  Everything else (stop_times, fare rules, ...) still lists its offending rows,
  just as unlinked text, since there is no page to land on.
- Labels need the row, not just the id, so `deriveFeedIssues()` takes an
  optional `FeedIssueRowSource` (satisfied by `gtfsParser`) and a `RowIndex`
  builds a pk -> row map **lazily, per file**, only for files that actually have
  listed entities. Without that, labelling 12 stop_times entities would scan
  stop_times 12 times.
- Cap is `MAX_ITEMS = 12` with a `moreCount` tail.
- Re-vendored as test-track commit `68ccd2d`, `@sha` bumped `7e94bec` ->
  `a515310`, still `@status modified` (it swaps `escapeHtml` for test-track's
  `escHtml`).

### Phase 8: Make them obviously fixable at the use site

- [x] **Red at the use site:** wherever a foreign key value is rendered
      read-only, show a dangling value in error color with a `title` explaining
      that the target does not exist. Covers `trips.shape_id` in the timetable
      trip rows and `routes.agency_id` on the route page at minimum. This is the
      read-only counterpart to the picker labelling that already exists.
- [x] **Contextual note on the entity page:** an entity whose own row has a
      dangling reference carries a warning note naming the broken field, so
      arriving from the issue card lands you on something that explains itself.
      Reuse `renderIssueCard` rather than inventing second warning markup.
- [x] **Fix path:** verify that clicking the field opens a picker carrying the
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
- [x] Commit: `feat(issues): surface and fix dangling references at the use site`

**Done** (commit `0131a2e`). Notes:

- The use sites read a **module-level dangling index** in `feed-issues.ts`, not
  a live lookup. `publishFeedIssues(results, source)` (which replaces the
  `deriveFeedIssues` + `setFeedIssues` pair at the `index.ts` call site) builds
  two indexes from the `INVALID_REFERENCE` errors: `danglingByValue`, keyed
  `${file}:${field}:${value}` for the render check, and `danglingByRow`, keyed
  `${file}:${pk}` for the per-entity note.
- Live-checking instead was rejected: `resolveForeignLabel` can only tell a
  value apart when the target field is the target table's whole natural key, so
  `trips.shape_id` (shapes has a composite pk) could not be checked that way.
  Reusing the validator's result also keeps the red and the issue card in
  agreement by construction.
- The index would otherwise go stale the moment a value is fixed, so both fix
  paths call `markReferenceResolved(file, field, value)` on commit and strip the
  error classes from the span in place: `commit()` in `inline-editable-field.ts`
  and `openTripPropShapePicker()` in `schedule-controller.ts`. A picker can only
  ever produce an existing value or the same broken one, so nothing needs to
  re-add an entry.
- **Red is generic, not per-page.** It went into `renderInlineEditableField()`,
  which every entity page renders its fields through, so `routes.agency_id`,
  `stops.parent_station`, `stops.level_id`, `pathways.from_stop_id` etc. are all
  covered by one change. The note went into `renderInlineEntityFields()` for the
  same reason.
- Fix path audit: `specFieldKind()` returns `'foreign'` for **every** field with
  a `foreignKey`, and both the entity-page picker and the editable-table picker
  branch on that kind and push the synthetic option, so all FKs are reachable.
  The timetable is the only bespoke path; it excludes `route_id`/`service_id`/
  `trip_id` from the trip property rows, leaving `shape_id` as the only FK
  there, which already has its own picker. No gap to fill.

### Follow-up: entity lists only ever appear for `INVALID_REFERENCE`

Found while testing the Nuuk feed, which reports "calendar.txt rows invalid
date" with nothing under it. The date is genuinely bad: the last row of
`calendar.txt` ends with a quoted CSV field containing a newline
(`"20261231\n"`), so the parsed `end_date` fails the `YYYYMMDD` check. The
report was the problem, not the detection. Fixed for the date checks:

- The three date checks in `validateCalendar()` (`calendar.start_date`,
  `calendar.end_date`, `calendar_dates.date`) now pass a `ValidationEntity` and
  name the value in the message, so the card expands to the offending service
  and links to its page.
- `formatValue()` in `feed-issues.ts` JSON-quotes a value whose problem is
  invisible (surrounding whitespace, embedded control chars) and renders `''` as
  `(empty)`, so `end_date: "20261231\n"` does not read as a valid date.

Still open: every other code that calls `addError` without an entity has the
same blind card. `INVALID_TIME_FORMAT`, `INVALID_COORDINATE`,
`MISSING_REQUIRED_FIELD`, `DUPLICATE_ID`, `INVALID_NUMBER`, `INVALID_URL` and
the rest should each pass one. `rowId()` is already the helper for it.

---

## Phase 9: Timetable stop click and hover highlight, in both repos

**Goal:** Clicking a stop in the timetable focuses it; hovering highlights it.
Shared with `../test-track`.

`src/modules/route-strip.ts` is vendored verbatim into test-track
(`../test-track/VENDORED.md`, SHA `9f1f986`), with coloring-book as the canonical
source. Put shareable highlight logic there so it flows across.

- [x] Click a stop name/marker in the timetable stop column
      (`timetable-renderer.ts:519`, `timetable-cell-renderer.ts:56`, both already
      carry `data-stop-id`) to focus that stop. Find the existing "focus a stop"
      mechanism first (`page-state-manager.ts` `setPageState({type: 'stop', ...})`,
      or a helper in `map-controller.ts` / `interaction-handler.ts`) and reuse it
      rather than reinventing it.
- [x] Hover highlights the stop (map and/or strip dot). Put the highlight logic
      in `src/modules/route-strip.ts` so it is shareable.
- [x] Apply the same change to `../test-track/src/modules/route-strip.ts` and
      bump its `VENDORED.md` row from SHA `9f1f986` to the new coloring-book SHA,
      keeping `@status verbatim`. test-track already has click-on-name, so
      reconcile with what is there rather than duplicating it.
- [ ] Manually verify in both apps: click a stop name, confirm focus behaves like
      other focus-stop entry points; hover, confirm the highlight appears.
- [x] Commit: `feat(timetable): focus and highlight stops from the stop column`

**Done** (commits `69dd3f6`, `f7a054d`; test-track `ad15fef`). Notes:

- **The click target is the rail dot, not the stop name.** The name span was
  already taken: `.stop-label-span` opens the change-stop picker
  (`schedule-controller.ts` `openStopPicker`), which is the editor's whole point
  and must not move. The TODO says "clicking stop markers", and the dot is the
  marker, so `railCell` grew a `{ stop_id, title }` option that turns the dot
  into a real `<button data-stop-id>`. Without the option the dot stays a
  decorative `<span>` inside an `aria-hidden` wrapper, exactly as before.
- **Focus means `mapController.highlightStop()`, not navigation.** Going through
  `setPageState({type:'stop'})` would replace the timetable with the stop page,
  which is wrong while editing a schedule. `highlightStop` is the map-side helper
  every other focus path lands on (fly-to + focused feature state + route
  spotlight) and leaves the timetable open.
- **Hover is split in two.** The dot scale is pure CSS via a named Tailwind group
  (`STRIP_ROW_CLASS = 'strip-stop-row group/strip'` on the row,
  `group-hover/strip:scale-125` on the dot), so it flows to test-track through
  the vendored file with no JS at all. The map reaction is per-app, because
  neither app's `layer-manager.ts` is the other's (test-track's copy is
  `modified`): each grew its own `setHoveredStop()` and its own delegated
  `pointerover`/`pointerout` (they bubble; `mouseenter`/`mouseleave` do not).
- coloring-book map side: a new `hovered` feature state on the `stops` source,
  read by the two existing `stops-focus-halo`/`stops-focus-ring` layers at lower
  opacity than `focused`. No new layers, and hover never touches the selection.
  `LayerManager.setHoveredStop()` mirrors `setFocusedStop()`, is cleared by
  `clearHighlights()`, and is reset on source recreation. Wired from
  `ScheduleController.installStopRowHover()`.
- test-track map side (commit `7498996`): it has no halo layers at all, so the
  same `hovered` feature state instead grows the stop circle (1.35x, against
  focus's 1.7x) and gives it the accent stroke. `hovered` also joins
  `SPECIAL_STOP`, so pointing at a strip row reveals the stop even when zoomed
  out past where plain stops fade. Two things there that coloring-book does not
  have to care about: `syncFeatureState()` wipes *all* feature state on every
  pass, so hover has to be part of the wanted-state model rather than a
  fire-and-forget `setFeatureState`; and `setHoveredStop` resolves through
  `drawnAncestor()` like `setFocus` does, since a platform is never drawn.
  Wired from `PanelRenderer` via a new `hoverStop` hook, cleared on `show()`/
  `hide()` because a page change replaces the hovered row without a
  `pointerout`.
- `ScheduleController` had no map or navigation reference, so `index.ts` injects
  one via `setStopHighlightHandlers({ onStopFocus, onStopHover })`, next to the
  existing `setPatchManager` call.

Two things worth carrying forward:

- **Tailwind's scanner treats `$` as a class character**, so a utility written
  immediately before a `${...}` interpolation (`...scale-125${x}`) is extracted
  as `...scale-125$`, matches nothing, and silently generates no CSS. Verified
  against the built stylesheet. Every utility in an interpolated class string
  must be whitespace-separated from the interpolation.
- **The vendored `route-strip.ts` row was stale**: coloring-book deleted
  `endpointNote`/`isMinority`/`MINORITY_SHARE` in `8cdd895` (unused here) while
  test-track still imported them, and the `VENDORED.md` SHA was never bumped, so
  nothing caught it. Re-vendoring surfaced it as a typecheck failure there. They
  are restored in coloring-book (commit `f7a054d`) as canonical-source exports,
  which Phase 10 needs back anyway for its endpoint/minority facts.

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

- [x] Write the render function, modelled on test-track's `renderStrip`, stripped
      of `placeVehicles` / `vehicleChip` / `eta` / `alertPips` (none of which
      exist in a static editor).
- [x] Data: `GTFSRouteSource` + `routeSequence(source, route_id, directionId,
      undefined)` + `routeGraph(sequence)`.
- [x] Rows: rail SVG + stop name link + endpoint/minority facts from `StopStats`
      (test-track's `endpointNoteHtml`). No trip counts.
- [x] Placement: a new section **below** the timetables list in `renderRoute()`
      (`page-content-renderer.ts:552`).
- [x] Give the timetables list a max height with `overflow-y-auto` so the page
      does not run long once the diagram is below it.
- [x] Incidental cleanup in the same file: `CREATE_NETWORK` is defined with a
      **literal NUL byte** in the source, which makes `rg`/`grep` treat the whole
      file as binary and skip it. Replace it with the `'\0create-network'` escape.
- [ ] Manually verify: open a route with branching patterns, confirm the diagram
      covers all trips (not just one service) and matches how test-track draws
      the same route.
- [x] Commit: `feat(route): draw the full route diagram on the route page`

**Done** (commit `2f51ecf`). Notes:

- New module `src/modules/route-diagram.ts`, exporting `renderRouteDiagram(parser,
  routeData)` and the `ROUTE_DIAGRAM_ROW` row class. It renders the whole section
  (heading + card), and returns `''` when the route has no trips with stop times,
  so the caller drops the section rather than showing an empty card.
- **One strip per direction, no tabs.** test-track uses direction tabs because it
  has `PageState.direction_id` to hang them off; the coloring-book route page has
  no direction in its page state, and adding one would be a navigation change
  outside this phase. Directions come from `directionsForRoute(source, route_id)`
  with no service filter, sorted by trip count, and the direction label is only
  shown as a heading when there is more than one.
- `renderCoverage` was ported over from test-track verbatim in substance (pattern
  count, loop note); it is the part that explains what the filled dots and the
  trip counts mean, so it earns its place.
- **`PageContentRenderer` had no parser.** `GTFSRouteSource` needs
  `getTripsByRouteId` / `getStopTimesByTripId` / `getFileDataSyncTyped`, none of
  which the relationships layer exposes, so `gtfsParser` is now an optional
  `ContentRendererDependencies` field, threaded `index.ts` -> `BrowseNavigation`
  (new trailing optional constructor arg) -> `PageContentRenderer`. Optional, so
  a renderer built without one just skips the diagram.
- **The row is the click target, not the dot.** Unlike the timetable (where the
  name span is already taken by the change-stop picker), nothing else on this row
  is interactive, so the whole row carries `data-stop-id` and navigates to the
  stop page via the existing `onStopClick` dependency. `railCell` is therefore
  called *without* `stop_id`, leaving the dot decorative; the row still carries
  `STRIP_ROW_CLASS`, so the CSS dot-scale hover from Phase 9 works for free.
- Hit the Phase 9 Tailwind gotcha again while writing this: test-track's
  `text-sm${minority ? ...}` pattern was copied over and silently produced no
  `text-sm`. Written as `text-sm ${minority ? 'opacity-60' : ''}` here. Verified
  the classes are in the built stylesheet.
- The timetables list scroll cap is `max-h-96 overflow-y-auto` on the inner
  `space-y-2` list, not the card, so the "add timetable for service" select stays
  pinned above the scroll region.
- The NUL byte is gone: `rg` now searches `page-content-renderer.ts` normally, so
  the `rg --text` note in the ground rules no longer applies.

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

- [x] Create `src/modules/service-timeline.ts` (check for naming conflicts
      first). Move `renderTimeline()` and its private helpers (`isServiceActive`,
      `getServiceColor`, `renderWeekdayDots`, `getDaysTooltip`, `hexToRgba`,
      `esc`, and the row-click wiring currently in `attachTimelineListeners`) out
      of `calendar-modal.ts` into this new module, exporting what's needed.
- [x] Add service-id filtering so callers can scope the `ServiceDataMap` to a
      specific set of `service_id`s. Prefer a post-filter step
      (`filterServiceDataMap(map, service_ids)`) over a parameter on
      `loadCalendarData()`, to keep the latter simple.
- [x] Update `calendar-modal.ts` to import from the new module instead of
      defining these locally; confirm the Calendar modal still renders
      identically.
- [x] Add support for an optional fixed `route_id` context (the route page needs
      a timeline row to link to a specific timetable, not just a service): an
      optional `data-route-id` attribute on `.timeline-row`, and an `onRowClick`
      callback shape flexible enough to carry `(service_id, route_id?)`.
- [ ] Manually verify the Calendar modal works exactly as before this refactor.
- [x] Commit: `refactor(calendar): extract the services timeline into a shared module`

**Done** (commit `e1534fc`). Notes:

- Public surface of `src/modules/service-timeline.ts`: types `ServiceData`,
  `ServiceDataMap`, `ServiceTimelineSource` (just `getAllRows`),
  `ServiceTimelineOptions`; functions `loadServiceData`, `filterServiceDataMap`,
  `isServiceActive`, `getServiceColor`, `renderServiceTimeline`,
  `attachServiceTimelineListeners`.
- `loadCalendarData` moved too and is now `loadServiceData`. It is the only
  producer of a `ServiceDataMap`, so leaving it behind in the modal would have
  forced Phase 12's callers to import from `calendar-modal.ts`. `CalendarModalDeps.gtfsDatabase`
  is now typed as `ServiceTimelineSource`, so the shape is declared once.
- `filterServiceDataMap` deliberately keeps each service's already-assigned
  color, so a service is the same color on the home page, the route page and in
  the modal. That means a filtered map's colors are not contiguous in the
  palette, which is the right tradeoff.
- The local `esc()` is gone from both files: `src/utils/escape-html.ts`
  `escapeHtml` already existed and does the same job plus `'`. The modal's
  `renderMonthGrid`/`renderMonthNav` (which stay in `calendar-modal.ts`) now use
  it too.
- Route context is a fixed `options.route_id` on the whole timeline, rendered as
  `data-route-id` on every `.timeline-row`; `attachServiceTimelineListeners(root,
  (service_id, route_id?) => ...)` reads it back off the row. Per-service route
  mapping was not added: no Phase 12 caller needs one row's route to differ from
  its neighbour's, and the stop page can render one timeline per route if it
  turns out to need that.
- `attachServiceTimelineListeners` takes a `ParentNode`, not the whole document,
  so several timelines can coexist on one page in Phase 12.
- The modal's timeline markup is byte-identical to before apart from `'` now
  being escaped as `&#39;` inside attributes.

### Phase 12: Swap the home, route and stop pages to the timeline view

- [x] Home page (`renderHome()`): replace the `renderServiceReference()` list
      with the shared timeline renderer, scoped to all services. Wire row clicks
      to the existing `onServiceClick` dependency.
- [x] Remove `tripCountByService`/`routesByService` computation in `renderHome()`
      now that nothing consumes it.
- [x] Route page (`renderRoute()`): replace the `renderTimetableReference()` list
      under "Timetables" with the shared timeline renderer, filtered to the
      route's `service_id`s (from the existing `serviceGroups` grouping), passing
      the fixed `route_id` context from Phase 11 so row clicks navigate to the
      specific timetable. This is the same list Phase 10 made scrollable; keep
      the scroll container.
- [x] Remove the now-unused `serviceTrips.length` trip-count plumbing in
      `renderRoute()`.
- [x] Stop page (`StopViewController.renderTimetablesSection()`): replace the
      timetables list with the timeline renderer, filtered to the relevant
      `service_id`s (derived from `timetableKeys`), with row clicks carrying both
      `route_id` and `service_id`.
- [x] Keep the existing "add new service" / "new timetable" dropdown affordances
      on all pages. Only the list rendering changes, not the add-new flow.
- [x] Remove `TimetableKey.tripCount` computation in `stop-view-controller.ts` if
      nothing else consumes it, and remove the `tripBadge` code paths in
      `src/utils/entity-references.ts` that no caller uses anymore. Check every
      call site first: do not remove `renderServiceReference`/
      `renderTimetableReference` themselves if the service page or another page
      still uses them.
- [ ] Manually verify all three pages, including row clicks landing on the right
      timetable.
- [x] Commit: `feat(services): use the timeline view on the home, route and stop pages`

**Done** (commit `ff77801`). Notes:

- **`filterServiceDataMap` now fills in missing services instead of dropping
  them.** A trip can point at a `service_id` no calendar defines; the old
  `renderTimetableReference` path still listed it (falling back to
  `{ service_id }`), and a plain filter would have made that timetable vanish
  from the route and stop pages entirely. It now emits a row with
  `calendar: null`, no exceptions and a neutral grey (`UNDEFINED_SERVICE_COLOR`),
  so the broken reference stays visible. It also sorts its output, since callers
  pass ids in trip order rather than sorted order.
- **`getServices()` is gone** from `page-content-renderer.ts`: it duplicated
  `loadServiceData`'s calendar + calendar_dates union, so the home page's service
  count is now `serviceData.size`. New private `serviceTimelineSource()` adapts
  the injected `gtfsDatabase` to `ServiceTimelineSource`.
- **The stop page renders one timeline per route**, not one overall. A timeline
  carries a single fixed `route_id`, and a stop is typically served by several
  routes, so `timetableKeys` is grouped by `route_id` into a colored route
  heading + its own scoped timeline. The `via <platform>` line is preserved,
  hoisted to the route heading with the descendant stops merged across that
  route's services (`MAX_VIA_LABELS` moved into `stop-view-controller.ts`, which
  is now its only user).
- **Row clicks are wired once, in `PageContentRenderer.addEventListeners()`.**
  It runs on the container for every page before delegating to the sub
  controllers, so its single `attachServiceTimelineListeners` call covers the
  home, route and stop timelines. `route_id` present -> `onTimetableClick`,
  absent -> `onServiceClick`. `StopViewController` therefore no longer needs
  `onTimetableClick`/`onRouteClick`/`onServiceClick` at all; those three deps and
  their handler blocks are removed.
- Removed as dead: `renderServiceReference`, `SERVICE_REF_ROW`,
  `ServiceReferenceOpts` (nothing else rendered one), the `viaStops` option and
  its `viaLine` on `renderTimetableReference`, and `TimetableKey.tripCount`.
  `renderTimetableReference` itself stays: `service-view-controller.ts` still
  lists routes with it, `tripCount` included.
- The route page's `max-h-96 overflow-y-auto` scroll container is kept, now
  wrapping the timeline instead of a `space-y-2` list.

**Follow-up: the timeline uses the app's one tooltip mechanism.** A later commit
added a per-week `title` attribute plus DaisyUI `tooltip`/`data-tip` on the
weekday-dot cell; both are now the portaled `.field-tooltip-trigger` +
`data-tooltip-content` pair from `src/utils/tooltip-position.ts`, which is the
only tooltip mechanism the app should use (native `title` is unstyled and slow,
DaisyUI's `.tooltip` sets `display:inline-block` and gets clipped by scroll
containers). Details worth carrying forward:

- `service-timeline.ts` has a local `renderTooltipTrigger(text, content, style)`
  helper. The portal writes `data-tooltip-content` as HTML, so plain text goes
  through `escapeHtml` first.
- The portal resolves the trigger with `closest()`, so triggers nest: the week
  cell carries the week tooltip and each exception tick carries its own
  "Added <date>" / "Removed <date>" tooltip, and the innermost one wins.
- There is no per-week tooltip. A week is not a meaningful unit (a service can
  start or end mid-week), so every highlighted cell in a row carries the same
  content, the service's `start_date` - `end_date`, and the whole shaded span
  reads as one tooltip. Cells outside the range carry no trigger at all.
- Converted alongside it: the timeline row label, the service edit button, and
  the calendar modal's day chips and feed start/end badges.
- The portal was at `z-[100]`, below DaisyUI's modal layer (z-index 999), so
  tooltips triggered inside a modal were painted behind it and looked missing.
  It is now `z-[2000]`. Any future overlay must stay below that.

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

Done. The flag landed as `columnOverrides[field].list?: boolean`. Grouping is a
pure function of `config.rows` (`groupRows()`), recomputed wherever it is needed
rather than cached, so the edit and delete handlers always see the same groups
the user is looking at; `findGroup(config, key)` maps a cell's `data-key` back
to its group. With no list column every row is its own group, so the plain
rendering is the same code path as before.

Two semantics the plan left open were decided with the user:

- Editing a non-list cell in a collapsed row applies to **every** row behind it,
  in one patch (one `recordBatchMixed`, so it undoes as one step). This holds
  for the re-key path too: all the group's rows are deleted before any is
  re-inserted, so a key moving onto one still held by a sibling cannot collide.
  The duplicate-key check ignores the group's own keys for the same reason.
- Deleting a collapsed row deletes **every** row behind it, again in one patch.
  The confirm dialog and the button tooltip name the count when it is >1.

`renderCell`'s formatting was pulled out into `cellText()` so `renderListCell()`
shares it, which is what carries foreign-key labels and `format` overrides into
the list values for free. The trailing blank add-row still renders a normal
editable cell for a list column (you have to be able to set `fare_media_id` on a
new row); grouping only applies to existing rows.

- [x] In `src/modules/editable-table.ts`, add support for a column marked as a
      "list column" (extend `EditableTableColumnOverride` with a `listOf?: boolean`
      or similar flag). When set, rows identical across every *other* rendered
      column collapse into a single visual row, with that column rendering all
      distinct values from the collapsed rows, newline-separated (use
      `white-space: pre-line` or `<br>`-joined markup, not the current `truncate`
      single-line span, which would clip a multi-value list).
- [x] Make list-column cells non-interactive/read-only for now, matching how
      `extraColumns` and `columnOverrides.readonly` already render plain text.
- [x] Foreign-key list values should still resolve to display labels (reuse
      `foreignLabelMaps()`, ~lines 237-251) rather than showing raw IDs.
- [x] Confirm add-row/delete-row flows still operate correctly against a grouped
      display: adding or deleting one underlying row must not corrupt the
      collapsed view.
- [x] Commit: `feat(editable-table): support list-valued columns via row grouping`

### Phase 14: Apply list columns to the four fares tables

Done, plus one semantic change to Phase 13's grouping that the multi-list tables
forced. Phase 13 deduped each list column independently, which is correct with a
single list column (`fare_products`) but not with a from/to pair: rows
`(A -> X)` and `(B -> Y)` sharing every other column would have rendered as
`from: A, B` / `to: X, Y`, claiming four pairings where only two exist.

Decided with the user: **a group only collapses when every combination of its
listed values is actually present**. `groupRows()` now partitions each candidate
group (rows identical across all non-list columns) into cross-product blocks via
`crossProductBlocks()`, a greedy grow-one-value-at-a-time cover that only admits
a value when all the combinations it implies exist. Rows left over become blocks
of their own, so a partial product splits into several displayed rows rather
than lying about one. With fewer than two list columns it short-circuits and the
Phase 13 behaviour is unchanged. `renderListCell()` needed no change: distinct
values per column is exactly right once the block is a complete product.

Two details worth remembering:

- Blocks are keyed on the list values only, so two records the rendered columns
  cannot tell apart (possible when `config.fields` is a subset of the table's
  fields) share an entry and stay together rather than one being dropped.
- `fare_leg_join_rules` has *all four* of its columns marked as lists, so the
  whole table is one candidate group and the cross-product split is the only
  thing separating its displayed rows.

- [x] `fare_products`: group by everything except `fare_media_id`, mark
      `fare_media_id` as a list column (`FARE_PRODUCTS` entry, ~lines 385-398).
- [x] `fare_leg_rules`: mark `from_area_id` and `to_area_id` as list columns
      (`FARE_LEG_RULES` entry, ~lines 399-414).
- [x] `fare_transfer_rules`: mark `from_leg_group_id` and `to_leg_group_id` as
      list columns (`FARE_TRANSFER_RULES` entry, ~lines 432-445).
- [x] `fare_leg_join_rules`: mark both OD pairs (`from_network_id`/`to_network_id`
      and `from_stop_id`/`to_stop_id`) as list columns (`FARE_LEG_JOIN_RULES`
      entry, ~lines 415-431). Field names confirmed against
      `src/gtfs-spec/files/fare-leg-join-rules.ts`: those four are the whole table.
- [ ] Manually verify each of the 4 tables with a feed that has actual
      duplication on these keys (create test rows if the sample feed has none),
      confirming rows collapse and list correctly. **Left to the user.**
- [x] Commit: `feat(fares): list repeated foreign keys instead of duplicating rows`

#### Follow-up: list cells are editable (fix pass)

Phases 13-15 shipped list cells read-only, which read as broken next to the
click-to-edit columns around them. Fixed in `54b620a`/`b8de069`/`37e6a15`:

- [x] `src/modules/option-picker-modal.ts`: the search box, result list, uFuzzy
      matching and keyboard handling moved into a shared `mountPicker()`, and
      `showMultiOptionPickerModal()` was added beside `showOptionPickerModal()`.
      Checkbox rows, toggle on click or Enter, Done resolves `string[]` and
      Cancel resolves `null`.
- [x] Selected options lead the list and are **never** capped by `MAX_SHOWN`;
      only the unselected remainder is, and the note counts that remainder
      ("All 214 selected shown, plus 50 of 7831 more"). Without this an area
      with 214 stops out of 8045 could not show, let alone uncheck, most of what
      it had selected. The partition happens per render rather than per toggle,
      so rows only move when the query changes, never out from under the
      pointer.
- [x] Blank is **not** a checkbox. `emptyOption: {label, hint}` renders a pinned
      button above the list, highlighted exactly when the selection is empty, so
      picking an option turns it off and clicking it clears the selection. The
      exclusivity is structural rather than enforced by handlers, and the picker
      still resolves a plain `string[]`.
- [x] `renderListCell()` now emits an `.editable-cell` span carrying
      `data-list="1"` and `data-values` (the group's distinct **raw** values as
      JSON). Display caps at `LIST_CELL_MAX = 8` labels plus `+N more`, via
      `renderListValues()`, which the join columns below share.
- [x] `commitListCell()` reconciles the rows behind the collapsed row: the block
      becomes the cross product of the other list columns with the new selection,
      so Phase 14's complete-product invariant is preserved by construction. A
      surviving combination reuses its existing record (fields outside
      `config.fields` are not lost); the rest are deletes plus inserts in one
      `recordBatchMixed`, so it undoes as one step. Values are coerced and
      per-field validated first, `validateRow` runs over every new record, and a
      key colliding with a row outside the group is refused the same way the
      re-key path refuses one.
- [x] An empty selection commits as `['']`: one row with the field blank, which
      in the fare rules is the "matches everything" row rather than no row.
- [x] New `onRowsChanged?` config hook, kept separate from `onUpdate` because
      the row count changed and the display cannot be patched in place. Ordinary
      cell edits still update in place, so a full re-render never destroys an
      editor the user has moved on to opening.

### Phase 15: Generalize the areas/networks list display

- [x] Extract `renderAreaStopLists()`'s presentation (the `<details>`/`<summary>`/
      `<ul><li>` markup, item formatting via `getStopDisplay`/`getEntityDisplay` +
      `renderOptionLabel`) into a shared helper taking a
      `Map<id, {label: string, items: string[]}>` and returning the HTML block,
      independent of whether the source join is `stop_areas` or `route_networks`.
- [x] Reimplement `renderAreaStopLists()` as a thin wrapper: collect the
      `stop_areas`/`stops` join data, then call the shared helper.
- [x] Add an equivalent for Networks: collect `route_networks`/`routes` join data
      (reuse the join logic in `countRoutesPerNetwork()`, `fares-modal.ts:70-82`),
      then call the shared helper. Wire it in as the Networks entry's `detail:`
      callback, mirroring Areas at `fares-modal.ts:464`.
- [ ] Manually verify both the Areas and Networks panes show matching-style list
      details.
- [x] Commit: `feat(fares): show a route list detail for networks, matching areas`

**Done** (commit `74b7ede`). Notes:

- The split is **two** helpers, not one. `renderMemberLists(heading, emptyItems,
  sections)` is the presentation half, and `collectMemberSections(deps, spec)` is
  the join half: the two panes differ only in which tables they read, so the
  collection loop is as shareable as the markup. `renderAreaStopLists()` and the
  new `renderNetworkRouteLists()` are each a single call to both.
- `collectMemberSections` takes `{ groupTable, memberTable, joinTable,
  groupField, memberField, memberSuffix? }`. `memberSuffix` is the one
  area-specific behaviour left: the `, and its platforms` note on a station.
  Networks pass none.
- Sections are a plain array, not the `Map<id, ...>` the plan sketched. The id
  was only ever the lookup key while building; nothing renders it, and the group
  rows already come back in table order, so the map would have been dead weight.
- Both `getEntityDisplay` calls take `specStoreName(table)`, not the raw
  `GTFS_TABLES` value: the dispatcher keys on `stops`/`routes`, and passing
  `stops.txt` would silently fall through to its generic `<singular>_name`
  branch.
- `countRoutesPerNetwork()`/`countStopsPerArea()` are untouched. They count join
  rows without reading the member table at all, so folding them into
  `collectMemberSections` would have made the Routes/Stops column pay for a full
  `routes`/`stops` read.
- Networks now has both a count column and an expandable list, matching Areas,
  which was the asymmetry Phase 13-15's context called out.

#### Follow-up: members are a column, not a block below the table (fix pass)

The phase as executed left **three** display patterns for one idea (a group and
the things in it): grouped list cells on the rule tables, a count column on
Areas/Networks, and a `<details>` block below the table. The point was to unify
them. Redone in `b8de069`, so everything is now a list column in the table:

- [x] Deleted `renderMemberLists`, `collectMemberSections`, `renderAreaStopLists`,
      `renderNetworkRouteLists`, `MemberListSection`, `countStopsPerArea`,
      `countRoutesPerNetwork`, and the `detail?` hook on `FaresEntry` with its
      concatenation in `refresh()`. Note that this reverses the split described
      immediately above: the two helpers are gone, not renamed.
- [x] `EditableTableExtraColumn` / `config.extraColumns` are deleted too, not
      left behind: the two count columns were their only use, and `fares-modal`
      is the only consumer of `editable-table`. Replaced by
      `EditableTableJoinColumn` (`label`, `values(row)`, `options()`,
      `apply(row, values)`) and `config.joinColumns`.
- [x] A join column's members live in a join table, so grouping cannot produce
      them. `editable-table` renders the cell and runs the picker; the **host**
      owns the write, so nothing in the table module knows a join table's shape.
      Cells reuse `renderListValues()`, so they cap at 8 with `+N more` exactly
      like a list column, and carry `data-join="<index>"` rather than
      `data-field` (a join cell has no spec field, so `resolve()` cannot handle
      it: `openCellEditor` branches on `data-join` before calling `resolve`).
- [x] One `memberJoinColumn(deps, spec)` in `fares-modal.ts` builds both panes
      from `{label, memberTable, joinTable, groupField, memberField, options,
      memberSuffix?}`. It reads the join once per refresh into a
      `Map<groupId, {value,label}[]>`; `apply` diffs the picked set against it
      and writes the join table in one `recordBatchMixed`, keyed with
      `generateCompositeKeyFromRecord`. `memberSuffix` still carries the
      `, and its platforms` note on a station; Networks passes none.
- [x] Added `routeOptions(deps)` beside `networkOptions`. Areas reuses
      `fareStopOptions`, which already filters to stops and stations, matching
      what `stop_areas` may name.
- [x] The `getEntityDisplay(specStoreName(table), ...)` note above still applies
      and is why stop labels keep going through `getStopDisplay` (the `stops`
      case of the dispatcher).
- [x] Both `note:` lines reworded: membership is now editable here as well as on
      the stop/route page. Station inheritance is unchanged, and this editor
      writes explicit join rows only, same as `utils/stop-areas-field.ts`.
- [ ] Manually verify: list cells on all four rule tables edit and undo in one
      step; Areas/Networks list their members, cap at 8, and agree with the stop
      and route pages after an edit. **Left to the user.**

---

## Phases 18-21: Later additions (small, independent)

These were added to `TODO.md` after the original planning pass. Neither depends
on any earlier phase, so they can be picked up whenever.

### Phase 18: Replace glyph characters with SVG icons

**Goal:** No text glyphs standing in for icons. Every one becomes a proper inline
SVG, styled in theme, sharing the existing icon helpers.

`src/modules/modal-utils.ts` is the canonical icon home: `renderTrashIcon`
(line 1), `renderUploadIcon` (line 5), `renderRouteWaypointsIcon` (line 13), each
taking a Tailwind `sizeClass` defaulting to `h-4 w-4`. Follow that signature
exactly for anything new. Decided with the user: **all** of the glyphs below get
replaced, including the `route-graph.ts` arrow.

Full inventory (this is every glyph in `src/`, verified by grep):

- `src/modules/calendar-modal.ts:105` - `&#9654;` (▶) inside a
  `badge badge-xs badge-success` marking the feed start date.
- `src/modules/calendar-modal.ts:109` - `&#9664;` (◀) inside a
  `badge badge-xs badge-error` marking the feed end date.
- `src/modules/service-timeline.ts:371` - `▲` with inline `style="color:#4ade80"`,
  an added service date in the timeline (moved out of `calendar-modal.ts` by
  Phase 11).
- `src/modules/service-timeline.ts:379` - `▼` with inline `style="color:#f87171"`,
  a removed service date in the timeline.
- `src/modules/calendar-modal.ts:91-92` - `+` / `−` chips marking an
  added/removed service on a day in the month calendar view.
- `src/modules/ui.ts` - 9 collapse chevrons set via `chevronEl.textContent`, at
  lines 912, 944, 996, 999, 1025, 1028, 1068, 1105, 1108. These are assigned
  imperatively, not templated, so they need `innerHTML` (or a class toggle on a
  single static SVG) rather than `textContent`.
- `src/modules/route-graph.ts:166` - `→`, but it is inside a doc comment, not
  rendered markup. Nothing to swap; confirm and drop it from the inventory.

- [x] Add the missing icon helpers to `modal-utils.ts`, matching the existing
      `sizeClass`-parameter signature: a chevron (one icon, rotated via a class
      for the up/down states, rather than two separate icons), a start/end
      triangle marker, an up/down service-date marker, and an arrow.
- [x] Swap the two calendar-modal date badges (lines 105, 109). Keep them inside
      their `badge badge-xs badge-success` / `badge-error` wrappers and keep the
      `field-tooltip-trigger` / `data-tooltip-content` attributes so the hover
      text is unchanged.
- [x] Swap the two `service-timeline.ts` timeline markers (lines 371, 379).
      Replace the inline `style="color:#4ade80"` / `#f87171` hex colors with
      theme classes (`text-success` / `text-error`) instead of carrying the
      hardcoded hex onto the SVG. They are rendered through
      `renderTooltipTrigger(text, content, style)`: keep the trigger wrapper, and
      pass the color as a class rather than widening the `style` parameter.
- [x] Swap the 9 `ui.ts` chevrons. Since these are runtime `textContent`
      assignments inside expand/collapse handlers, prefer rendering the chevron
      SVG once into the element and toggling a `rotate-180` class on it, so the
      handlers stop rebuilding markup on every toggle.
- [x] `route-graph.ts:166` needs no change: the arrow is prose inside a doc
      comment. Re-grep to confirm, then leave it.
- [x] Size and color must come from Tailwind/DaisyUI classes, not inline styles,
      so all 9 themes stay correct. Verify light and dark themes.
- [x] Re-grep `src/` for glyphs afterwards to confirm none remain.
- [ ] Manually verify: calendar modal badges and timeline markers, and every
      expand/collapse chevron in the file/route list.
- [x] Commit: `refactor(icons): replace glyph characters with svg icons`

**Done** (commit `51e8536`, plus the `ui.ts` half which landed inside `ef01288`,
see below). Notes:

- **Three helpers, not four.** `renderChevronIcon` (stroke chevron pointing
  down), `renderTriangleIcon` (filled triangle pointing right), and
  `renderCloseIcon` (see below). No arrow helper: the only `→` in `src/` is prose
  in a `route-graph.ts` doc comment, re-grepped and confirmed, so nothing renders
  one.
- **One triangle covers all four markers.** Its path is centred on the viewBox
  (`M8 6l8 6-8 6z`, bounding box 8..16 x 6..18), so rotating it stays put:
  feed start as-is, feed end `rotate-180`, added `-rotate-90`, removed
  `rotate-90`. Both rotation and color are passed through the single
  `sizeClass` parameter, which is just a class string, so the existing helper
  signature did not have to grow.
- **The month-grid `+` / `−` chips reuse that same up/down triangle** (decided
  with the user), so an added/removed date reads identically in the month view
  and the timeline. No plus/minus icons exist.
- `renderTooltipTrigger`'s third parameter in `service-timeline.ts` changed from
  `style` to `className` (its only two style callers were these glyphs), and the
  ticks pass `inline-flex text-success` / `inline-flex text-error`. `inline-flex`
  is needed because an SVG inside a bare inline span does not centre in the
  table cell.
- The `ui.ts` chevron spans are now `inline-flex opacity-60 transition-transform`
  with the SVG set once via `innerHTML`; each of the three toggle handlers ends
  in a single `chevronEl.classList.toggle('rotate-180', isExpanded)` instead of
  two `textContent` writes. `inline-flex` matters here too: `rotate-180` on a
  non-replaced inline element does nothing.

**Out-of-inventory glyphs found by the closing re-grep.** The plan's inventory
claimed to be every glyph in `src/` and was not: five `×` close/remove buttons
were standing in for an X icon. They are swapped too, via a new
`renderCloseIcon`, since they are the same defect: `modal-utils.ts`'s shared
`showModal` dismiss button, `levels-controller.ts`, `notification-system.ts`, and
two in `service-days-controller.ts`. The `•` separator in
`field-descriptions.ts:84` is left alone: it is real typography, not an icon.

**Follow-up: an SVG inside a tooltip trigger killed the tooltip** (commit
`fc960de`). `findTrigger()` in `src/utils/tooltip-position.ts` started with
`if (!(target instanceof HTMLElement)) return null`, and an `<svg>` is an
`SVGElement`, not an `HTMLElement`, so `pointerover` on the new icons matched no
trigger at all. Both that check and the `relatedTarget` check in
`handlePointerOut` now test `Element`. This was pre-existing for every trigger
whose content was already an icon (the timeline's pencil edit button), not new
breakage, and it is worth checking against Phase 20's missing fares tooltips.

**The `ui.ts` chevrons are not in `51e8536`.** A second session was editing this
working tree at the same time and committed Phase 21's `ui.ts` changes with
`git commit -a`, which swallowed the chevron hunks into `ef01288`
(`fix(files-modal): ...`). The code is correct and present; only the commit
message is wrong about it. Nothing to redo.

### Phase 19: Shapes list shows routes and trip counts, with sticky chrome

**Goal:** The Shapes modal table tells you what actually uses each shape, links
through to those routes, and stays usable with hundreds of shapes.

`src/modules/shapes-manager.ts` (332 lines) is self-contained. `renderBody()`
(lines 37-79) currently renders a 3-column table (Shape ID / Points / Actions)
from a `Map<string, number>` of shape_id to point count, built by `getShapes()`
(lines 91-101) via `gtfsDatabase.getAllRows('shapes')`. `open()` (line 90) wires
`refreshPanel()` (lines 116-119), which re-renders `renderBody()` into
`#shapes-panel` after every mutation, so any new data the table needs must be
recomputed there too, not just on first open.

Decided with the user: the usage count is the **trip** count, plus a link per
distinct route. Keep it in theme, and share code rather than inlining new markup.

- [x] Build a shape usage map alongside `getShapes()`: read `trips.txt` (use
      `gtfsParser.getFileDataSync('trips.txt')`, the pattern at
      `schedule-controller.ts:746`) and produce
      `Map<shape_id, { tripCount: number, routeIds: Set<string> }>`. Include
      shapes with zero trips (they must still render a row, showing 0).
- [x] Add a "Trips" column and a "Routes" column to the table in `renderBody()`.
      Keep the existing "Points" column.
- [x] Render each route in the Routes column via the shared helpers, not an
      inline string: `getRouteDisplay` (`src/utils/entity-display.ts:34`) with
      `renderOptionLabel`, or `renderRouteReference`
      (`src/utils/entity-references.ts:107`) if its markup fits the table cell.
      Check `renderRouteReference` first, and only fall back to the display
      helpers if the reference card is too heavy for a table row.
- [x] Route links must navigate through `PageStateManager`
      (`{type: 'route', route_id}`), following the delegated-click +
      `data-route-id` pattern used elsewhere. The Shapes modal has no
      `PageStateManager` reference today, so `ShapesManager`'s constructor
      (line 85, currently `gtfsParser` + `patchManager`) needs one injected from
      `src/index.ts`. Decide whether clicking a route also closes the Shapes
      modal; navigating behind an open modal is the wrong behavior, so it
      probably should close.
- [x] Make the table body scrollable with the `<thead>` still visible: wrap the
      table in a fixed-max-height `overflow-y-auto` container and use DaisyUI's
      `table-pin-rows` (or `position: sticky` on the `th`).
- [x] **No horizontal scrolling.** The two new columns must fit without one.
      `showModal()` takes a `boxClassName` (`modal-utils.ts:58`); the Shapes call
      (`shapes-manager.ts:105-109`) passes none, so it gets the default narrow
      box. Widen it the way the Fares modal already does
      (`fares-modal.ts:588`: `boxClassName: 'max-w-6xl w-11/12'`). Then drop the
      `overflow-x-auto` wrapper (line 63) and let the Routes column wrap instead
      of overflowing; a shape used by many routes is the case that will push the
      table wide, so wrap or truncate that cell rather than growing the table.
- [x] Keep the "Upload GPX" button always visible: move it out of the scrolling
      region into a pinned footer below the scroll container (it is currently at
      line 76, inside the scrolling flow). The empty-feed branch (lines 38-43)
      already renders it standalone and needs no change.
- [x] Confirm `refreshPanel()` (lines 116-119) recomputes the trips/routes data,
      not just the point counts, so the columns are correct after a
      new/replace/delete without reopening the modal.
- [ ] Watch for cost: `getAllRows('shapes')` already walks every shape point, and
      this adds a full `trips` scan on every panel refresh. If a large feed makes
      the modal sluggish, compute the usage map once per `open()` and only
      recompute the piece a given mutation invalidates.
- [ ] Manually verify: open Shapes on a feed with many shapes, confirm the header
      stays put while scrolling and the upload button stays reachable; confirm
      trip counts and route links are right, including a shape used by more than
      one route and a shape used by none.
- [x] Commit: `feat(shapes): show routes and trip counts in the shapes list`


**Done** (commit `78024de`). Notes:

- `getShapes()` moved off `open()` and onto the class as a private method
  returning `Map<shape_id, { pointCount, tripCount, routes }>`. It stores the
  resolved route *records*, not ids, so `renderBody()` needs no second lookup.
  A trip pointing at a `shape_id` no `shapes.txt` row defines is skipped rather
  than synthesizing a row: `trips.shape_id` is a spec-declared foreign key, so
  the Phase 6 sweep already reports it as a dangling reference.
- Routes render as a new local `renderRouteChip()`: a colored dot plus
  `renderOptionLabel(getRouteDisplay(route))`. `renderRouteReference` was
  checked first and rejected, it is a full `p-3` card row with its own hover
  and View button, far too heavy to stack several to a table cell. The chip
  reuses `routeColor()` for the dot so an uncolored route matches the hue it
  has everywhere else.
- **No `PageStateManager` injection after all.** `navigation-actions.ts`
  already exposes `navigateToRoute()` over the module-level page state manager
  singleton, which `ui.ts`, `browse-navigation.ts` and
  `page-content-renderer.ts` all use. Importing that keeps `ShapesManager`'s
  constructor unchanged. The chip is a `data-action="route"` button, so it
  rides the existing delegated `[data-action]` handler instead of adding a
  second listener.
- Clicking a route closes the modal first, then navigates.
- The local `esc()`/`escAttr()` pair is gone, replaced by `escapeHtml` from
  `src/utils/escape-html.ts`. It escapes quotes, so the attribute-safe variant
  was redundant, and it avoids allocating a detached div per call.
- Scroll chrome: `max-h-[55vh] overflow-y-auto` around the table plus DaisyUI
  `table-pin-rows` for the sticky `<thead>`; the Upload GPX button already sat
  after the table, so moving it out of the scroll region was just a matter of
  the container ending before it. `overflow-x-auto` dropped and the box widened
  to `max-w-6xl w-11/12` like the Fares modal.
- The cost item is left unchecked deliberately: `refreshPanel()` recomputes
  everything (which is what keeps the columns correct), and whether the extra
  `routes`/`trips` scan is noticeable needs a large feed to judge.

### Phase 20: Restore field tooltips in the Fares modal

**Goal:** Hovering a column header in any Fares table shows the spec description
tooltip again, as it does elsewhere in the app.

**Done.** What was actually wrong, after the two problems the plan predicted had
already been fixed independently (the `columnOverride?.label` branch now passes
through `renderFieldLabelContent`, and the portal's z-index is `z-[2000]`, above
DaisyUI's modal layer at 999): the tooltips appeared but had no description.
`getGTFSFieldDescription` (`src/utils/zod-tooltip-helper.ts`) resolved
descriptions through a hardcoded `schemaMap` of exactly 9 filenames (agency,
routes, calendar, calendar_dates, stops, trips, stop_times, shapes, feed_info).
Every other file, all of fares v2 included, fell through to `''`, so
`buildFieldTooltipContent` emitted only the "ID:" and "Presence:" lines. Not a
fares regression at all: it was generic and had never worked outside those 9.

Fixed at the source rather than at the fares call site: `getGTFSFieldDescription`
now reads `GTFS_FIELD_SPECS[filename]?.[field]?.description`, which the spec
layer populates verbatim for all 32 files. That also fixes `editor.ts`'s CSV
header tooltips for the same 23 files. Note the derived Zod schemas are *not* a
usable source here: `adapter.ts` attaches `.describe()` to the inner type and
then wraps it in `.optional()`, so `shape[field].description` is undefined for
every optional field (`getFieldDescription` in `src/types/gtfs.ts` has this
latent bug too, but it is only used by the `field-descriptions` overlay).

Also handled the `joinColumns` case the plan left open. Those headers ("Stops",
"Routes" on Areas and Networks) rendered as bare escaped `<th>`s. They are
spec-backed, just against the *join* table, so `EditableTableJoinColumn` gained
an optional `spec: { tableName, field }` and `memberJoinColumn` in
`fares-modal.ts` points it at `stop_areas.stop_id` / `route_networks.route_id`.
The new shared helper `renderSpecFieldLabelContent(tableName, field, label)` in
`field-component.ts` builds the config for it and deliberately omits presence:
the field is required of a join row, not of the row being rendered, so a
required mark there would be a lie.

The plumbing is all still present, which is why this is a regression rather than
a missing feature:

- `renderFieldLabelContent()` (`src/utils/field-component.ts:196-209`) wraps the
  label in `<span class="field-tooltip-trigger" tabindex="0"
  data-tooltip-content="...">` whenever `buildFieldTooltipContent(config)`
  returns something.
- `src/modules/editable-table.ts:316` calls `renderFieldLabelContent` for every
  spec-backed `<th>`, and `fares-modal.ts` renders every fares table through
  `renderEditableTable()`. So the triggers should be in the DOM.
- `src/utils/tooltip-position.ts` owns the portal: `initFieldTooltipPortal()`
  (line 165) registers delegated `pointerover`/`pointerout`/`focusin`/`focusout`
  listeners on `document`, matching `TRIGGER_SELECTOR = '.field-tooltip-trigger'`
  (line 19), and appends a `position: fixed`, `z-[100]` portal to `document.body`
  (lines 90-96). It is called once from `src/index.ts:45`.

Two header paths exist and only one carries a tooltip, which is the first thing
to check: `editable-table.ts:314` returns a bare `<th>${override.label}</th>` for
columns with a `columnOverride` label, bypassing `renderFieldLabelContent`
entirely, and `:327` does the same for `extraColumns`. If the fares tables set
`columnOverrides` with labels, that alone explains missing tooltips on exactly
those columns.

- [x] Diagnose before changing anything. Open the Fares modal and check in
      devtools: (a) do `.field-tooltip-trigger` elements exist in the fares
      `<th>`s, (b) if they exist, does the portal element get appended to
      `document.body` on hover, and (c) if it is appended, is it visible or is it
      behind the modal / clipped by an ancestor.
- [x] If the triggers are missing: the `columnOverride?.label` branch at
      `editable-table.ts:314` is the cause. Fix by passing the override label
      through `renderFieldLabelContent` (it already accepts
      `{ ...fieldConfig, label: override.label }` on the very next branch at
      line 316) instead of returning a bare `<th>`. Decide separately whether
      `extraColumns` (line 327) should get tooltips too, since those are not
      spec-backed and may have no description to show.
- [x] If the portal appears but is invisible: it is a stacking or clipping
      problem between the portal's `z-[100]` and the `showModal()` overlay. Check
      the overlay's z-index in `modal-utils.ts` and `src/styles/main.css`
      (lines 43, 52 set `z-index: 40 !important` and `50`). Raise the portal
      rather than lowering the modal.
- [x] Check whether this affects only Fares or every `renderEditableTable()`
      caller. If it is generic, fix it in `editable-table.ts` / `field-component.ts`
      once rather than patching the fares call site.
- [ ] Manually verify: hover and keyboard-focus (`tabindex="0"` means Tab must
      work too) a column header in each fares table, confirm the tooltip appears
      above the modal and is fully readable.
- [x] Commit: `fix(fares): restore field tooltips on table headers`

### Phase 21: Files modal fixes (scrolling, stale list state, size jump)

**Goal:** Three independent Files modal bugs, fixed together since they're all
in the same small area of `src/index.html` / `src/modules/ui.ts`.

`src/index.html:666-732` is the Files modal. `.modal-box` (line 667) is
`w-11/12 max-w-2xl max-h-[90vh] flex flex-col p-0` with no fixed height, so it
sizes to content: a short file's table shrinks the whole modal. The file list
view (`#file-list-view`, line 697) and file editor view (`#file-editor-view`,
line 702) are toggled via `hidden` in `src/modules/ui.ts` `showFileList()`
(line 571) / `showFileEditor()` (line 580). The `files-btn` click handler
(`ui.ts:217-222`) only calls `updateFileList()` before `showModal()`; it never
calls `showFileList()`, so if the modal was last left on the editor view
(via `back-to-files` not being clicked, or via `showFileInEditor()` at
line 559), reopening the modal shows the stale editor view instead of the
list.

- [x] Make the file list scrollable. `#file-list` (line 698) already has
      `overflow-y-auto h-full`, so check whether the ancestor chain
      (`#file-list-view`, the `flex-1 overflow-hidden min-h-0` wrapper at
      line 695) is actually constraining height, or whether the `modal-box`
      itself growing to fit content (see below) is defeating the scroll
      container by never capping its own height.
- [x] Give `.modal-box` a fixed height instead of a max-height that shrinks to
      content, e.g. `h-[90vh]` in place of `max-h-[90vh]` (line 667), so
      opening a small file does not shrink the whole modal.
- [x] In the `files-btn` click handler (`ui.ts:217-222`), call
      `this.showFileList()` before `showModal()` so the modal always opens on
      the list view, never a stale editor view from a previous session.
- [x] Strip any other place that remembers "last file clicked" for the Files
      modal specifically (e.g. `menu-active` class left on a list item,
      `current-file-name` text) so reopening the modal is a clean state, not
      just visually landing on the list while other stale bits linger.
- [ ] Manually verify: open a file, close the modal, reopen via the Files
      button, confirm it shows the list (not the last file); open a small file
      and confirm the modal stays the same size; confirm the file list scrolls
      with many files.
- [x] Commit: `fix(files-modal): make list scrollable, reset to list view on reopen, keep fixed size`

**Notes.** Done in `ef01288`. The scroll bug had no separate cause: the ancestor
chain was already right, and capping `.modal-box` at `h-[90vh]` is what gives
`flex-1 overflow-hidden min-h-0` a bounded height to hand `#file-list`. One
edit fixed both the scroll and the size jump.

The stale-state reset went into `showFileList()` rather than the `files-btn`
handler, so every route back to the list (the Back button, post-import, the
`page-content-renderer` path) clears the same things: `menu-active` on the file
list items and `#current-file-name` back to `None`. The `menu-active` sweep is
scoped to `#file-list`, not the old global `.menu a`, so it cannot touch the
navbar or objects menus.

Numbering: this file shipped two headings called "Phase 21". The stop-map-styles
one is renumbered to Phase 22 below; the summary paragraph at the top still says
"Phase 21" for it.

### Phase 22: Share the stop map styles with test-track

**Goal:** One source of truth for how a stop circle looks on the map. The stop
styling coloring-book gained during Phase 9 (focus halo, focus ring, focus-top
redraw, hover as a dimmer halo) reaches `../test-track` too, and the two apps
stop carrying separate hand-tuned copies of the same expressions.

Both repos have a `layer-manager.ts`, but they are not the same file:
`VENDORED.md` marks test-track's copy `modified` with a long `@changes` list
(fed from `GTFSStatic`, pathways/levels/editing dropped, route layers absorbed,
realtime vehicles added). So the file itself can never go verbatim. The sharing
unit is a **new small module holding only the stop paint expressions**, vendored
verbatim like `route-strip.ts` is, with coloring-book canonical.

Where the two currently diverge:

- coloring-book `src/modules/layer-manager.ts`
  - `stopRadiusAt(plainRadius, scale)` (line 489): radius encodes
    `location_type` only. Focus deliberately does not resize, so a focused plain
    stop can never outgrow an unfocused station.
  - `stopFillColor(options)` (line 512): the `location_type` color ramp
    (station white / entrance amber / node purple / boarding area green), with a
    focused branch inverting to the theme accent.
  - `HALO_FOCUSED` / `HALO_HOVERED` / `HALO_LIT` feature-state expressions and
    `focusHaloRadius()` (lines ~530-565), driving `addFocusHaloLayers()`
    (line 571): `stops-focus-halo` (soft accent disc, opacity 0.18 focused /
    0.12 hovered) plus `stops-focus-ring`. Visibility is driven by collapsing
    radius and opacity to 0 when unlit, because layer filters cannot read
    feature-state.
  - `addFocusTopLayer()` (line 706): redraws only the focused stop above every
    other stop layer so a neighbouring stop cannot paint over the selection.
- test-track `src/modules/layer-manager.ts`
  - `stopRadiusAt(scale)` (line 646): **no halo layers at all**. It fakes focus
    by growing the circle instead: `byType(1.7)` focused, `byType(1.35)`
    hovered, `byType(1)` otherwise. That is exactly the size-hierarchy lie
    coloring-book's comment warns about.
  - The `location_type` fill ramp is inlined in `addStopLayers()` (line ~693),
    duplicated from coloring-book's `stopFillColor` minus the focused branch.
  - `STOP_RADIUS` is a module constant rather than an option.

Decided: coloring-book's treatment is the one to keep. test-track loses the
grow-on-focus behaviour and gains the halo.

- [x] Ask the user first: test-track's `setHoveredStop` growing the circle is
      currently the *only* hover affordance there and is noticeably louder than
      a 0.12-opacity halo. Confirm they want it replaced outright rather than
      halo-plus-a-smaller-grow, before touching test-track.
- [x] Extract the stop paint expressions from coloring-book's
      `layer-manager.ts` into a new `src/modules/stop-layer-style.ts`, exporting
      pure builders that take primitives and return `ExpressionSpecification`:
      `stopRadiusAt`, `stopFillColor`, `focusHaloRadius`, the `HALO_*`
      expressions, and the paint objects for `stops-focus-halo` /
      `stops-focus-ring` / `stops-focus-top`. **No imports of coloring-book
      types, no `this`, no map handle**, the same discipline `route-strip.ts`
      follows, or it cannot be vendored. `accent()` and the option values
      (`backgroundColor`, `radius`) get passed in as arguments.
- [x] Rewrite coloring-book's `layer-manager.ts` to call the new module. This
      step must be a pure refactor: the rendered map is byte-identical before
      and after. Verify visually before moving on, because everything after this
      builds on it.
- [x] Copy `stop-layer-style.ts` into `../test-track/src/modules/` with the
      `@vendored-from` banner, `@status verbatim`, and add its row to
      `../test-track/VENDORED.md` with the new coloring-book SHA.
- [x] In test-track's `layer-manager.ts`: delete the inlined `location_type`
      fill ramp and the focused/hovered multipliers in `stopRadiusAt`, call the
      shared builders instead, and add the `stops-focus-halo`,
      `stops-focus-ring`, and `stops-focus-top` layers. Insert them in
      coloring-book's order (halo and ring under the stop circles, focus-top
      above them) and register the new ids everywhere test-track enumerates stop
      layers: `HIT_LAYERS` is unaffected but the spotlight fade in
      `applySpotlight` (line ~337) and any layer-id arrays must include them or
      the halo will not dim with the rest.
- [x] Update test-track's `setHoveredStop` / `setFocusedStop` to set the
      `hovered` / `focused` feature states the halo reads, dropping the radius
      multiplier path. Fix `VENDORED.md`'s `layer-manager.ts` `@changes` bullet,
      which currently records the now-removed "grows the stop circle rather than
      lighting coloring-book's focus-halo layers, which this copy does not
      have".
- [x] Check test-track's route layer sort/insert points: coloring-book inserts
      route lines `before` `stops-focus-halo` (line ~1479). test-track has no
      such anchor today, so adding the halo changes what its equivalent insert
      resolves to. Confirm route lines still paint under the stops.
- [ ] Manually verify in both apps: click a stop (halo plus ring, focused stop
      drawn above neighbours), hover a stop from the timetable stop column
      (dimmer halo, no size change), and confirm station/entrance/node/boarding
      area colors and sizes are unchanged from before in coloring-book.
- [x] Commit in coloring-book: `refactor(map): extract shared stop layer styles`.
      Separate commit in test-track: `feat(map): adopt shared stop focus halo styles`.

**Notes.** coloring-book `cfecd04`, test-track `a3472b9`. The user confirmed
test-track loses grow-on-hover and grow-on-focus outright.

`src/modules/stop-layer-style.ts` ended up larger than the plan's list, because
stopping at the three focus layers would have left the two apps with separate
copies of the stop circle itself, which is where they had already drifted. It
exports `stopRadiusAt`, `stopRadiusByZoom`, `stopFillColor`, `focusHaloRadius`,
the `HALO_*` expressions, and five paint builders: `focusHaloPaint`,
`focusRingPaint`, `stopsBackgroundPaint`, `focusTopPaint`, `stationDotPaint`.
Only `maplibre-gl` types are imported. `stopRadiusByZoom` takes an optional
`wrap` callback, which is how the focus-top layer collapses every unfocused stop
to radius 0 without duplicating the zoom ramp.

The accent is an argument, not a resolved theme color: coloring-book passes
`resolveThemeColor('--color-primary')`, test-track passes its hardcoded
`FOCUS_ACCENT` red. That keeps the module shared without dragging coloring-book's
theme layer into test-track, which has no `resolveThemeColor`.

The zoom fade stays per-app for the same reason and comes in as an argument:
each app's `stopFadeOpacity` / `stationFadeOpacity` reads its own `CONFIG` and
its own `SPECIAL_STOP` definition.

Two plan expectations did not hold:

- The route insert anchor is a non-issue. test-track's `addLayers()` adds
  routes, then stops, then vehicles with plain sequential `addLayer` calls and
  no `before:` anchor anywhere, so the halo landing at the top of
  `addStopLayers()` keeps route lines under it automatically.
- The spotlight fade does not need the new ids. `applyStopDim` only repaints
  `stops-background` and `stops-station-dot`, and the halo, ring, and focus-top
  layers are only ever visible for a focused or hovered stop, which
  `SPECIAL_STOP` already exempts from dimming. coloring-book does not dim them
  either, so adding them there would have been a divergence, not a fix.

test-track's `setHoveredStop` / `setFocusedStop` needed no change at all: they
already set the `hovered` / `focused` feature states through `syncFeatureState`,
and the size multipliers lived entirely inside the deleted `stopRadiusAt`.
Also removed there: the station dot's grow-on-focus, and the focused/hovered
`FOCUS_ACCENT` stroke on `stops-background` (coloring-book uses a white ring
against the accent fill). `STOP_RADIUS` / `STOP_FILL_COLOR` / `STOP_STROKE_*`
collapsed into one `STOP_STYLE: StopStyleOptions` const.

`pnpm vendor:check` in test-track passes with the new row at SHA `cfecd04`.
Vendored files are exempt from test-track's prettier config (route-strip and
route-sort fail `--check` too), so the copy stays byte-identical.

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
- Feat: remove glyph "emojis" like ▶ ◀ ▲ ▼ → and replace them with proper SVG
  icons, in theme, sharing the icon helpers as much as possible
- Feat: improve the shapes list. Include the routes using each shape, linking to
  those routes, and the number of trips using the shape. Make the table
  scrollable with the header still visible and the upload GPX button always
  visible. No horizontal scrolling, use a wider modal if needed.
- Bug: tooltips are not working in the fares tables, they should be back
- Feat(medium): Lets add support for the tables in fares to have lists
  (reducing repetitive columns). For now, lets do this for fare_products with
  fare_media_id. In fare_leg_rules, lets do it for from_area_id and to_area_id.
  In fare_transfer_rules, lets do it for from_leg_group_id and to_leg_group_id.
  In fare_leg_join_rules, we can do it for both OD pairs. Lets list the items
  in the table for now to make it super clear (newlines between). Lets use the
  opportunity to use the same display method for areas and networks tables
  (internal logic will remain different for these two)
```
