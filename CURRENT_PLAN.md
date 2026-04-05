## Summary

Replace the fragile two-step auto-scraping pipeline (`scrape-gtfs-spec.ts` → `gtfs-spec.json` → `generate-gtfs-types.ts` → `gtfs.ts`) with a hand-authored TypeScript spec library. The spec lives in `src/gtfs-spec/files/` — one `.ts` file per GTFS file — and is authored verbatim from the official reference at https://gtfs.org/documentation/schedule/reference/. A runtime adapter replaces the codegen step by deriving all existing app exports (`GTFS_PRIMARY_KEYS`, `GTFS_FIELD_TYPES`, `GTFSSchemas`, `GTFS_ENUMS`, etc.) from the spec data at startup. The spec is structured to eventually be extracted as a standalone zero-dependency npm package. A `docs/gtfs-implementation-status.md` file tracks which files/features are supported in the UI.

**Why manual?** The scraper silently mis-parses edge cases — for example, `continuous_pickup` value `1 or empty` was scraped as just `1`, losing the "or empty" semantic. The reference changes rarely (a few times a year at most), so manual authorship with phased review is more accurate and maintainable than fixing an HTML parser.

## Relevant Context

### Current pipeline (being replaced)
- `scripts/scrape-gtfs-spec.ts` — scrapes gtfs.org HTML → `src/gtfs-spec.json` ← **deleted in Phase 1**
- `scripts/generate-gtfs-types.ts` — reads JSON → generates `src/types/gtfs.ts` + `src/types/gtfs-enums.ts` ← **deleted in Phase 1**
- `src/gtfs-spec.json` — scraped intermediate; kept as read-only reference until Phase 15, then deleted
- `src/types/gtfs.ts` — 1700-line generated file; stays until Phase 15 (app depends on it)
- `src/types/gtfs-enums.ts` — generated enum registry; stays until Phase 15

### Files that stay (hand-written, referenced by adapter)
- `src/types/gtfs-field-types.ts` — `GTFSFieldType` enum + `GTFS_FIELD_TYPE_METADATA` with `zodValidator` per type. The adapter uses these to build Zod schemas programmatically.
- `src/types/gtfs-entities.ts` — `z.infer<>` types; updated in Phase 15 to point at new schemas

### App consumers (updated in Phase 15)
- `src/utils/field-component.ts:381` — `generateFieldConfigsFromSchema()` uses `GTFSSchemas`, `GTFS_FIELD_TYPES`, `GTFS_PRIMARY_KEYS`, `GTFS_ENUMS`
- `src/utils/zod-tooltip-helper.ts:137` — `getGTFSFieldDescription()` uses `GTFSSchemas`
- `src/modules/gtfs-database.ts` — uses `GTFS_FILES`, primary key mappings

### New file structure
```
src/gtfs-spec/
  types.ts          ← GTFSSpec, GTFSFileSpec, GTFSFieldSpec, GTFSEnumValue types
  index.ts          ← assembles and exports the full GTFSSpec constant
  adapter.ts        ← derives GTFS_PRIMARY_KEYS, GTFSSchemas, etc. from spec at runtime
  files/
    agency.ts
    feed-info.ts
    stops.ts
    routes.ts
    trips.ts
    stop-times.ts
    ... (one file per GTFS file)
```

### Key type decisions
- `GTFSPresence = 'Required' | 'Optional' | 'Conditionally Required' | 'Conditionally Forbidden' | 'Recommended'` — `Recommended` is first-class in the type but the adapter treats it as Optional for Zod purposes (no enforcement)
- `presenceCondition?: string` — prose condition copied verbatim from reference (e.g. "Required if agency.txt has multiple agencies")
- `enumValues?: Array<{ value: number | string; label: string; description: string }>` — each part stored separately, enabling richer UI rendering
- `allowEmpty?: boolean` — for fields like `arrival_time`/`departure_time` that can be blank under conditions (distinct from Optional, which means the column may be omitted entirely). Adapter generates `z.union([z.literal(''), baseValidator]).describe(description).optional()` for these.
- `foreignKey?: { file: string; field: string }` — parsed from "Foreign ID referencing X.Y" patterns
- `format?: 'csv' | 'geojson'` on `GTFSFileSpec` — for `locations.geojson`
- `specVersion: string` on `GTFSSpec` — records the reference date this was authored against
- Zod stays **in the app only**, not in the spec library. The spec is zero-dependency data.

---

## Phase 1 — Foundation: types, file structure, delete scraper/codegen

