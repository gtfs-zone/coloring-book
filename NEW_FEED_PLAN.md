# New Feed & File Management — Implementation Plan

## Motivation

The "New Feed" button exists in the UI but is currently broken in practice. When a user clicks it,
a notification fires but the file list stays empty, the map overlay persists, and nothing can be
edited. The root cause is a single off-by-one guard in `initializeEmpty()`, but fixing just that
one line without a stronger abstraction would leave us with fragile file management long-term.

This plan repairs the immediate bug, then establishes a clean invariant: **all 31 GTFS files are
always registered in memory**, regardless of feed state. No code ever needs to special-case
"this file might not exist." The `project` metadata store (a non-GTFS artifact used only as a
"feed loaded?" signal) is removed entirely. Debug console logs are left in place intentionally.

---

## Root Cause (diagnosed before implementation)

In `src/modules/gtfs-parser.ts`, `initializeEmpty()` (line 238):

```typescript
if (data.length > 0) {   // ← BUG: all new-feed arrays are [], so nothing is stored
  this.gtfsData[fileName] = { ... };
}
```

Because every array is empty, `this.gtfsData` ends up as `{}` after initialization.
`getAllFileNames()` returns `[]`, `categorizeFiles()` returns three empty arrays, the file list
renders nothing, and `openFile()` bails early because `getFileContent()` returns `''` (falsy).

Secondary issues in `createNewFeed()`:
- Does not call `hideMapOverlay()` — the welcome overlay stays on screen.
- Does not switch to the Files tab or scroll the sidebar.
- Notification says "with sample data" but no data is created.

---

## The Core Invariant

After Phase 2 is complete, the following is always true from the moment `initialize()` returns:

> `gtfsParser.getAllFileNames()` returns all 31 GTFS filenames. Every file has at least a
> header row. `getFileDataSync(filename)` returns `[]` (never `null`) for any supported file.

This means:
- No code ever needs to check "does this file exist?" — it always does.
- No "No GTFS Data" empty state is needed in Browse — the home page just shows 0 agencies/routes.
- No `hasData()` / `hasDataAsync()` concept is needed anywhere.
- No "Add file" affordance is needed — files are always present, users just add rows to them.
- The `project` metadata store (non-GTFS, used only to gate restore logic) is eliminated.
- Export skips files with 0 rows (correct GTFS behaviour; validators reject empty required files).

---

## Phase 1 — Debug Instrumentation & Minimal Fix ✓ DONE

**Goal:** Make the new-feed flow visible and minimally functional so we can observe the full
system behavior during subsequent phases.

### What was implemented

- `[new-feed]` console logs added to `initializeEmpty()` (entry, per-file, final keys),
  `createNewFeed()` (entry, each sub-step), and `updateFileList()` (categorized counts).
- Removed `if (data.length > 0)` guard in `initializeEmpty()` — files are always stored.
  Empty files get `content: ''` for now (Phase 2 will supply the header row).
- `createNewFeed()` now calls `hideMapOverlay()` and `showFileList()` after initialization.
- Notification text changed to `'New empty GTFS feed created.'`
- `openFile()` guard changed from falsy-content check to `getAllFileNames().includes(fileName)` —
  this is the correct long-term check and should stay through all phases.

### Checklist — Phase 1

- [x] Add `[new-feed]` console logs to `initializeEmpty()`
- [x] Add `[new-feed]` console logs to `createNewFeed()`
- [x] Add `[new-feed]` console logs to `updateFileList()`
- [x] Remove `if (data.length > 0)` guard in `initializeEmpty()`
- [x] Call `hideMapOverlay()` in `createNewFeed()`
- [x] Switch to Files tab in `createNewFeed()`
- [x] Fix notification text in `createNewFeed()`
- [x] Fix `openFile()` empty-content guard

---

## Phase 2 — Always-Files Invariant & Project Store Removal

**Goal:** All 31 GTFS files are always registered in `gtfsData` from startup. The `project`
IndexedDB store (non-GTFS, used only as a "feed loaded?" gate) is removed. The "No GTFS Data"
empty state in Browse is eliminated.

Phase 2 has two sub-phases that must be done together (they are tightly coupled):
- **2A** — File registry + always-register in memory (pure in-memory, no DB changes)
- **2B** — Drop `project` store from IndexedDB (requires DB version bump + migration)

