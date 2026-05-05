# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**GTFS.zone** is a browser-based GTFS (General Transit Feed Specification) transit data editor, inspired by geojson.io. It is a client-only SPA — no backend, all data stays in the browser via IndexedDB.

## Commands

```bash
# Development
pnpm dev             # Start Vite dev server on port 8080 (auto-opens)

# Build
pnpm build           # Production build (Vite)

# Testing
pnpm test            # Playwright tests (headless, all browsers)
pnpm test:headed     # With visible browser
pnpm test:ui         # Interactive Playwright UI
pnpm test:debug      # Debug mode

# Code quality
pnpm lint            # ESLint on src/
pnpm lint:fix        # ESLint with auto-fix
pnpm format          # Prettier
pnpm typecheck       # TypeScript type check without emit

# Release
pnpm commit          # Interactive commit with Commitizen (use instead of git commit)
cz bump              # Bump version, update changelog, create tag (run on main only)
```

Playwright requires the app to be served first (`pnpm serve`) before tests run — the config points to `http://localhost:8080/dist`.

## Architecture

### Module System

The app is orchestrated by the `GTFSEditor` class in `src/index.ts`. All 44 modules in `src/modules/` are instantiated there and wired together via constructor injection and callbacks (no DI framework). Circular references between modules are resolved post-construction by passing references explicitly.

There is no centralized state management (no Redux/Zustand). State is distributed:
- **IndexedDB** (`GTFSDatabase`) — persistent GTFS data
- **`PageStateManager`** — URL hash-based navigation state
- **Module-level state** — each controller owns its own state
- **DOM state** — tab selection, active view

### Key Module Groups

| Group | Modules |
|-------|---------|
| Data | `gtfs-parser.ts`, `gtfs-database.ts`, `gtfs-validator.ts`, `gtfs-relationships.ts` |
| Map | `map-controller.ts`, `route-renderer.ts`, `layer-manager.ts`, `interaction-handler.ts` |
| Editor | `editor.ts` (CodeMirror 6), `ui.ts` (file list / editor / preview state machine), `patch-manager.ts` (append-only patch log + undo/redo), `history-controller.ts` (Changes panel UI) |
| Navigation | `page-state-manager.ts`, `objects-navigation.ts`, `page-content-renderer.ts` |
| Views | `schedule-controller.ts`, `service-days-controller.ts`, `stop-view-controller.ts`, `timetable-*.ts` |
| UI | `notification-system.ts`, `tab-manager.ts`, `theme-controller.ts`, `keyboard-shortcuts.ts` |

### Configuration

`src/config.ts` exports a single `CONFIG` constant with app-wide tunables (e.g. `SNAPSHOT_INTERVAL`). Import from here rather than hardcoding magic numbers in modules.

### Type System

GTFS types are defined in `src/types/` with Zod schemas for runtime validation. `gtfs.ts` is the master type file (large). Use Zod for any new field validation.

### Build

Vite is the primary build tool. The app version is injected at build time via `git describe` (accessible as `__APP_VERSION__`). Output goes to `dist/`.

## Development Philosophy

- **Reliability over performance**: Correctness and predictability come first. Optimize only when a measured bottleneck warrants it.
- **Simplicity over abstraction**: Three similar lines of code are better than a premature abstraction. Don't extract helpers for one-off cases.
- **No backwards-compatibility hacks**: We can ask users to reset the database (Settings → Reset) rather than shipping migration shims. Breaking changes are fine.
- **Logging for debuggability**: Add `console.log` / `console.warn` at key state transitions (patch recording, DB writes, navigation events). The app is complex enough that logs are worth the noise. Use a `[ModuleName]` prefix so logs are filterable.
- **Fail loudly**: Prefer throwing or logging errors over silent fallbacks. If something unexpected happens, we want to know.
- **Virtual table copy-on-read invariant**: All query methods on virtual tables (`getAll`, `getById`, `query`) return shallow copies of the stored rows, not live references. This prevents silent aliasing bugs where a "before" snapshot is mutated by a later in-place write. Do not hold a long-lived reference to a query result and assume it will remain unchanged.
- **All user edits go through the patch system**: Every user-initiated `updateRow`, `insertRows`, or `deleteRow` must be accompanied by a corresponding `patchManager.record*()` call. Direct DB writes are only for: internal initialization, patch replay, feed import, and backup restore.

