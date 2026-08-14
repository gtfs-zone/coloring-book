# Plan: Work through TODO.md

## Summary

`TODO.md` is a flat, unprioritized scratchpad. This file is the actionable
version, ordered small-fixes-first. Phases 1-5 are quick, independent bugs and
feats. Phases 6-8 unify dangling reference handling into one coherent feature
(detect generically, find from the home page, fix at the use site). Phases 9-10
are the two stop/route diagram features shared with `../test-track`. Phases 11-12
build the services timeline; Phases 13-15 build the fares list-column feature.
Phases 16-17 are blocked on live reproduction and sit at the end deliberately.
Phases 18-20 are small, independent items added after the original pass (glyph
cleanup, shapes list improvements, a fares tooltip regression); they can be
picked up at any time and do not depend on anything above.

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

## Phases 18-20: Later additions (small, independent)

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

- `src/modules/calendar-modal.ts:236` - `&#9654;` (▶) inside a
  `badge badge-xs badge-success` marking the feed start date.
- `src/modules/calendar-modal.ts:240` - `&#9664;` (◀) inside a
  `badge badge-xs badge-error` marking the feed end date.
- `src/modules/calendar-modal.ts:427` - `▲` with inline `style="color:#4ade80"`,
  an added service date in the timeline.
- `src/modules/calendar-modal.ts:431` - `▼` with inline `style="color:#f87171"`,
  a removed service date in the timeline.
- `src/modules/ui.ts` - 9 collapse chevrons set via `chevronEl.textContent`, at
  lines 912, 944, 996, 999, 1025, 1028, 1068, 1105, 1108. These are assigned
  imperatively, not templated, so they need `innerHTML` (or a class toggle on a
  single static SVG) rather than `textContent`.
- `src/modules/route-graph.ts:166` - `→`.

- [ ] Add the missing icon helpers to `modal-utils.ts`, matching the existing
      `sizeClass`-parameter signature: a chevron (one icon, rotated via a class
      for the up/down states, rather than two separate icons), a start/end
      triangle marker, an up/down service-date marker, and an arrow.
- [ ] Swap the two calendar-modal date badges (lines 236, 240). Keep them inside
      their `badge badge-xs badge-success` / `badge-error` wrappers and keep the
      existing `title` attributes so the hover text is unchanged.
- [ ] Swap the two calendar-modal timeline markers (lines 427, 431). Replace the
      inline `style="color:#4ade80"` / `#f87171` hex colors with theme classes
      (`text-success` / `text-error`) instead of carrying the hardcoded hex onto
      the SVG. Keep the surrounding `tooltip`/`data-tip` wrapper intact.
- [ ] Swap the 9 `ui.ts` chevrons. Since these are runtime `textContent`
      assignments inside expand/collapse handlers, prefer rendering the chevron
      SVG once into the element and toggling a `rotate-180` class on it, so the
      handlers stop rebuilding markup on every toggle.
- [ ] Swap `route-graph.ts:166`. Check first whether that arrow is presentational
      or part of a string that is measured/parsed (it sits in graph layout code);
      if it feeds into a width or text computation, an SVG will change layout, so
      confirm the render path before replacing it.
- [ ] Size and color must come from Tailwind/DaisyUI classes, not inline styles,
      so all 9 themes stay correct. Verify light and dark themes.
- [ ] Re-grep `src/` for glyphs afterwards to confirm none remain (note
      `page-content-renderer.ts` needs `rg --text` until Phase 10 removes its NUL
      byte).
- [ ] Manually verify: calendar modal badges and timeline markers, and every
      expand/collapse chevron in the file/route list.
- [ ] Commit: `refactor(icons): replace glyph characters with svg icons`

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

- [ ] Build a shape usage map alongside `getShapes()`: read `trips.txt` (use
      `gtfsParser.getFileDataSync('trips.txt')`, the pattern at
      `schedule-controller.ts:746`) and produce
      `Map<shape_id, { tripCount: number, routeIds: Set<string> }>`. Include
      shapes with zero trips (they must still render a row, showing 0).
- [ ] Add a "Trips" column and a "Routes" column to the table in `renderBody()`.
      Keep the existing "Points" column.
- [ ] Render each route in the Routes column via the shared helpers, not an
      inline string: `getRouteDisplay` (`src/utils/entity-display.ts:34`) with
      `renderOptionLabel`, or `renderRouteReference`
      (`src/utils/entity-references.ts:107`) if its markup fits the table cell.
      Check `renderRouteReference` first, and only fall back to the display
      helpers if the reference card is too heavy for a table row.
