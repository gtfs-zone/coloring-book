# Patch-Based GTFS Editor — Implementation Plan

## Overview

Migrate the app from a full-replace IndexedDB strategy to a **patch-based, append-only history system**. Every structural edit generates a small semantic patch. Snapshots compress full state periodically. Undo/redo and a Changes tab are delivered as later phases.

Clean start is acceptable — existing IndexedDB data is not migrated.

---

## Architecture Summary

| Layer | Role |
|---|---|
| `GTFSParser.gtfsData` | In-memory working copy — fast reads, immediate UI updates |
| IndexedDB GTFS tables | Synchronized with memory (for cold start without patches) |
| IndexedDB `patches` store | Append-only log of semantic changes |
| IndexedDB `snapshots` store | Compressed full-state checkpoints every N patches |

**Write flow:** edit → generate patch → apply to memory + GTFS tables → persist patch → maybe snapshot

**Cold start:** latest snapshot → apply subsequent patches → hydrate `gtfsData` + GTFS tables

---

## Checklist

### Phase 0 — Configuration Module
- [x] Create `src/config.ts` with all magic numbers
- [x] Update `editor.ts` (DEBOUNCE_DELAY, Clusterize constants)
- [x] Update `page-state-manager.ts` (MAX_NAVIGATION_HISTORY = 50)
- [x] Update `gtfs-parser.ts` (SEARCH_RESULTS_LIMIT = 10, SEARCH_MIN_QUERY_LENGTH = 2)
- [x] Update `gtfs-database.ts` (DB_NAME, DB_VERSION)
- [x] Update any other consumers of inline magic numbers
- [x] User confirms: `npm run build` succeeds, app loads normally

### Phase 0.5 — Rename "Objects" → "Browse" Throughout
The label already reads "Browse" in the UI but the underlying identifiers still say `objects`. This phase makes the code consistent with the visible label.

**HTML (`src/index.html`)**
- [ ] `id="objects-tab-radio"` → `id="browse-tab-radio"`
- [ ] `id="objects-list-view"` → `id="browse-list-view"`
- [ ] `id="objects-navigation"` → `id="browse-navigation"`
- [ ] `id="breadcrumb-objects"` → `id="breadcrumb-browse"`
- [ ] All text references to `"Objects"` tab in help/description copy → `"Browse"`

**`src/modules/objects-navigation.ts`**
- [ ] Rename file → `src/modules/browse-navigation.ts`
- [ ] Rename class `ObjectsNavigation` → `BrowseNavigation`
- [ ] Update internal DOM query for `objects-navigation` → `browse-navigation`
- [ ] Update CSS class `objects-navigation` → `browse-navigation` inside `render()`

**`src/index.ts`**
- [ ] Update import path `./modules/objects-navigation` → `./modules/browse-navigation`
- [ ] Rename `ObjectsNavigation` → `BrowseNavigation` (import and type)
- [ ] Rename property `objectsNavigation` → `browseNavigation`
- [ ] Update `browseNavigation.initialize('browse-navigation')`
- [ ] Update `switchToTab('objects')` → `switchToTab('browse')`
- [ ] Update all `this.objectsNavigation` references → `this.browseNavigation`

**`src/modules/ui.ts`**
- [ ] Update import: `ObjectsNavigation` → `BrowseNavigation`
- [ ] Rename internal property `this.objectsNavigation` → `this.browseNavigation`
- [ ] Update `tabName === 'objects'` → `tabName === 'browse'`
- [ ] Update DOM query `'objects-list-view'` → `'browse-list-view'`
- [ ] Update DOM query `'breadcrumb-objects'` → `'breadcrumb-browse'`
- [ ] Update DOM query `'related-objects'` → `'related-browse'` (and matching HTML id)
- [ ] Update all `this.objectsNavigation` / `this.browseNavigation` call sites

**`src/modules/keyboard-shortcuts.ts`**
- [ ] Rename `objectsNavigation` interface field → `browseNavigation`
- [ ] Update `switchToTab('objects')` → `switchToTab('browse')`
- [ ] Update DOM query `'objects-search'` → `'browse-search'` (and matching HTML id if present)
- [ ] Update `this.gtfsEditor.objectsNavigation` → `this.gtfsEditor.browseNavigation`

