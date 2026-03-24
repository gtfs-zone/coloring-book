# New Feed & File Management — Implementation Plan

## Motivation

The "New Feed" button exists in the UI but is currently broken in practice. When a user clicks it,
a notification fires but the file list stays empty, the map overlay persists, and nothing can be
edited. The root cause is a single off-by-one guard in `initializeEmpty()`, but fixing just that
one line without a stronger abstraction would leave us with fragile file management long-term.

This plan repairs the immediate bug, then layers in a proper GTFS file management idiom that will
make adding optional files, handling missing files, and future feed operations essentially
bug-free by construction. Debug console logs are left in place intentionally — this is a
development-phase project and rich logging is a feature, not clutter.

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

## Phase 1 — Debug Instrumentation & Minimal Fix

**Goal:** Make the new-feed flow visible and minimally functional so we can observe the full
system behavior during subsequent phases.

### 1.1 Add structured console logging

Add `[new-feed]` prefixed console logs at every decision point in:

- `GTFSParser.initializeEmpty()` — log entry, each file registered, final `gtfsData` keys
- `UIController.createNewFeed()` — log entry, result of each sub-step
- `UIController.updateFileList()` — log categorized file counts
- `MapController.hideMapOverlay()` — confirm it is being called

Format: `console.log('[new-feed] <step>', { ... relevant data ... })`

### 1.2 Fix the empty-array guard

In `initializeEmpty()`, store every file unconditionally — even if `data = []`. An empty file is
still a present file. The content stored should be the header row only (see Phase 2 for how
headers are derived). For now, use an empty CSV string `''` as a placeholder so the flow works
end-to-end.

```diff
- if (data.length > 0) {
-   this.gtfsData[fileName] = { content: csvContent, data, errors: [] };
- }
+ // Register file even if empty — presence is what matters for the file list
+ this.gtfsData[fileName] = { content: csvContent, data, errors: [] };
```

### 1.3 Fix post-creation UI update in `createNewFeed()`

After `initializeEmpty()`, the controller must:

1. Call `this.mapController.hideMapOverlay()`
2. Switch to the Files tab (same as `loadGTFSFile()` does at line 219)
3. Change notification text from "with sample data" → "New empty GTFS feed created."

### 1.4 Fix `openFile()` to allow empty files

`openFile()` currently returns early if `getFileContent()` is falsy (empty string). It should
allow opening files that exist in `gtfsData` even if their content is `''` (header-only files will
have content after Phase 2, but defensive fix now is good).

### Checklist — Phase 1

- [ ] Add `[new-feed]` console logs to `initializeEmpty()`
- [ ] Add `[new-feed]` console logs to `createNewFeed()`
- [ ] Add `[new-feed]` console logs to `updateFileList()`
- [ ] Remove `if (data.length > 0)` guard in `initializeEmpty()`
- [ ] Call `hideMapOverlay()` in `createNewFeed()`
- [ ] Switch to Files tab in `createNewFeed()`
- [ ] Fix notification text in `createNewFeed()`
- [ ] Fix `openFile()` empty-content guard
- [ ] **Test flow:** Load example feed → click New Feed → file list shows 6 files → map overlay gone → files tab active

---

## Phase 2 — GTFS File Registry Abstraction

**Goal:** Establish a single source of truth for file metadata (headers, presence, supported
status) that all other code consults. This prevents the scattered assumptions that caused the
Phase 1 bug and makes "add file" / "missing file" handling trivial.

### 2.1 Design

Add a module `src/modules/gtfs-file-registry.ts` (or extend `src/types/gtfs.ts`) that exports:

```typescript
// The 6 files to initialize on a new feed (required + conditionally-required starters)
export const NEW_FEED_FILES: readonly string[] = [
  'agency.txt',
  'routes.txt',
  'trips.txt',
  'stops.txt',        // Conditionally Required — included by default
  'stop_times.txt',
  'calendar.txt',     // Conditionally Required — included by default (vs calendar_dates.txt)
];

// Derive canonical column headers for a file from its Zod schema
export function getFileHeaders(filename: string): string[]

// Whether a filename is supported (appears in GTFS_FILES)
export function isSupportedFile(filename: string): boolean

// All optional/conditionally-required files that can be added
export function getAddableFiles(presentFiles: string[]): GTFSFileInfo[]

// Generate a headers-only CSV string for a given file
export function makeHeaderOnlyCSV(filename: string): string
```

