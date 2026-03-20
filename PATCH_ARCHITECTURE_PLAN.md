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
- [x] `id="objects-tab-radio"` → `id="browse-tab-radio"`
- [x] `id="objects-list-view"` → `id="browse-list-view"`
- [x] `id="objects-navigation"` → `id="browse-navigation"`
- [x] `id="breadcrumb-objects"` → `id="breadcrumb-browse"`
- [x] All text references to `"Objects"` tab in help/description copy → `"Browse"`

**`src/modules/objects-navigation.ts`**
- [x] Rename file → `src/modules/browse-navigation.ts`
- [x] Rename class `ObjectsNavigation` → `BrowseNavigation`
- [x] Update internal DOM query for `objects-navigation` → `browse-navigation`
- [x] Update CSS class `objects-navigation` → `browse-navigation` inside `render()`

**`src/index.ts`**
- [x] Update import path `./modules/objects-navigation` → `./modules/browse-navigation`
- [x] Rename `ObjectsNavigation` → `BrowseNavigation` (import and type)
- [x] Rename property `objectsNavigation` → `browseNavigation`
- [x] Update `browseNavigation.initialize('browse-navigation')`
- [x] Update `switchToTab('objects')` → `switchToTab('browse')`
- [x] Update all `this.objectsNavigation` references → `this.browseNavigation`

**`src/modules/ui.ts`**
- [x] Update import: `ObjectsNavigation` → `BrowseNavigation`
- [x] Rename internal property `this.objectsNavigation` → `this.browseNavigation`
- [x] Update `tabName === 'objects'` → `tabName === 'browse'`
- [x] Update DOM query `'objects-list-view'` → `'browse-list-view'`
- [x] Update DOM query `'breadcrumb-objects'` → `'breadcrumb-browse'`
- [x] Update DOM query `'related-objects'` → `'related-browse'` (and matching HTML id)
- [x] Update all `this.objectsNavigation` / `this.browseNavigation` call sites

**`src/modules/keyboard-shortcuts.ts`**
- [x] Rename `objectsNavigation` interface field → `browseNavigation`
- [x] Update `switchToTab('objects')` → `switchToTab('browse')`
- [x] Update DOM query `'objects-search'` → `'browse-search'` (and matching HTML id if present)
- [x] Update `this.gtfsEditor.objectsNavigation` → `this.gtfsEditor.browseNavigation`

**`src/modules/schedule-controller.ts`**
- [x] Update any comment referring to "Objects tab" → "Browse tab" (no references found)

- [x] Run `npm run typecheck` — zero new errors (pre-existing errors unchanged)
- [x] Run `npm run lint` — zero errors
- [x] User confirms: Browse tab still shows agencies/routes/stops; tab switching from map still works

### Phase 1 — Remove CodeMirror
- [x] Remove CodeMirror imports and `EditorView` / `EditorState` from `editor.ts`
- [x] Remove `csvMathematicaMode` syntax highlighter from `editor.ts`
- [x] Remove `StreamParser` / `TokenState` interfaces from `editor.ts`
- [x] Remove `editorView`, `setEditorValue()`, `getEditorValue()` from `editor.ts`
- [x] Remove `switchToTextView()`, `switchToTableView()`, `updateToggleLabels()`, `syncTableToText()`, `syncTextToTable()` from `editor.ts`
- [x] Remove `lastTextModified`, `lastTableModified`, view-conflict detection
- [x] Remove `saveCurrentFileChanges()` code-branch that reads from CodeMirror
- [x] Remove `viewPreference` localStorage logic (`loadViewPreference`, `saveViewPreference`)
- [x] Remove `isTableView` flag — table is always shown
- [x] Rename `openFile()` to drop code-view fallback path; always call `buildTableEditor()`
- [x] Remove `refreshRelatedTables()` from `GTFSParser` interface in `editor.ts` (no longer needed)
- [x] Remove the view-toggle checkbox and label from `index.html`
- [x] Remove `#text-editor-view` / `#simple-editor` DOM element from `index.html`
- [x] Ensure `#table-editor-view` is always visible when a file is selected
- [x] Remove `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language` from `package.json`
- [x] Run `npm install` to update lockfile
- [x] Remove any references in `ui.ts` that called code-view methods
- [x] Run `npm run typecheck` — zero errors
- [x] Run `npm run lint` — zero errors
- [x] User confirms: file list opens a table, cells are editable, map edits persist