---

### Phase 2A — File Registry & Always-Register in Memory

#### 2A.1 — `gtfs-file-registry.ts` (partially done)

Add `ALL_GTFS_FILES` — the canonical list of all 31 filenames, derived directly from
`GTFS_FILES` so it can never go out of sync:

```typescript
// All 31 supported GTFS filenames, derived from the Zod schema registry.
// This is the authoritative list — never hardcode filenames elsewhere.
export const ALL_GTFS_FILES: readonly string[] =
  GTFS_FILES.map((f) => f.filename);

// The 6 minimum-viable starter files (kept for documentation / reference only)
export const NEW_FEED_FILES: readonly string[] = [
  'agency.txt', 'routes.txt', 'trips.txt',
  'stops.txt', 'stop_times.txt', 'calendar.txt',
];
```

Keep `getFileHeaders()`, `makeHeaderOnlyCSV()`, `isSupportedFile()`, `getAddableFiles()` as-is.

#### 2A.2 — `GTFSParser.initialize()` — always pre-register all files

Before calling `restoreDataFromDatabase()`, unconditionally register every file in
`ALL_GTFS_FILES` with header-only content:

```typescript
async initialize(): Promise<void> {
  await this.gtfsDatabase.initialize();
  // Invariant: all 31 GTFS files are always in gtfsData from this point forward.
  for (const filename of ALL_GTFS_FILES) {
    this.gtfsData[filename] = {
      content: makeHeaderOnlyCSV(filename),
      data: [],
      errors: [],
    };
  }
  // Overlay with real rows from IndexedDB (if any exist).
  await this.restoreDataFromDatabase();
}
```

This replaces the `NEW_FEED_FILES` baseline loop that was inside `restoreDataFromDatabase()`.

#### 2A.3 — `GTFSParser.restoreDataFromDatabase()` — remove project metadata gate

The current implementation gates on `getProjectMetadata()` returning a value, which is the sole
reason the `project` store exists. Remove the gate entirely. The method now simply iterates all
tables in the DB and overlays any rows it finds:

```typescript
async restoreDataFromDatabase(): Promise<void> {
  // No project-metadata gate. All 31 files already registered by initialize().
  // Just overlay with real rows where they exist.
  const stats = await this.gtfsDatabase.getDatabaseStats();
  if (!stats?.tables) return;

  for (const [tableName, count] of Object.entries(stats.tables)) {
    if (count === 0) continue;
    const fileName = tableName.endsWith('.txt') ? tableName : `${tableName}.txt`;
    const data = await this.gtfsDatabase.getAllRows(tableName);
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      this.gtfsData[fileName] = {
        content: [headers.join(','), ...data.map(row => headers.map(h => row[h] ?? '').join(','))].join('\n'),
        data,
        errors: [],
      };
    }
  }
}
```

#### 2A.4 — `GTFSParser.initializeEmpty()` — register all 31 files, remove metadata call

```typescript
async initializeEmpty(): Promise<void> {
  await this.gtfsDatabase.clearDatabase();
  console.log('[new-feed] initializeEmpty() start');
  for (const filename of ALL_GTFS_FILES) {
    const content = makeHeaderOnlyCSV(filename);
    console.log('[new-feed] registering file', filename);
    this.gtfsData[filename] = { content, data: [], errors: [] };
  }
  console.log('[new-feed] initializeEmpty() done', { keys: Object.keys(this.gtfsData) });
  // No updateProjectMetadata() call — project store is being removed.
}
```

#### 2A.5 — `GTFSParser.parseFile()` — fill in missing files, remove metadata call

After processing the ZIP, register any GTFS file that was not in the archive with header-only
content (so all 31 are present regardless of what the feed contained):

```typescript
// After the existing ZIP-processing loop:
for (const filename of ALL_GTFS_FILES) {
  if (!this.gtfsData[filename]) {
    this.gtfsData[filename] = {
      content: makeHeaderOnlyCSV(filename),
      data: [],
      errors: [],
    };
  }
}
// Remove: await this.gtfsDatabase.updateProjectMetadata(...)
```

#### 2A.6 — `GTFSParser.exportAsZip()` — skip header-only (empty) files