**Header derivation strategy:** The Zod schemas in `GTFS_FILES[n].schema` are `z.object({...})`
shapes. The canonical header list is `Object.keys(schema.shape)`. This is already the ground
truth for the application — no duplication needed.

### 2.2 `makeHeaderOnlyCSV(filename)`

Returns a single-line CSV: just the comma-joined field names from the schema. Example:

```
agency_id,agency_name,agency_url,agency_timezone
```

This is what gets stored as `content` in `gtfsData` for a new or added file with no rows.

### 2.3 Integrate with `GTFSParser.initializeEmpty()`

Replace the hardcoded `emptyData` object with a loop over `NEW_FEED_FILES`:

```typescript
for (const filename of NEW_FEED_FILES) {
  const content = makeHeaderOnlyCSV(filename);
  this.gtfsData[filename] = { content, data: [], errors: [] };
  console.log('[new-feed] registered file', filename, 'with headers');
}
```

No IndexedDB insert needed for empty tables (nothing to store). The table is "present" by virtue
of being in `gtfsData`.

### 2.4 Integrate with `categorizeFiles()`

No change needed — `categorizeFiles()` already consults `getAllFileNames()` which reads
`gtfsData` keys. Once Phase 1 fix lands, this works correctly.

### 2.5 Parser restoration on app reload

