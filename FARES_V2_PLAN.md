# Fares v2 Completion Plan

Bring GTFS Fares v2 to full coverage, and in the process make `src/gtfs-spec/` a
verbatim, machine-checked copy of the official GTFS reference. After this work the
only unsupported parts of the spec are **flex service** (`locations.geojson`,
`location_groups.txt`, `location_group_stops.txt`, `booking_rules.txt`) and
`frequencies.txt`.

Reference snapshot: `reference/gtfs-reference.md`, downloaded from
`https://raw.githubusercontent.com/google/transit/master/gtfs/spec/en/reference.md`,
revised **April 27, 2026**. This file is the single source of truth for every
description string, field name, type, and presence value in `src/gtfs-spec/`.

---

## HOW TO USE THIS PLAN

**Each phase is executed by a fresh session with no memory of previous phases.**
Read this entire file before doing anything.

1. Find the lowest-numbered phase whose checklist is not fully ticked. That is
   your phase. **Do only that phase.**
2. Implement every unticked item in that phase.
3. Tick each box in this file as you complete it.
4. Append to that phase's **Discoveries** subsection: anything surprising, any
   decision you had to make, any assumption a later phase depends on. Future
   sessions read this instead of re-deriving it.
5. **Stop.** Do not start the next phase. The user tests manually between phases.

### Commit policy

1. **One logical step = one commit.** Run the gate, then commit immediately.
2. **The gate before every commit**, all passing:
   ```bash
   pnpm typecheck && pnpm lint && pnpm knip && pnpm check-spec && pnpm build
   ```
   (`pnpm check-spec` also runs from `.husky/pre-commit` as of Phase 2.)
3. **Stage explicitly, never `git add -A`.** The user works concurrently in this tree.
4. **Plain `git commit`.** No `--no-verify`, no hook overrides.
5. **Conventional Commits**: `feat(fares):`, `fix(spec):`, `refactor(ui):`.
   Never a `Co-Authored-By: Claude` trailer.
6. **Never run `pnpm test`.** Manual browser testing only.
7. **No emoji, no em-dashes**, in code, comments, commit messages, or UI copy.
   ASCII arrows (`->`) and ellipses (`...`).
8. Work on branch `feat/fares-v2`. Create it from `main` if it does not exist.
9. Commit this file's updates along with the phase's code.

### Decisions already taken (do not relitigate)

| Decision | Choice |
|---|---|
| Spec source of truth | Hand-written TS in `src/gtfs-spec/files/`, with **verbatim** descriptions and **verbatim** type strings, enforced by `scripts/check-spec.ts` against `reference/gtfs-reference.md`. Curated extras (enum short labels, `foreignKey`, `isPrimaryKey`, `presenceCondition`, `allowEmpty`) stay hand-written. |
| Description rendering | Store the reference string **verbatim**. A sanitizing renderer converts `<br>`, `` `code` ``, `[links]`, and `<table>` to safe HTML for tooltips. The two SVG diagrams referenced by `fare_transfer_type` are vendored into `src/assets/`. |
| Networks representation | Canonical in-DB form is always `networks.txt` + `route_networks.txt`. The form the feed **arrived** in is remembered in the `meta` store and reused on export unless a network gains a name. |
| Cell editing | Extract a shared spec-driven click-to-edit table component from the timetable pattern **first**, then migrate everything onto it. |
| Modal layout | Left sidebar list grouped into Definitions / Rules / Geography, content pane on the right, row counts next to each entry. |
| Fares v1 | Out of scope. `fare_attributes.txt` / `fare_rules.txt` stay file-viewer only. |
| Areas on stops | Platforms show areas inherited from their parent station as greyed "from `<station>`" chips; adding an explicit area writes a `stop_areas` row for the platform and supersedes the inherited set. |
| Spec gate | `pnpm check-spec` joins the commit gate. |
| Click-to-edit scope | Not just fares. **All** entity property inputs (route, stop, agency, pathway, trip) migrate to click-to-edit for uniformity and accessibility. |

---

## RELEVANT CONTEXT

### Spec layer

| File | Role |
|---|---|
| `src/gtfs-spec/types.ts` | `GTFSFieldSpec`, `GTFSFileSpec`, `GTFSPresence`, `GTFSEnumValue` |
| `src/gtfs-spec/files/*.ts` | 33 hand-written file specs |
| `src/gtfs-spec/index.ts` | `gtfsSpec` aggregate, `specVersion: '2026-04'` |
| `src/gtfs-spec/adapter.ts` | Derives Zod schemas, primary keys, enum registry, field-type strings, `GTFSFileInfo[]` from the spec |
| `src/types/gtfs.ts` | `GTFS_TABLES`, `GTFSSchemas`, `GTFS_FILES`; consumes the adapter |
| `src/types/gtfs-field-types.ts` | `GTFSFieldType` enum + `GTFS_FIELD_TYPE_METADATA` (type string -> Zod validator) |
| `src/utils/gtfs-primary-keys.ts` | Composite key definitions (hand-written, lines ~118-155 cover fares tables) |

The adapter is the only consumer of the spec shape, so adding fields to
`GTFSFieldSpec` is cheap. Zod schemas, and therefore validation, flow
automatically from spec changes.

### UI layer

| File | Role |
|---|---|
| `src/modules/fares-modal.ts` | 804 lines. 3 tabs, read-only tables, second modal for add/edit. To be rebuilt. |
| `src/modules/schedule-controller.ts` | The click-to-edit reference implementation. `installTimetablePickers` (~line 205), `openTimeEditor` (~255), `openTripPropEditor` (~388), `openTripPropEnumMenu` (~440), `openStopPicker` (~325) |
| `src/modules/timetable-renderer.ts` | Emits `.time-span` / `.trip-prop-span` with `data-field-kind` |
| `src/modules/option-picker-modal.ts` | `showOptionPickerModal` - searchable uFuzzy picker for large option sets |
| `src/modules/modal-utils.ts` | `showModal`, `renderTrashIcon` |
| `src/utils/field-component.ts` | `FieldConfig`, `generateFieldConfigsFromSchema`, `renderFormField(s)`, `renderEntityFields`, `buildFieldTooltipContent`, `getSpecUrl` |
| `src/utils/form-patch-bridge.ts` | Wires always-live form inputs to patches. Superseded by click-to-edit in Phase 5. |
| `src/modules/page-content-renderer.ts` | Route/trip detail pages (`renderFormFields` ~497, `renderEntityFormFields` ~557) |
| `src/modules/stop-view-controller.ts` | Stop page (`renderEntityFields` ~195) |
| `src/modules/agency-view-controller.ts` | Agency page (~87) |
| `src/modules/pathway-view-controller.ts` | Pathway page (~46) |

**The click-to-edit contract** (mirror it exactly): a display `<span>` carrying
`data-*` attributes; a single delegated `click` listener bound to `document`
(not to the container, whose `innerHTML` is replaced wholesale by several call
sites); on click the span is `replaceWith`-ed by an `<input class="editor-input-live">`;
a module-wide `document.querySelector('.editor-input-live')` guard ensures at
most one live editor; `blur` commits, `Enter` blurs, `Escape` cancels; a `settled`
flag prevents double-commit. Enums use a lightweight inline menu; large ID sets
use `showOptionPickerModal`.

### Data layer

| File | Role |
|---|---|
| `src/modules/gtfs-database.ts` | IndexedDB. Stores: `patches`, `snapshots`, `meta` (keyPath `key`), `file_blobs`, `passthrough_files`, plus one store per table. `exportCurrentBlobsAsZip` ~line 400. |
| `src/modules/gtfs-parser.ts` | Import + export. `generateCSVFromRows` ~line 453 (column order = insertion order of the union of row keys). Export ~line 1055. |
| `src/modules/patch-manager.ts` | Append-only patch log. **Every user edit must record a patch.** |
| `src/modules/gtfs-validator.ts` | Validation surface for the conditional-presence rules |
| `src/modules/notification-system.ts` | Where the "ignoring routes.network_id" warning goes |

### Known drift already found (illustrative, not exhaustive - Phase 1 produces the full list)

- `rider_categories.txt`: our spec has `is_default_fare_container`; the reference
  says **`is_default_fare_category`**. Our spec also has `min_age` / `max_age`,
  which are **not in the reference**. `fares-modal.ts` reads the wrong name today.
- `fare_leg_join_rules.txt`: our spec's fields (`from_leg_group_id`,
  `to_leg_group_id`, `duration_limit`, `fare_transfer_rule_id`) are **entirely
  wrong**. The reference defines `from_network_id`, `to_network_id`,
  `from_stop_id`, `to_stop_id`.