The invariant means `gtfsData` always has 31 entries, but most of them may be empty. Only export
files that have actual data rows. Also update the "nothing to export" guard.

```typescript
// Replace: if (fileNames.length === 0) throw ...
// With:
const hasAnyData = fileNames.some(f => this.gtfsData[f].data.length > 0);
if (!hasAnyData) throw new Error('No GTFS data to export');

// In the per-file loop, skip empty files:
if (rows.length === 0 && this.gtfsData[fileName].data.length === 0) {
  continue; // Don't include header-only files in the export
}
```

#### 2A.7 — Remove `renderEmptyState()` and `hasDataAsync()` guard

**`src/modules/page-content-renderer.ts`:**
- Delete the `if (!(await this.dependencies.relationships.hasDataAsync()))` early-return in `renderPage()`.
- Delete the `renderEmptyState()` method.
- Remove `hasDataAsync` from the `ContentRendererDependencies` interface.

**`src/modules/browse-navigation.ts`:**
- Remove `hasDataAsync` from the `relationships` dependency type declaration.

**`src/modules/gtfs-relationships.ts`:**
- Delete `hasData()` and `hasDataAsync()` methods.
- Remove any helper method used only by those two (e.g. `getStatisticsAsync()` if it has no
  other callers — check first).

**`src/modules/export-manager.ts` (line 73) and `src/modules/ui.ts` (line 1137):**
- Replace the `getAllFileNames().length === 0` guard with the "any rows?" check:
  ```typescript
  if (!this.gtfsParser.getAllFileNames().some(f => (this.gtfsParser.getFileDataSync(f)?.length ?? 0) > 0)) {
    notifications.showError('No GTFS data to export. Please add some data first.');
    return;
  }
  ```

### Checklist — Phase 2A

- [x] Create `src/modules/gtfs-file-registry.ts` with `NEW_FEED_FILES`, `getFileHeaders()`,
      `makeHeaderOnlyCSV()`, `getAddableFiles()`
- [x] Fix reload persistence (pre-register `NEW_FEED_FILES` baseline — superseded by 2A.2)
- [x] Fix patch replay double-insert in `PatchManager.initialize()`
- [x] Add `ALL_GTFS_FILES` to `gtfs-file-registry.ts`
- [x] `GTFSParser.initialize()`: pre-register all 31 files unconditionally before `restoreDataFromDatabase()`
- [x] `GTFSParser.restoreDataFromDatabase()`: remove `getProjectMetadata()` gate; remove `NEW_FEED_FILES` baseline loop (moved to `initialize()`)
- [x] `GTFSParser.initializeEmpty()`: register all 31 files; remove `updateProjectMetadata()` call
- [x] `GTFSParser.parseFile()`: fill in missing files after ZIP loop; remove `updateProjectMetadata()` call
- [x] `GTFSParser.exportAsZip()`: skip files with 0 rows; update "nothing to export" guard
- [x] Remove `renderEmptyState()` and `hasDataAsync()` guard from `page-content-renderer.ts`
- [x] Remove `hasDataAsync` from `ContentRendererDependencies` interface
- [x] Remove `hasDataAsync` from `BrowseNavigation.relationships` type
- [x] Remove `hasData()` and `hasDataAsync()` from `gtfs-relationships.ts`
- [x] Update export guards in `export-manager.ts` and `ui.ts` to use "any rows?" check
- [x] Remove `getProjectMetadata()` gate + `initializeEmpty()` call from `index.ts init()`
- [x] **Test flow:** Cold start → all 31 files in sidebar → Browse shows empty home (no "No GTFS Data")
- [x] **Test flow:** New feed → all 31 files in sidebar → map overlay gone → open any file → see header row
- [x] **Test flow:** Load example feed → real data in populated files + headers only in unpopulated files

---

### Phase 2B — Remove `project` Store from IndexedDB

The `project` store in IndexedDB is a non-GTFS concept. Its only purpose was to signal
"a feed has been loaded" to `restoreDataFromDatabase()`. With Phase 2A removing that gate,
the store serves no purpose and should be dropped.

This requires a DB schema version bump from 5 → 6 with an upgrade migration.

#### 2B.1 — Bump DB version in `src/config.ts`

```typescript
DB_VERSION: 6,   // was 5
```