When the app reloads with existing IndexedDB data, `gtfsData` is currently populated only for
files that had rows. Files that were present but empty (e.g., a user created `shapes.txt` but
hasn't added shapes yet) will disappear from the file list on reload.

Fix: during `restoreFromPatches()` / `initialize()`, for any file that was ever inserted into the
DB (even with 0 rows), ensure it is registered in `gtfsData` with at least a header-only entry.
This requires checking `getDatabaseStats()` or querying each known table.

### Checklist — Phase 2

- [ ] Create `src/modules/gtfs-file-registry.ts` with `NEW_FEED_FILES`, `getFileHeaders()`,
      `makeHeaderOnlyCSV()`, `getAddableFiles()`
- [ ] Write unit-level tests (or at least manual verification) of header derivation for all 6
      starter files
- [ ] Replace hardcoded `emptyData` in `initializeEmpty()` with registry-based loop
- [ ] Verify `categorizeFiles()` correctly lists all 6 files after new-feed creation
- [ ] Fix reload persistence for empty files
- [ ] **Test flow:** New feed → reload page → still shows 6 files in sidebar

---

## Phase 3 — "Add Optional File" Affordance

**Goal:** Users can add any supported optional file to an existing feed (new or loaded). Adding a
file creates it header-only; the first row can be added via the normal table editor.

### 3.1 UI placement

Below the Optional Files section in the sidebar (or at the bottom of the file list), add an
"+ Add file" button. This is always visible when a feed is loaded.

Clicking opens a small dropdown/select (DaisyUI dropdown) listing all supported files not
currently present, grouped by presence category (Optional / Conditionally Required /
Recommended). Greyed-out entries for unsupported or already-present files.

### 3.2 Implementation

In `UIController`:

```typescript
async addOptionalFile(filename: string): Promise<void> {
  const content = makeHeaderOnlyCSV(filename);
  this.gtfsParser.registerFile(filename, content, []);
  this.updateFileList();
  await this.openFile(filename);   // immediately open it in the editor
  console.log('[file-mgmt] added optional file', filename);
  notifications.showSuccess(`Added ${filename} to feed.`);
}
```

`GTFSParser.registerFile(filename, content, data)` is a new public method that adds/replaces
an entry in `gtfsData`. This is also what the "add row to a file that doesn't exist" path uses.

### 3.3 Auto-create on first row

When the table editor inserts a row into a file that isn't present yet:
- Call `registerFile()` with the header-only content first
- Then proceed with the insert

This means a user can navigate to a route and add a shape without first manually adding
`shapes.txt` — the file is auto-created on demand.

### Checklist — Phase 3

- [ ] Add `GTFSParser.registerFile(filename, content, data)` method
- [ ] Add "+ Add file" button to file list sidebar
- [ ] Build dropdown listing addable files from `getAddableFiles()`
- [ ] Wire dropdown to `UIController.addOptionalFile()`
- [ ] Implement auto-create-on-first-row in table editor insert path
- [ ] **Test flow:** New feed → click "+ Add file" → select `shapes.txt` → file appears in
      sidebar → can be opened → editor shows header row → can add a row

---

## Phase 4 — Missing File Handling in Content Views

**Goal:** When a content view (e.g., a route detail panel) references a file that doesn't exist
in the current feed, show a clear "this file is not present" affordance rather than silently
failing or rendering nothing.

### 4.1 Detection

Any view that reads from `gtfsParser.getFileDataSync(filename)` and receives `null` should treat
this as "file not present" — distinct from "file present but empty" (which returns `[]`).

Update `getFileDataSync()` to return `null` only when the file is not registered in `gtfsData`,
and `[]` when it is registered but has no rows. This distinction already exists — Phase 1 fix
ensures `gtfsData` has entries for present-but-empty files.

### 4.2 "Add this file" inline CTA

In `PageContentRenderer` views, when a dependency file is missing, render something like:

```html
<div class="alert alert-info">
  <span>shapes.txt is not in this feed.</span>
  <button class="btn btn-sm btn-primary">Add shapes.txt</button>
</div>
```

The button calls `uiController.addOptionalFile('shapes.txt')`.

### 4.3 File list: show missing required files

In `updateFileList()`, show the 6 starter files even if they're absent, with a visual indicator
(warning badge, greyed out, "missing" label). This gives the user a clear picture of what the
feed needs.

Strategy: iterate `NEW_FEED_FILES` for the required section, checking presence in `getAllFileNames()`.
Present → normal item. Absent → dimmed item with "missing" badge and "Add" button.

### Checklist — Phase 4

- [ ] Confirm `getFileDataSync()` semantics: `null` = absent, `[]` = present-empty
- [ ] Add missing-file CTA component in `PageContentRenderer`
- [ ] Identify all views that silently fail on missing files and add CTA to each
- [ ] Update `updateFileList()` to show absent required files with "missing" indicator
- [ ] **Test flow:** New feed (no shapes.txt) → navigate to route detail that shows shape info →
      see "shapes.txt not in feed" message with Add button → click Add → shapes.txt appears in
      sidebar

---

## Phase 5 — Polish & Consistency Pass

**Goal:** Clean up remaining rough edges now that the abstraction is solid.

- [ ] Remove "with sample data" from any remaining notification text
- [ ] Ensure export button state is always correct (enabled ↔ feed has files)
- [ ] Ensure undo/redo works correctly after adding a file
- [ ] Ensure patch log records file creation (so undo removes the file)
- [ ] Verify reload persistence covers all Phase 3 flows (added optional file survives reload)
- [ ] Add a `[file-mgmt]` console log namespace for all file operations
- [ ] Confirm keyboard shortcut for New Feed still works end-to-end
- [ ] **Test flow:** New feed → add agency row → add route row → undo → redo → export → reimport
      → same state

---

## UI Flows to Test (Suggested)

These are the key scenarios to walk through manually after each phase:

1. **Cold start (no IndexedDB data):** Open app → see welcome overlay → nothing in file list.
2. **New feed (Phase 1+):** Click "New" → overlay hides → Files tab activates → 6 files in
   sidebar → click `agency.txt` → opens in editor with header row only.
3. **Load then new:** Load an example feed → verify it shows correctly → click "New" → feed
   resets to 6 empty files (old data gone).
4. **Reload persistence (Phase 2+):** New feed → add a row to agency.txt → reload page → still
   shows 6 files → agency.txt has 1 row.
5. **Add optional file (Phase 3+):** New feed → click "+ Add file" → choose `shapes.txt` →
   file appears → click it → empty table editor → add a row → row appears.
6. **Auto-create (Phase 3+):** Navigate to a route → click "Add shape" (or equivalent) →
   `shapes.txt` is auto-created and the row lands in it.
7. **Missing file CTA (Phase 4+):** New feed → navigate to agency → look for shapes indicator →
   see "not in feed" message → click Add → file created.
8. **Export round-trip:** New feed → populate minimally → export ZIP → reimport → same state.

---

## Files Expected to Change

| File | Change |
|------|--------|
| `src/modules/gtfs-parser.ts` | Fix `initializeEmpty()`, add `registerFile()`, fix reload persistence |
| `src/modules/ui.ts` | Fix `createNewFeed()`, `openFile()`, `updateFileList()`, add `addOptionalFile()`, add file dropdown |
| `src/modules/gtfs-file-registry.ts` | **New file** — `NEW_FEED_FILES`, `getFileHeaders()`, `makeHeaderOnlyCSV()`, `getAddableFiles()` |
| `src/modules/page-content-renderer.ts` | Add missing-file CTA in relevant views |
| `src/index.ts` | Minor — wire `addOptionalFile` dependency if needed |

---

*Plan written 2026-03-24. Phases are intended to be implemented sequentially; each phase is
independently testable before the next begins.*