- `agency.txt` and `routes.txt`: missing `cemv_support`.
- `trips.txt`: missing `cars_allowed`, `safe_duration_factor`, `safe_duration_offset`.
- `transfers.txt`: `from_stop_id` / `to_stop_id` presence must become
  Conditionally Required, "Required if `transfer_type` is empty, `0`, `1`, `2`, or `3`".
- Every description string in every file is paraphrased rather than verbatim.

---

## PHASE 1 - Spec conformance harness

Build the checker before changing any spec content, so Phase 2 has a definitive
worklist instead of a hand audit. The checker parses `reference/gtfs-reference.md`
and diffs it against the in-code `gtfsSpec`. This phase must **not** fix any
drift; it only reports it. Landing the checker red-but-informative first keeps the
diff reviewable.

The reference format is regular: each file is a `### <filename>` section,
followed by prose, followed by a table with a
`| Field Name | Type | Presence | Description |` header. Field names are
backticked in column 1. Presence is bolded for anything other than `Optional`.
Types are literal strings, sometimes compound
(`Foreign ID referencing \`routes.network_id\` or \`networks.network_id\``).

- [x] Create `scripts/check-spec.ts`. Parse `reference/gtfs-reference.md` into
      `Map<filename, { description: string; fields: Map<name, {type, presence, description}> }>`.
      Extract the file description as the prose between the `### x.txt` heading
      and the field table, excluding the `File: **Optional**` and
      `Primary key (...)` lines.
- [x] Normalize before comparing: strip backticks used purely as markup, collapse
      runs of whitespace, normalize `<br>` / `<br/>` / `<br />`, normalize curly
      quotes (the reference uses `’` and `“ ”` in several places, notably
      `timeframes.txt` and `fare_leg_rules.txt`) and non-breaking spaces. Keep the
      normalizer in one exported function so Phase 2 can reuse it.
- [x] Parse presence: `**Required**` -> `Required`, `**Conditionally Required**` ->
      `Conditionally Required`, `**Conditionally Forbidden**` ->
      `Conditionally Forbidden`, `**Recommended**` -> `Recommended`, `Optional` ->
      `Optional`. Handle the reference's inconsistent bolding of `Optional`.
- [x] Diff against `gtfsSpec` and report, grouped by file:
      missing files, extra files, missing fields, extra fields, field order
      mismatch, type mismatch, presence mismatch, description mismatch (with a
      unified diff of the two normalized strings).
- [x] Allow an explicit, small `KNOWN_DIVERGENCES` list in the script for cases we
      deliberately differ on. It must start **empty**; Phase 2 adds entries only
      with a comment naming the reason. `locations.geojson` has no field table and
      is the one expected structural exception - handle it by filename, not by
      divergence entry.
- [x] Exit non-zero on any unexplained difference. Print a summary count.
- [x] Add `"check-spec": "tsx scripts/check-spec.ts"` to `package.json` scripts
      and include it in the `check` script.
- [x] Do **not** add it to the pre-commit gate yet (it will fail). Add a `TODO` in
      the script's header noting Phase 2 wires it in.
- [x] Commit. Then run it and paste the full report into the Discoveries section
      below, so Phase 2 can work from it directly.

**Gotchas**: `fare_transfer_type`'s description contains a literal `<table>` and
two `![](examples/*.svg)` images; the parser must not choke on pipes inside HTML
tables. Row-splitting on `|` needs to respect that. `shape_dist_traveled` contains
an `<img>` tag and an `<hr>`.

### Discoveries

Branch `feat/fares-v2` did not exist; it was created from `main` at `4e600fa`.

**How to run**

```bash
pnpm check-spec                        # everything
pnpm check-spec agency.txt routes.txt  # restrict to named files
pnpm check-spec --full                 # also print the raw reference strings
```

`--full` prints the unnormalized reference text, which is what Phase 2 must paste
into the spec files. Without it the report shows only normalized word diffs.

**Decisions taken while building the checker**

1. *File descriptions have two sources.* Most `### x.txt` sections have no prose
   at all between the heading and the field table (`agency.txt`, `stops.txt`,
   `routes.txt`, ...); their one-line purpose statement lives in the `## Dataset
   Files` summary table. The plan's rule (prose only) would therefore have marked
   every such file as "expected empty description", which is useless. The checker
   parses **both** the summary-table description and the section prose, and
   accepts our description if it matches **either**. Mismatches print a diff
   against each candidate. Phase 2 should prefer the section prose where it
   exists (it is the richer text, and Phase 9 wants it for empty states) and the
   summary-table sentence otherwise.
2. *Foreign key types are reassembled, not compared literally.* The reference
   writes ``Foreign ID referencing `stops.stop_id` ``; our spec splits this into
   `type: 'Foreign ID'` plus a structured `foreignKey`, which is what
   `deriveGTFSFieldTypes` and the pickers consume. The checker rebuilds the
   reference string from `type` + `foreignKey` (dropping the `.txt`) before
   comparing, so a correct `foreignKey` is not reported as drift. The 5 remaining
   `type` reports on foreign IDs are genuine: the reference names **two** target
   tables and `GTFSFieldSpec.foreignKey` holds only one. Phase 2 must decide
   whether to widen `foreignKey` to an array or add a `KNOWN_DIVERGENCES` entry.
   Widening is preferable, since Phase 7 and 9 pickers need to know that
   `fare_leg_rules.network_id` may reference either table.
3. *`presenceCondition` is not checked.* The reference keeps conditional text
   inside the description column, so once descriptions are verbatim the condition
   text is already covered. `presenceCondition` stays a curated convenience field.
4. *Row splitting.* Pipes never occur in the first three columns, so the checker
   splits on `|` and folds any surplus cells back into the description. The
   embedded `<table>` in `fare_transfer_type` contains no pipes, so it survives
   intact; verified by inspecting that row's diff.
5. *Report volume.* 157 description mismatches at full text would be roughly 800
   lines of duplicated reference prose. Pasted below is the complete report for
   every non-description aspect verbatim, plus the per-file index of which fields
   have description drift. The word-level diffs are one `pnpm check-spec <file>`
   away and Phase 2 has to re-run the checker regardless, since its exit
   condition is "this exits zero".

**Summary counts (2026-04-27 reference vs `specVersion: '2026-04'`)**

```
Parsed 32 files from the reference, 32 from gtfsSpec.
Skipped by filename: locations.geojson (no CSV field table).

description: 157
extra-field: 8
file-description: 24
missing-field: 10
presence: 10
type: 12
files with drift: 31
total differences: 221
```

No `missing-file`, `extra-file`, `file-presence`, or `field-order` differences:
the file set, the file-level presence values, and the field ordering within every
file already match the reference. `frequencies.txt` and `booking_rules.txt` are
in the spec layer even though the app does not edit them.

**Full non-description report**

```
=== agency.txt ===
  [missing-field] cemv_support: missing field (Enum, Optional)

=== routes.txt ===
  [missing-field] cemv_support: missing field (Enum, Optional)
  [presence] continuous_pickup: reference "Conditionally Forbidden", spec "Optional"
  [presence] continuous_drop_off: reference "Conditionally Forbidden", spec "Optional"

=== trips.txt ===
  [missing-field] cars_allowed: missing field (Enum, Optional)
  [missing-field] safe_duration_factor: missing field (Float, Optional)
  [missing-field] safe_duration_offset: missing field (Float, Optional)
  [type] service_id: reference "Foreign ID referencing `calendar.service_id` or `calendar_dates.service_id`", spec "Foreign ID referencing calendar.service_id"

=== stop_times.txt ===
  [type] location_id: reference "Foreign ID referencing `id` from `locations.geojson`", spec "Foreign ID referencing locations.geojson.id"
  [presence] pickup_type: reference "Conditionally Forbidden", spec "Conditionally Required"
  [presence] drop_off_type: reference "Conditionally Forbidden", spec "Conditionally Required"
  [type] shape_dist_traveled: reference "Non-negative float", spec "Float"

=== calendar_dates.txt ===
  [type] service_id: reference "Foreign ID referencing `calendar.service_id` or ID", spec "Foreign ID referencing calendar.service_id"

=== timeframes.txt ===
  [type] start_time: reference "Local time", spec "Time"
  [type] end_time: reference "Local time", spec "Time"
  [type] service_id: reference "Foreign ID referencing `calendar.service_id` or `calendar_dates.service_id`", spec "Foreign ID referencing calendar.service_id"

=== rider_categories.txt ===
  [missing-field] is_default_fare_category: missing field (Enum, Required)
  [extra-field] is_default_fare_container: field is not in the reference
  [extra-field] min_age: field is not in the reference
  [extra-field] max_age: field is not in the reference

=== fare_leg_rules.txt ===
  [type] network_id: reference "Foreign ID referencing `routes.network_id` or `networks.network_id`", spec "Foreign ID referencing networks.network_id"

=== fare_leg_join_rules.txt ===
  [missing-field] from_network_id: missing field (Foreign ID referencing `routes.network_id` or `networks.network_id`, Required)
  [missing-field] to_network_id: missing field (Foreign ID referencing `routes.network_id` or `networks.network_id`, Required)
  [missing-field] from_stop_id: missing field (Foreign ID referencing `stops.stop_id`, Conditionally Required)
  [missing-field] to_stop_id: missing field (Foreign ID referencing `stops.stop_id`, Conditionally Required)
  [extra-field] from_leg_group_id: field is not in the reference
  [extra-field] to_leg_group_id: field is not in the reference
  [extra-field] duration_limit: field is not in the reference
  [extra-field] fare_transfer_rule_id: field is not in the reference

=== fare_transfer_rules.txt ===
  [extra-field] fare_transfer_rule_id: field is not in the reference
  [presence] from_leg_group_id: reference "Optional", spec "Required"
  [presence] to_leg_group_id: reference "Optional", spec "Required"
  [type] transfer_count: reference "Non-zero integer", spec "Non-negative integer"
  [presence] transfer_count: reference "Conditionally Forbidden", spec "Optional"
  [type] duration_limit: reference "Positive integer", spec "Non-negative integer"
  [presence] duration_limit: reference "Optional", spec "Conditionally Required"
  [presence] fare_product_id: reference "Optional", spec "Required"

=== pathways.txt ===
  [presence] reversed_signposted_as: reference "Optional", spec "Conditionally Required"

=== translations.txt ===
  [type] translation: reference "Text or URL or Email or Phone number", spec "Text or URL or Email"
  [type] field_value: reference "Text or URL or Email or Phone number", spec "Text or URL or Email"
```