#### 2B.2 — Add version 6 migration in `GTFSDatabase.initialize()`

In the `upgrade` callback in `openDB(...)`:

```typescript
if (oldVersion < 6) {
  // Remove the non-GTFS project metadata store.
  // All-files-always-registered makes it unnecessary.
  if (db.objectStoreNames.contains('project')) {
    db.deleteObjectStore('project');
  }
}
```

Remove the `project` store creation block that follows the patch/meta store creation.

#### 2B.3 — Remove `project` from `GTFSDBSchema`

In `gtfs-database.ts`, delete:

```typescript
project: {
  key: string;
  value: ProjectMetadata;
};
```

#### 2B.4 — Remove `getProjectMetadata()` and `updateProjectMetadata()` from `GTFSDatabase`

Delete both methods (~lines 884–926).

#### 2B.5 — Remove `ProjectMetadata` type

In `src/types/gtfs-entities.ts`:
- Delete the `ProjectMetadata` interface (~line 289).
- Remove `project: ProjectMetadata` from `GTFSTableMap`.

In `src/modules/gtfs-database.ts`:
- Remove `ProjectMetadata` from the import and re-export.

#### 2B.6 — Remove from `database-fallback-manager.ts`

Delete `getProjectMetadata()` and `updateProjectMetadata()` methods (~lines 740–749).
Remove `ProjectMetadata` from its import.

#### 2B.7 — Remove all call sites

Search for `getProjectMetadata` and `updateProjectMetadata` across the codebase and delete
every call. Expected locations:
- `src/modules/gtfs-parser.ts` — `initializeEmpty()`, `parseFile()`, `restoreDataFromDatabase()`
  (all handled in 2A above)

### Checklist — Phase 2B

- [x] Bump `CONFIG.DB_VERSION` to 6 in `src/config.ts`
- [x] Add `oldVersion < 6` migration in `GTFSDatabase.initialize()` to drop `project` store
- [x] Remove `project` store from `GTFSDBSchema` interface
- [x] Remove `project` store creation from the upgrade handler
- [x] Delete `GTFSDatabase.getProjectMetadata()` and `updateProjectMetadata()`
- [x] Delete `ProjectMetadata` interface from `src/types/gtfs-entities.ts`
- [x] Remove `project: ProjectMetadata` from `GTFSTableMap`
- [x] Remove `ProjectMetadata` import/re-export from `gtfs-database.ts`
- [x] Delete `getProjectMetadata()` / `updateProjectMetadata()` from `database-fallback-manager.ts`
- [x] Verify no remaining references to `getProjectMetadata`, `updateProjectMetadata`, or
      `ProjectMetadata` anywhere in the codebase (`grep` to confirm)
- [x] **Test flow:** Open app with old DB (version 5) → migration runs cleanly → no errors
- [x] **Test flow:** Open app fresh (no prior DB) → version 6 schema created → no `project` store

---

## Phase 3 — "Add File" Affordance (ELIMINATED)

With all 31 files always registered in Phase 2, there is nothing to "add." Users interact with
files by adding rows to them. The `getAddableFiles()` export from `gtfs-file-registry.ts` can
be removed if it has no other callers.

No implementation needed.

---

## Phase 4 — Optional File Awareness in Content Views (SIMPLIFIED)

With all files always present (`getFileDataSync()` always returns `[]`, never `null`), content
views that formerly needed null checks for optional files (e.g. shapes, feed_info) can instead
simply check `data.length === 0` and render an "empty" state vs. a "not present" state.

The distinction between "file absent" and "file empty" no longer exists. Views that previously
showed "shapes.txt not in feed" should instead show "No shapes defined yet" or similar empty-list
messaging — no "Add file" button needed, since the file is already there.

### Checklist — Phase 4

- [x] Audit content views in `page-content-renderer.ts` for `getFileDataSync()` null checks —
      replace `=== null` guards with `length === 0` empty-list rendering
- [x] Audit content views for any "file not in feed" messaging — replace with empty-list copy
- [x] **Test flow:** New feed → navigate to route detail → see "No shapes defined" (not "shapes.txt not in feed")

---

## Phase 5 — Polish & Consistency Pass

### View State Reset on Feed Change

When a new feed is created or a feed is loaded, the UI should land in a known-good state rather
than leaving stale navigation from a prior feed.