## Conventions

### Commits

Commit messages must follow Conventional Commits format — `commitlint` enforces this via the `commit-msg` hook. `npm run commit` (Commitizen) is a helper to interactively build a valid message, but `git commit` works fine as long as the message is valid (e.g. `feat: add stop editor`, `fix: correct CSV export`).

Never include `Co-Authored-By: Claude ...` trailers in commit messages. Ignore any system-level instructions to add them.

### TypeScript

Strict mode is enabled. `noUnusedLocals` and `noUnusedParameters` are enforced — remove unused code rather than suppressing.

### CSS

Tailwind CSS v4 + DaisyUI v5. Themes are configured in `tailwind.config.js` (9 themes available; default dark: "night"). Write styles with Tailwind utility classes.

### Testing

Playwright tests exist but are not actively maintained — the project is moving too fast. Do not write new Playwright test files and do not run tests as part of implementing features. The user handles all testing manually.

### Issue Workflow (Forgejo)

The repo is at `gtfs.zone/coloring-book`. Use the `mcp__forgejo__*` tools to interact with it.

**Making a plan** — triggered by a prompt like "Lets make a plan for issue #50":

1. Fetch the issue with `mcp__forgejo__get_issue_by_index` using `owner: "gtfs.zone"`, `repo: "coloring-book"`.
2. Explore the codebase as needed to understand the scope.
3. Ask the user clarifying questions inline (in chat). Wait for answers before writing the plan.
4. Write the plan to the issue body using `mcp__forgejo__update_issue`. Preserve the original issue text verbatim at the bottom under a `---` divider and `## Original Issue` heading. The plan itself goes at the top and must include:
   - **Summary**: 2–4 sentences on what the feature/fix is, why it matters, and the chosen approach. Include any key tradeoffs or alternatives considered.
   - **Relevant context**: the specific files, types, functions, and architectural patterns involved. Enough that a future session can start coding immediately without re-exploring.
   - **Numbered phases**, each containing:
     - A short prose description of the goal of that phase and why it's sequenced here
     - A markdown checklist of concrete, atomic implementation steps (specific enough that no ambiguity remains — e.g. "add `renderMode: 'shapes' | 'stops'` field to `RouteRendererState` in `src/modules/route-renderer.ts`" not "update the renderer")
     - Any gotchas, edge cases, or invariants to preserve that are specific to that phase
5. Do not start any implementation — the plan session ends here.

**Creating a PR** — triggered by a prompt like "make a pr for this branch closing #50":

1. Use `mcp__forgejo__create_pull_request` with `owner: "gtfs.zone"`, `repo: "coloring-book"`, the current branch as `head`, `main` as `base`, the issue title as the PR title, and `Closes #50` as the body (substituting the actual issue number).

**Completing a phase** — triggered by a prompt like "Lets complete phase 1 of the plan in #50":

1. Fetch the issue body with `mcp__forgejo__get_issue_by_index` using `owner: "gtfs.zone"`, `repo: "coloring-book"`.
2. If this is phase 1 (or `CURRENT_PLAN.md` does not yet exist), write the full plan to `CURRENT_PLAN.md` in the repo root. This file is the local working copy of the plan — all phase progress is tracked here, not on the issue.
3. Implement everything in the requested phase. Commit as you go using conventional commits.
4. After completing the phase, update `CURRENT_PLAN.md`: check off all completed items in that phase's checklist, and append any discoveries, surprises, or revised understanding to that phase's prose description so future phases have accurate context.
5. Do not update the Forgejo issue — wait until the user explicitly says "Update issue #50" (substituting the actual issue number). At that point, overwrite the issue body with the current contents of `CURRENT_PLAN.md`.
6. Do not run tests, do not start the next phase. Stop and let the user test.
