# GTFS reference snapshot

`gtfs-reference.md` is a verbatim copy of the official GTFS Schedule reference.

- Source: https://raw.githubusercontent.com/google/transit/master/gtfs/spec/en/reference.md
- Revision: **April 27, 2026**

It is the single source of truth for every file name, field name, type string,
presence value, and description in `src/gtfs-spec/`. `pnpm check-spec` diffs the
two and fails on any difference that is not listed in the script's
`KNOWN_DIVERGENCES`. It runs from `.husky/pre-commit`, so drift blocks a commit.

## Refreshing the snapshot

1. Re-download the file over `reference/gtfs-reference.md` and update the
   revision date above and `specVersion` in `src/gtfs-spec/index.ts`.
2. Run `pnpm check-spec` to get the full drift report. `pnpm check-spec <file>`
   restricts it to named files; `--full` also prints the raw reference strings,
   which is what goes into the spec files.
3. Fix each difference in `src/gtfs-spec/files/*.ts` until the checker exits
   zero. Descriptions and type strings are stored verbatim; the curated extras
   (enum short labels, `foreignKey`, `isPrimaryKey`, `presenceCondition`,
   `allowEmpty`) are hand-written and are not checked.
4. New or renamed fields also need a look at `src/utils/gtfs-primary-keys.ts`,
   `src/types/gtfs-field-types.ts` (a new type string needs a `GTFSFieldType`
   member and a formatter), and any images the new descriptions embed, which are
   vendored into `src/assets/gtfs-spec/`.