**On `createNewFeed()` (new empty feed):**
- Reset `PageStateManager` to `{ type: 'home' }` so Browse opens on the home view.
- Switch to the Files tab (already done in Phase 1).
- Hide the map overlay (already done in Phase 1).
- Call `updateFileList()` to render all 31 files.
- Call `browseNavigation.refresh()` so the Browse panel reflects the empty state.

**On `parseFile()` / `parseFromURL()` (loading a feed):**
- Same page-state reset to `{ type: 'home' }` so Browse doesn't land mid-tree on stale route/stop.
- `browseNavigation.refresh()` after load completes.

**Implementation:** In `UIController.createNewFeed()` and in the post-load callback in
`UIController` (or wherever `parseFile` results are handled), call
`this.pageStateManager.navigate({ type: 'home' })` before triggering the Browse render.

### Remaining Polish Items

- [ ] Reset page state to `{ type: 'home' }` in `createNewFeed()` and on feed load
- [ ] Call `browseNavigation.refresh()` after new feed and after load to reflect correct state
- [ ] Remove any remaining `[new-feed]`-specific console logs that are no longer needed
- [ ] Ensure undo/redo works correctly across all 31 files
- [ ] Verify export round-trip: new feed → add agency + route → export → reimport → same state
- [ ] Confirm keyboard shortcut for New Feed still works end-to-end
- [ ] Confirm `categorizeFiles()` returns the correct buckets for all 31 files
- [ ] **Test flow:** New feed → add agency row → add route row → undo → redo → export → reimport → same state
- [ ] **Test flow:** Load feed while on a route detail page → Browse resets to home

---

## UI Flows to Test (After Phase 2)

1. **Cold start:** Open app → 31 files in sidebar → map overlay visible → Browse shows empty home.
2. **New feed:** Click "New" → overlay hides → Files tab active → still 31 files → open any file → see header row only.
3. **Load feed:** Load example ZIP → populated files show data → unpopulated files show header row only.
4. **Reload after new feed + data:** Add a row → reload → data persists → all 31 files still listed.
5. **Export:** New feed (no rows) → export button shows "No data" message. Add an agency row → export → ZIP contains only agency.txt (with that one row).
6. **DB migration (existing user):** Open app that had version 5 DB → upgrade to version 6 runs → `project` store dropped → no errors → data intact.

---

## Files Expected to Change

| File | Change |
|------|--------|
| `src/config.ts` | `DB_VERSION: 5 → 6` |
| `src/modules/gtfs-file-registry.ts` | Add `ALL_GTFS_FILES` |
| `src/modules/gtfs-parser.ts` | `initialize()` pre-registers all 31; `restoreDataFromDatabase()` removes project gate; `initializeEmpty()` uses `ALL_GTFS_FILES`; `parseFile()` fills missing files; `exportAsZip()` skips empty files; remove all `ProjectMetadata` usage |
| `src/modules/gtfs-database.ts` | Version 6 migration; remove `project` store from schema; remove `getProjectMetadata()` / `updateProjectMetadata()`; remove `ProjectMetadata` import/re-export |
| `src/modules/database-fallback-manager.ts` | Remove `getProjectMetadata()` / `updateProjectMetadata()` |
| `src/types/gtfs-entities.ts` | Remove `ProjectMetadata` interface and `project` from `GTFSTableMap` |
| `src/modules/page-content-renderer.ts` | Remove `renderEmptyState()` + `hasDataAsync()` guard; update null→empty-list checks in views |
| `src/modules/gtfs-relationships.ts` | Remove `hasData()` and `hasDataAsync()` |
| `src/modules/browse-navigation.ts` | Remove `hasDataAsync` from dependency interface |
| `src/modules/export-manager.ts` | Update export guard to "any rows?" check |
| `src/modules/ui.ts` | Update export guard to "any rows?" check |

---

*Plan written 2026-03-24. Revised 2026-03-25: adopted "all 31 GTFS files always registered"
invariant; removed `project` metadata store (non-GTFS); eliminated Phase 3 "Add file" entirely;
simplified Phase 4 to empty-list handling only. Phases are intended to be implemented
sequentially; each phase is independently testable. Update this file after each phase with actual
changes made, deviations, and findings.*
