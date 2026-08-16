# Plan: The Last Unsupported Parts of the Spec

## Summary

Three spec files still have no structured UI: `transfers.txt` (validated by
`validateTransfers`, but not editable anywhere except the raw file viewer, and
never drawn), `translations.txt` (no UI, and translations are never applied to
any label), and `attributions.txt` (no UI at all). Separately, feeds routinely
carry non-spec columns and non-spec files: both already survive the
import/export round-trip byte-for-byte, but neither is visible anywhere in the
app, so a user cannot see or change them. And the Files modal's "Other Files"
section is an accident, not a design.

The approach is to lean on abstractions that already exist rather than build new
ones. `editable-table.ts` is already a fully spec-driven editable grid, and
`fares-modal.ts` is already a sidebar-plus-table modal built on it; the three
missing files get exactly that treatment in one new modal, which is a few
hundred lines of configuration rather than new machinery. The two integration
touches that a plain table cannot give (transfers on the stop page and on the
map) come after, as their own phase. Applying translations to displayed labels
is deliberately **not** in this plan.

**Chosen approach and tradeoffs:**

- **One "Feed Data" modal, not three modals and not three browse pages.**
  `transfers`, `translations`, and `attributions` are all low-frequency,
  feed-level tables that a user visits deliberately. `showFaresModal` already
  proves the shape: a sidebar of tables, one `renderEditableTable` pane, counts
  per entry. Three bespoke modals would be three copies of the same 60 lines.
  Browse pages were considered and rejected: none of these three is an entity a
  user navigates *to*, they are relations between entities that already have
  pages.
- **Transfers additionally appear where the user thinks about them.** A
  "Transfers" card on the stop page, and transfer edges drawn on the map for the
  focused stop only. A feed-wide transfer layer with a toggle was considered and
  rejected: it adds layer-control surface and a styling problem on large feeds,
  for a view nobody asked to see all at once.
- **Attributions additionally appear on the home page**, under Feed Information.
  They are feed metadata, and the home page is already the feed-metadata page.
- **Translations get editing only in this plan.** Applying them means a display
  language selector plus a lookup consulted inside
  `src/utils/entity-display.ts`, which is the single mandated choke point for
  labels. That is a coherent piece of work with its own risks (cache
  invalidation, re-render on language change, `field_value` vs `record_id`
  precedence) and it belongs in its own plan. Shipping the editor first means
  the data is at least authorable and inspectable.
- **Extension columns are derived from the data, not configured.** A non-spec
  column exists because rows have that key. The one thing data-derivation cannot
  express is a column the user just created and has not filled in yet, so that
  single case is held in the `meta` store. This keeps the common path with zero
  state.
- **Non-spec files stay raw text.** They have no schema, so there is nothing to
  drive a grid from. A plain text editor is the honest UI, and it is what the
  data already is (`passthroughFiles` is a `Map<string, string>` of raw file
  contents).

## Relevant context

### Why "Other Files" holds `networks.txt` and `route_networks.txt`

`categorizeFiles()` (`src/modules/gtfs-parser.ts:1190`) buckets by presence, but
only tests three values: `Required`, `Optional`, `Conditionally Required`. The
spec files use five (`grep "presence: '" src/gtfs-spec/files/*.ts`): the other
two are `Conditionally Forbidden` and `Recommended`. `networks.txt` and
`route_networks.txt` are `presence: 'Conditionally Forbidden'`
(`src/gtfs-spec/files/networks.ts:5`, because they are forbidden when
`routes.network_id` is used), so they match neither list and fall through into
`other`.

The `other` bucket was meant for unrecognized files, but it can never contain
one: `getAllFileNames()` returns `Object.keys(this.gtfsData)`, and `gtfsData` is
only ever populated from the worker's `resultFiles`, which contains supported
files only. Unrecognized files go to a separate `passthroughFiles` map. So today
"Other Files" is exactly the set of `Conditionally Forbidden` files and nothing
else. Fixing it by inverting the test (anything in `ALL_GTFS_FILES` that is not
`Required` is optional) is robust against future presence values.

### What already exists and should be reused

