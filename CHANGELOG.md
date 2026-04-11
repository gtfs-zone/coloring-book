## v0.13.1 (2026-04-11)

### Fix

- link to gtfs zone and clean

## v0.13.0 (2026-04-11)

### Feat

- grey-out undo/redo buttons and show descriptive hover tooltips
- wire Files and History modals in TypeScript (#82 phase 2)
- replace right-panel tabs with persistent modals (HTML only)
- redesign Feed loaded baseline as a clickable change card
- remove per-patch revert buttons and dead revertPatch method

### Fix

- use history icon and fix tooltip dir

## v0.12.0 (2026-04-11)

### Feat

- force-update exception_type on duplicate date (phase 5)
- batch patch recording for add/remove pattern group
- add addPatternGroup, removePatternGroup, addPatternGroupFromForm methods
- add pattern matching and updated renderExceptions for holiday groups
- add holiday pattern infrastructure (us-federal)
- add touch event handlers for mobile stop drag
- wire deleteRow proxy and refresh map after stop deletion (#48 phase 4)
- implement handleDeleteStop with FK-aware cascade modal (#48 phase 2)
- add delete stop button to stop view UI (#48 phase 1)

### Fix

- remove duplicate stop creation/move notifications from map-controller
- move notification container down to clear search card overlap
- prevent delete listener accumulation with AbortController
- group cascade delete into one batch patch, fix revertPatch inversion for batch ops
- use event delegation for delete stop button and add debug logs (#48 phase 3)

## v0.11.0 (2026-04-08)

### Feat

- **mobile**: add bottom-sheet padding to all map auto-zoom operations
- **mobile**: move search to map overlay, unify desktop/mobile search, reposition notifications
- **mobile**: phase 3 DaisyUI dock + BottomSheetController v2
- **mobile**: clear page state when switching to Files or Changes tab
- **mobile**: phase 2 BottomSheetController and dual search input
- **mobile**: phase 1 HTML/CSS skeleton for mobile layout
- **layout**: add adjustable panel resizer with drag handle
- **layout**: replace hardcoded 650px grid column with CSS variable
- **url**: add #load= command and remove legacy URL handling
- **page-state**: enable hash-based URL sync for focused object
- **about-modal**: wire up about button, remove help tab, add dismissable to modals
- **about-modal**: add showAboutModal module with shortcuts table and resource links
- **modal**: add dismissable + scrollable modal support
- **tab-lock**: block keyboard shortcuts in inactive tabs
- **tab-lock**: add TabLockController with BroadcastChannel coordination and blocking overlay

### Fix

- fix web scrollbox size
- **mobile**: add overflow: hidden to html element to eliminate micro-scroll
- **mobile**: switch basemap controls to position: fixed above dock
- **mobile**: give #right-panel .tabs a definite height to unblock scroll container
- **mobile**: fix load button icon and raise dropdown z-index above map controls
- **mobile**: set height 100% on right-panel tab-content to fix scroll collapse
- **mobile**: use dvh units and ResizeObserver for dock height
- **mobile**: position basemap control above dock on mobile
- **mobile**: sync --dock-height from actual dock measured height
- **mobile**: disable overscroll bounce on html and body
- polyfill crypto.randomUUID for non-HTTPS mobile browsers
- preserve timetable scroll using capture-phase listener
- capture timetable scrollLeft before async renderSchedule call
- preserve timetable horizontal scroll in browse-navigation re-render
- preserve timetable horizontal scroll on in-place re-render
- preserve browse panel scroll position on in-place re-render
- allow bigger side panel

### Refactor

- rm improper prior fixes

## v0.10.0 (2026-04-06)

### Feat

- **ui**: replace map tool buttons with joined radio group
- **map**: highlighted stop draggable in navigate mode, remove EDIT_STOPS
- **map**: navigate home on empty map click
- **atlas**: replace includes() filter with uFuzzy for fuzzy atlas search
- **ui**: replace 'Need Help?' with error detail modal on URL load failure
- **atlas**: add Search Atlas dropdown item and modal
- **ui**: add From URL option to Load dropdown
- **atlas**: add generate-atlas-data script and commit atlas-feeds.json
- **field-component**: show empty-equivalent value in dropdown placeholder
- **field-component**: prefix enum option labels with numeric value
- **field-component**: clickable spec links on info, presence, and lock icons
- **field-component**: presence colors and conditional hover on asterisk mark
- **gtfs-spec**: phase 17 — add locations.geojson spec entry
- **gtfs-spec**: phase 15 — swap app imports to adapter-derived exports, delete generated files
- **gtfs-spec**: phase 14 — add runtime adapter deriving all GTFS exports from spec
- **gtfs-spec**: phase 13 — add translations.txt and attributions.txt spec files
- **gtfs-spec**: phase 12 — add location_groups, location_group_stops, and booking_rules spec files
- **gtfs-spec**: phase 11 — add 6 compact spec files
- **gtfs-spec**: phase 10 — add Fares v2 spec files
- **gtfs-spec**: phase 9 — add fare_attributes.txt and fare_rules.txt spec files
- **gtfs-spec**: phase 8 — add pathways.txt and levels.txt spec files
- **gtfs-spec**: phase 7 — add shapes.txt, frequencies.txt, and transfers.txt spec files
- **gtfs-spec**: phase 6 — add calendar.txt and calendar_dates.txt spec files
- **gtfs-spec**: phase 5 — add stop_times.txt spec file
- **gtfs-spec**: phase 4 — add routes.txt and trips.txt spec files
- **gtfs-spec**: phase 3 — add stops.txt spec file
- **gtfs-spec**: phase 2 — add agency.txt and feed_info.txt spec files
- **gtfs-spec**: phase 1 — add spec types, stub index, delete scraper/codegen

### Fix

- **layout**: prevent right panel from overflowing viewport
- **map**: highlight circle follows stop during drag
- **schedule**: record patch when toggling from unlinked to linked input
- **timetable**: remove duplicate success notifications for time edits
- **timetable**: coerce stop_sequence to number in getStopTime for patch recording
- **schedule**: record patches when clearing arrival/departure times
- **schedule**: remove duplicate success notification in updateTripProperty
- **schedule**: correct trips.txt key and add no-op guard in updateTripProperty
- **knip**: restore knip.config.ts, remove dead deps and exports

## v0.9.0 (2026-03-31)

### Feat

- **parser**: move ZIP/CSV parsing to Web Worker
- remove dead load-data-first guards in add/edit stops modes
- always show Feed Information block on home page
- always show all file sections and keep export button enabled
- remove welcome overlay and map overlay methods
- always initialize empty feed on startup
- **basemap-control**: add shape/stops render mode toggle (#50)
- **route-renderer**: add render mode toggle (shapes vs stops)

### Fix

- fix bug with new feeds not showing stops and trips
- seed feed_info row and fix array aliasing in initializeEmpty
- use cleaner bg color'
- **notifications**: use DaisyUI alert structure with SVG icons, always expire
- **notifications**: use DaisyUI semantic colors, remove emojis, move to bottom-left

### Refactor

- knip
- **loading**: clean split between progress indicator and notification toasts

## v0.8.0 (2026-03-30)

### Feat

- phase 1-4
- add ability to change stops in the timetable
- finish patch integrity plan

### Fix

- phase 5
- typeos from linting
- allow trips with repeat stops
- allow dupliacate stops for trips
- fix the deletion of all stops on new stop
- phase 5 + 6
- finish phase 3
- mostly working phase 3
- stops patch load fix
- phase 1
- fix and simplify timetable inbound/outbound

### Refactor

- knip
- strengthen husky
- knip
- fix typecheck and lint errors
- knip
- pass knip

## v0.7.0 (2026-03-27)

### Feat

- simplify db upgrades with export and clear

### Fix

- doesn't completely crash loading mbta

### Refactor

- remove the fallback database
- cleaning

### Perf

- loads MBTA!
- treat all files as the same (big)
- special case large files
- faster feed loading
- remove debug logs and dead code

## v0.6.2 (2026-03-25)

### Fix

- phase 5
- phase 4
- phase 2a+b
- phase 1

## v0.6.1 (2026-03-24)

### Fix

- make gtfsDatabase required in ContentRendererDependencies, remove null-guards

## v0.6.0 (2026-03-23)

### Feat

- phase 6 complete of #3
- phase 4 complete of #3
- phase 3 of patches

### Fix

- fix compress stack overflow, revert refresh, snapshot perf, and stale docs
- fix snapshot load
- fix insert and duplicate issue
- phase 2 #3
- phase 1 of the follow on

### Refactor

- add config

## v0.5.2 (2026-03-19)

### Refactor

- finish renaming to subdomain

## v0.5.1 (2026-03-19)

## v0.5.0 (2026-03-19)

### Feat

- rename gtfs.zone to edit.gtfs.zone
- phase 6 complete of #3
- phase 4 complete of #3
- phase 3 of patches

### Fix

- fix compress stack overflow, revert refresh, snapshot perf, and stale docs
- fix snapshot load
- fix insert and duplicate issue
- phase 2 #3
- phase 1 of the follow on

### Refactor

- add config
- remove all of the npm version stuff to stick with cz
- rm unused files

### Perf

- npm update

## v0.4.1 (2025-12-24)

### Feat

- ability to add new services
- implement handling of different gtfs field types
- **map**: add projection and basemap controls
- add feed info to the home browse page
- add properties to the agency page
- **timetable**: added trip properties editing in timetable
- **development**: use semantic-release and related tools

### Fix

- slight styling improvements to the map
- compromise with tooltips and scrolling
- **stop-page**: simplify the stop page
- **dev**: deprecated husky issue