**`src/modules/schedule-controller.ts`**
- [ ] Update any comment referring to "Objects tab" → "Browse tab"

- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm run lint` — zero errors
- [ ] User confirms: Browse tab still shows agencies/routes/stops; tab switching from map still works

### Phase 1 — Remove CodeMirror
- [ ] Remove CodeMirror imports and `EditorView` / `EditorState` from `editor.ts`
- [ ] Remove `csvMathematicaMode` syntax highlighter from `editor.ts`
- [ ] Remove `StreamParser` / `TokenState` interfaces from `editor.ts`
- [ ] Remove `editorView`, `setEditorValue()`, `getEditorValue()` from `editor.ts`
- [ ] Remove `switchToTextView()`, `switchToTableView()`, `updateToggleLabels()`, `syncTableToText()`, `syncTextToTable()` from `editor.ts`
- [ ] Remove `lastTextModified`, `lastTableModified`, view-conflict detection
- [ ] Remove `saveCurrentFileChanges()` code-branch that reads from CodeMirror
- [ ] Remove `viewPreference` localStorage logic (`loadViewPreference`, `saveViewPreference`)
- [ ] Remove `isTableView` flag — table is always shown
- [ ] Rename `openFile()` to drop code-view fallback path; always call `buildTableEditor()`
- [ ] Remove `refreshRelatedTables()` from `GTFSParser` interface in `editor.ts` (no longer needed)
- [ ] Remove the view-toggle checkbox and label from `index.html`
- [ ] Remove `#text-editor-view` / `#simple-editor` DOM element from `index.html`
- [ ] Ensure `#table-editor-view` is always visible when a file is selected
- [ ] Remove `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language` from `package.json`
- [ ] Run `npm install` to update lockfile
- [ ] Remove any references in `ui.ts` that called code-view methods
- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm run lint` — zero errors
- [ ] User confirms: file list opens a table, cells are editable, map edits persist

### Phase 2 — Patch Types & IndexedDB Schema Extension
- [ ] Create `src/types/patch.ts`:
  - `PatchOp = 'insert' | 'update' | 'delete'`
  - `GTFSPatch` — op, table, id, changes (update), record (insert/delete)
  - `PatchRecord` — version, patch, timestamp, description
  - `SnapshotRecord` — version, state (compressed string), timestamp
  - `GTFSState = Record<string, Record<string, unknown>[]>` (table → rows)
- [ ] Extend `GTFSDBSchema` in `gtfs-database.ts` with `patches` and `snapshots` stores
- [ ] Bump `dbVersion` from `3` → `4` in `gtfs-database.ts` (use `CONFIG.DB_VERSION`)
- [ ] Add `upgrade` branch for version 4: create `patches` and `snapshots` object stores
  - `patches` keyPath: `version`, autoIncrement: true
  - `snapshots` keyPath: `version`
- [ ] Add `GTFSDatabase` methods:
  - `appendPatch(patch: Omit<PatchRecord, 'version'>): Promise<number>` — returns assigned version
  - `getPatchesAfter(version: number): Promise<PatchRecord[]>`
  - `getLatestSnapshot(): Promise<SnapshotRecord | undefined>`
  - `saveSnapshot(record: Omit<SnapshotRecord, 'version'>): Promise<void>`
  - `getPatchCount(): Promise<number>`
- [ ] Run `npm run typecheck` — zero errors
- [ ] User confirms: app still loads, IndexedDB inspector shows new stores

### Phase 3 — PatchManager Module
- [ ] Create `src/modules/patch-manager.ts` — `PatchManager` class
- [ ] Constructor receives `GTFSDatabase` and `GTFSParser` references
- [ ] Implement `initialize()`:
  - Call `getLatestSnapshot()` from DB
  - If snapshot exists, decompress and parse state into `GTFSParser.gtfsData`
  - Call `getPatchesAfter(snapshot.version)` and apply each patch forward
  - Write final state back to GTFS IndexedDB tables (so existing read paths still work)
  - If no snapshot: existing cold-start behaviour (table data already in IndexedDB)
- [ ] Implement `applyPatchForward(patch: GTFSPatch)` — mutates `GTFSParser.gtfsData` in-memory and updates IndexedDB GTFS table
- [ ] Implement `applyPatchInverse(patch: GTFSPatch)` — reverses changes for undo
- [ ] Implement `recordInsert(table, record, description)`:
  - Build `GTFSPatch { op: 'insert', table, id, record }`
  - Append to IndexedDB `patches` store, get version number
  - Push to in-memory `undoStack`, clear `redoStack`
  - Call `maybeSnapshot()`
- [ ] Implement `recordUpdate(table, id, before, after, description)`:
  - Build `GTFSPatch { op: 'update', table, id, changes }`
  - Append to `patches` store
  - Push to `undoStack`, clear `redoStack`
  - Call `maybeSnapshot()`
- [ ] Implement `recordDelete(table, id, record, description)`:
  - Build `GTFSPatch { op: 'delete', table, id, record }`
  - Same append/stack/snapshot pattern
- [ ] Implement `undo()`:
  - Pop from `undoStack`, push to `redoStack`
  - Call `applyPatchInverse()`
  - Emit `'undo'` event for UI refresh
- [ ] Implement `redo()`:
  - Pop from `redoStack`, push to `undoStack`
  - Call `applyPatchForward()`
  - Emit `'redo'` event for UI refresh
- [ ] Implement private `maybeSnapshot()`:
  - Compare `undoStack.length` modulo `CONFIG.SNAPSHOT_INTERVAL`
  - If interval reached: serialize `GTFSParser.gtfsData`, compress with `CompressionStream`, save snapshot
- [ ] Implement `getHistory(): PatchRecord[]` — returns all patches from IndexedDB for the Changes tab
- [ ] Export `PatchManager` and instantiate in `GTFSEditor` constructor
- [ ] Call `patchManager.initialize()` inside `GTFSEditor.init()` after `gtfsParser.initialize()`
- [ ] Run `npm run typecheck` — zero errors
- [ ] User confirms: page refresh restores data correctly (cold start via patches works)

### Phase 4 — Wire Patches to Edit Operations
- [ ] **Stop creation** (`GTFSParser.createStop`): before inserting, call `patchManager.recordInsert('stops', stop, 'Created stop ${stop.stop_id}')`
- [ ] **Coordinate update** (`GTFSParser.updateStopCoordinates`): read current values first, then call `patchManager.recordUpdate('stops', stopId, before, after, 'Moved stop ${stopId}')`
- [ ] **Table cell edits** (`Editor.flushPendingUpdates`): for each pending update, read current row from `gtfsData`, call `patchManager.recordUpdate(table, key, beforeRow, afterRow, 'Edited ${col} in ${table}')`
  - Note: multiple cell changes in one debounce flush should each emit their own patch (or batch into one compound patch — keep it simple, one patch per row flush)
- [ ] Wire undo/redo to keyboard shortcuts in `keyboard-shortcuts.ts`:
  - `Ctrl+Z` / `Cmd+Z` → `patchManager.undo()`
  - `Ctrl+Shift+Z` / `Cmd+Shift+Z` → `patchManager.redo()`
- [ ] After undo/redo: refresh `Editor` table view and `MapController.updateMap()`
- [ ] Wire `patchManager` `'undo'` / `'redo'` events to trigger UI refresh callbacks
- [ ] Run `npm run typecheck` and `npm run lint` — zero errors
- [ ] User confirms:
  - Table cell edit → change persists after refresh
  - Drag stop on map → change persists after refresh
  - Ctrl+Z undoes last edit → UI reflects
  - Ctrl+Shift+Z redoes → UI reflects
  - Multiple undo/redo cycles work correctly

### Phase 5 — Changes Tab (Read-Only History)
- [ ] Add a new tab between "Files" and "Help" in `index.html`:
  - Radio: `id="changes-tab-radio"`, `name="main_tabs"`
  - Label: "Changes"
  - Panel: `id="changes-panel"`
- [ ] Create `src/modules/history-controller.ts` — `HistoryController` class
- [ ] `initialize(patchManager: PatchManager)` — renders patch list into `#changes-panel`
- [ ] `render()` — fetches `patchManager.getHistory()`, builds a DaisyUI-styled list:
  - Each item: timestamp (relative, e.g. "2 min ago"), operation badge (`insert` / `update` / `delete`), table name, record id, description
  - Use DaisyUI `badge` component for op type with semantic colours (success/warning/error)
  - Empty state: "No changes yet" with a subtle icon
