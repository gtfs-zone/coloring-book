# Future Issues — Edit History (`3-edit-history`)

These are real concerns identified during code review of the patch/undo system, deferred to separate tickets.

---

## 1. No patch log compaction

**File:** `src/modules/patch-manager.ts`, `src/modules/gtfs-database.ts`

The `patches` store grows forever. Snapshots are saved every 50 patches, but old patches before the earliest snapshot are never pruned from IndexedDB. Over time this will waste storage.

**Suggested fix:** After saving a new snapshot, delete all patches with `version < snapshot.version - SNAPSHOT_INTERVAL` (or all patches covered by the prior snapshot).

---

## 2. `jumpToVersion()` is O(n) sequential IDB reads

**File:** `src/modules/patch-manager.ts` — `jumpToVersion()`

Each step in the forward or backward walk calls `db.getPatch(v)` individually inside a loop, issuing one IndexedDB request per patch. For large jumps this is slow.

**Suggested fix:** Add a `getPatchesInRange(from, to)` method to `GTFSDatabase` that uses a key-range cursor, then batch-process the patches in memory.

---

## 3. No Playwright tests for the patch system

There are no automated tests covering:
- Undo / redo after edits
- Revert of a single patch
- Jump to an arbitrary version
- Snapshot creation and restore

These should be added in `tests/`.

---

## 4. `CompressionStream` browser compatibility

**File:** `src/modules/patch-manager.ts` — `compress()` / `decompress()`

`CompressionStream` is not available in Safari < 16.4 (released September 2022). Users on older Safari will get a runtime error when a snapshot is triggered.

**Suggested fix:** Add a feature-detect: if `typeof CompressionStream === 'undefined'`, fall back to storing snapshots uncompressed (or use a small JS gzip library like `fflate`).