Delete the generation scripts immediately (clean break). Define the spec TypeScript types. The existing `gtfs.ts` / `gtfs-enums.ts` remain untouched — the app still depends on them through Phase 14.

- [x] Create `src/gtfs-spec/types.ts` with: `GTFSPresence`, `GTFSEnumValue`, `GTFSFieldSpec`, `GTFSFileSpec`, `GTFSSpec`
- [x] Create `src/gtfs-spec/index.ts` stub (empty `gtfsSpec` export for now — files added incrementally)
- [x] Delete `scripts/scrape-gtfs-spec.ts`
- [x] Delete `scripts/generate-gtfs-types.ts`
- [x] Remove `generate-gtfs-types` script from `package.json`
- [x] Run `npm run typecheck` to confirm nothing is broken

*Gotchas:* `src/gtfs-spec.json` is kept as read-only reference until Phase 15. Do not add any imports of the new spec into the app yet — that happens in Phase 15.

---

## Phase 2 — agency.txt + feed_info.txt

Two simple files to establish the pattern and validate the type structure before tackling complex files.

- [x] Create `src/gtfs-spec/files/agency.ts` — 8 fields: `agency_id` (Unique ID, Conditionally Required, primary key), `agency_name` (Text, Required), `agency_url` (URL, Required), `agency_timezone` (Timezone, Required), `agency_lang` (Language code, Optional), `agency_phone` (Phone number, Optional), `agency_fare_url` (URL, Optional), `agency_email` (Email, Optional)
- [x] Create `src/gtfs-spec/files/feed-info.ts` — 9 fields: `feed_publisher_name`, `feed_publisher_url`, `feed_lang`, `default_lang`, `feed_start_date`, `feed_end_date`, `feed_version`, `feed_contact_email`, `feed_contact_url`
- [x] Add both to `src/gtfs-spec/index.ts`

*Gotchas:* `agency_id` has `presenceCondition` from reference. `feed_info.txt` itself is Conditionally Required — captured at file level with `presenceCondition`. `default_lang` is Optional per reference. `feed_start_date` and `feed_end_date` are Recommended (not Required).

---

## Phase 3 — stops.txt

Complex file with enums, foreign keys, and nuanced conditional presence — worth its own phase. Implemented 16 fields total (verified against live reference). Added `stop_access` (Conditionally Forbidden, enum 0–1), a newer field not present in the old scraper. Verified `location_type` value 0 "or empty" equivalence captured in enum description. `wheelchair_boarding` enum descriptions cover all three location contexts (parentless stops, child stops, station entrances). `zone_id` kept as Optional (per current reference) but with a `presenceCondition` noting fare_rules.txt dependency.

- [x] Create `src/gtfs-spec/files/stops.ts` — ~20 fields
- [x] `location_type` enum: 5 values (0–4), each with label and full description. Value `0` has `label: 'Stop (or Platform)'` — verify "or empty" semantic is captured in description
- [x] `parent_station`: foreign key `{ file: 'stops.txt', field: 'stop_id' }`, Conditionally Required
- [x] `wheelchair_boarding` enum: 3 values (0–2); semantics differ by `location_type` — copy description verbatim
- [x] `stop_name`, `stop_lat`, `stop_lon`, `parent_station`, `stop_timezone`, `zone_id`: all have `presenceCondition` prose
- [x] Add to `src/gtfs-spec/index.ts`

*Gotchas:* Do NOT rely on `gtfs-spec.json` as source of truth for this file — verify every enum value against the live reference, as the scraper was known to mis-parse this file.

---

## Phase 4 — routes.txt + trips.txt

Two medium-complexity files. `routes.txt` has the important `continuous_pickup` / `continuous_drop_off` enum bug fix. Implemented all fields verbatim from reference. `continuous_pickup`/`continuous_drop_off` value `1` label is `'No continuous stopping pickup'`/`'No continuous stopping drop off'` with "An empty value is equivalent to 1." in the description. `network_id` is `Conditionally Forbidden` with mutual exclusivity note. `trips.txt` includes `shape_id` as `Conditionally Required` with foreign key to `shapes.txt`.

- [x] Create `src/gtfs-spec/files/routes.ts` — ~15 fields
  - `route_type` enum: values 0–7, 11, 12 (check reference for any extended route type notes)
  - `continuous_pickup` / `continuous_drop_off` enums: **4 values** — value `1` label must be `'No continuous stopping pickup'` (the reference says "1 or empty"); capture the "or empty" equivalence in the description verbatim
  - `network_id`: note mutual exclusivity with `networks.txt` / `route_networks.txt` in description