**Description drift index** (`(file)` = the file-level description also differs)

```
agency.txt: agency_id agency_fare_url
areas.txt: (file) area_id
attributions.txt: (file) agency_id route_id trip_id is_producer is_operator is_authority
booking_rules.txt: (file) booking_type prior_notice_duration_min prior_notice_duration_max
  prior_notice_last_day prior_notice_last_time prior_notice_start_day prior_notice_start_time
  prior_notice_service_id message
calendar.txt: (file) monday tuesday wednesday thursday friday
calendar_dates.txt: (file) service_id exception_type
fare_attributes.txt: (file) payment_method transfers agency_id transfer_duration
fare_leg_join_rules.txt: (file)
fare_leg_rules.txt: (file) leg_group_id network_id from_area_id to_area_id
  from_timeframe_group_id to_timeframe_group_id fare_product_id rule_priority
fare_media.txt: (file) fare_media_name fare_media_type
fare_products.txt: (file) fare_product_id fare_product_name rider_category_id amount
fare_rules.txt: (file) fare_id route_id origin_id destination_id contains_id
fare_transfer_rules.txt: (file) from_leg_group_id to_leg_group_id transfer_count
  duration_limit duration_limit_type fare_transfer_type fare_product_id
feed_info.txt: (file) feed_publisher_name feed_publisher_url feed_lang feed_start_date
  feed_end_date feed_contact_email feed_contact_url
frequencies.txt: exact_times
levels.txt: (file) level_index level_name
location_group_stops.txt: (file) location_group_id stop_id
location_groups.txt: (file) location_group_id location_group_name
networks.txt: (file) network_id network_name
pathways.txt: (file) pathway_id from_stop_id to_stop_id pathway_mode is_bidirectional
  length traversal_time stair_count max_slope min_width signposted_as reversed_signposted_as
rider_categories.txt: (file) rider_category_name eligibility_url
route_networks.txt: (file) network_id route_id
routes.txt: agency_id route_short_name route_long_name route_desc route_type route_url
  continuous_pickup continuous_drop_off network_id
shapes.txt: shape_pt_lat shape_pt_sequence shape_dist_traveled
stop_areas.txt: (file) area_id stop_id
stops.txt: (file) stop_id stop_code stop_name tts_stop_name stop_lat stop_lon stop_url
  location_type parent_station stop_timezone wheelchair_boarding platform_code stop_access
stop_times.txt: arrival_time departure_time stop_id location_group_id location_id
  stop_sequence stop_headsign start_pickup_drop_off_window end_pickup_drop_off_window
  pickup_type drop_off_type continuous_pickup continuous_drop_off shape_dist_traveled
  timepoint pickup_booking_rule_id drop_off_booking_rule_id
timeframes.txt: (file) timeframe_group_id start_time end_time service_id
transfers.txt: from_stop_id to_stop_id from_route_id to_route_id from_trip_id to_trip_id
  transfer_type
translations.txt: (file) table_name field_name language translation record_id record_sub_id
  field_value
trips.txt: service_id trip_headsign trip_short_name direction_id block_id shape_id
  wheelchair_accessible bikes_allowed
```

**Corrections to the plan's "Known drift" list**

- `transfers.from_stop_id` / `to_stop_id` are **already** `Conditionally Required`
  in our spec; only their description text differs. That Phase 2 checklist item
  is nearly a no-op.
- `rider_categories.eligibility_url` is already present. `rider_category_name` is
  already `Required`. `is_default_fare_category` is `Required` in the reference,
  not Optional as our `is_default_fare_container` has it.
- Beyond the fares tables, Phase 2 also has to deal with drift the plan did not
  anticipate: `stop_times.pickup_type` / `drop_off_type` and
  `routes.continuous_pickup` / `continuous_drop_off` became **Conditionally
  Forbidden** (flex windows), `timeframes.start_time` / `end_time` are now
  **Local time** rather than Time (which needs a `GTFSFieldType` entry), and
  `fare_transfer_rules` has 6 presence/type differences plus an invented
  `fare_transfer_rule_id` field.
- `fare_transfer_rules.fare_transfer_rule_id` and
  `fare_leg_join_rules.fare_transfer_rule_id` are ours, not the reference's.
  Check whether anything (fares modal, primary keys, patch code) depends on them
  before deleting.

---

## PHASE 2 - Make the spec verbatim and complete

Mechanical but high-volume: rewrite every description in `src/gtfs-spec/files/`
to the exact reference string, add missing fields and files, remove fields that
do not exist. This is where the April 2026 and February 2026 spec updates land.
Work file by file, committing in small groups, driven entirely by Phase 1's report.

Field **order** in each spec file must match the reference's table order, since
that order drives form layout and CSV column order for newly created files.

- [x] Rewrite descriptions verbatim for all 33 existing spec files.
- [x] `agency.txt`: add `cemv_support` (Enum, Optional) with enum values `0`/`1`/`2`.
- [x] `routes.txt`: add `cemv_support` (same shape). Verify `network_id` is present
      and its `Conditionally Forbidden` condition matches the reference.
- [x] `trips.txt`: add `cars_allowed` (Enum, Optional), `safe_duration_factor`
      (Float, Optional), `safe_duration_offset` (Float, Optional).
- [x] `transfers.txt`: change `from_stop_id` / `to_stop_id` to
      `Conditionally Required` with the exact February 2026 condition text.
- [x] `rider_categories.txt`: rename `is_default_fare_container` ->
      `is_default_fare_category`; delete `min_age` and `max_age`; add
      `eligibility_url` if absent; confirm `rider_category_name` is Required.
- [x] `fare_leg_join_rules.txt`: replace the field list wholesale with
      `from_network_id`, `to_network_id`, `from_stop_id`, `to_stop_id`, with the
      exact conditional-requirement text on the two stop fields.
- [x] `fare_transfer_rules.txt`: verbatim descriptions including the embedded
      `<table>` and both `![](examples/*.svg)` references. Keep our curated
      `enumValues` short labels (`A + AB`, etc.) as an addition, not a replacement.
- [x] `fare_leg_rules.txt`, `fare_products.txt`, `fare_media.txt`,
      `timeframes.txt`, `areas.txt`, `stop_areas.txt`, `networks.txt`,
      `route_networks.txt`: verbatim, and reconcile field lists.
- [x] Verify the "Currency amount" type description in
      `src/types/gtfs-field-types.ts` matches the reference's improved February
      2026 wording.
- [x] Update `specVersion` in `src/gtfs-spec/index.ts` to `'2026-04-27'`.
- [x] Update `src/utils/gtfs-primary-keys.ts` to match the reference's stated
      primary keys, especially `fare_leg_join_rules` (`from_network_id,
      to_network_id, from_stop_id, to_stop_id`) which is currently derived from the
      wrong field list, and `fare_leg_rules` (six-field composite).
- [x] Grep the app for every renamed/removed field and fix each use site.
      `is_default_fare_container` appears in `fares-modal.ts`; there may be others
      in `src/types/gtfs-entities.ts` and `src/types/gtfs.ts`.
- [x] Get `pnpm check-spec` to exit zero, then wire it into the pre-commit gate
      (`.husky/`, `lint-staged`, and the gate command in this file's Commit
      Policy).

