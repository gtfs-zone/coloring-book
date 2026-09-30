# Architecture

How the editor is put together, and the invariants that keep it correct.
`AGENTS.md` links here for each rule.

## Module groups

All modules live in `src/modules/` and are instantiated and wired together by
`GTFSEditor` in `src/index.ts`, via constructor injection and callbacks (no DI
framework). Circular references are resolved post-construction by passing
references explicitly.

| Group | Modules |
|-------|---------|
| Data | `gtfs-parser.ts`, `gtfs-database.ts`, `gtfs-validator.ts`, `gtfs-relationships.ts` |
| Map | `map-controller.ts`, `route-renderer.ts`, `layer-manager.ts`, `interaction-handler.ts` |
| Editor | `editor.ts` (Files table viewer, Clusterize grid), `ui.ts` (file list / editor / preview state machine), `patch-manager.ts` (append-only patch log + undo/redo), `history-controller.ts` (Changes panel UI) |
| Navigation | `page-state-manager.ts`, `breadcrumbs.ts`, `objects-navigation.ts`, `page-content-renderer.ts` |
| Views | `schedule-controller.ts`, `service-days-controller.ts`, `stop-view-controller.ts`, `timetable-*.ts` |
| UI | `navbar-action-list.ts`, `shortcut-list.ts`, `help-pages.ts`, `tab-lock.ts` |

## State model

There is no centralized state management (no Redux/Zustand). State is distributed:

- **IndexedDB** (`GTFSDatabase`): persistent GTFS data
- **`PageStateManager`**: URL hash-based navigation state
- **Module-level state**: each controller owns its own state
- **DOM state**: tab selection, active view

## Patch system

Every user-initiated `updateRow`, `insertRows`, or `deleteRow` must be
accompanied by a corresponding `patchManager.record*()` call. Direct DB writes
are only for: internal initialization, patch replay, feed import, and backup
restore.

The one exception is non-spec passthrough files (see
`GTFSParser.setPassthroughContent`): they have no table, no primary key and no
schema, so there is nothing a patch could describe. Do not extend this
exception to anything else.

## Copy-on-read

All query methods on virtual tables (`getAll`, `getById`, `query`) return
shallow copies of the stored rows, not live references. This prevents silent
aliasing bugs where a "before" snapshot is mutated by a later in-place write.
Do not hold a long-lived reference to a query result and assume it will remain
unchanged.

## Networks

GTFS allows two mutually exclusive on-disk forms, `routes.network_id` or the
two network files. In IndexedDB it is always the two tables, `networks` +
`route_networks`: import synthesizes them from `routes.network_id` when that is
the form the feed used, and nothing reads `routes.network_id` afterwards. Which
form the feed arrived in is remembered as `networksMode` in the `meta` store
and decides the export form, unless a network has gained a name (which forces
the files form). Never write `routes.network_id` outside export.

## Extension fields

A non-spec column of a CSV table exists because rows carry that key, so
`extensionFields(tableName, rows)` in `src/utils/extension-fields.ts` is the
only source of the list, and `extensionFieldSpec` supplies the synthetic
optional-text spec every renderer needs. Both shared field renderers
(`editable-table.ts`'s `columnFields`, `inline-editable-field.ts`'s
`renderInlineEntityFields`) append them after the spec fields.

The one thing data-derivation cannot express, a column the user just created
with no values yet, lives in the `meta` store under `extensionColumns`. Never
add extension fields to the Zod schemas: those are generated from
`src/gtfs-spec/` and `pnpm check-spec` blocks the divergence.

## IndexedDB requests

No IndexedDB request may be waited on without a way out. An open or delete
queued behind a blocked version-change operation fires no event at all, not
success, not error, not even `blocked`, so a bare `await` on one hangs forever
with nothing logged. Everything on the boot path goes through `withTimeout` /
`deleteDatabaseWithTimeout` in `src/utils/idb-request.ts`.

A blocked delete is not a completed delete: reporting it as success and
reloading leaves the request queued and wedges every later request on that
database, including the next page load's version probe.

The other half of the rule is never to be the blocker: the open connection
carries a `blocking` handler that closes it when another tab needs an upgrade.

## Yielding on long jobs

Never yield with `setTimeout` on a long job: a hidden tab clamps timers to
about one second, so a pass that yields per step turns into a hang that looks
like a wedged database. Measured in Firefox with the tab hidden: ten
`setTimeout(0)` round trips took 10059ms, ten MessageChannel round trips took
1ms. `yieldToEventLoop` in `src/utils/async-yield.ts` is the only yield
primitive, it posts on a shared MessageChannel, and it stays a macrotask so the
progress bar still paints.

The same rule applies to deleting IndexedDB records: a cursor step
deserializes the record's value, and a `file_blobs` value is a whole
`BLOB_CHUNK_ROWS`-row JSON string, so a delete that never reads values goes
through `getAllKeys` plus `store.delete` (measured on 10 x 10MB chunks: 2629ms
by cursor, 3ms by key).

## Feed-scoped caches

Every module is constructed and can read feed data before a feed exists, so a
cache guarded only by `if (this.cache)` or `=== null` pins the empty boot
scaffold for the whole session. Feed-scoped caches key on `feedGeneration` or
subscribe to `onFeedReplaced`.

`GTFSParser.markFeedReplaced()` is the single emit point and fires only once
the new rows are final. Use the pull side (`parser.feedGeneration` as part of
the memo key) for anything recomputable synchronously; use `onFeedReplaced`
only when the invalidation needs imperative or async work, and register the
listener in the one block in `src/index.ts` rather than scattering it.

The only external caller of `markFeedReplaced` is
`GTFSEditor.restoreStoredFeed`, because the boot restore is not final until
`PatchManager.initialize` has replayed the patch log; do not add a third.