- [ ] Auto-refresh `render()` after each `recordInsert` / `recordUpdate` / `recordDelete`
- [ ] Auto-refresh after undo/redo
- [ ] Instantiate `HistoryController` in `GTFSEditor`
- [ ] Update `TabManager.switchToTab` callers to be aware of new `'changes'` tab if needed
- [ ] Run `npm run typecheck` and `npm run lint` — zero errors
- [ ] User confirms:
  - Tab appears in correct order: Browse | Files | Changes | Help (Browse rename was done in Phase 0.5)
  - After editing, Changes tab shows entries
  - Undo removes the entry (or marks it undone)
  - Read-only — no click-to-rollback UI yet

---

## Key File Map

| File | Change |
|---|---|
| `src/config.ts` | **New** — all magic numbers |
| `src/types/patch.ts` | **New** — patch/snapshot types |
| `src/modules/patch-manager.ts` | **New** — core patch engine |
| `src/modules/history-controller.ts` | **New** — Changes tab UI |
| `src/modules/editor.ts` | **Remove** CodeMirror; table-only |
| `src/modules/gtfs-database.ts` | Add `patches`/`snapshots` stores, new methods |
| `src/modules/gtfs-parser.ts` | Emit patches from `createStop`, `updateStopCoordinates` |
| `src/modules/keyboard-shortcuts.ts` | Add Ctrl+Z / Ctrl+Shift+Z |
| `src/index.ts` | Instantiate `PatchManager`, `HistoryController` |
| `src/index.html` | Remove code editor toggle; rename objects→browse IDs; add Changes tab |
| `src/modules/objects-navigation.ts` | **Renamed** → `browse-navigation.ts`; class `ObjectsNavigation` → `BrowseNavigation` |
| `package.json` | Remove `codemirror` and `@codemirror/*` packages |