**Gotchas**: `noUnusedLocals` is on, so removing fields may orphan helpers.
Renaming `is_default_fare_container` changes stored IndexedDB data shape; per the
project's no-backwards-compat policy, tell the user to Settings -> Reset rather
than writing a migration. Verbatim descriptions are long; they will make the spec
files much bigger, which is expected and fine.

### Discoveries

`pnpm check-spec` exits **zero**: 0 differences across all 32 CSV files, and
`KNOWN_DIVERGENCES` is still empty. It now runs from `.husky/pre-commit`
(after `lint-staged`), so drift blocks a commit.

**How the rewrite was actually done.** Hand-editing 157 descriptions was not
viable, so the spec files were regenerated by a throwaway script that parsed the
reference (importing `parseReference` from `check-spec.ts`) and re-emitted each
`src/gtfs-spec/files/*.ts` with reference name / type / presence / order plus the
curated extras carried over by `(filename, fieldName)`. The output is ordinary
hand-editable TS - the decision that these files are hand-written still holds -
but a future reference refresh will be far cheaper if it repeats the same trick.
Two things `check-spec.ts` gained to make that possible, both worth keeping:
`parseReference`, `ReferenceFile`, `ReferenceField` and `REFERENCE_PATH` are now
exported, and `main()` only runs when the script is the entry point.
`locations.geojson` has to be excluded by hand: the reference's nested-object
table parses as 10 pseudo-fields and will overwrite `locations-geojson.ts`.

**Type strings are now verbatim too, and `foreignKey` is an array.** This is the
resolution of Phase 1's open question about compound foreign IDs, and it changes
the shape later phases consume:

- `GTFSFieldSpec.type` holds the full reference string, backticks included:
  `` type: 'Foreign ID referencing `stops.stop_id`' ``, not `'Foreign ID'`.
  `deriveGTFSFieldTypes` is now a straight projection, and `check-spec`'s
  `expectedTypeString` reassembly is gone. `mapGTFSTypeString` still resolves
  these via its `startsWith('Foreign ID')` branch, so `GTFS_FIELD_TYPES`
  consumers are unaffected. Note the emitted string no longer contains `.txt`
  (`stops.stop_id`, not `stops.txt.stop_id`); nothing parsed that, but do not
  reintroduce a parser for it - use `foreignKey`.
- `foreignKey?: GTFSForeignKeyTarget[]` (was a single object). Every foreign-ID
  field has one, derived from the reference type string. Five fields carry two
  targets: `trips.service_id` and `timeframes.service_id`
  (`calendar` + `calendar_dates`), and `fare_leg_rules.network_id`,
  `fare_leg_join_rules.from_network_id` / `to_network_id`
  (`routes.network_id` + `networks.network_id`). Phase 7 makes the canonical
  `networks` table the one the pickers read; Phase 4's picker should treat the
  array as "union the option sets", not "pick the first".
- `calendar_dates.service_id` reads "referencing `calendar.service_id` **or ID**".
  The bare `ID` alternative names no table and is dropped, so its `foreignKey`
  has one entry.
- `stop_times.location_id` is "referencing `id` from `locations.geojson`", which
  yields `{ file: 'locations.geojson', field: 'id' }`.

**File-level descriptions.** Where the `### x.txt` section has prose, that prose
is used; otherwise the `## Dataset Files` summary sentence. Prose is joined with
`\n` rather than a space so the bullet lists in `fare_leg_join_rules.txt`,
`fare_leg_rules.txt` and `timeframes.txt` survive. Phase 3's
`renderSpecDescription` must therefore handle `\n` and leading `- ` bullets on
top of the markup subset the plan lists. The normalizer collapses whitespace, so
this does not affect the check.

**New `GTFSFieldType` members** (`src/types/gtfs-field-types.ts`):

- `LocalTime = 'Local time'` for `timeframes.start_time` / `end_time`. Same
  HH:MM:SS validator as `Time`; the difference is semantic (wall clock, and
  values above `24:00:00` are forbidden - Phase 9 enforces the cap).
- `NonZeroInteger = 'Non-zero integer'` for `fare_transfer_rules.transfer_count`.
  `mapGTFSTypeString` previously folded Non-zero into `PositiveInteger`, which
  would have rejected the spec-legal `-1` ("no limit").
- Both needed a `field-formatters.ts` entry, since `FIELD_FORMATTERS` is an
  exhaustive `Record<GTFSFieldType, FieldFormatter>`.
- `mapGTFSTypeString` also gained a `Text or ...` branch so
  `translations.translation` / `field_value` stop logging an unknown-type warning
  on every lookup.

**Primary keys.** `fare_leg_join_rules` and `fare_leg_rules` already matched, so
that checklist item was a no-op. Four others did not and were corrected:
`transfers` and `fare_transfer_rules` moved from `all_fields` to the reference's
explicit composites, `route_networks` from `all_fields` to natural `route_id`,
and `translations`' composite gained `record_id` / `record_sub_id` /
`field_value` in place of `translation`. **`attributions` is a deliberate
exception**: the reference names `attribution_id` as its primary key, but that
field is Optional and real feeds omit it, which would make
`generateCompositeKeyFromRecord` throw on import. It stays `all_fields`, with a
comment saying why. These key changes alter IndexedDB keying, so the user needs
Settings -> Reset before importing an old feed.

**Use sites.** Only `fares-modal.ts` referenced the renamed/removed fields
(`is_default_fare_container` -> `is_default_fare_category`, and the `min_age` /
`max_age` form rows are gone). `gtfs-entities.ts` types the fares tables as
generic `GTFSEntityRecord`, so nothing there needed touching. Phase 6 replaces
this modal anyway; the edit was the minimum to keep it correct.

**Left for later phases.** The `isPrimaryKey` flags inside the spec files were
carried over untouched and a few are questionable as "the" key
(`fare_leg_rules.leg_group_id`, `timeframes.timeframe_group_id` are not unique).
`deriveGTFSPrimaryKeys` reads them, `gtfs-primary-keys.ts` is the real authority,
and reconciling the two was out of Phase 2's scope. `presenceCondition` is still
only populated where it already was; new fields have none.

---

## PHASE 3 - Render verbatim descriptions safely

Verbatim descriptions carry markup that the current tooltip path renders as
literal text. This phase makes them display correctly everywhere descriptions
already surface, and vendors the two diagrams `fare_transfer_type` depends on.

- [x] Add `src/utils/spec-markup.ts` exporting `renderSpecDescription(s: string): string`.
      Supported subset: `<br>` -> `<br>`, `` `x` `` -> `<code>`,
      `[text](#anchor)` -> a link to `https://gtfs.org/documentation/schedule/reference/#anchor`,
      `[text](http...)` -> external link with `target="_blank" rel="noopener noreferrer"`,
      `**bold**`, `*italic*`, `<hr>`, and a passthrough for `<table>`/`<thead>`/
      `<tbody>`/`<tr>`/`<th>`/`<td>` with all attributes stripped.
      Escape everything else. Nothing user-supplied ever reaches this function -
      input is always a compile-time constant from the spec - but escape anyway.
- [x] Add `renderSpecDescriptionPlain(s: string): string` for contexts that need
      one line (option-picker subtitles, `title=` attributes).
- [x] Vendor `examples/2-leg.svg` and `examples/3-leg.svg` from the
      `google/transit` repo into `src/assets/gtfs-spec/`. Rewrite the
      `![](examples/*.svg)` references at render time to the bundled asset URLs.
      Both must be legible in all 9 DaisyUI themes; if they are dark-on-transparent,
      wrap them in a light background container rather than editing the SVGs.
- [x] Route `buildFieldTooltipContent` in `src/utils/field-component.ts` through
      `renderSpecDescription`.
- [x] Verify long descriptions do not blow out tooltip layout. Cap tooltip width
      and allow internal scrolling for the `fare_transfer_type` case.
- [ ] Spot-check in the browser: `fare_transfer_type` (table + images),
      `from_timeframe_group_id` (very long, bulleted), `cemv_support` (links).
      **Left for the user's manual pass.**

### Discoveries

**Tooltips had to stop being `data-tip` tooltips.** DaisyUI renders `data-tip`
through CSS `content:`, so any HTML in it shows up as literal text. The rich path
is `.tooltip > .tooltip-content`, which `renderFieldLabelContent` now emits.
Three DaisyUI defaults on `.tooltip-content` are overridden by utility classes on
the element: `text-align: center` -> `text-left`, `max-width: 20rem` ->
`max-w-[36rem]`, and `pointer-events: none` -> `pointer-events-auto`. The last is
what makes `max-h-[60vh] overflow-y-auto` usable at all; the content is a
descendant of `.tooltip`, so hovering it keeps the tooltip open. `escapeAttr` in
`field-component.ts` had no callers left and was deleted.

