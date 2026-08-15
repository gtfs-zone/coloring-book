# Plan: Grid keyboard navigation (phases 2 and 3)

Phase 1 is implemented. This file carries the remaining two phases.

Kept separate from `CURRENT_PLAN.md`, which holds the in-progress modal
Enter/Escape plan (#71).

## Summary

Editing a value in either of the app's grids costs a mouse click. Phase 1 fixed
the common case in the timetable: while an editor is live, Enter, Tab and the
vertical arrows commit and move to the next cell, opening its editor
immediately, and the edit survives the full panel re-render that every patch
triggers.

Phase 2 adds a navigation mode to the timetable so the grid can be traversed
without opening an editor, which is also what makes it keyboard accessible at
all. Phase 3 brings vertical movement to the Files modal, which is a different
table implementation and needs a different approach.

## Key mechanics (phase 1, for reference)

| Key | While an editor is live |
| --- | --- |
| Enter / Shift+Enter | commit, move down / up, open editor |
| Tab / Shift+Tab | commit, move right / left, open editor, no wrap |
| ArrowUp / ArrowDown | commit, move up / down, open editor |
| ArrowLeft / ArrowRight | move the text caret, never navigate |
| Escape | cancel, restore the span |

Down runs arrival, then departure of the same stop, then arrival of the next
stop, which is the order a trip is actually entered in. Left and right move
between trips at the same stop and clamp at the row edge.

## Relevant context

Built in phase 1, and what phases 2 and 3 build on:

- **`src/utils/grid-navigation.ts`** (new). `GridDirection` and
  `keyToGridDirection(e)`, the single mapping of keys to directions. Returns
  null for horizontal arrows and for any key with a modifier held. Phase 3
  reuses this directly.
- **`src/utils/inline-edit.ts`**. `InlineEditorOptions` gained `onNavigate`,
  `arrowNavigation`, `selectionStart` and `initialValue`. Navigation commits
  first, which restores the display span and clears the single-live-editor
  guard, and only then calls `onNavigate`. `value` is the stored value and the
  baseline a commit is measured against; `initialValue` is only what goes in the
  box, so restoring mid-edit text does not make the editor think nothing
  changed. `getLiveEditorState()` reads the live input's text and caret.
- **`src/modules/timetable-cell-renderer.ts`**. Time spans carry
  `data-trip-id`, `data-stop-id`, `data-stop-index`, `data-time-type`,
  `data-stop-sequence`, `data-pending`. `data-stop-index` is the supersequence
  position and is the row's real key: `stop_id` repeats on circular routes.
- **`src/modules/schedule-controller.ts`**. `timeCellRows()` returns one array
  of `.time-span`s per row, arrival at even indices and departure at odd.
  `moveTimeCell(from, direction)` is arithmetic on that array.
  `captureTimetableEditor()` / `restoreTimetableEditor()` carry the open editor
  across a re-render, keyed on the trip, stop index and time type.
- **`src/modules/browse-navigation.ts`**. Capture runs next to `captureFocus()`
  before the rebuild, restore next to `restoreFocus()` after it, synchronously,
  inside the `isSamePage` guard. `ScheduleController.refreshCurrentTimetable`
  duplicates the same pair for the pending add-stop path.

Not yet touched:

- **`src/modules/editor.ts`**. The Files modal. A Clusterize.js virtualized
  table whose editable cells are always-live `<input data-row data-col>`
  (line 204). Primary key columns render as locked `<td>`s with no input
  (line 202). Does not use `openInlineEditor` and has no keydown handling.
- **`src/modules/editable-table.ts`**. A third grid, used only by the fares and
  levels modals. Out of scope, see the bottom of this file.

## Phase 2: navigation mode for the timetable

Goal: focus a cell without editing it, arrow around, and start editing by
typing. Today a time cell cannot be reached from the keyboard at all, so this is
the accessibility half of the feature as much as the speed half.

The model is the spreadsheet one. A cell is either selected (focused, not
editing) or editing. Arrows move the selection; Enter, F2 or any printable
character opens the editor. Phase 1's in-editor behaviour is unchanged: from an
open editor, Enter still commits and opens the next cell down.

Implemented. Decisions taken during implementation:

- Tab in navigation mode leaves the grid, as the roving tabindex implies. All
  four arrows move the selection instead, which is free here because a selected
  cell has no text caret to protect. That needed a second key mapping,
  `arrowToGridDirection` in `utils/grid-navigation.ts`, alongside phase 1's
  `keyToGridDirection`: in nav mode Enter and Tab mean something else entirely,
  so they could not share one function.
- Trip property rows are not part of the grid. They are a different cell type
  with a different editor (some open pickers, not inline inputs), so the
  printable-character and Delete handlers would have needed per-type branching.
- Delete on the pending add-stop row is a no-op, short-circuited before the DB
  call rather than relying on `updateArrivalDepartureTime`'s existing early
  return for a clear with no stop_time behind it.

The one thing the plan underestimated: `restoreTimetableEditor` was not a
sufficient post-render hook. It is called only inside `browse-navigation`'s
`isSamePage` guard, so a *freshly opened* timetable never ran it and would have
had no cell carrying `tabindex="0"` at all, making the grid untabbable in
exactly the case that matters most. `applyTimetableSelection()` is therefore
called unconditionally, outside that guard.

- [x] Add `tabindex="-1"` and `role="gridcell"` to `.time-span` in
      `timetable-cell-renderer.ts`. Exactly one span in the grid carries
      `tabindex="0"` (roving tabindex) so Tab enters the grid at a single stop
      and Tab from inside it leaves, rather than walking every cell.
- [x] Add `role="grid"` to the table and `role="row"` to the rows in
      `timetable-renderer.ts`.
- [x] Track which cell holds the roving tabindex on `ScheduleController`, keyed
      the same way as `editingCell` (trip id, stop index, time type) so it can
      be re-applied after a render. Default it to the first time cell.
      Both keys now share a `TimeCellKey` interface and a `findTimeCell(key)`
      lookup, which `restoreTimetableEditor` was also switched over to.
- [x] Add a delegated `keydown` on `document` inside `installTimetablePickers`
      (`schedule-controller.ts`), matching `.time-span` targets. Delegate on
      `document` rather than the container, for the same reason the click
      handler does: the container's `innerHTML` is replaced wholesale by several
      call sites.
  - Arrows: move the roving focus, do not open an editor. Reuse
    `timeCellRows()` and `moveTimeCell`'s index arithmetic, factored into a
    shared `resolveNeighbour(from, direction)` so selection and editing cannot
    disagree about what is next.
  - Enter or F2: open the editor with the content selected.
  - Any printable character (`e.key.length === 1`, no Ctrl/Meta/Alt): open the
    editor seeded with that character via `initialValue`, caret at the end.
  - Delete or Backspace: clear the time. Route through
    `updateArrivalDepartureTime` with an empty value so it records a patch like
    any other edit.
- [x] Extend the capture/restore pair to carry selection, not just an open
      editor, so arrowing around also survives a re-render. `editingCell`
      already has the right shape; add a sibling `selectedCell` and restore
      whichever is set.
      `selectedCell` alone was not enough: it survives the user clicking away
      from the grid, so restoring it would have yanked focus back into the
      timetable on any unrelated re-render. `captureTimetableEditor` now also
      records `selectionHadFocus` (was the active element really a `.time-span`)
      and only that re-focuses. A delegated `focusin` keeps `selectedCell` in
      step when the user tabs or clicks into a cell, and
      `resetTimetableScroll` clears it on navigation to another page, since the
      key means nothing in a different timetable.

### Phase 2 gotchas

- A focused span is not an input, so global shortcuts in
  `keyboard-shortcuts.ts` are no longer suppressed by the `isInputField` guard
  at line 193. Every registered shortcut is currently Ctrl or Meta prefixed
  except `escape`, so nothing collides today, but the printable-character
  handler must call `preventDefault()` and stop propagation to keep it that way.
- Do not give the spans `tabindex="0"` wholesale. A timetable is easily 40 stops
  by 30 trips, which is 2400 tab stops.
- `openInlineEditor` refuses to open while `.editor-input-live` exists. A
  keystroke arriving while an editor is open must go to the input, not the
  delegated span handler. Check the event target is actually a `.time-span`
  before acting.
- Optional, decide during implementation: let ArrowUp from the first stop row
  cross into the trip property rows (`.trip-prop-span`, keyed by `data-trip-id`
  plus `data-field`, `timetable-renderer.ts:307`). They are column aligned with
  the time cells so it works, but it mixes two cell types in one grid. Leave it
  out unless it feels natural in use. **Left out.**
- `role="gridcell"` sits on the span, not the `<td>`, because one `<td>` holds
  two logical cells (arrival and departure). Strictly that nests a gridcell
  inside a cell. Fixing it properly means restructuring the table so each time
  gets its own `<td>`, which is out of scope here.

## Phase 3: the Files modal

The Files modal is a different implementation from the timetable, which is worth
stating plainly because the obvious assumption is wrong. `src/modules/editor.ts`
builds a Clusterize.js virtualized table of always-live inputs. It shares no
code with the timetable's editing path.

Because the inputs are always live, "open the editor" collapses to "focus and
select the input", and there is no editing versus navigation mode to build. So
the Files modal only needs the vertical axis. Tab already works horizontally,
and because primary key cells contain no input, native Tab skips them for free.

- [ ] In `buildTableEditor` (`editor.ts:225-242`), alongside the existing
      delegated `change` and `input` listeners on `#scrollArea`, add a delegated
      `keydown` that runs `keyToGridDirection` from `utils/grid-navigation.ts`.
  - Handle `up` and `down` only. Let `left` and `right` fall through to native
    Tab, which already does the right thing.
  - `#scrollArea` is recreated by the `innerHTML` assignment on every rebuild,
    so binding there cannot leak or double bind. Match the existing style in
    that function.
- [ ] Resolve the target as
      `input[data-row="${rowIndex +/- 1}"][data-col="${col}"]` within
      `#contentArea`, then focus and select it.
- [ ] Handle virtualization. Clusterize keeps roughly 200 rows in the DOM
      (`CLUSTERIZE_ROWS_IN_BLOCK` times `CLUSTERIZE_BLOCKS_IN_CLUSTER`,
      `src/config.ts:11-12`), so the target input often does not exist. When the
      query misses, scroll `#scrollArea` toward
      `targetRow / this.tableData.length * scrollHeight`, then re-query on
      `requestAnimationFrame`: Clusterize renders off its own scroll listener,
      so the row is not in the DOM synchronously. Retry at most twice, then give
      up with a `[Editor]` warning rather than looping.
  - Moving one row at a time almost always stays inside the loaded cluster. The
    retry path matters mainly for a held-down arrow key.
- [ ] Do not flush the pending-update debounce before moving. `updateTableCell`
      (line 253) already captured the value into `this.tableData` and the
      `PendingUpdate` map on the `input` event. The 500ms debounce completing
      later is correct, and moving focus does not disturb it.

### Phase 3 gotchas

- `buildTableEditor` is re-run wholesale on undo, redo and jump
  (`src/index.ts:249-267`) and preserves neither scroll nor focus. Phase 3 does
  not make that worse, but keyboard navigation will make it much more
  noticeable. Fixing it is a follow-up, not part of this phase.
- The scroll container Clusterize is told about (`#scrollArea`) may not be the
  element actually scrolling: `#table-container` supplies `overflow-auto` in
  `index.html:719`, and no Clusterize CSS is imported anywhere in the repo.
  Verify which element scrolls before computing a scroll target.

## Out of scope

`src/modules/editable-table.ts`, used by the fares and levels modals, already
renders `.editable-cell` spans with `tabindex="0"` and uses `openInlineEditor`,
so it would inherit navigation cheaply now that phase 1 has landed.
Deliberately excluded: it is a third grid with its own row model, and it should
be a follow-up once the pattern has proven itself in the timetable.

## Verification

No Playwright. Tests are not maintained on this project and the user tests
manually.

- [x] `pnpm typecheck` and `pnpm lint` clean.
- [ ] `pnpm dev`, load a feed, open a route timetable.
- [ ] Phase 2: Tab into the grid from outside and confirm it lands on one cell,
      not every cell. Arrow around without an editor opening. Press a digit and
      confirm the editor opens containing just that digit. Press Delete on a
      cell with a time and confirm it clears and records one patch.
- [ ] Phase 2: arrow to a cell, then wait for an unrelated re-render (undo a
      change from the Changes panel) and confirm the selection is still there.
- [ ] Phase 2: confirm Ctrl+Z still undoes while a cell is selected rather than
      being swallowed by the grid handler.
- [ ] Phase 3: open the Files modal on `stop_times.txt`, hold ArrowDown through
      a column past the cluster boundary, a few hundred rows, and confirm focus
      keeps up and lands on real inputs rather than stalling.
- [ ] Phase 3: confirm Tab still skips the locked primary key columns, and that
      a value typed just before an arrow keypress still saves.