- [x] Create `src/gtfs-spec/files/trips.ts` — ~10 fields
  - `direction_id` enum (0–1), `bikes_allowed` enum (0–2), `wheelchair_accessible` enum (0–2)
  - `shape_id`: foreign key `{ file: 'shapes.txt', field: 'shape_id' }`
- [x] Add both to `src/gtfs-spec/index.ts`

---

## Phase 5 — stop_times.txt

The most conditional file in the spec. Primary use case for `allowEmpty`. Implemented 18 fields total. `stop_id` / `location_group_id` / `location_id` mutual exclusivity captured in both `presenceCondition` and `description` for each. `continuous_pickup` / `continuous_drop_off` are `Conditionally Forbidden` (forbidden when pickup/drop-off windows are defined) rather than Optional as in routes.txt. `pickup_booking_rule_id` and `drop_off_booking_rule_id` added for flex transit booking rules.

- [x] Create `src/gtfs-spec/files/stop-times.ts` — ~15 fields
- [x] `arrival_time`: type `'Time'`, `allowEmpty: true`, presence `'Conditionally Required'` with prose condition
- [x] `departure_time`: same pattern as `arrival_time`
- [x] `stop_id` / `location_id` / `location_group_id`: mutually exclusive — capture in each field's description
- [x] `pickup_type` / `drop_off_type` enums: 4 values each
- [x] `continuous_pickup` / `continuous_drop_off` enums: same 4 values as `routes.txt` (same "or empty" issue on value 1)
- [x] `timepoint` enum: 0–1
- [x] Add to `src/gtfs-spec/index.ts`

---

## Phase 6 — calendar.txt + calendar_dates.txt

Service schedule files. Simple structure but mutually conditionally required with respect to each other. Both files authored verbatim from reference. `calendar.txt` is Conditionally Required (unless all dates defined in `calendar_dates.txt`). `calendar_dates.txt` is Conditionally Required (if `calendar.txt` is omitted). The `service_id` in `calendar_dates.txt` uses a `foreignKey` to `calendar.txt` — this captures the relationship when both files are used together.

- [x] Create `src/gtfs-spec/files/calendar.ts` — 10 fields: `service_id` (Unique ID, Required, primary key), `monday`–`sunday` (each Enum 0/1, Required), `start_date` (Date, Required), `end_date` (Date, Required)
- [x] Create `src/gtfs-spec/files/calendar-dates.ts` — 3 fields: `service_id` (ID, Required), `date` (Date, Required), `exception_type` (Enum 1/2, Required)
- [x] Capture mutual conditionality in `GTFSFileSpec.presenceCondition` for both files
- [x] Add both to `src/gtfs-spec/index.ts`

---

## Phase 7 — shapes.txt + frequencies.txt + transfers.txt

Three files grouped by relationship to trips. `transfers.txt` has the most conditional logic. All three files authored verbatim from reference. `transfers.txt` captures the full `transfer_type` enum (0–5) including the newer in-seat transfer types (4 and 5), with `from_trip_id`/`to_trip_id` marked Conditionally Required for those values. `frequencies.txt` uses a foreign key to `trips.txt`.

- [x] Create `src/gtfs-spec/files/shapes.ts` — 5 fields: `shape_id` (ID, Required, primary key), `shape_pt_lat`, `shape_pt_lon`, `shape_pt_sequence`, `shape_dist_traveled`
- [x] Create `src/gtfs-spec/files/frequencies.ts` — 6 fields: `trip_id`, `start_time`, `end_time`, `headway_secs`, `exact_times` (Enum 0/1)
- [x] Create `src/gtfs-spec/files/transfers.ts` — ~9 fields: `transfer_type` enum (0–5), multiple foreign keys, several Conditionally Required fields
- [x] Add all to `src/gtfs-spec/index.ts`

---

## Phase 8 — pathways.txt + levels.txt

Station interior navigation files. `pathways.txt` is among the most complex in the spec. Implemented 12 fields for pathways.txt (pathway_id, from_stop_id, to_stop_id, pathway_mode, is_bidirectional, length, traversal_time, stair_count, max_slope, min_width, signposted_as, reversed_signposted_as). `levels.txt` is marked Conditionally Required since it's only needed when stops reference level_id.