### Phase 2 — Patch Types & IndexedDB Schema Extension
- [x] Create `src/types/patch.ts`:
  - `PatchOp = 'insert' | 'update' | 'delete'`
  - `GTFSPatch` — op, table, id, changes (update), record (insert/delete)
  - `PatchRecord` — version (optional, autoIncrement), patch, timestamp, description
  - `SnapshotRecord` — version (last patch version), state (compressed string), timestamp
  - `GTFSState = Record<string, Record<string, unknown>[]>` (table → rows)
- [x] Extend `GTFSDBSchema` in `gtfs-database.ts` with `patches` and `snapshots` stores
- [x] Bump `dbVersion` from `3` → `4` in `config.ts` (via `CONFIG.DB_VERSION`)
- [x] Add `upgrade` branch for version 4: create `patches` and `snapshots` object stores
  - `patches` keyPath: `version`, autoIncrement: true
  - `snapshots` keyPath: `version`
- [x] Add `GTFSDatabase` methods:
  - `appendPatch(patch: Omit<PatchRecord, 'version'>): Promise<number>` — returns assigned version
  - `getPatchesAfter(version: number): Promise<PatchRecord[]>` — uses IDBKeyRange for efficiency
  - `getLatestSnapshot(): Promise<SnapshotRecord | undefined>`
  - `saveSnapshot(record: SnapshotRecord): Promise<void>` — note: takes full record incl. version
  - `getPatchCount(): Promise<number>`
- [x] Build passes (`npm run build`); no new typecheck errors introduced
- [x] User confirms: app still loads, IndexedDB inspector shows new stores

### Phase 3 — PatchManager Module
- [x] Create `src/modules/patch-manager.ts` — `PatchManager` class
- [x] Constructor receives `GTFSDatabase` and `GTFSParser` references
- [x] Implement `initialize()`:
  - Call `getLatestSnapshot()` from DB
  - If snapshot exists, decompress and parse state into `GTFSParser.gtfsData`
  - Call `getPatchesAfter(snapshot.version)` and apply each patch forward
  - Write final state back to GTFS IndexedDB tables (so existing read paths still work)
  - If no snapshot: existing cold-start behaviour (table data already in IndexedDB)
- [x] Implement `applyPatchForward(patch: GTFSPatch)` — mutates `GTFSParser.gtfsData` in-memory and updates IndexedDB GTFS table
- [x] Implement `applyPatchInverse(patch: GTFSPatch)` — reverses changes for undo
- [x] Implement `recordInsert(table, record, description)`:
  - Build `GTFSPatch { op: 'insert', table, id, record }`
  - Append to IndexedDB `patches` store, get version number
  - Push to in-memory `undoStack`, clear `redoStack`
  - Call `maybeSnapshot()`
- [x] Implement `recordUpdate(table, id, before, after, description)`:
  - Build `GTFSPatch { op: 'update', table, id, changes }`
  - Append to `patches` store
  - Push to `undoStack`, clear `redoStack`
  - Call `maybeSnapshot()`
- [x] Implement `recordDelete(table, id, record, description)`:
  - Build `GTFSPatch { op: 'delete', table, id, record }`
  - Same append/stack/snapshot pattern
- [x] Implement `undo()`:
  - Pop from `undoStack`, push to `redoStack`
  - Call `applyPatchInverse()`
  - Emit `'undo'` event for UI refresh
- [x] Implement `redo()`:
  - Pop from `redoStack`, push to `undoStack`
  - Call `applyPatchForward()`
  - Emit `'redo'` event for UI refresh
- [x] Implement private `maybeSnapshot()`:
  - Compare `undoStack.length` modulo `CONFIG.SNAPSHOT_INTERVAL`
  - If interval reached: serialize `GTFSParser.gtfsData`, compress with `CompressionStream`, save snapshot
- [x] Implement `getHistory(): PatchRecord[]` — returns all patches from IndexedDB for the Changes tab
- [x] Export `PatchManager` and instantiate in `GTFSEditor` constructor
- [x] Call `patchManager.initialize()` inside `GTFSEditor.init()` after `gtfsParser.initialize()`
- [x] Run `npm run typecheck` — zero errors
- [x] User confirms: page refresh restores data correctly (cold start via patches works)

### Phase 4 — Wire Patches to Edit Operations
- [x] **Stop creation** (`GTFSParser.createStop`): before inserting, call `patchManager.recordInsert('stops', stop, 'Created stop ${stop.stop_id}')`
- [x] **Coordinate update** (`GTFSParser.updateStopCoordinates`): read current values first, then call `patchManager.recordUpdate('stops', stopId, before, after, 'Moved stop ${stopId}')`
- [x] **Table cell edits** (`Editor.flushPendingUpdates`): for each pending update, read current row from `gtfsData`, call `patchManager.recordUpdate(table, key, beforeRow, afterRow, 'Edited ${col} in ${table}')`
  - Note: multiple cell changes in one debounce flush should each emit their own patch (or batch into one compound patch — keep it simple, one patch per row flush)
  - Note: covers all GTFS table edits including agencies