**Three images, not two.** `shapes.shape_dist_traveled` embeds a raw
`<img src="inlining.svg">`, which the plan did not account for and which would
have rendered broken. It is vendored alongside the two `fare_transfer_type`
diagrams; it lives at `gtfs/spec/en/inlining.svg` in `google/transit`, not under
`examples/`. All three are black line art on transparency, so `renderImage`
wraps them in a white plate rather than forking the SVGs. Images are matched by
basename, so both the `![](examples/x.svg)` and `<img src="x.svg">` spellings
resolve to the same asset, and an unrecognized one logs `[SpecMarkup]` and
renders nothing instead of a broken image. Vite inlines `inlining.svg` as a data
URI (under the 4 kB threshold) and emits the other two as files.

**Bullets come from `<br>`, not just newlines.** `<br>` variants are folded to
`\n` before the line pass, which is what turns `<br>- **Required** for ...` in
`stop_times.arrival_time` into a real list. The reference writes bullets with
both `- ` and `* ` leaders, and one bullet in `stop_times.txt` uses `-&nbsp;`,
so the bullet regex admits `&nbsp;` as the separator. Numbered lists (`1.`,
`2.`) in `fare_leg_rules.txt`'s file description stay as plain paragraphs; they
read fine in order and a numbered-list parser was not worth it.

**`renderInline` recurses** through bold and italic runs, so it builds a fresh
`RegExp` per call rather than sharing one global regex whose `lastIndex` the
inner call would clobber.

**Verification.** A sweep over all 250 file-level and field-level descriptions in
`gtfsSpec` renders with balanced, fully-closed tags and no unresolved images. The
`<table>` in `fare_transfer_type` survives with its `<code>` cells intact.

**`src/types/assets.d.ts`** was added to declare `*.svg` imports; the project has
no `vite/client` types.

**Second surface for descriptions.** The file-viewer's column headers
(`editor.ts`, via `createTooltip`) are still `data-tip` tooltips, and were
showing raw backticks and `<br>` as text. They now run through
`renderSpecDescriptionPlain`. Making them rich would mean restyling a Clusterize
`<th>`, which is out of scope here.

---

## PHASE 4 - Shared spec-driven editable table

The foundation for everything after it. Extract the timetable's click-to-edit
behavior into a component that renders any GTFS table from its spec, so each new
fares tab is a few lines of configuration rather than a bespoke renderer plus a
bespoke add/edit modal.

- [x] Create `src/modules/editable-table.ts` exporting `renderEditableTable(config)`
      and `installEditableTableHandlers(config)`.
- [x] Config shape: `{ tableName, fields?, rows, primaryKey, columnOverrides?,
      onInsert, onUpdate, onDelete }`. When `fields` is omitted, derive columns
      from `generateFieldConfigsFromSchema` for `tableName`, in spec order.
- [x] Column headers reuse `renderFieldLabelContent` so every column carries the
      spec tooltip from Phase 3.
- [x] Cell rendering by field kind, dispatched from the `GTFSFieldSpec`:
      - text / number / URL / color / time -> inline `<input>` swap
      - `Enum` -> inline menu (mirror `openTripPropEnumMenu`)
      - `Foreign ID` -> `showOptionPickerModal`, options built from the referenced
        table via `foreignKey`, labels via `getStopDisplay` / `renderOptionLabel`
        where the target is `stops.txt`
- [x] Reuse the exact editing contract from `schedule-controller.ts`: `data-*`
      spans, delegated `document` listener, `.editor-input-live` single-editor
      guard, `settled` flag, blur-commits / Enter-blurs / Escape-cancels.
- [x] A trailing blank "new row": typing into any cell of it creates the record.
      Required fields that are still empty block the insert and show an inline
      error on the offending cell.
- [x] Per-row delete button using `renderTrashIcon`, going through the existing
      confirm modal. Keep the "This can be undone via Edit -> Undo" copy.
- [x] Every mutation calls `patchManager.record{Insert,Update,Delete}` alongside
      the DB write. Log `[EditableTable]`-prefixed lines at each write.
- [x] Validate on commit with the field's Zod schema. On failure, revert the cell
      and surface the Zod message; do not write.
- [x] Honor the copy-on-read invariant: never retain a row object returned by a
      query across an await.
- [x] Refactor `schedule-controller.ts` to consume the shared editor primitives
      rather than keeping a parallel copy. If the timetable's needs turn out to be
      too specialized, extract only the low-level `openInlineEditor` /
      `openInlineEnumMenu` helpers into `src/utils/inline-edit.ts` and have both
      call those. Record which route you took in Discoveries.

**Gotchas**: the timetable's editors are tuned for a virtualized wide grid; do not
regress it. `noUnusedParameters` is on. Do not build a generic "table framework" -
per the project philosophy, keep it concrete and specific to GTFS spec tables.

### Discoveries

**Which refactor route was taken: the low-level extraction.** The timetable's
editors are not table cells - the time editor validates arrival <= departure and
can insert a whole stop, the shape picker has a dangling-reference option, and
the whole thing is a virtualized wide grid. Only the mechanics are shared, so
`src/utils/inline-edit.ts` now holds `openInlineEditor` and `openInlineMenu` and
both `schedule-controller.ts` and `editable-table.ts` call them. That deleted
about 120 lines of duplicated editor plumbing from the schedule controller with
no behavior change; its own commit callbacks are untouched. Two renames to know
about: the enum menu's element class is now `inline-enum-menu` (was
`trip-prop-enum-menu`, referenced nowhere else), and `LIVE_EDITOR_CLASS` is the
exported name for the `.editor-input-live` guard. `escapeHtml` is no longer
imported by `schedule-controller.ts`.

**`renderEditableTable` is async.** Foreign-ID columns show a label
(`Adult (adult)`), not a bare id, which means reading the referenced tables
before emitting HTML. Callers must `await` it. `generateFieldConfigsFromSchema`
is used only to build the header `FieldConfig`s, because it *sorts* its output
(primary keys, then required, then optional); column order comes from
`Object.keys(GTFS_FIELD_SPECS[tableName])`, which is spec order.

**Instance registry instead of per-render binding.** `installEditableTableHandlers`
records the config in a module-level `Map` keyed by `instanceId` and installs one
`document` click/keydown listener for all instances. Cells carry `data-et` with
the instance id. The host keeps its config object and re-assigns `config.rows`
before each re-render, so the handlers always see what the user is looking at.
There is also `uninstallEditableTableHandlers(instanceId)`; Phase 6 should call
it when the fares modal closes so the map does not accumulate dead instances.

**Mutations live in the component, not in the callbacks.** `onInsert`/`onUpdate`/
`onDelete` are post-write notification hooks (refresh the pane, update the row
counts); the DB write, the patch record and the `[EditableTable]` log all happen
inside the component, driven by a required `deps: { gtfsDatabase, patchManager }`.
Nine tables re-implementing patch recording was the thing this phase existed to
prevent.

**Editing a key field re-keys the row.** `updateRow` cannot express that, so when
the edited field participates in the table's primary key the commit becomes
`deleteRow` + `insertRows` recorded as one `recordBatchMixed` patch. This matters
more than it sounds: `timeframes`, `stop_areas` and `fare_rules` are `all_fields`
tables, where *every* field re-keys. Collisions with an existing row are refused
with an inline error rather than silently overwriting. Non-key edits take the
ordinary `patchUpdate` path.

**Clearing a cell writes `''`, never `undefined`.** Deleting the key from the row
would make it vanish from the CSV column union on export; an empty string is what
the spec means by an absent value anyway.

**Validation.** `coerceValue` turns the raw input into a number for the numeric
field types and numeric enums (the derived Zod validators are `z.number()`, so a
string would always fail), then the field's schema from
`GTFSSchemas[tableName].shape[field]` runs `safeParse`. The first Zod issue
message is shown via `notify.error` and the cell is marked `text-error` with the
message as its `title`; nothing is written and the cell keeps its pre-edit value.
`shape[field]` needs an `as z.ZodTypeAny` cast: the Zod 4 shape type erases to
`$ZodType`, which has no `safeParse`.

**Required-field handling on the blank row is deferred, not per-cell.** A
half-filled new row is not an error, so requiredness is only checked once a cell
commits: still-empty required cells get a `ring-error` outline and the insert is
held until they are filled. Per-cell Zod validation still runs on each commit.

**Accessibility came along for free.** Cells are `tabindex="0"`, open on Enter and
Space as well as click, and carry a `focus-visible` outline. Phase 5 needs the
same treatment on entity pages, so mirror this rather than reinventing it.

**Knip.** The component has no consumer until Phase 6, and knip fails a
never-imported file. `knip.config.ts` gained an `ignore` entry naming
`src/modules/editable-table.ts`, with a comment saying to delete it once the
fares modal is rebuilt on top of the component. **Phase 6 must remove that
entry.**