- [x] Create `src/gtfs-spec/files/pathways.ts` — ~15 fields
  - `pathway_mode` enum: 7 values (1–7)
  - `is_bidirectional` enum: 0–1
  - Many Conditionally Required fields depending on `pathway_mode` — capture all `presenceCondition` strings
- [x] Create `src/gtfs-spec/files/levels.ts` — 3 fields: `level_id` (Unique ID, Required, primary key), `level_index` (Float, Required), `level_name` (Text, Optional)
- [x] Add both to `src/gtfs-spec/index.ts`

---

## Phase 9 — fare_attributes.txt + fare_rules.txt

Legacy fare model (Fares v1). Still widely used. Fairly straightforward. `transfers` enum in `fare_attributes.txt` includes an empty-string value for unlimited transfers — stored as `value: ''` with label `'Unlimited'`. `fare_rules.txt` is all foreign keys; `origin_id`, `destination_id`, and `contains_id` all reference `stops.txt`'s `zone_id` field.

- [x] Create `src/gtfs-spec/files/fare-attributes.ts` — 7 fields: `fare_id` (Unique ID, primary key), `price`, `currency_type`, `payment_method` (Enum 0/1), `transfers` (Enum 0/1/2/empty), `agency_id`, `transfer_duration`
- [x] Create `src/gtfs-spec/files/fare-rules.ts` — 5 fields: all foreign keys (fare_id, route_id, origin_id, destination_id, contains_id)
- [x] Add both to `src/gtfs-spec/index.ts`

*Gotchas:* `transfers` in `fare_attributes.txt` has an "empty" option (unlimited transfers) — noted in description and stored as `value: ''`.

---

## Phase 10 — Fares v2: fare_media.txt, fare_products.txt, fare_leg_rules.txt, fare_leg_join_rules.txt, fare_transfer_rules.txt

The newer Fares v2 model. `fare_leg_rules.txt` and `fare_transfer_rules.txt` are the most complex. These files are entirely separate from Fares v1 — noted in each file's description. `fare_products.txt` has a composite primary key (`fare_product_id` + `rider_category_id` + `fare_media_id`) — `fare_product_id` is marked `isPrimaryKey: true` as the identifying field. `fare_transfer_rules.txt` has 8 fields including `duration_limit_type` (enum 0–3, measuring departure/arrival combinations) and `fare_transfer_type` (enum 0–2, representing A+AB, A+AB+B, and AB cost models). `duration_limit` and `duration_limit_type` are mutually Conditionally Required — each requires the other. `fare_leg_join_rules.txt` has 4 fields including an optional `fare_transfer_rule_id` back-reference. The `fare_leg_rules.txt` `network_id` foreign key points to `networks.txt` (which cross-references `routes.network_id` as well).

- [x] Create `src/gtfs-spec/files/fare-media.ts` — ~5 fields: `fare_media_id` (primary key), `fare_media_name`, `fare_media_type` (Enum 0–4)
- [x] Create `src/gtfs-spec/files/fare-products.ts` — ~5 fields: `fare_product_id` (primary key), `fare_product_name`, `fare_media_id`, `amount`, `currency`
- [x] Create `src/gtfs-spec/files/fare-leg-rules.ts` — ~10 fields with complex conditionality
- [x] Create `src/gtfs-spec/files/fare-leg-join-rules.ts` — small, ~4 fields
- [x] Create `src/gtfs-spec/files/fare-transfer-rules.ts` — ~10 fields: `duration_limit_type` enum (0–3), `fare_transfer_type` enum (0–2)
- [x] Add all to `src/gtfs-spec/index.ts`

---

## Phase 11 — timeframes.txt, rider_categories.txt, areas.txt, stop_areas.txt, networks.txt, route_networks.txt

Six compact files, mostly 2–5 fields each. All authored verbatim from the reference. `timeframes.txt` has 4 fields including `start_time`/`end_time` (both Conditionally Required — each requires the other) and a `service_id` foreign key to `calendar.txt`. `rider_categories.txt` has 6 fields including an `is_default_fare_container` enum (0/1) and `min_age`/`max_age`. `areas.txt` and `stop_areas.txt` are straightforward 2-field files. `networks.txt` and `route_networks.txt` are both `Conditionally Forbidden` with `presenceCondition` capturing the mutual exclusion with `routes.network_id`.