- [x] Wire undo/redo to keyboard shortcuts in `keyboard-shortcuts.ts`:
  - `Ctrl+Z` / `Cmd+Z` → `patchManager.undo()`
  - `Ctrl+Shift+Z` / `Cmd+Shift+Z` → `patchManager.redo()`
- [x] After undo/redo: refresh `Editor` table view and `MapController.updateMap()`
- [x] Wire `patchManager` `'undo'` / `'redo'` events to trigger UI refresh callbacks
- [x] Run `npm run typecheck` and `npm run lint` — zero errors (no new errors introduced)
- [x] User confirms:
  - Table cell edit → change persists after refresh
  - Drag stop on map → change persists after refresh
  - Ctrl+Z undoes last edit → UI reflects
  - Ctrl+Shift+Z redoes → UI reflects
  - Multiple undo/redo cycles work correctly

### Phase 5 — Refactor Undo/Redo to Version-Pointer Model ✅

The Phase 4 implementation used in-memory `undoStack`/`redoStack`. This phase replaces that with a persistent version-pointer model so undo/redo state survives page refresh.

**Schema changes (DB version 4 → 5)**
- [x] Bump `CONFIG.DB_VERSION` from `4` → `5` in `src/config.ts`
- [x] Add `meta` object store in the DB upgrade handler (keyPath: `'key'`, no autoIncrement)
- [x] Update `GTFSDBSchema` in `gtfs-database.ts` to include `meta` store type
- [x] Add `GTFSDatabase` methods:
  - `getVersions(): Promise<{ currentVersion: number; headVersion: number }>`
  - `setVersions(currentVersion: number, headVersion: number): Promise<void>`
  - `deletePatchesAfter(version: number): Promise<void>`
  - `getPatch(version: number): Promise<PatchRecord | undefined>`

**Patch type changes (`src/types/patch.ts`)**
- [x] Remove `description` field from `GTFSPatch` and `PatchRecord`
- [x] Add `source: { table: string; id: string; col?: string }` to `GTFSPatch`
- [x] Replace per-op fields with explicit `forward: PatchData` and `inverse: PatchData`
- [x] Add `PatchData` discriminated union type

**PatchManager refactor (`src/modules/patch-manager.ts`)**
- [x] Replace `undoStack`/`redoStack` with `currentVersion`/`headVersion` pointers
- [x] Remove `MAX_UNDO_HISTORY` cap from config and usage
- [x] `initialize()` reads `meta` versions and replays only up to `currentVersion`
- [x] `recordInsert` / `recordUpdate` / `recordDelete` — no `description` param; builds `forward`+`inverse`; truncates future on edit-after-undo; persists versions
- [x] `undo()` / `redo()` — look up patch by version number, persist updated pointers
- [x] `applyPatchForward` / `applyPatchInverse` — read from `patch.forward` / `patch.inverse`
- [x] `getHistory()` — annotates each record with `applied: boolean`
- [x] `maybeSnapshot()` — uses `currentVersion` instead of stack length
- [x] `description` args removed from all call sites in `gtfs-parser.ts` and `editor.ts`
- [x] Run `npm run typecheck` and `npm run lint` — zero errors in changed files
- [x] `npm run build` — clean build
- [x] User confirmed working

**Also fixed (discovered during testing)**
- [x] `map-controller.ts`: removed blocking `await routeRenderer.ensureInitialized()` from startup — UI button handlers now register immediately regardless of tile load speed
- [x] `gtfs-parser.ts` (`parseFromURL`): improved CORS/network error messages with console logging
- [x] `ui.ts`: fixed `e.target` → `e.currentTarget` on example feed buttons; added click-time console logging

### Phase 6 — Changes Tab
- [ ] Add a new tab between "Files" and "Help" in `index.html`:
  - Radio: `id="changes-tab-radio"`, `name="main_tabs"`
  - Label: "Changes"
  - Panel: `id="changes-panel"`
- [ ] Create `src/modules/history-controller.ts` — `HistoryController` class
- [ ] `initialize(patchManager: PatchManager)` — renders patch list into `#changes-panel`
- [ ] `render()` — fetches `patchManager.getHistory()`, builds a DaisyUI-styled list:
  - Each item: timestamp (relative, e.g. "2 min ago"), operation badge (`insert` / `update` / `delete`), table name, record id
  - Derive human-readable label from `patch.source` (e.g. "Edited stop_name in stops / stop_123", "Created stop stop_456")
  - Visually distinguish applied vs undone patches (undone items dimmed / struck-through)
  - Highlight the current version entry (the most recently applied patch)
  - Use DaisyUI `badge` component for op type with semantic colours (success/warning/error)
  - Empty state: "No changes yet" with a subtle icon
