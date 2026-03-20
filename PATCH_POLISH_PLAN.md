# Patch System Polish — Implementation Plan

## Overview

Follow-on to the completed patch architecture. Phase 6 (Changes tab) is live. This plan addresses four rough edges:

1. **Wiring gap** — most form inputs (e.g. `feed_default_lang` in feed_info) never record patches. Only agency view and the table editor do. The fix must be abstracted — not manually added per-controller.
2. **No feedback** — no notifications or console logging on any patch event.
3. **Thin Changes tab** — entries show `table / id` only; no before/after field values, no Undo button in the UI.
4. **No baseline** — no affordance to revert all the way back to the initial feed load state.

---

## Architecture Notes

### Why the wiring gap exists

| Code path | Patch recorded? | How |
|---|---|---|
| `editor.ts` `flushPendingUpdates()` | ✅ | Calls `patchManager.recordUpdate()` explicitly |
| `agency-view-controller.ts` | ✅ | Uses `attachFormPatchListeners()` bridge (Phase 1 done) |
| `page-content-renderer.ts` feed_info | ✅ | Uses `attachFormPatchListeners()` bridge (Phase 1 done) |
| Any future browse-view controller | ✅ by default | Call `attachFormPatchListeners()` after rendering |

### Fix strategy

All browse-view form fields already render with `data-field` and `data-table` attributes. The missing piece is a `data-record-id` attribute so a centralized handler can identify which record to update. With that in place, a single utility (`attachFormPatchListeners`) can handle patch recording for any form generically.

`patchManager.recordUpdate()` → `applyPatchForward()` → updates both parser memory AND IndexedDB. Controllers can stop calling `gtfsDatabase.updateRow()` separately.

---

## Checklist

### Phase 1 — Centralized Form Patch Bridge ✅

**New file: `src/utils/form-patch-bridge.ts`**
- [x] Export `interface FormPatchDeps { patchManager; parser }` (structural types, not class imports)
- [x] Export `function attachFormPatchListeners(container: HTMLElement, deps: FormPatchDeps): void`
  - Queries `input[data-field][data-table][data-record-id]`, `select[...]`, `textarea[...]` inside `container`
  - For each element, attaches a `change` listener:
    - Read `rawTable` from `data-table` (e.g. `"agency.txt"`), strip `.txt` for `table`, read `field` and `recordId`
    - Look up before value via `deps.parser.getFileDataSync(rawTable)` + `GTFS_PRIMARY_KEYS[rawTable]`
    - If `before === newValue`, return early (no-op)
    - Call `deps.patchManager.recordUpdate(table, recordId, { [field]: before }, { [field]: newValue })`

**Add `data-record-id` to rendered form inputs**
- [x] `src/utils/field-component.ts` — added `recordId?: string` to `FieldConfig`; emits `data-record-id` on all three renderers (`renderTextInput`, `renderSelectInput`, `renderTextareaInput`)
- [x] `src/modules/agency-view-controller.ts` — `.map(c => ({ ...c, recordId: this.currentAgencyId ?? '' }))` on generated configs
- [x] `src/modules/page-content-renderer.ts` — `.map(c => ({ ...c, recordId: 'feed_info' }))` on generated configs

**Migrate AgencyViewController**
- [x] Removed `updateAgencyProperty()` entirely
- [x] Removed agency field wiring block in `addEventListeners()`; kept route-item click wiring
- [x] Removed `fieldValues: Map<string, string>` (no longer needed)
- [x] Removed `getFieldDisplayName()` (no longer needed)
- [x] Removed unused `notifications` import
- [x] Added `parser?` to `AgencyViewDependencies`; fixed `patchManager` to 4-param signature
- [x] `addEventListeners()` now calls `attachFormPatchListeners()` when both deps are available

**Migrate PageContentRenderer**
- [x] Removed `updateFeedInfoProperty()`
- [x] Removed `addFeedInfoEventListeners()` and its call site
- [x] Replaced with inline `attachFormPatchListeners()` call in `addEventListeners()`
- [x] Removed unused `convertValueToGTFS` and `GTFSFieldType` imports
- [x] Added `parser?` to `ContentRendererDependencies`; fixed `patchManager` to 4-param signature
- [x] Threads `parser` through to `AgencyViewDependencies` in `renderAgency()`
- [x] `src/modules/browse-navigation.ts` — fixed `patchManager` to 4-param; passes `gtfsRelationshipsInstance.gtfsParser` as `parser`

**Verify Phase 1**
- [x] `npm run typecheck` — no new errors (pre-existing errors in `index.ts` and `gtfs-database.ts` unchanged)
- [x] `npm run lint` — zero errors in changed files
- [x] `npm run build` — clean build (✓ 148 modules, 3.29s)
- [x] Edit `feed_default_lang` → entry appears in Changes tab immediately
- [x] Refresh → value persists
- [x] Edit agency name → still recorded, no duplicate entry in Changes tab

---

### Phase 2 — Verbose Notifications + Console Logging ✅

**New file: `src/utils/patch-label.ts`**
- [x] Export `function humanLabel(patch: GTFSPatch | undefined): string`:
  - `op === 'update'`: `"Updated ${fields} in ${source.table} / ${source.id}"` where `fields` = `source.col ?? Object.keys((forward as {changes:...}).changes).join(', ')`
  - `op === 'insert'`: `"Created ${source.table} / ${source.id}"`
  - `op === 'delete'`: `"Deleted ${source.table} / ${source.id}"`
  - Fallback for undefined patch: `"Unknown change"`