- [ ] Route links must navigate through `PageStateManager`
      (`{type: 'route', route_id}`), following the delegated-click +
      `data-route-id` pattern used elsewhere. The Shapes modal has no
      `PageStateManager` reference today, so `ShapesManager`'s constructor
      (line 85, currently `gtfsParser` + `patchManager`) needs one injected from
      `src/index.ts`. Decide whether clicking a route also closes the Shapes
      modal; navigating behind an open modal is the wrong behavior, so it
      probably should close.
- [ ] Make the table body scrollable with the `<thead>` still visible: wrap the
      table in a fixed-max-height `overflow-y-auto` container and use DaisyUI's
      `table-pin-rows` (or `position: sticky` on the `th`).
- [ ] **No horizontal scrolling.** The two new columns must fit without one.
      `showModal()` takes a `boxClassName` (`modal-utils.ts:58`); the Shapes call
      (`shapes-manager.ts:105-109`) passes none, so it gets the default narrow
      box. Widen it the way the Fares modal already does
      (`fares-modal.ts:588`: `boxClassName: 'max-w-6xl w-11/12'`). Then drop the
      `overflow-x-auto` wrapper (line 63) and let the Routes column wrap instead
      of overflowing; a shape used by many routes is the case that will push the
      table wide, so wrap or truncate that cell rather than growing the table.
- [ ] Keep the "Upload GPX" button always visible: move it out of the scrolling
      region into a pinned footer below the scroll container (it is currently at
      line 76, inside the scrolling flow). The empty-feed branch (lines 38-43)
      already renders it standalone and needs no change.
- [ ] Confirm `refreshPanel()` (lines 116-119) recomputes the trips/routes data,
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
- [ ] Commit: `feat(shapes): show routes and trip counts in the shapes list`

### Phase 20: Restore field tooltips in the Fares modal

**Goal:** Hovering a column header in any Fares table shows the spec description
tooltip again, as it does elsewhere in the app.

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

- [ ] Diagnose before changing anything. Open the Fares modal and check in
      devtools: (a) do `.field-tooltip-trigger` elements exist in the fares
      `<th>`s, (b) if they exist, does the portal element get appended to
      `document.body` on hover, and (c) if it is appended, is it visible or is it
      behind the modal / clipped by an ancestor.
- [ ] If the triggers are missing: the `columnOverride?.label` branch at
      `editable-table.ts:314` is the cause. Fix by passing the override label
      through `renderFieldLabelContent` (it already accepts
      `{ ...fieldConfig, label: override.label }` on the very next branch at
      line 316) instead of returning a bare `<th>`. Decide separately whether
      `extraColumns` (line 327) should get tooltips too, since those are not
      spec-backed and may have no description to show.
- [ ] If the portal appears but is invisible: it is a stacking or clipping
      problem between the portal's `z-[100]` and the `showModal()` overlay. Check
      the overlay's z-index in `modal-utils.ts` and `src/styles/main.css`
      (lines 43, 52 set `z-index: 40 !important` and `50`). Raise the portal
      rather than lowering the modal.
- [ ] Check whether this affects only Fares or every `renderEditableTable()`
      caller. If it is generic, fix it in `editable-table.ts` / `field-component.ts`
      once rather than patching the fares call site.
- [ ] Manually verify: hover and keyboard-focus (`tabindex="0"` means Tab must
      work too) a column header in each fares table, confirm the tooltip appears
      above the modal and is fully readable.
- [ ] Commit: `fix(fares): restore field tooltips on table headers`

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

- [ ] Make the file list scrollable. `#file-list` (line 698) already has
      `overflow-y-auto h-full`, so check whether the ancestor chain
      (`#file-list-view`, the `flex-1 overflow-hidden min-h-0` wrapper at
      line 695) is actually constraining height, or whether the `modal-box`
      itself growing to fit content (see below) is defeating the scroll
      container by never capping its own height.
- [ ] Give `.modal-box` a fixed height instead of a max-height that shrinks to
      content, e.g. `h-[90vh]` in place of `max-h-[90vh]` (line 667), so
      opening a small file does not shrink the whole modal.
- [ ] In the `files-btn` click handler (`ui.ts:217-222`), call
      `this.showFileList()` before `showModal()` so the modal always opens on
      the list view, never a stale editor view from a previous session.
- [ ] Strip any other place that remembers "last file clicked" for the Files
      modal specifically (e.g. `menu-active` class left on a list item,
      `current-file-name` text) so reopening the modal is a clean state, not
      just visually landing on the list while other stale bits linger.
- [ ] Manually verify: open a file, close the modal, reopen via the Files
      button, confirm it shows the list (not the last file); open a small file
      and confirm the modal stays the same size; confirm the file list scrolls
      with many files.
- [ ] Commit: `fix(files-modal): make list scrollable, reset to list view on reopen, keep fixed size`

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