| Thing | Where | Why it matters |
|---|---|---|
| `renderEditableTable` / `installEditableTableHandlers` / `uninstallEditableTableHandlers` | `src/modules/editable-table.ts:577,707,746` | Spec-driven editable grid: columns, tooltips, enum menus, FK pickers, trailing blank insert row, delete, patch recording. Takes an `EditableTableConfig` (`:168`). |
| `showFaresModal` | `src/modules/fares-modal.ts:560` | The exact modal shape to copy: `FaresEntry[]` describing each table, a `refresh()` that re-points `tableConfig.tableName` and re-reads rows, a sidebar with per-table counts. |
| `renderInlineEntityFields(table, record, recordId, exclude)` | `src/utils/inline-editable-field.ts:240` | Renders every field of one record as click-to-edit rows. Used by the stop, agency, pathway, route, and feed_info views. |
| `generateFieldConfigsFromSchema` | `src/utils/field-component.ts:325` | Walks the Zod shape to build the field configs the above renders. The place extension fields have to be appended. |
| `fieldSpecs(tableName)` / `columnFields(config)` | `src/modules/editable-table.ts:223,232` | Column source for the grid. Throws on an unknown table; individual field lookups at `:426,:580,:762,:1332` will return `undefined` for an extension field, so they need a synthetic spec. |
| `validateTransferRow` | `src/utils/fares-rules.ts:76`, used by `gtfs-validator.ts` | Already exported, and already encodes the conditional presence rules for transfers. Reuse as `EditableTableConfig.validateRow`. |
| `trip-highlight` / `stops-highlight` sources | `src/modules/layer-manager.ts:1084,1111` | The ephemeral "geometry for the currently focused thing" pattern that transfer edges should copy. |
| `focusStop` / `clearFocus` | `src/modules/map-controller.ts:1463` and the deps interface in `browse-navigation.ts` | The hooks that decide when transfer edges appear. |
| `passthroughFiles` map + `savePassthroughFiles` | `src/modules/gtfs-parser.ts:68,874,1352`, `src/modules/gtfs-database.ts:657` | Non-spec files: read on import, stored in the `passthrough_files` object store, restored on reload, appended verbatim on export. |
| `generateCSVFromRows` | `src/modules/gtfs-parser.ts:485` | Export headers are the union of keys across all rows, which is why extension columns already round-trip. |
| `processParsedData` | `src/workers/gtfs-parser.worker.ts:104` | Import keeps every parsed column; nothing filters against the schema. The other half of why extension columns already round-trip. |

### Invariants to preserve

- Every user edit goes through `patchManager.record*()`. `editable-table.ts`
  already does this, so anything built on it is compliant for free.
- Copy-on-read: query results are shallow copies. Do not hold a row reference
  across a write.
- Stop labels go through `getStopDisplay()`.
- `renderSpecDescription` / `renderSpecDescriptionPlain` for any spec
  description shown to the user.

---

## Phase 1: File categorization, and non-spec files made visible and editable

Independent of everything else and small, so it goes first. Two fixes: the
"Other Files" bucket is wrong, and non-spec files are invisible. Both live in the
Files modal, and the second is what the "Other Files" section was supposed to be
for in the first place.

The important design decision here: a non-spec file has no schema, so it is
edited as raw text, and edits to it **do not go through the patch system**.
There is no table, no primary key, and no `record*()` call that could describe
the change. This is a real exception to the patch invariant, so it is confined
to this one file kind, documented in code, and logged.

- [x] In `categorizeFiles()` (`src/modules/gtfs-parser.ts:1190`), replace the
      `optionalFiles` membership test with an inverted one: a file is
      `required` if its `GTFS_FILES` presence is `Required`, otherwise
      `optional` if it appears in `ALL_GTFS_FILES` at all. Delete the
      `optionalFiles` array. This puts `networks.txt` and `route_networks.txt`
      in Optional Files.
- [x] Change the return type's third key from `other` to `additional`, and
      populate it from a new parser method rather than from `gtfsData`.
- [x] Add `getPassthroughFileNames(): string[]` and
      `getPassthroughContent(fileName: string): string | undefined` to
      `GTFSParser`, both reading `this.passthroughFiles`.
- [x] Add `setPassthroughContent(fileName: string, rawContent: string):
      Promise<void>` to `GTFSParser`: update the in-memory map, call
      `this.gtfsDatabase.savePassthroughFiles({ [fileName]: rawContent })`, and
      `console.log('[GTFSParser] passthrough file edited (not patched):',
      fileName)`.
- [x] In `updateFileList()` (`src/modules/ui.ts:396`), rename the third section
      header from `'Other Files'` to `'Additional Files'` and source it from
      `additional`. Keep the "only render when non-empty" guard.
- [x] In `addFileItem`, the record-count badge comes from `getFileDataSync`,
      which returns `[]` for a passthrough file. Show a line count badge for
      additional files instead, or no badge. Do not show `0`.