---

## Technical Notes

### Compression
Use the native `CompressionStream` API (gzip) — zero dependencies, available in all modern browsers that run MapLibre GL:
```typescript
async function compress(data: string): Promise<string> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(data));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const blob = new Blob(chunks);
  return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
}
```

### Patch format for `update`
```typescript
{
  op: 'update',
  table: 'stops',
  id: 'stop_123',
  changes: {
    stop_name: ['Old Name', 'New Name'],
    stop_lat:  [37.774, 37.775],
  }
}
```
Inverse is simply swapping `[before, after]` → `[after, before]`.

### DB version bump
Current: `dbVersion = 3`. Phase 2 bumps to `4`. The `upgrade` callback adds two new stores; existing GTFS data is untouched (clean start means the old data is gone anyway, but upgrade is non-destructive by design).

### Table name derivation in `Editor.flushPendingUpdates`
Current code does `fileName.replace('.txt', 's')` — this is brittle. In Phase 4, use the same `getTableName()` helper from `GTFSParser` (strip `.txt`) which is already correct.

### Undo stack & patch retention
Patches are kept indefinitely in IndexedDB — never pruned. The in-memory undo/redo stacks are session-only and capped at `CONFIG.MAX_UNDO_HISTORY` to bound memory use. The stacks are pointer/version references; the authoritative record is always the `patches` store.

---

## Testing Checkpoints

Each phase ends with user visual confirmation. In addition, run after each phase:
```bash
npm run typecheck   # zero errors
npm run lint        # zero warnings
npm run build       # clean build
```

Playwright tests (`npm test`) should be run after Phase 4 to catch regressions in the edit flow.