- [x] Create `src/gtfs-spec/files/timeframes.ts`
- [x] Create `src/gtfs-spec/files/rider-categories.ts`
- [x] Create `src/gtfs-spec/files/areas.ts` — 2 fields: `area_id` (primary key), `area_name`
- [x] Create `src/gtfs-spec/files/stop-areas.ts`
- [x] Create `src/gtfs-spec/files/networks.ts` — 2 fields: `network_id` (primary key), `network_name`; file is Conditionally Forbidden — capture in `GTFSFileSpec.presenceCondition`
- [x] Create `src/gtfs-spec/files/route-networks.ts` — Conditionally Forbidden, same mutual exclusion as `networks.txt`
- [x] Add all to `src/gtfs-spec/index.ts`

---

## Phase 12 — location_groups.txt, location_group_stops.txt, booking_rules.txt

Flexible transit (on-demand) files. `booking_rules.txt` has 15 fields (not ~20 as estimated — the reference has exactly 15). Many are Conditionally Required/Forbidden based on `booking_type` value (0=real-time, 1=same-day advance, 2=prior day). `prior_notice_service_id` is a foreign key to `calendar.txt` for counting business days vs. calendar days. `location_group_stops.txt` has a composite primary key (`location_group_id` + `stop_id`).

- [x] Create `src/gtfs-spec/files/location-groups.ts` — ~3 fields: `location_group_id` (primary key), `location_group_name`
- [x] Create `src/gtfs-spec/files/location-group-stops.ts` — 2 fields: `location_group_id`, `stop_id`
- [x] Create `src/gtfs-spec/files/booking-rules.ts` — 15 fields: `booking_rule_id` (primary key), `booking_type` enum (0–2), many fields Conditionally Required/Forbidden based on `booking_type` value
- [x] Add all to `src/gtfs-spec/index.ts`

---

## Phase 13 — translations.txt + attributions.txt

Final two standard CSV files. Both are compact administrative files.

- [x] Create `src/gtfs-spec/files/translations.ts` — 6 fields: `table_name` (Enum — list of GTFS table names), `field_name`, `language`, `translation`, `record_id`, `record_sub_id`, `field_value`
- [x] Create `src/gtfs-spec/files/attributions.ts` — ~8 fields: `attribution_id` (primary key), `agency_id`, `route_id`, `trip_id`, `organization_name`, `is_producer` / `is_operator` / `is_authority` (each Enum 0/1), `attribution_url`, `attribution_email`, `attribution_phone`
- [x] Add both to `src/gtfs-spec/index.ts`

*Gotchas:* `translations.txt`'s `table_name` field is an enum of GTFS filenames — copy verbatim from reference. `translation` and `field_value` have compound type `'Text or URL or Email'` — no single GTFSFieldType covers this; the adapter falls back via `mapGTFSTypeString` which normalizes it to `Text`/`z.string()`.

---

## Phase 14 — Runtime adapter

Write `src/gtfs-spec/adapter.ts` to derive all existing app exports from the spec at runtime. This replaces the codegen step entirely. The output must be functionally identical to what `gtfs.ts` and `gtfs-enums.ts` currently export so that Phase 15 is a straightforward swap.

Discovered during implementation:
- In **Zod v4** (used in this project), `describe()` sets the description as a direct property (`schema.description`) rather than in `_def.description`. The existing `zod-tooltip-helper.ts` already handles this correctly (checks `field.description` before `field._def.description`).
- For `allowEmpty` fields, the `.describe()` call must be placed on the union (`z.union([...]).describe(...).optional()`) not the inner validator, so the tooltip helper can find it after unwrapping `ZodOptional`.
- Two spec files were missing `isPrimaryKey: true`: `timeframes.txt` (`timeframe_group_id`) and `fare_leg_rules.txt` (`leg_group_id`) — both fixed during this phase.
- The compound type `'Non-null integer'` (pathways `stair_count`) is not in `GTFSFieldType` — handled by falling back to `mapGTFSTypeString`, which maps it to `Integer`.

- [x] Create `src/gtfs-spec/adapter.ts` exporting:
  - `deriveGTFSPrimaryKeys(spec)` → `Record<string, string>` (from `isPrimaryKey: true` fields)
  - `deriveGTFSFieldTypes(spec)` → `{ [filename]: { [fieldName]: string } }` (field `type` strings)
  - `deriveGTFSRelationships(spec)` → foreign key map (from `foreignKey` on fields)
  - `deriveGTFSTables(spec)` → `{ AGENCY: 'agency.txt', ... }` (filename → UPPER_CASE key, strip `.txt`, replace spaces/hyphens with `_`)
  - `deriveGTFSFiles(spec)` → `string[]`
  - `deriveGTFSEnums(spec)` → `Record<fieldName, GTFSEnumValue[]>` (from all `enumValues` across all files)
  - `deriveGTFSSchemas(spec, fieldTypeMeta)` → `Record<filename, ZodObject>` — builds Zod schemas using `GTFS_FIELD_TYPE_METADATA[field.type].zodValidator`, adds `.describe(field.description)`, applies `.optional()` for non-Required presence, and for `allowEmpty: true` fields wraps as `z.union([z.literal(''), baseValidator]).describe(description).optional()`
  - `deriveGTFSFileInfos(spec, schemas)` → `GTFSAdapterFileInfo[]` — full file metadata + schemas for replacing `GTFS_FILES`