**Not yet exercised.** Nothing renders this component yet, so Phase 6 is also its
first real test. The paths most worth watching there: the re-key delete+insert,
the blank-row insert on a composite-key table (`fare_products`), and the currency
`amount` column, which is a `z.string().regex(...)` and therefore deliberately
*not* in `NUMERIC_FIELD_TYPES` (no float math, per the spec).

---

## PHASE 5 - Uniform click-to-edit on entity pages

Extend Phase 4's inline-edit primitives to every entity property form, replacing
the always-live `<input>`/`<select>` pattern. This is the user's explicit
accessibility and uniformity request: one editing idiom across the whole app.

- [x] Add `renderInlineEditableField(config)` to `src/utils/field-component.ts`
      (or a sibling module), emitting a display span with the same `data-*`
      contract as Phase 4's cells.
- [x] Migrate `src/modules/page-content-renderer.ts` (route and trip pages).
- [x] Migrate `src/modules/stop-view-controller.ts`.
- [x] Migrate `src/modules/agency-view-controller.ts`.
- [x] Migrate `src/modules/pathway-view-controller.ts`.
- [x] Wire each page's commits through `patchManager`, preserving whatever
      `form-patch-bridge.ts` did per page. Delete `form-patch-bridge.ts` and
      `renderFormField`/`renderFormFields`/`renderEntityFields` once no caller
      remains; `pnpm knip` will confirm.
- [x] Keyboard: every editable span must be reachable by Tab, activatable by
      Enter and Space, with a visible focus ring. This is the point of the change.
- [ ] Confirm the new `cemv_support` field appears and is editable on both the
      agency page and the route page. **Left for the user's manual pass**; both
      pages render every field of their spec, and `cemv_support` is in it.
- [ ] Confirm `cars_allowed`, `safe_duration_factor`, `safe_duration_offset`
      appear on the trip property rows in the timetable. **Left for the user's
      manual pass**; the rows come from `TripsSchema`, which has all three.

**Gotchas**: some pages render fields before their entity is loaded. Preserve the
async ordering. Watch for `input`/`change` listeners elsewhere that assumed live
inputs existed in the DOM.

### Discoveries

**Where things live now.** `src/utils/inline-editable-field.ts` holds the field
renderer and its delegated listeners; `src/utils/spec-field-edit.ts` holds the
rules both it and `editable-table.ts` need. That second file is the real
structural change of this phase: "which editor does this field get, how is its
raw input coerced, how is it validated, how is it displayed, what are its picker
options" now has one implementation instead of one per screen. Phase 4's local
`cellKind` / `coerceValue` / `validateValue` / `displayValue` / `foreignOptions`
were moved there verbatim and renamed (`specFieldKind`, `coerceFieldValue`,
`validateFieldValue`, `formatSpecValue`, `buildForeignKeyOptions`), plus
`specStoreName` and a new `resolveForeignLabel`. Phases 6-9 should reach for
this module rather than re-deriving any of it.

**Rendering entity fields is async now**, for the same reason Phase 4's table
render is: a foreign-ID field shows a label, not a bare id. But a stop page
labelling `parent_station` must not read every stop in the feed, so
`resolveForeignLabel` does a single `getRow` when the target table is keyed on
the named field, and falls back to the raw value otherwise.
`buildForeignKeyOptions` (the full scan) only runs when the picker actually
opens. Every `renderXProperties` on the four controllers became `async`.

**One module-level dependency slot, not threaded parameters.**
`installInlineEditableFields({ gtfsDatabase, patchManager })` is called from
`PageContentRenderer`'s constructor and stores its argument in a module-level
`let`; the render functions and the delegated listeners both read it. The
alternative was passing a db handle through five controllers into every render
call, for a component that is a singleton in practice. Calling it again just
refreshes the dependencies. The controllers' `QueryOnlyDatabase` type is
therefore untouched: they never see the write side.

**Commits go through `recordUpdate` alone.** `PatchManager.recordUpdate` calls
`applyPatchForward`, which does the `updateRow`, so there is no separate
database write here (the same shape `form-patch-bridge.ts` had). The `before`
value comes from the span's `data-value`, coerced the same way as the new value
so a numeric field does not record a string `"0"` against a number `0` and make
undo write the wrong type.

**Display/storage round-trip.** Text-kind editors open on
`formatValueForDisplay(value, gtfsFieldType)` and commit through
`convertValueToGTFS`, so a date field still shows and edits as `2026-04-01`
while storing `20260401`, and a color as `#FFFFFF` while storing `FFFFFF`.
`openInlineEditor` gained the full `inputType` union from
`GTFS_FIELD_TYPE_METADATA` (plus a `sizeClass` option) so those fields keep
their native pickers. `Time` and `LocalTime` are deliberately forced back to a
text input: GTFS times run past `24:00:00`, which `<input type="time">` cannot
hold.

**`level_id`'s hand-built `<select>` is gone.** It was a regex replacement over
the rendered HTML of the `level_id` input. The spec already types the field as
`Foreign ID referencing levels.level_id`, so the generic picker covers it, with
better labels. That removed the whole `getLevelOptions` chain:
`LevelsController.getLevelOptions`, `LevelOption`, the
`setLevelsController` call in `index.ts`, and the dependency on
`StopViewDependencies` / `ContentRendererDependencies`. The Levels modal itself
is untouched. `ContentRendererDependencies.parser` went with
`form-patch-bridge.ts`, its only consumer.

**`renderFormField` / `renderFormFields` survive**, because `fares-modal.ts`
still calls them. `renderEntityFields` and `renderEntityFormFields` are deleted.
**Phase 6 should delete the remaining three** once the modal is rebuilt; knip
will name them the moment the last caller goes.

**Primary keys render as static text**, not as editors: they were already
`readonly` in the generated field configs, and changing one re-keys the record,
which is a different operation from editing a property. Phase 4's table handles
re-keying because a table row's identity is its content; an entity page's is not.

**Accessibility.** Spans are `tabindex="0" role="button"`, open on click, Enter
and Space, and carry a `focus-visible` ring. Empty fields show their muted
placeholder text rather than a bare dash, so the form still reads as a form.
While an editor is live the keydown target is the input, not the span, so the
Space handler cannot re-open the field being typed in.

**Not verified in a browser.** Everything above passes
`typecheck / lint / knip / check-spec / build`, but no page was opened. Worth
watching on the manual pass: the stop page's `parent_station` and `level_id`
pickers, a date field on the home page's feed_info block, and that committing a
field does not fight with whatever re-render the `patch:change` listener does.

---

## PHASE 6 - Fares modal shell

Rebuild `fares-modal.ts` around the sidebar layout and Phase 4's component, and
delete the second-modal add/edit flow entirely. Only the three existing tables
move in this phase; new tables arrive in Phases 7-9. Keeping the set unchanged
here makes the refactor independently testable.

- [x] Replace the tab row with a two-pane layout: left sidebar of grouped entries,
      right content pane. Groups and order:
      - **Definitions**: Timeframes, Rider Categories, Fare Media, Fare Products
      - **Rules**: Fare Leg Rules, Fare Leg Join Rules, Fare Transfer Rules
      - **Geography**: Areas, Networks
      Entries for tables not yet implemented are rendered disabled with a
      "coming in a later phase" title until their phase lands.
- [x] Each sidebar entry shows a live row count, refreshed after every mutation.
- [x] Widen `boxClassName` beyond `max-w-3xl`; the rule tables are wide. Content
      pane scrolls horizontally on its own, the modal never does.
- [x] Render Rider Categories, Fare Media, Fare Products via `renderEditableTable`.
- [x] Delete `showAddEditRiderCategoryModal`, `showAddEditFareMediaModal`,
      `showAddEditFareProductModal`, `readFormValues`, `showFormError`,
      `renderColumnHeader`, and the local `esc` if now unused.
- [x] Keep `showDeleteConfirmModal`, or move it into `editable-table.ts` if that
      is where it now belongs. **It was already in `editable-table.ts`**; the
      fares-modal copy is deleted.
- [x] Replace the "Supports a limited set of Fares V2..." blurb with accurate copy,
      still linking to the reference and still noting that Fares v1 lives in the
      file viewer.
- [x] Fare Products' `amount` column must render as a Currency amount, with the
      decimal-place count implied by the row's `currency`. Do not use float math.
- [x] Preserve deep-linking / reopen behavior if `PageStateManager` tracks the
      modal today. If it does not, do not add it. **It does not**: the modal is
      opened from a `#fares-btn` click listener in `index.ts` and nothing was
      added.

### Discoveries

