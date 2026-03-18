# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**GTFS.zone** is a browser-based GTFS (General Transit Feed Specification) transit data editor, inspired by geojson.io. It is a client-only SPA — no backend, all data stays in the browser via IndexedDB.

## Commands

```bash
# Development
npm run dev          # Start Vite dev server on port 8080 (auto-opens)

# Build
npm run build        # Production build (Vite)

# Testing
npm test             # Playwright tests (headless, all browsers)
npm run test:headed  # With visible browser
npm run test:ui      # Interactive Playwright UI
npm run test:debug   # Debug mode

# Code quality
npm run lint         # ESLint on src/
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier
npm run typecheck    # TypeScript type check without emit

# Release
npm run commit       # Interactive commit with Commitizen (use instead of git commit)
cz bump              # Bump version, update changelog, create tag (run on main only)
```

Playwright requires the app to be served first (`npm run serve`) before tests run — the config points to `http://localhost:8080/dist`.

## Architecture

### Module System

The app is orchestrated by the `GTFSEditor` class in `src/index.ts`. All 42 modules in `src/modules/` are instantiated there and wired together via constructor injection and callbacks (no DI framework). Circular references between modules are resolved post-construction by passing references explicitly.

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
| Editor | `editor.ts` (CodeMirror 6), `ui.ts` (file list / editor / preview state machine) |
| Navigation | `page-state-manager.ts`, `objects-navigation.ts`, `page-content-renderer.ts` |
| Views | `schedule-controller.ts`, `service-days-controller.ts`, `stop-view-controller.ts`, `timetable-*.ts` |
| UI | `notification-system.ts`, `tab-manager.ts`, `theme-controller.ts`, `keyboard-shortcuts.ts` |

### Type System

GTFS types are defined in `src/types/` with Zod schemas for runtime validation. `gtfs.ts` is the master type file (large). Use Zod for any new field validation.

### Build

Vite is the primary build tool. The app version is injected at build time via `git describe` (accessible as `__APP_VERSION__`). Output goes to `dist/`.

## Conventions

### Commits

Commit messages must follow Conventional Commits format — `commitlint` enforces this via the `commit-msg` hook. `npm run commit` (Commitizen) is a helper to interactively build a valid message, but `git commit` works fine as long as the message is valid (e.g. `feat: add stop editor`, `fix: correct CSV export`).

### TypeScript

Strict mode is enabled. `noUnusedLocals` and `noUnusedParameters` are enforced — remove unused code rather than suppressing.

### CSS

Tailwind CSS v4 + DaisyUI v5. Themes are configured in `tailwind.config.js` (9 themes available; default dark: "night"). Write styles with Tailwind utility classes.

### Testing

Playwright tests live in `tests/`. The dev server must be running on port 8080 with built assets in `dist/`. Run `npm run build && npm run serve` before running tests in CI.