- [x] Manually verify output matches current `gtfs.ts` exports for `agency.txt` and `stops.txt` (spot check) — all 19 primary keys match exactly, agency/stops schemas verified

---

## Phase 15 — App integration: swap imports, delete generated files

Replace the generated file exports with adapter-derived values. Import paths kept stable by making `gtfs.ts` and `gtfs-enums.ts` thin re-export wrappers rather than updating every import site across the app.

Discovered during implementation:
- `gtfs-entities.ts` could not use `z.infer<>` on the dynamically-built schemas (TypeScript cannot infer specific field shapes from runtime-derived `ZodObject`s). All entity types are instead aliased to `Record<string, any>` with an eslint-disable comment. Runtime validation is handled by the derived Zod schemas; TypeScript static typing is intentionally loose here.
- `gtfs.ts` was extended beyond thin re-exports: `GTFSFilePresence` enum kept for backward compat (values are identical to `GTFSPresence` strings), individual `*Schema` exports added as aliases into `GTFSSchemas[filename]` for consumers that destructure them, `GTFS_TABLES` retained as an explicit `as const` literal object (rather than using `deriveGTFSTables`) to keep narrow string-literal types, and utility functions `getFieldDescription`, `getFileSchema`, `getAllFieldDescriptions` added to centralize schema access patterns.
- `src/gtfs-spec.json` deleted as planned.

- [x] Update `src/types/gtfs.ts`: remove all generated content, replace with adapter-derived exports (thin wrapper with backward-compat additions)
- [x] Update `src/types/gtfs-enums.ts`: thin re-export of `deriveGTFSEnums(gtfsSpec)` output
- [x] Update `src/types/gtfs-entities.ts`: all entity types aliased to `Record<string, any>` (static inference not possible for dynamic schemas)
- [x] Delete `src/gtfs-spec.json`
- [x] Run `npm run typecheck` and fix any type errors
- [ ] Smoke-test the running app: open a feed, verify fields render correctly, confirm tooltips show descriptions, confirm enum dropdowns show correct options

---

## Phase 16 — Documentation

- [x] Create `docs/gtfs-implementation-status.md` with a table: `| File | File Presence | UI Support | Notes |` — one row per GTFS file, `UI Support` values: `Full`, `Partial`, `None`
- [x] Add a "GTFS Implementation Status" section to `README.md` with a link to that file
- [x] Remove any references to `npm run generate-gtfs-types` from `README.md` if present (none found)

---

## Phase 17 — locations.geojson (final)

`locations.geojson` is a GeoJSON file — not tabular, no CSV fields in the GTFS sense. Include a file entry with file-level metadata only.

- [x] Create `src/gtfs-spec/files/locations-geojson.ts` with `filename: 'locations.geojson'`, `format: 'geojson'`, `presence`, `description` verbatim from reference, `fields: undefined`
- [x] Add to `src/gtfs-spec/index.ts`
- [x] Verify adapter correctly skips this file when deriving schemas and primary keys

---

## Open questions / notes for future phases

- The `continuous_pickup` / `continuous_drop_off` "or empty" enum values appear in both `routes.txt` (Phase 4) and `stop_times.txt` (Phase 5). The value `1` means "No continuous stopping pickup" and an empty string is equivalent — this is a GTFS spec quirk. The enum value should store `value: 1` with the "or empty" equivalence noted in the description verbatim. If the UI ever needs to handle this distinction (e.g. normalizing empty → 1 on import), that's an app-layer concern, not spec-layer.
- `translations.txt`'s `table_name` enum values are GTFS filenames themselves — the spec lists exactly which tables are translatable. Copy that list verbatim.

---

## Original Issue

We should keep track of which parts of the spec we are supporting and which ones still need support. This can be done in an issue or in the repo or in the landing-zone (gtfs.zone landing page).