**Shape of the rebuilt module.** `fares-modal.ts` went from 804 lines to about
250, and nine tenths of what is left is data: a `FARES_ENTRIES` array of
`{ table, label, group, pending?, emptyMessage, columnOverrides? }`. Phases 7-9
should only have to drop the `pending: true` flag and add the entry's
`columnOverrides`; no rendering code should need to change. The four entries
that are not yet editable render as `menu-disabled` `<span>`s with a
`title="Editing this table is coming in a later phase"`, but they still show
their live row count, so an imported feed's fares data is visible before its
editor exists.

**One `EditableTableConfig` for the whole modal, re-pointed on navigation.**
Switching sidebar entries re-assigns `tableName` / `rows` / `emptyMessage` /
`columnOverrides` on the same config object and re-renders, rather than
installing a second instance. The delegated handlers hold that object, so they
follow the switch for free, and `uninstallEditableTableHandlers` has exactly one
id to drop when `showModal` resolves. `FaresModalDeps` is now just an alias for
`EditableTableDeps`, which adds `recordBatchMixed` to what `index.ts` passes;
`PatchManager` already had it, and the existing `Parameters<typeof
showFaresModal>[0]` cast at the call site still holds.

**Two fixes to `editable-table.ts`, from it finally being exercised.** Both come
from the same decision: **do not re-render on update.** A commit fires on blur,
and a blur is usually caused by clicking the next cell, so an async re-render
lands *after* that cell's editor has opened and destroys it. Re-rendering is
therefore limited to insert and delete, where the row set genuinely changed.
That left two pieces of state stale, now handled in the component:

- `replaceRow` writes the committed row back into `config.rows`, so the next
  edit of that row reads the value just written rather than the pre-edit one.
- `rekeyRowElement` rewrites `data-key` on every cell and the delete button, and
  `data-et-row` on the `<tr>`, after a re-keying edit. Without it the next edit
  of that row looked up a key that no longer existed and logged
  "row ... is gone".

`onUpdate` is consequently unused by this host, which is the intended split: the
hook exists for a host that needs to react, not to keep the table correct.

**Currency without float math.** `formatCurrencyAmount(value, currency)` pads the
stored decimal string out to the ISO 4217 minor-unit count for the row's
currency, taking the digit count from
`Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits` and doing the
rest with `padEnd`. It never truncates: a value with more digits than the
currency allows is shown as written, since hiding it would misrepresent what is
in the feed. Unparseable amounts, an empty currency and an unknown currency code
all fall through to the raw string. It is a `columnOverrides.format`, so the
cell still edits as the raw value.

**`renderFormField` / `renderFormFields` are gone**, as Phase 5 predicted, along
with the now-orphaned `renderTextInput`, `renderSelectInput`,
`renderTextareaInput` and the `formatValueForDisplay` import (191 lines out of
`field-component.ts`). `renderFieldLabel`, `renderFieldLabelContent`,
`buildFieldTooltipContent`, `generateFieldConfigsFromSchema` and `FieldConfig`
all stay: the click-to-edit path and the editable table's headers use them. The
`FieldConfig` fields that only the deleted renderers read (`placeholder`,
`attributes`, `options`, `inputClasses`, `emptyEquivalentValue`) were left in
place; `generateFieldConfigsFromSchema` still populates them and no lint rule
objects.

**`knip.config.ts`'s `ignore` block is removed** now that `editable-table.ts` has
a consumer, as Phase 4 required.

**Not verified in a browser.** `typecheck / lint / knip / check-spec / build` all
pass. Worth watching on the manual pass: adding a fare product through the blank
row (composite key, and `amount` is a `Currency amount` string rather than a
number), editing `fare_product_id` on an existing row (the re-key path), the
row counts updating after an insert and a delete, and whether the sidebar plus a
six-column table fits without the modal itself scrolling sideways.

---

## PHASE 7 - Networks

The trickiest data-model phase. Two mutually exclusive on-disk representations
must collapse to one in-memory model without losing the user's original form.

**Model**: IndexedDB always holds `networks` and `route_networks` tables.
`routes.network_id` is never read after import and never written except at export.

**Import**:
- If `networks.txt` or `route_networks.txt` is present -> load them. If
  `routes.txt` also has a `network_id` column, **ignore it** and warn the user
  once via `notification-system`, naming the count of routes whose `network_id`
  is being discarded. Record `networksMode = 'files'` in the `meta` store.
- Otherwise -> synthesize one `networks` row per distinct non-empty
  `routes.network_id` (with empty `network_name`), and one `route_networks` row
  per route. Record `networksMode = 'inline'`.
- If neither exists -> `networksMode = 'inline'` (the default, so a feed that
  gains its first network exports the lighter form).

**Export**:
- If any network has a non-empty `network_name` -> write `networks.txt` and
  `route_networks.txt`, and **omit** the `network_id` column from `routes.txt`.
- Else if `networksMode === 'files'` -> write both files anyway (roundtrip
  fidelity: the feed came in that way).
- Else -> write `routes.network_id` and emit neither file.

- [x] Add `networksMode` to the `meta` store with a typed getter/setter in
      `gtfs-database.ts`. Default `'inline'` when absent.
- [x] Implement the import normalization in `gtfs-parser.ts`, after tables load
      and before any consumer runs. Log `[Networks]` lines for which branch ran.
- [x] Emit the ignored-`network_id` warning through `notification-system.ts`.
      Exactly once per import, not once per route.
- [x] Implement the export rule. `generateCSVFromRows` derives columns from the
      union of row keys, so omitting `routes.network_id` means stripping the key
      from the exported route rows, not just skipping a header.
- [x] Ensure the synthesized `networks` / `route_networks` rows are **not** patch
      records. They are derived import state, which the philosophy section
      explicitly permits writing directly.
- [x] Add the Networks entry to the modal. Show one row per network:
      `network_id`, `network_name`, and a route count. Editing `network_name`
      to a non-empty value is what flips the export to the files form; surface
      that consequence in the UI (a short inline note, not a modal).
- [x] Add a network selector to the route detail page, writing to
      `route_networks` (never to `routes.network_id`). Use
      `showOptionPickerModal`, with an option to create a new network inline.
- [x] Enforce the spec constraint that a `route_id` may appear in only one
      `network_id`: assigning a route replaces its existing `route_networks` row.
- [x] Update `gtfs-validator.ts`: flag `routes.network_id` coexisting with
      `networks.txt`/`route_networks.txt` as an error, per the reference's
      Conditionally Forbidden rule.

**Gotchas**: `fare_leg_rules.network_id` and `fare_leg_join_rules.from/to_network_id`
reference "`routes.network_id` **or** `networks.network_id`". Their pickers must
read the canonical `networks` table, which is correct under either mode. A feed
that imports as `'files'` with unnamed networks and is exported unchanged must
still emit both files - that is exactly what `networksMode` is for, and it is
worth verifying explicitly before the Phase 11 roundtrip test.

### Discoveries

**`routes.network_id` is left in memory, not stripped at import.** The plan says
"ignore it", and ignoring turned out to be the literal implementation: nothing
reads the column after `normalizeNetworks`, and the export decides the column's
contents from scratch. Stripping it would have made the file viewer show a
routes.txt that differs from the imported one for no gain, and would have left
`gtfs-validator`'s new Conditionally Forbidden check unable to ever fire.

**Export rewrites `routes.network_id` rather than passing it through.** Because
the stored column is stale by construction, `applyNetworkColumn` sets it from
the `route_networks` map in the inline form and deletes the key in the files
form. A route with no assignment gets the key deleted, not blanked, so a feed
with no networks at all emits no `network_id` column; Papa fills the gap with
`''` for the other rows when some route does have one, which is what the
original CSV had anyway. That should keep the Phase 11 roundtrip clean.

**Where the two hooks live.** `normalizeNetworks()` runs at the end of
`parseFile`, which is also the whole of `parseFromURL`'s import path, so one
call site covers both. The trailing `setBlobVersion(0)` became
`persistDirtyBlobs(0)`: the synthesized rows go in through the virtual tables,
which only mark the blob dirty, and the old call would have left them to a
3-second debounce that a quick refresh could beat. `clearDatabase()` at the top
of `parseFile` wipes the `meta` store, so `networksMode` is always written after
it, and `initializeEmpty` needs nothing: the absent key reads as `'inline'`.

**`route_networks` is keyed on `route_id`**, natural, in
`gtfs-primary-keys.ts`. The "a route belongs to at most one network" constraint
therefore needs no enforcement code: the store cannot hold two rows for a route,
and assignment is an update of the existing row rather than an insert. Note the
consequence for patches: moving a route between networks is a `recordUpdate`
(which applies its own write), assigning is `insertRows` + `recordInsert`, and
unassigning is `deleteRow` + `recordDelete`.