- [ ] **Click-to-rollback**: clicking any entry calls `patchManager.jumpToVersion(version)`:
  - Implement `jumpToVersion(target: number)` on `PatchManager`:
    - If `target < currentVersion`: replay inverses from `currentVersion` down to `target + 1`
    - If `target > currentVersion`: replay forwards from `currentVersion + 1` up to `target`
    - Set `currentVersion = target`, persist via `db.setVersions(currentVersion, headVersion)`
    - Emit a `'jump'` event for UI refresh
  - After jump: refresh `Editor` table view and `MapController.updateMap()` (same as undo/redo)
- [ ] Auto-refresh `render()` after each `recordInsert` / `recordUpdate` / `recordDelete`
- [ ] Auto-refresh after undo/redo/jump (listen to `'undo'` / `'redo'` / `'jump'` events from `PatchManager`)
- [ ] Instantiate `HistoryController` in `GTFSEditor`
- [ ] Update `TabManager.switchToTab` callers to be aware of new `'changes'` tab if needed
- [ ] Run `npm run typecheck` and `npm run lint` — zero errors
- [ ] User confirms:
  - Tab appears in correct order: Browse | Files | Changes | Help
  - After editing, Changes tab shows entries
  - Clicking an earlier entry rolls state back; map and table update
  - Clicking a struck-through (undone) entry re-applies up to that point
  - Ctrl+Z / Ctrl+Shift+Z and clicking in the tab stay in sync

---

## Key File Map

| File | Change |
|---|---|
| `src/config.ts` | **New** — all magic numbers |
| `src/types/patch.ts` | **New** — patch/snapshot types |
| `src/modules/patch-manager.ts` | **New** — core patch engine |
| `src/modules/history-controller.ts` | **New** — Changes tab UI (Phase 6) |
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

### Patch format
Each patch stores both directions so neither side needs to be recomputed at undo/redo time:
```typescript
{
  op: 'update',                          // canonical op
  source: { table: 'stops', id: 'stop_123', col: 'stop_name' },
  forward: { changes: { stop_name: 'New Name', stop_lat: 37.775 } },
  inverse: { changes: { stop_name: 'Old Name', stop_lat: 37.774 } },
}

// insert — forward applies the record; inverse deletes it
{
  op: 'insert',
  source: { table: 'stops', id: 'stop_456' },
  forward: { record: { stop_id: 'stop_456', ... } },
  inverse: { id: 'stop_456' },
}

// delete — forward removes; inverse re-inserts
{
  op: 'delete',
  source: { table: 'stops', id: 'stop_789' },
  forward: { id: 'stop_789' },
  inverse: { record: { stop_id: 'stop_789', ... } },
}
```
Human-readable labels are derived from `source` at render time — no `description` field stored.

### DB version bump
Current: `dbVersion = 3`. Phase 2 bumps to `4`. The `upgrade` callback adds two new stores; existing GTFS data is untouched (clean start means the old data is gone anyway, but upgrade is non-destructive by design).

### Table name derivation in `Editor.flushPendingUpdates`
Current code does `fileName.replace('.txt', 's')` — this is brittle. In Phase 4, use the same `getTableName()` helper from `GTFSParser` (strip `.txt`) which is already correct.

### Undo/redo model (version pointers)
Two integers drive the system: `currentVersion` (where we are now) and `headVersion` (the furthest-forward patch ever written). Both are persisted in the `meta` IndexedDB store so undo/redo state survives refresh.

- **Undo**: apply `patch.inverse` at `currentVersion`, decrement `currentVersion`.
- **Redo**: apply `patch.forward` at `currentVersion + 1`, increment `currentVersion`.
- **Edit after undo**: truncate patches after `currentVersion` (`deletePatchesAfter`), reset `headVersion = currentVersion`, then append normally. Linear history — no branching.

Patches are never pruned (except when truncated by an edit-after-undo). `CONFIG.MAX_UNDO_HISTORY` is no longer needed and can be removed.

---

## Testing Checkpoints

Each phase ends with user visual confirmation. In addition, run after each phase:
```bash
npm run typecheck   # zero errors
npm run lint        # zero warnings
npm run build       # clean build
```

Playwright tests (`npm test`) should be run after Phase 5 to catch regressions in the edit flow.