- [x] In `Editor.openFile` (`src/modules/editor.ts:66`), branch on
      `gtfsParser.getPassthroughContent(fileName) !== undefined`: render the raw
      content in a plain textarea rather than the parsed table view, with a save
      that calls `setPassthroughContent`.
- [x] Add a short note above the passthrough editor: this file is not part of
      the GTFS spec, it is preserved verbatim on export, and edits to it are not
      undoable.
- [x] Add a bullet to `CLAUDE.md` under Development Philosophy recording the
      passthrough exception to the patch invariant.

**Discoveries**

- There is no CodeMirror in the project despite what `CLAUDE.md` says: `editor.ts`
  is a Clusterize grid and CodeMirror is not a dependency. The raw editor is a
  plain `<textarea>` in a new `#raw-editor-view` pane in `src/index.html`, shown
  and hidden opposite `#table-editor-view`. Saving is an explicit Save button,
  not debounced autosave, because the write is unpatched and therefore
  unrecoverable.
- The `other` bucket really was only ever `networks.txt` / `route_networks.txt`,
  as predicted. `categorizeFiles` had exactly one caller (`ui.ts:402`), so the
  rename to `additional` was contained.
- Export needed no change: `exportAsZip` iterates the in-memory
  `passthroughFiles` map, which `setPassthroughContent` updates before it writes
  to IDB. The reload path (`restoreFromDatabase`) repopulates the map from the
  `passthrough_files` store, so an edit survives a refresh.
- The save handler is attached by cloning and replacing the Save button on every
  open, so the previous file's closure cannot fire against the new file.

**Gotchas**