**Update patch event system (`src/modules/patch-manager.ts`)**
- [x] Update `PatchEventListener` type: `type PatchEventListener = (record?: PatchRecord) => void`
- [x] Update `emit()` private method to accept and forward an optional `PatchRecord` payload
- [x] In `appendAndPush()`: emit `'change'` with the freshly persisted `PatchRecord`
- [x] In `undo()`: emit `'undo'` with the patch record that was just inversed
- [x] In `redo()`: emit `'redo'` with the patch record that was just applied forward
- [x] In `jumpToVersion()`: emit `'jump'` (no specific record needed — it's a bulk operation)
- [x] Existing `on()` call sites (index.ts, history-controller.ts) are compatible — `() => void` is assignable to `(record?: PatchRecord) => void` in TypeScript

**Wire notifications in `src/index.ts`**
- [x] Import `humanLabel` from `src/utils/patch-label.ts`
- [x] Add listener: `patchManager.on('change', (r) => { console.log('[patch:change]', r); notifications.showInfo(humanLabel(r?.patch), { duration: 3000 }); })`
- [x] Add listener: `patchManager.on('undo', (r) => { console.log('[patch:undo]', r); notifications.showInfo(\`Undone: ${humanLabel(r?.patch)}\`, { duration: 3000 }); })`
- [x] Add listener: `patchManager.on('redo', (r) => { console.log('[patch:redo]', r); notifications.showInfo(\`Redone: ${humanLabel(r?.patch)}\`, { duration: 3000 }); })`

**Update HistoryController to use new listener signature**
- [x] No code change needed — `() => void` lambdas are structurally compatible with `(record?: PatchRecord) => void`

**Verify Phase 2**
- [x] `npm run typecheck` — zero new errors (pre-existing errors in `index.ts` and `gtfs-database.ts` unchanged)
- [x] `npm run lint` — zero errors in changed files (pre-existing `no-console` warnings only)
- [x] `npm run build` — clean build (✓ 149 modules, 3.30s)
- [x] Edit any field → toast appears, browser console logs `[patch:change]` with full record
- [x] Ctrl+Z → toast "Undone: …", console logs `[patch:undo]`
- [x] Ctrl+Shift+Z → toast "Redone: …", console logs `[patch:redo]`

---

### Phase 3 — Enhanced Changes Tab + UI Buttons ✅

**Inline before/after field diffs (`src/modules/history-controller.ts`)**
- [x] Import `humanLabel` from `src/utils/patch-label.ts`; replace the `labelFor()` function with it
- [x] Add `function renderFieldDiffs(patch: GTFSPatch): string` helper:
  - For `update`: renders each changed field as `before → after` with strikethrough on old value
  - For `insert`/`delete`: shows first 4 fields of the record (truncates with "…" if more)
- [x] In `render()`, inside the patch list loop, append `renderFieldDiffs(patch)` HTML beneath badge + label row

**"Undo on top" button**
- [x] In `render()`, before the patch list, prepend a toolbar with `↩ Undo` button
- [x] Wire button click → `this.patchManager.undo()`
- [x] Disable the button when `currentVersion === 0` (uses existing `version` getter on PatchManager)

**Feed load baseline entry**
- [x] In `render()`, after the patch list, append a static "Feed loaded" entry at the bottom (shown always, even in empty state)
- [x] Wire `#revert-all-btn` click → `this.patchManager.jumpToVersion(0)`
- [x] No DB or PatchManager changes required — `jumpToVersion(0)` already works correctly

**Expose `getCurrentVersion()` on PatchManager if needed**
- [x] Not needed — existing `version` getter is sufficient

**Verify Phase 3**
- [x] `npm run typecheck` — zero new errors (pre-existing test file errors only)
- [x] `npm run lint` — zero errors (pre-existing `no-console` warnings only)
- [x] `npm run build` — clean build (✓ 3.71s)
- [ ] Changes tab shows field diffs inline (e.g. `feed_default_lang: "en" → "fr"`)
- [ ] "↩ Undo" button is enabled when patches exist, disabled at version 0
- [ ] Clicking "↩ Undo" undoes the last patch; tab re-renders
- [ ] "Feed loaded" entry always visible at bottom
- [ ] Clicking "Revert all" rolls back to initial state; map and table refresh

---

## Key File Map

| File | Change |
|---|---|
| `src/utils/form-patch-bridge.ts` | **New** — centralized form input patch listener |
| `src/utils/patch-label.ts` | **New** — `humanLabel()` shared across notifications and Changes tab |
| `src/utils/field-component.ts` | Add `recordId` param; emit `data-record-id` on inputs |
| `src/modules/agency-view-controller.ts` | Remove `updateAgencyProperty()` + manual wiring; use bridge |
| `src/modules/page-content-renderer.ts` | Remove `updateFeedInfoProperty()` + manual wiring; use bridge |
| `src/modules/patch-manager.ts` | Event payload signature; expose `getCurrentVersion()` |
| `src/modules/history-controller.ts` | Field diffs, Undo button, Feed load baseline entry |
| `src/index.ts` | Add notification listeners for change/undo/redo |