**`route_networks` may name networks `networks.txt` never defined.** Both files
are Optional, so this is legal input. Those networks are synthesized at import,
since a network with no row is invisible in the modal and in every picker. The
validator still warns about the case, which is now only reachable by deleting a
network in the modal while routes are still assigned to it. **Deleting a network
does not cascade to `route_networks`** - a gap worth closing, but it belongs
with the rest of referential integrity in Phase 10.

**The editable table grew `extraColumns`.** Read-only columns appended after the
spec columns, `{ label, render(row) }`, for values derived from other tables.
Networks' route count is the only user so far; Phase 8's areas want the same
thing for their stop count. They are rebuilt on every refresh, so `FaresEntry`
carries `extraColumns` as an async factory rather than a value.
`FaresEntry.note` was added alongside it, rendering a line of prose above the
table, and is what carries the "naming a network changes the export form"
consequence.

**The route page's network field is not an `inline-editable-field`.** That
module is spec-field-driven, keyed by table plus record id, and this field edits
a different table from the one the page is about. It is a hand-rolled span in
`page-content-renderer.ts` that mirrors the same contract (`tabindex="0"`,
`role="button"`, click / Enter / Space, `focus-visible` ring) and opens
`showOptionPickerModal`. `renderInlineEntityFields` gained an `exclude`
parameter so `network_id` no longer renders as an ordinary editable property.
`InlineEntityCreator` was not extended: its three methods each carry an entity's
default-value shape, and a network is two fields, so the create flow is a small
local modal instead.

**Not verified in a browser.** `typecheck / lint / knip / check-spec / build`
all pass. Worth watching on the manual pass: importing a feed with
`routes.network_id` (the MBTA feed has one) and confirming the Networks table
fills in with unnamed networks and correct route counts; the ignored-`network_id`
warning appearing exactly once; assigning, moving and clearing a route's network
and then undoing each; and that renaming a network in the modal flips the export
to `networks.txt` + `route_networks.txt` with no `network_id` column on
`routes.txt`.

---

## PHASE 8 - Areas

Simpler than networks: `areas.txt` is the only representation. The complexity is
the station-to-platform inheritance rule.

Spec rule: a `stop_areas` row naming a station (`location_type=1`) implies all
its platforms (`location_type=0`, `parent_station` = that station) are in the
area, "unless a platform is assigned to another area". Stops with any other
`location_type` may not be assigned to areas.

- [ ] Add `getEffectiveAreasForStop(stopId)` to `src/utils/stop-hierarchy.ts`
      (or a new `src/utils/area-hierarchy.ts` if that file is already crowded).
      Returns `{ areaId, inheritedFrom?: stopId }[]`. A platform with any explicit
      `stop_areas` row uses only its explicit rows; otherwise it inherits its
      parent station's.
- [ ] Add the Areas entry to the modal: one row per area (`area_id`, `area_name`,
      stop count), with an expandable or drill-in list of assigned stops. Stop
      labels must go through `getStopDisplay`.
- [ ] Add an area selector to the stop detail page. Explicit assignments render as
      normal chips; inherited ones render greyed with a "from `<station name>`"
      label and are not directly removable. Adding an explicit area to a platform
      writes a `stop_areas` row and visibly supersedes the inherited set - show a
      one-line note when that transition happens.
- [ ] Removing a platform's last explicit area returns it to inheriting. Make that
      reversible and obvious.
- [ ] Block assignment for stops whose `location_type` is not 0, 1, or empty, per
      the reference.
- [ ] Every mutation goes through `patchManager`.
- [ ] Validator: flag `stop_areas` rows pointing at a `location_type` of 2, 3, or 4.

**Gotchas**: unlike networks, "the same `stop_id` may appear in multiple `area_id`
entries" - areas are many-to-many. Do not reuse the single-assignment logic from
Phase 7.

### Discoveries
_(fill in)_

---

## PHASE 9 - Timeframes and the three rule tables

Per the user's direction, these are **simple tables** with no bespoke UI: straight
`renderEditableTable` instances with foreign-key pickers. This is where Phase 4's
investment pays off.

- [ ] Timeframes entry: `timeframe_group_id`, `start_time`, `end_time`,
      `service_id`. `service_id` picker reads `calendar` union `calendar_dates`,
      labeled via the service-days helpers. Validate the conditional pairing of
      `start_time`/`end_time` and reject values above `24:00:00`.
- [ ] Fare Leg Rules entry: all eight fields. Pickers for `network_id` (canonical
      networks table), `from_area_id`/`to_area_id` (areas),
      `from_timeframe_group_id`/`to_timeframe_group_id` (distinct
      `timeframe_group_id` values), `fare_product_id` (fare products).
      `leg_group_id` is a free ID, but offer existing values as suggestions.
- [ ] Fare Leg Join Rules entry: the **corrected** fields from Phase 2 -
      `from_network_id`, `to_network_id`, `from_stop_id`, `to_stop_id`. Enforce
      the mutual conditional requirement on the two stop fields, and that the
      stops are `location_type` 0 or 1.
- [ ] Fare Transfer Rules entry: all fields. `fare_transfer_type` and
      `duration_limit_type` use the inline enum menu with our curated short
      labels; the full verbatim description with its table and diagrams is
      available from the column header tooltip.
- [ ] Enforce `duration_limit` / `duration_limit_type` mutual requirement
      (each Required if the other is defined, Forbidden otherwise).
- [ ] Note in the Fare Transfer Rules UI that these rules are **directional**
      (the February 2026 clarification), using the reference's wording.
- [ ] Enable all previously-disabled sidebar entries; remove the placeholder copy.
- [ ] Empty-state copy for each table explaining what it is for, drawn from the
      reference's file-level description via `renderSpecDescription`.

**Gotchas**: `fare_leg_rules`' primary key is a six-field composite including
`fare_product_id`; `generateCompositeKeyFromRecord` must produce stable keys when
several of those fields are empty, which is the normal case. Verify empty-vs-absent
is handled consistently, since the two mean different things to the spec's matching
semantics.

### Discoveries
_(fill in)_

---

## PHASE 10 - Validation, docs, cleanup

- [ ] Extend `gtfs-validator.ts` with the conditional-presence rules introduced
      above: transfers `from_stop_id`/`to_stop_id`, timeframes start/end pairing,
      fare_transfer_rules duration pairing, fare_leg_join_rules stop pairing,
      networks Conditionally Forbidden, rider category default-uniqueness
      ("exactly one default per fare_product_id eligibility set").
- [ ] Cross-file referential integrity for every new `foreignKey` in the fares
      tables.
- [ ] Update `CLAUDE.md`: document `reference/gtfs-reference.md` as the spec source
      of truth, `pnpm check-spec` as part of the gate, and the networks
      canonicalization invariant.
- [ ] Delete `FARES.md` (superseded scratch notes).
- [ ] Add a short `reference/README.md` recording the source URL, the revision
      date, and how to refresh the snapshot (re-download, run `pnpm check-spec`,
      fix drift).
- [ ] Confirm the About / feature list copy reflects that only flex service and
      `frequencies.txt` remain unsupported.
- [ ] `pnpm knip` clean; no orphaned modules from Phases 5 and 6.

### Discoveries
_(fill in)_

---

## PHASE 11 - Roundtrip verification (user-driven)

The acceptance test. **The user performs the interactive part.**

Before handing off, build the tooling:

- [ ] Add `scripts/diff-gtfs.ts`: takes two GTFS zips, prints a semantic diff -
      files added/removed, columns added/removed per file, and rows
      added/removed/changed keyed by that table's primary key. It must **not** be
      a byte diff, and must normalize row order, column order, quoting, and
      trailing newlines. Those all legitimately differ on export and would drown
      out real changes.
- [ ] Verify it reports nothing on an import-with-no-edits, export cycle of the
      MBTA feed. If it does report something, that is a real export bug: fix it
      before proceeding.

Then the test:

1. User downloads the MBTA GTFS feed and imports it.
2. User makes a small, **written-down** set of changes across the new surfaces:
   at least one edit each to a network, an area, a fare product, a fare leg rule,
   a `cemv_support` value, and a trip's `cars_allowed`.
3. User exports the zip.
4. Run `pnpm tsx scripts/diff-gtfs.ts <original.zip> <exported.zip>` and confirm
   the diff contains **exactly** the user's listed changes and nothing else.
5. Investigate every unexplained difference. Common suspects: the networks
   inline/files decision, columns dropped because every value was empty, tables
   omitted because they were empty on import, `passthrough_files` handling.

- [ ] Diff is clean. Record the exact change list and the diff output below.

### Discoveries
_(fill in)_

---

## Out of scope

- Flex service: `locations.geojson`, `location_groups.txt`,
  `location_group_stops.txt`, `booking_rules.txt`
- `frequencies.txt`
- Fares v1 editing (`fare_attributes.txt`, `fare_rules.txt`) - file viewer only
- `translations.txt` editing for any new fares field