- `getAllFileNames()` must keep returning only spec files. Several callers
  (`openFile`'s guard at `src/modules/ui.ts:483`, the export path) assume every
  name it returns has a table. Passthrough names need their own guard in
  `openFile`.
- Export already appends passthrough files verbatim
  (`src/modules/gtfs-parser.ts:1352`) from the in-memory map, so an edit that
  updates the map is exported correctly with no export change needed. Verify
  this rather than assuming it.
- `resetInMemoryFeedState` clears `passthroughFiles` (`:740`). Confirm the
  reload path at `:705` still restores from IDB after the change.

---

## Phase 2: The Feed Data modal (transfers, attributions, translations)

The bulk of the work, and the thing everything else in this plan builds on. One
new modal, modelled directly on `fares-modal.ts`, with three sidebar entries.
This alone closes all three "no UI" gaps; phases 3 and 4 are refinements on top.

Sequenced before the stop-page and home-page integrations because those want a
"Manage all transfers" / "Manage all attributions" escape hatch to link to.

- [ ] Create `src/modules/feed-data-modal.ts` exporting
      `showFeedDataModal(deps: EditableTableDeps): Promise<void>`. Copy the
      structure of `showFaresModal` (`src/modules/fares-modal.ts:560`): a
      module-level `FEED_DATA_ENTRIES` array, `INSTANCE_ID`, `readCounts`,
      `refresh`, sidebar click handling, `installEditableTableHandlers` before
      `showModal` and `uninstallEditableTableHandlers` after.
- [ ] Entry 1, `transfers.txt`. Set `validateRow` to the existing
      `validateTransferRow` from `src/utils/fares-rules.ts`, so the modal and
      the validator share one copy of the rules. Column overrides:
      `widthClass` on `from_stop_id` / `to_stop_id`; the FK pickers for stops,
      routes, and trips come from the spec's `foreignKey` with no override.
- [ ] Entry 2, `attributions.txt`. `validateRow` enforcing "at most one of
      `agency_id` / `route_id` / `trip_id` is set" and "at least one of
      `is_producer` / `is_operator` / `is_authority` is 1". `widthClass` on
      `organization_name`.
- [ ] Entry 3, `translations.txt`. Column overrides: `table_name` gets
      `options` listing the spec's allowed enum values; `field_name` gets
      `suggestions` computed from the spec fields of the row's current
      `table_name` filtered to `Text` / `URL` / `Email` / `Phone number` types;
      `record_id` gets `suggestions` from the primary keys of that table.
      `validateRow` enforcing the mutual exclusion of `field_value` against
      `record_id` / `record_sub_id`, the `feed_info` forbiddance, and the
      `stop_times` + `record_id` requires `record_sub_id` rule.
- [ ] Add a `<button id="feed-data-btn">` to the navbar in
      `src/index.html`, next to `fares-btn` (`:116`) and `on-demand-btn`
      (`:143`), following their markup and tooltip pattern.
- [ ] Wire it in `src/index.ts` alongside the `fares-btn` handler (`:341`),
      passing `{ gtfsDatabase, patchManager }`.
- [ ] Give each entry a `note` line and a link to the relevant
      `gtfs.org/documentation/schedule/reference/#...` anchor, as the fares
      modal does.

**Gotchas**

- All three tables have composite or absent primary keys.
  `transfers.txt` keys on six fields, `translations.txt` on six,
  `attributions.txt` on an *optional* `attribution_id`. Check what
  `GTFS_PRIMARY_KEYS` and `generateCompositeKeyFromRecord` produce for each
  before writing any config, and confirm `isKeyField`
  (`src/modules/editable-table.ts:250`) does the right thing: editing a key
  field re-keys the row, which the table handles as delete plus insert. This is
  the same hazard the `frequencies` invariant in `CLAUDE.md` documents.
- `attributions.txt` with an empty `attribution_id` is legal and means every row
  keys identically. Decide the row key explicitly (a `config.primaryKey`
  returning the row index, or synthesising an id) rather than letting the
  composite key collapse rows together.
- `translations.txt` `field_name` suggestions depend on another cell in the same
  row. `suggestions` is a `() => Promise<string[]>` with no row argument, so
  either widen that signature or fall back to suggesting the union of
  translatable field names across all tables. Prefer the fallback: it is
  simpler, and a wrong suggestion is not a wrong value.
- Do not let the translations editor try to resolve `record_id` as a real
  foreign key. Its target table varies per row, and a dangling-reference error
  on a legal row would be a false alarm.

---

## Phase 3: Transfers on the stop page and on the map

The integration that makes transfers feel like part of the feed rather than a
table. Sequenced after phase 2 so both the editing surface and the
"Manage all transfers" link already exist.

Map rendering is scoped to the focused stop deliberately. A feed-wide layer
would need a toggle, a legend, and a plan for feeds with tens of thousands of
transfers, none of which buys anything over drawing the edges of the stop the
user is looking at.

- [ ] In `src/modules/stop-view-controller.ts`, add
      `renderTransfersSection(stop_id)` returning a card listing every transfer
      where `from_stop_id` or `to_stop_id` equals this stop. Render it as a
      `renderEditableTable` instance scoped to those rows, with a
      `Manage all transfers` button opening the Feed Data modal on the
      transfers entry.
- [ ] Slot the section into `renderStopView`'s template
      (`src/modules/stop-view-controller.ts:154`), after the pathway sections
      and before Timetables. Show it for both stops and stations, since a
      station-level transfer applies to all child stops.
- [ ] Label the other end of each transfer with `getStopDisplay` +
      `renderOptionLabel`, never an inline format.
- [ ] In `src/modules/layer-manager.ts`, add a `transfer-edges` GeoJSON source
      and a line layer, following the `trip-highlight` pattern (`:1084`).
      Style by `transfer_type`: dashed for `0`, solid for `1` and `2`, and a
      distinct error colour for `3` (transfer not possible).
- [ ] Add `showTransferEdges(stop_id)` / `clearTransferEdges()` to the layer
      manager, building a `LineString` per transfer between the two stops'
      coordinates.
- [ ] Call them from `MapController.focusStop` (`:1463`) and `clearFocus`.
- [ ] For a transfer whose endpoint is a station, draw to the station's
      coordinates, not to every child. For an endpoint with no usable
      coordinates, skip the edge and `console.warn` with the transfer's
      endpoints. Do not silently drop it.

**Gotchas**

- `transfer_type` 4 and 5 are trip-to-trip and may have no
  `from_stop_id` / `to_stop_id` at all. They must not appear on a stop page
  section keyed by stop, and they have no geometry. Filter them out of both, and
  make sure the stop-page section says so rather than looking empty by accident.
- A transfer between two stops at the same coordinates renders as a zero-length
  line, which MapLibre draws as nothing. Detect it and draw a marker or skip it,
  but decide deliberately.
- Dangling `from_stop_id` / `to_stop_id` are the user's data problem to see, not
  ours to work around: surface them the way `isDanglingReference` /
  `formatIssueValue` already do in the table, and warn in the console when the
  map cannot place an edge.

---

## Phase 4: Attributions on the home page

Small, and last of the three-file features because it is the least load-bearing.
Attributions are feed metadata, so they belong next to Feed Information rather
than behind a modal only.

- [ ] In `src/modules/page-content-renderer.ts`, add
      `renderAttributionsSection()` after `renderFeedInfoProperties`
      (`:579`), reading all `attributions` rows.
- [ ] Render each row as a compact card: `organization_name`, the roles as
      badges, the scope (dataset-wide, or the agency / route / trip it names,
      labelled via the `entity-display` helpers), and the URL / email / phone as
      links.
- [ ] Add a `Manage attributions` button opening the Feed Data modal on the
      attributions entry. Do not duplicate the editing UI here.
- [ ] Slot the section into `renderHome`'s template, between
      `renderFeedInfoProperties` and the `renderIssueCard('Feed issues', ...)`
      call (`src/modules/page-content-renderer.ts:480`).
- [ ] Render nothing at all when there are no attributions. An empty card on
      every feed's home page is noise.

**Gotchas**

- `renderHome` is a template-literal builder with no escaping of its own.
  `organization_name` and the URL fields are user data: escape them.

---

## Phase 5: Extension columns

Independent of phases 1 to 4, and last because it touches the two shared field
renderers that every entity page and every grid in the app goes through.

The key realisation is that extension columns already survive the round-trip:
`processParsedData` (`src/workers/gtfs-parser.worker.ts:104`) keeps every parsed
column, and `generateCSVFromRows` (`src/modules/gtfs-parser.ts:485`) writes the
union of keys across all rows. The data is there. Only the UI derives its
columns from the spec and therefore cannot see it. So this phase is about
deriving one more list, not about a new storage path.

- [ ] Create `src/utils/extension-fields.ts` exporting
      `extensionFields(tableName: string, rows: Record<string, unknown>[]):
      string[]`: the union of keys across `rows`, minus the keys in
      `GTFS_FIELD_SPECS[tableName]`, ordered by first appearance.
- [ ] Export `extensionFieldSpec(field: string): GTFSFieldSpec` from the same
      file: a synthetic spec with `type: 'Text'`, `presence: 'Optional'`, and a
      description saying the field is not part of the GTFS spec and is preserved
      as-is on export.
- [ ] In `editable-table.ts`, make `columnFields()` (`:232`) append
      `extensionFields(...)` after the spec fields, and make `fieldSpecs()`
      lookups at `:426`, `:580`, `:762`, `:1332` fall back to
      `extensionFieldSpec` when the field is not in the spec. Mark extension
      column headers visually (a muted badge or an italic header) so they are
      not mistaken for spec fields.
- [ ] In `renderInlineEntityFields` (`src/utils/inline-editable-field.ts:240`),
      append a config per extension key present on the record, with
      `kind: 'text'`, after the schema-derived configs and under a small
      "Additional fields" divider.
- [ ] Add an `Add field` control to the editable table header. It prompts for a
      column name, validates it against the existing spec and extension names,
      and records it.
- [ ] Persist user-added column names per table in the `meta` store under
      `extensionColumns`, and union that list into `extensionFields`. Without
      this, a newly added column has no values in any row, so the data-derived
      list would not contain it and it would vanish on the next render.
- [ ] Confirm the validator does not report an extension column as an error.
      If it does, downgrade it to an info-level notice naming the field.
- [ ] Add a `CLAUDE.md` bullet: extension fields are derived from row data via
      `extensionFields`, never hardcoded, and both shared field renderers append
      them after the spec fields.

**Gotchas**

- `extensionFields` runs over every row of a table. For `stop_times.txt` that is
  the hot path. Compute it once per render and pass it down; do not call it per
  row or per cell.
- An extension column that exists only in the `meta` store and has no values in
  any row will not appear in the export, because the export unions row keys. Say
  so in the `Add field` UI, or seed the key with `''` on every row when the
  column is created. Prefer saying so: seeding rewrites every row of a table to
  add an empty column, which is a large patch for no data.
- Do not add extension fields to the Zod schemas. The schemas are derived from
  `src/gtfs-spec/` and `pnpm check-spec` will block a commit that diverges.
- `locations.geojson` is not a CSV table and has no field specs. Guard it out of
  all of the above rather than letting `extensionFields` produce nonsense from
  a GeoJSON feature collection.
- Reserved-ish names: a user could add a column named exactly like a spec field
  of a *different* table, which is fine, or one colliding with an internal key.
  Validate the name against the current table's spec fields and reject a
  duplicate loudly.

---

## Explicitly out of scope

- **Applying translations to displayed labels.** Needs a display-language
  selector, a translation lookup with `record_id`-over-`field_value`
  precedence, and a re-render path on language change, all funnelled through
  `src/utils/entity-display.ts`. Its own plan.
- **A feed-wide transfers map layer.** Focused-stop edges only.
- **Editing `locations.geojson` extension properties.** Phase 5 covers CSV
  tables only.
- **Undo for non-spec file edits.** Documented as a limitation in phase 1.
