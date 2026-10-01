# AGENTS.md

**GTFS.zone** is a browser-based GTFS transit data editor, inspired by geojson.io.
It is a client-only SPA: no backend, all data stays in the browser via IndexedDB.

## Commands

```bash
pnpm dev          # Vite dev server on port 8080
pnpm build        # Production build to dist/
pnpm serve        # Preview the production build
pnpm lint         # ESLint on src/ (lint:fix to auto-fix)
pnpm format       # Prettier
pnpm typecheck    # tsc --noEmit
pnpm check        # typecheck + lint + knip + check-spec
pnpm check-spec   # Diff src/gtfs-spec/ against the reference snapshot
pnpm vuln         # osv-scanner vulnerability gate
pnpm commit       # Commitizen prompt for a Conventional Commit
```

## Architecture

`GTFSEditor` in `src/index.ts` instantiates every module in `src/modules/` and wires them together via constructor injection and callbacks (no DI framework). There is no central store: GTFS data lives in IndexedDB (`GTFSDatabase`), navigation in the URL hash (`PageStateManager`), and everything else in the controller that owns it. Module groups and the state model are in [docs/architecture.md](docs/architecture.md).

App-wide tunables live in `CONFIG` in `src/config.ts`. GTFS types and their Zod schemas are in `src/types/`; use Zod for any new field validation.

### Shared modules (`gtfs-zone-web-common`)

Modules shared with the two realtime apps live in the `gtfs-zone-web-common` package, a git dependency shipping raw TypeScript with no build step. Import them as `gtfs-zone-web-common/ui/...`, `gtfs-zone-web-common/gtfs/...`, `gtfs-zone-web-common/map/...` and `gtfs-zone-web-common/util/...`; `tsconfig.json` `paths` and a `resolve.alias` in `vite.config.js` point both at `node_modules/gtfs-zone-web-common/src`. It includes the app shell (mounted by `src/shell.ts`, which `index.ts` must import first) and its stylesheet.

A shared change is a commit in gtfs-zone-web-common, a tag, and a bump in each consumer. It is not edited here.

Restart the dev server after a bump. The alias resolves through a pnpm symlink into the store, and Vite does not watch `node_modules`, so files whose transform is still cached keep importing the old store path: the page then holds two copies of a shared module, each with its own module-level state. Interlocking's `util/module-state` keeps that from corrupting anything and logs `loaded twice`.

### Spec layer

`reference/gtfs-reference.md` is a verbatim snapshot of the official GTFS Schedule reference and the single source of truth. `src/gtfs-spec/files/*.ts` mirrors it verbatim, and `src/gtfs-spec/adapter.ts` derives the Zod schemas, primary keys, enums and field types from there. `pnpm check-spec` blocks any drift from the pre-commit hook. Descriptions carry markdown and HTML, so render them through `renderSpecDescription` / `renderSpecDescriptionPlain` in `gtfs-zone-web-common/gtfs/spec-markup`. See [reference/README.md](reference/README.md) for how to refresh the snapshot.

## Development philosophy

- **Reliability over performance**: correctness and predictability come first. Optimize only when a measured bottleneck warrants it.
- **Simplicity over abstraction**: three similar lines of code are better than a premature abstraction.
- **No backwards-compatibility hacks**: users can reset the database (Settings -> Reset) rather than us shipping migration shims.
- **Logging for debuggability**: `console.log` / `console.warn` at key state transitions (patch recording, DB writes, navigation), with a `[ModuleName]` prefix.
- **Fail loudly**: prefer throwing or logging errors over silent fallbacks.

Invariants (details in [docs/architecture.md](docs/architecture.md)):

- [Every user edit goes through the patch system](docs/architecture.md#patch-system).
- [Virtual table queries return copies](docs/architecture.md#copy-on-read), not live rows.
- [Networks are canonical as `networks` + `route_networks`](docs/architecture.md#networks); never write `routes.network_id` outside export.
- [Extension fields are derived from row data](docs/architecture.md#extension-fields), never hardcoded or added to the Zod schemas.
- [No IndexedDB request is awaited without a timeout](docs/architecture.md#indexeddb-requests), and no connection blocks another tab's upgrade.
- [Never yield with `setTimeout` on a long job](docs/architecture.md#yielding-on-long-jobs); use `yieldToEventLoop`.
- [Feed-scoped caches key on `feedGeneration` or subscribe to `onFeedReplaced`](docs/architecture.md#feed-scoped-caches).

## Conventions

- **Commits**: Conventional Commits, enforced by `commitlint` in the `commit-msg` hook. `pnpm commit` helps build one; plain `git commit` works too.
- **TypeScript**: strict mode, with `noUnusedLocals` and `noUnusedParameters`. Remove unused code rather than suppressing.
- **CSS**: Tailwind CSS v4 + DaisyUI v5, configured in `src/styles/main.css` (no `tailwind.config.js`). The `@source` pointing into `node_modules/gtfs-zone-web-common/src` is what styles the shared modules. Write styles with Tailwind utility classes.
- **UI**: conventions live in gtfs-zone-web-common's `AGENTS.md`.
- **Testing**: no automated tests; changes are checked manually.
