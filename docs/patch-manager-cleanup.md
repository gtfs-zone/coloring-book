# Patch Manager Cleanup Plan

## Overview

Three related bugs were found in the patch manager's initialization and patch-replay logic.
They all stem from the same root cause: `applyPatchForward` / `applyPatchInverse` try to
maintain in-memory state **two ways simultaneously** — by directly mutating the parser's
`gtfsData[fileName].data` array, AND by calling `db.*` methods which go through the virtual
table system (which operates on the **same** underlying array). This dual-write is fragile and
was the source of both bugs found during review.

---

## Background: How the Virtual Table System Works

All GTFS `.txt` tables are **virtual tables**. When `setupVirtual(tableName, data)` is called
(e.g. from `restoreDataFromDatabase`), it calls `buildAndRegisterVirtual(tableName, data)`.
Inside, a closure is created over the `flat` parameter (which IS the `data` array passed in —
same reference). The virtual table handlers (`insert`, `delete`, `update`, `clear`) all mutate
this `flat` array directly.

`getFileDataSync(fileName)` returns `this.gtfsData[fileName].data` — which is also the `flat`
array. So `data` in `applyPatchForward` and `flat` in the virtual table are the **same object**.

```
gtfsData['stops.txt'].data  ──────────┐
                                       ↓ (same array reference)
vt.flat  ─────────────────────────────┘
```

`vt.insert` maintains a parallel `byId: Map<string, GTFSDatabaseRecord>` for O(1) lookups and
deduplication. This map is populated from `flat` at registration time and kept in sync by the
`insert/delete/update/clear` handlers. **It is only updated by going through the virtual table
methods — direct array pushes bypass `byId`.**

The blob (`saveTableBlob`) is also flushed from `flat` via `invalidateBlobForTable` (debounced).
So the blob reflects the current `flat` state.

---

## Bug 1 (fixed): Double-insert on refresh

### Symptom
Load feed → create stop → refresh → `stops.txt` shows 2 identical copies of the new stop only.

### Root Cause
`applyPatchForward` for insert patches did:
```typescript
data.push(record);                    // 1. manual push to flat (bypasses byId)
await this.db.insertRows(table, [r]); // 2. vt.insert → flat.push again
```
`vt.insert`'s `byId` guard (`if (byId.has(key)) continue`) didn't fire because the manual push
never updated `byId`. Result: two copies in `flat`.

### Fix Applied
Removed the manual `data.push(record)` from the insert branches in both `applyPatchForward`
and `applyPatchInverse`. The `db.insertRows` call alone is sufficient.

---

## Bug 2 (needs fix): All original stops gone on refresh

### Symptom
Load feed → create stop → refresh → `stops.txt` shows **only the new stop** — all original
feed stops are gone.

### Root Cause
`PatchManager.initialize()` (lines 79–94) has a `tablesToClear` block introduced to prevent
the double-insert:

```typescript
if (!snapshot && patches.length > 0) {
  // Clear any table that has a non-update patch, then replay from scratch.
  for (const table of tablesToClear) {
    await this.db.clearTable(table);                   // wipes original feed data
    this.parser.setInMemoryFileData(`${table}.txt`, []); // wipes in-memory too
  }
}
// then replays only the patches — which only cover user changes, not original feed
```

The blob loaded by `GTFSParser.initialize()` already contains the **correct current state**
(original feed + new stop). The clearing step then wipes all of that, and patch replay only
re-adds the explicitly patched rows (the new stop). The original feed stops are permanently lost
for this session.

This block was the workaround for Bug 1 — but now that Bug 1 is fixed, the `byId` guard in
`vt.insert` correctly prevents double-inserts. The clearing block is no longer needed and is
actively harmful.

**Proof the guard now works correctly on refresh:**
1. Load blob → flat = [100 original + new stop], byId populated with all 101 stops
2. No clearing
3. Replay insert patch for new stop → `vt.insert` → `byId.has(newStopId)` → **true** → skip
4. Final: flat = [100 original + new stop] ✓

**Edge cases verified:**
- Delete patch on refresh: stop not in blob → `vt.delete` finds nothing via `byId` → safe no-op ✓
- Insert then delete (net no-op): blob has no stop → replay insert adds it → replay delete removes it ✓
- Mid-undo refresh: `currentVersion < headVersion` → patches after `currentVersion` are skipped by the loop break ✓

---

## Remaining Issue: Redundant Dual-Write in delete and update Paths

### Current State
`applyPatchForward` and `applyPatchInverse` still have manual array mutations for delete and update:

**Delete** (in `applyPatchForward`):
```typescript
if (data) {
  const idx = this.findRecordIndex(data, source.id, source.table);
  if (idx !== -1) {
    data.splice(idx, 1);            // manual splice on flat
  }
}
await this.db.deleteRow(table, id); // vt.delete also splices flat (gets -1, no-ops splice)
                                     // but does clean up byId + fieldMaps
```
Works by accident: manual splice removes from flat first; then `vt.delete` gets `flat.indexOf(row) === -1` so skips the splice, but still cleans `byId` and `fieldMaps`. Fragile — order-dependent.

**Update** (in both):
```typescript
if (data) {
  data[idx][field] = value;           // manual Object mutation
}
await this.db.updateRow(table, id, delta); // vt.update: Object.assign (idempotent)
                                            // ALSO handles byId key rotation + fieldMaps
```
Works because `Object.assign` is idempotent. But if the `data[idx]` lookup failed (e.g. row not found), `vt.update` would also not find it via `byId`. No real bug, just noise.

### Fix Needed
Remove all `if (data) { ... }` blocks from `applyPatchForward` and `applyPatchInverse`. The
virtual table methods are the single source of truth for in-memory state. The `data` variable
and `getFileDataSync` call at the top of each function become unused and can be removed too.

---

## Phase 1 — Fix "all stops gone" bug

**File:** `src/modules/patch-manager.ts`

- [x] Remove the entire `tablesToClear` block (lines ~79–94 in `initialize()`)
- [x] Remove the now-outdated comment above it explaining the rationale
- [x] Add a new comment explaining why no clearing is needed (blob reflects current state; `vt.insert`'s `byId` guard prevents double-inserts during replay)
- [x] Manual test: load feed → create stop → refresh → verify all original stops + new stop present

---

## Phase 2 — Remove redundant manual array mutations

**File:** `src/modules/patch-manager.ts`

In `applyPatchForward`:
- [x] Remove `const data = this.parser.getFileDataSync(fileName)` (unused after cleanup)
- [x] Remove `const fileName = ...` if also unused
- [x] Remove `if (data) { data.splice(...) }` from the `delete` branch
- [x] Remove `if (data) { const idx = ...; data[idx][field] = value }` from the `update` branch
- [x] Simplify the `update` branch: build `delta` and call `db.updateRow` only

In `applyPatchInverse`:
- [x] Same removals (delete splice, update manual mutations, unused `data` variable)
- [x] The insert branch (undo of insert → delete by id) already only calls `db.deleteRow` — nothing to change

Also removed:
- [x] `findRecordIndex` private method (now unused)
- [x] Four now-unused imports from `gtfs-primary-keys.js`

---

## Phase 3 — Documentation

**File:** `src/modules/gtfs-parser.ts` — `buildAndRegisterVirtual`
- [x] Add a doc comment above the function stating the invariant:
  > The `flat` array passed in is stored as a live reference shared with `gtfsData[fileName].data`.
  > All in-memory mutations MUST go through the returned virtual table methods (`insert`, `delete`,
  > `update`, `clear`). Direct pushes/splices to the array bypass `byId` and `fieldMaps` and will
  > corrupt the indexes.

**File:** `src/modules/gtfs-parser.ts` — `vt.insert` deduplication guard
- [x] Updated the `// guard for PatchManager double-add` comment to describe the general mechanism:
  > deduplication: skip rows already present (e.g. replaying an insert patch whose row was already loaded from the blob)

**File:** `src/modules/patch-manager.ts` — `applyPatchForward` / `applyPatchInverse` doc comments
- [x] Updated doc comments on both methods to note: all in-memory state is maintained
  exclusively via `db.*` calls (which route through virtual table handlers). Do not add direct
  array mutations here. (Done as part of Phase 2.)

---

## Verification After Each Phase

After Phase 1:
- Load a real feed, create a new stop, refresh → stops.txt should show original stops + new stop
- Load a real feed, delete a stop, refresh → stops.txt should not contain deleted stop
- Load a real feed, update a stop's name, refresh → stop name should be updated

After Phase 2:
- Same manual tests (behavior should be identical — only internals changed)
- Run `npm run typecheck` to catch any unused variable errors
- Run `npm run lint` to check for lint issues

After Phase 3:
- Code review: confirm comments match the actual invariants

---

## Notes

**Snapshot path (out of scope):** When a snapshot exists, `initialize()` calls
`db.clearTable` + `db.insertRows` then `setInMemoryFileData`. The first two calls operate on
the old virtual table (pre-`setInMemoryFileData`) and are effectively no-ops since
`setInMemoryFileData` immediately re-registers the virtual table with the snapshot rows directly.
This is harmless redundancy but could be cleaned up in a future pass by removing the
`db.clearTable` + `db.insertRows` calls from the snapshot restore path. Not touching it now.
