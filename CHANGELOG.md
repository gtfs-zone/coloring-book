## v0.32.0 (2026-09-07)

### Feat

- **route**: add a timetable button to the route header

### Refactor

- **modal**: port the Files and History modals to showModal

## v0.31.0 (2026-09-07)

### Feat

- **load**: stage feed imports in a generation and cut over atomically

## v0.30.0 (2026-09-06)

### Feat

- **timetable**: accept plain minutes in the trip time offset
- **timetable**: add copy, reverse and shift trip actions
- **map**: add an auto-zoom toggle to the map controls
- **services**: prune out-of-range exceptions on trim and extend
- **map**: draw direction arrows on the spotlighted route
- **dates**: add a today shortcut to date pickers
- **services**: create a service from the timetable and route pages
- **help**: reorder publishing guide and add a realtime step
- **help**: inline links in the publishing guide
- **services**: readable dates and holiday names in exception lists
- **shapes**: editable shapes and zones via geojson.io, guided on-demand setup
- **timetable**: move the timetable into a hash-routed modal

### Fix

- **modal**: keep the keyboard inside an open modal
- **timetable**: use the portal tooltip for the trip_id header
- **map**: apply the persisted auto-zoom state on boot
- **zones**: keep geometry-less features and validate them
- **zones**: persist locations.geojson, edit zone name and description
- **services**: read feed bounds from any feed_info row and surface bulk trim/extend

### Refactor

- **navbar**: render the action row from a descriptor list
- **map**: always use the globe projection
- **modals**: share the creation form and the sidebar modal
- **help**: drop the "don't show again" checkbox
- **shortcuts**: drop the Ctrl+N new-feed shortcut

### Perf

- **load-modal**: open the modal before the feed list loads

## v0.29.0 (2026-08-27)

### Feat

- **help**: merge About modal into the help menu

## v0.28.0 (2026-08-27)

### Feat

- **service**: add a "Create timetable" action to the service view
- **help**: add in-app help modal with first-run tips
- **load**: make the continue card's edit count optional
- **nav**: verbose two-line breadcrumbs and page titles
- **load-modal**: lead with the search, move the URL block to the bottom
- **boot**: open the load modal first, with a continue card
- **map**: replace the projection toggle icons with a globe and a graticule
- **timetable**: couple arrival and departure on a single time edit

### Fix

- **timetable**: stop clobbering untouched cell editors on rebuild
- **pathway**: show a persistent hint while in ADD_PATHWAY mode
- **nav**: attach breadcrumb listener once, add focus-after-render
- **pathway**: style From/To endpoints as breadcrumb-style crumbs
- **nav**: stack breadcrumb crumbs instead of daisyUI's row
- **map**: keep a new stop on a small feed visible and clickable
- **map**: vacate the old geometry bucket on every stop_times op
- **timetable**: stop a route with no trips from breaking add stop
- **map**: do not navigate on a click that closes an inline editor

### Refactor

- **load**: return a discriminated result from the load modal
- **vocab**: call a static feed a scheduled feed
- **map**: remove the route geometry toggle

## v0.27.1 (2026-08-21)

### Refactor

- **types**: drop dead flex/extension helpers and the file presence enum

### Perf

- **load**: coalesce download progress and stop copying the feed twice

## v0.27.0 (2026-08-20)

### Feat

- **about**: break the blurb into paragraphs and bullets, link the manager
- **about**: share the About modal link blocks and add SEO metadata
- **load**: let a feed download be cancelled from the progress bar
- **load**: share a byte-progress feed downloader
- **map**: highlight the stop and transfer edge under a hovered table row
- **timetable**: place, remove and re-sort stop_time rows explicitly
- **pickers**: show spec descriptions on their own line in option pickers

### Fix

- **inline-edit**: raise enum menu above modals
- **route-sequence**: align stop visit indices across patterns by LCS
- **timetable**: keep the frozen label column aligned with its sub-rows

## v0.26.2 (2026-08-18)

## v0.26.1 (2026-08-18)

### Feat

- **timetable**: labeled sub-rows for frequency periods
- **pickers**: one trigger shape and manager footers for picker modals
- **fields**: show and edit non-spec extension columns
- **timetable**: portal tooltips on icon-only controls
- **home**: attributions section on the home page
- **transfers**: stop page section and focused-stop map edges
- **feed-data**: editor for transfers, attributions and translations
- **files**: show and edit non-spec passthrough files
- **timeline**: vertical marker for today in service timelines
- **timeline**: sort service rows by date range, then trip count
- **timeline**: clickable route headers on the stop view and per-service trip counts
- **validator**: report frequencies.txt row, overlap and duplicate-key problems
- **timetable**: compact-mode flag row for the nine non-time stop_time fields
- **timetable**: decorate stop_time cells with conditional-presence state
- **timetable**: sub-row grid for stop_times and a frequencies band
- **timetable**: add stop_time field model and frequency data path
- **flex**: make a zone row editable on every trip
- **flex**: edit pickup/drop-off types and booking rules from the timetable
- **flex**: make the zone page a real GeoJSON editor
- **flex**: add on-demand rows from the timetable
- **flex**: fit the viewport to zones and shapes, not just stops
- **flex**: make zones and location groups clickable and hoverable
- **flex**: add the On-Demand modal and flex validation
- **flex**: add browse pages for zones and location groups
- **flex**: render on-demand zones on the map with a geojson.io round-trip
- **flex**: render on-demand stop_times inline in the timetable
- **flex**: generalize stop_time references through the sequence pipeline
- **flex**: add StopTimeRef types and fix flex presence conditions

### Fix

- point CORS proxy at cors.kcfam.us
- point CORS proxy at cors.kcfam.us
- **load**: do not block an http feed URL that goes through the proxy
- **edit**: record field edits that only change surrounding whitespace
- **flex**: decode pasted geojson.io share links instead of fetching them

## v0.26.0 (2026-08-15)

### Feat

- **load**: unify the feed loading process with test-track

### Fix

- **load**: pin the modal height so only the result list scrolls

## v0.25.0 (2026-08-15)

### Feat

- **feed-issues**: re-run validation when the panel draws stale issues
- **service**: commit date-range edits on blur or picker choice
- **export**: name the export archive after the feed
- **editor**: move between rows in the Files table from the keyboard
- **timetable**: navigate the grid without opening an editor
- **timetable**: navigate between time cells from the keyboard
- **levels**: lock the level id and badge the level count
- **levels**: edit levels through the spec-driven table
- **levels**: show stop usage and share the shapes list chrome
- **shapes**: show routes and trip counts in the shapes list
- **option-picker**: pin a blank row that excludes the other options
- **fares**: make list and membership columns editable
- **option-picker**: add a multi-select mode with checkboxes
- **fares**: show a route list detail for networks, matching areas
- **fares**: list repeated foreign keys instead of duplicating rows
- **editable-table**: support list-valued columns via row grouping
- **services**: add week tooltips and a service edit column to the timeline
- **services**: use the timeline view on the home, route and stop pages
- **route**: draw the full route diagram on the route page
- **timetable**: focus and highlight stops from the stop column
- **issues**: surface and fix dangling references at the use site
- **issues**: list the offending entities under each feed issue
- **validation**: check every spec-declared foreign key generically
- **navbar**: show item counts as badge bubbles
- **shapes**: upload GPX first and default the shape id to the filename
- **navbar**: use the brouter waypoints icon for the shapes button
- **validation**: surface feed issues in the home panel
- **time**: accept fuzzy time input on all Time fields, not just the timetable
- **validation**: check fares v2 conditional presence and referential integrity
- **fares**: edit timeframes and the three fares v2 rule tables
- **fares**: edit areas from the fares modal and the stop page
- **networks**: assign routes to networks from the route page
- **fares**: add the Networks table to the fares modal
- **networks**: canonicalize networks on import and export
- **fares**: rebuild the fares modal on the spec-driven table
- **ui**: move the remaining entity pages to click-to-edit
- **ui**: add click-to-edit entity property fields
- **ui**: add the spec-driven editable table
- **spec**: render verbatim reference descriptions as HTML
- **spec**: make the GTFS spec layer verbatim against the April 2026 reference
- **spec**: add check-spec conformance harness

### Fix

- **map**: keep the map focus tied to the page actually being shown
- **history**: badge the number of applied changes, not the version
- **feed-issues**: link a flagged trip to its timetable
- **export**: stop the CSV writer appending a newline to the last value
- **validation**: report references broken by hidden whitespace
- **tooltips**: match triggers when the pointer lands on an svg icon
- **shapes**: give the route chip a pointer cursor
- **fares**: restore field tooltips on table headers
- **files-modal**: make list scrollable, reset to list view on reopen, keep fixed size
- **option-picker**: never cap the selected options in multi-select
- **option-picker**: give the blank row a pointer cursor and hover
- **tooltips**: raise the tooltip portal above the modal layer
- **services**: one date range tooltip per highlighted span
- **services**: use the unified tooltips in the services timeline
- **map**: spotlight the stations above a highlighted route's stops
- **strip**: restore endpointNote and isMinority for the shared strip module
- **issues**: identify the offending row and value for invalid dates
- **modals**: scope Escape/Enter handling to the topmost modal
- **ui**: stop opening the files modal after loading a feed
- **feed**: reset in-memory state on new/replacement feed load
- **ui**: resolve tooltip clipping and route page horizontal scroll
- **tooltip**: make field label tooltips edge-aware and clip-safe

### Refactor

- **types**: drop unused zod tooltip helpers and schema exports
- **map**: extract shared stop layer styles
- **icons**: replace glyph characters with svg icons
- **calendar**: extract the services timeline into a shared module
- **ui**: extract the click-to-edit primitives from the timetable

## v0.24.1 (2026-08-05)

## v0.24.0 (2026-08-05)

### Feat

- **map**: render pathways and station geometry with theme-aware styling
- **timetable**: freeze and tighten the stop column
- **timetable**: dedicated trip actions row with routing icon
- **timetable**: add stops via searchable modal
- **timetable**: pick stops via searchable modal
- **timetable**: edit trip properties in place
- **timetable**: add searchable option-picker modal
- **strip**: show endpoint, minority and revisit facts
- **timetable**: draw the route strip in the stop column
- **timetable**: label directions by headsign
- **route-sequence**: port the shared route engine from test-track
- **timetable**: edit time cells in place

### Fix

- **map**: show pointer cursor over routes

### Refactor

- **timetable**: render trip properties as text
- **scs**: drop the unused alignment helpers
- **timetable**: derive rows from the route sequence

### Perf

- **timetable**: memoize timetable data
- **timetable**: update one cell instead of the table
- **timetable**: render time cells as text
- **timetable**: fill the shape_id picker on demand
- **timetable**: remove the per-row full-feed stop select

## v0.23.2 (2026-08-04)

## v0.23.1 (2026-08-04)

### Fix

- knip

## v0.23.0 (2026-08-04)

### Feat

- **map**: fade stations by zoom on a gentler band than plain stops
- **map**: mute hashed route colors with a perceptual OKLCH ramp
- **map**: order route lines by mode, trip count, and focus
- **search**: prioritize stations, then routes, then stops
- **search**: fuzzy map search wired to page state

## v0.21.1 (2026-08-02)

### Fix

- **scs**: fold pairwise with an iterative two-sequence DP

## v0.21.0 (2026-07-17)

### Feat

- **map**: case route lines and add spotlight selection styling
- **notifications**: unify change wording via humanLabel

### Fix

- **map**: make MapController the sole owner of route spotlight state
- **notifications**: wrap long ids and highlight entity tokens

### Refactor

- **map**: drop single-element forEach wrappers, dedupe focused expr
- **map**: reuse indexed getStopIdsForRoute in flyToRoute/fitToRoutes
- **map**: centralize spotlight/fade constants in CONFIG
- **notifications**: patch spot is sole emitter for entity creates
- **notifications**: collapse to one notify API and fix toast overflow

## v0.20.0 (2026-05-26)

### Feat

- **gtfs-parser**: preserve unrecognized files as passthrough for export

### Fix

- **ui**: replace levels button text label with icon-only square button
- **gtfs-parser**: enable DEFLATE compression on ZIP export
- **timetable-database**: use 0-based stop_sequence indexing
- **gtfs-parser**: add trailing newline to all exported CSV files
- **gtfs-parser**: preserve full coordinate precision and field whitespace on import

## v0.19.1 (2026-05-26)

### Fix

- **layer-manager**: invalidate coord resolver on full map reload

## v0.19.0 (2026-05-25)

### Fix

- **route-renderer**: guard clearHighlight against uninitialized layers

## v0.18.1 (2026-05-25)

### Fix

- **layer-manager**: suppress coord warning for generic nodes and boarding areas

## v0.18.0 (2026-05-25)

### Feat

- polish timeline — dynamic label width, weekday dots, DaisyUI tooltips on exception ticks
- polish month grid — scrollable cells, full IDs, feed date markers
- implement timeline/gantt tab in calendar modal
- add calendar modal with month grid view
- show FeedProgressIndicator during restore on page refresh
- add map key section to about modal
- show coord-less stops with grey outline on map
- lay out coord-less child stops via pathway graph instead of circle
- append stop_id to child-stop labels universally

### Fix

- **calendar-modal**: fix timeline week order and add days-of-week tooltip
- **basemap-control**: prevent invisible container from blocking map clicks
- **entity-references**: escape route_id and service_id in data-* attrs
- **interaction-handler**: route add-pathway click through queryFeaturesOnLayers
- **map-controller**: replace falsy-zero stop coord checks with hasValidCoords
- **pathway-view**: attach delete handler to button elements, not container
- restore pathway layer after basemap change
- restore basemap FAB position within map container
- revert watercolor maxzoom to 16, redesign basemap FAB to vertical with labels
- correct maxzoom values based on live tile testing
- add maxzoom to all raster sources and update satellite icon
- restore pathways layer after basemap/projection switch
- show id for pathways
- drop empty-coord stops from station fly-to bounds
- highlight pathway and zoom to station on side-panel/URL navigation
- properly escape CSV writes and drop (0,0) from feed fit-bounds
- render coord-less child stops in a circle around their station

### Refactor

- knip
- **stop-view**: restore onTimetableClick to StopViewDependencies
- remove unused getCurrentHighlight (lossy for pathway focus)
- **stop-coords**: single-pass orphan/pinned classification

### Perf

- add DEBUG_BOOT timing instrumentation for restore path
- skip snapshot/patch replay when blobs are current at the stored version
- defer map update to idle callback and unblock export/nav earlier
- switch blob format from CSV to JSON and parse off main thread
- drop startup validator call to eliminate redundant full-feed scan on boot
- **stop-coords**: cache coord resolver and fix O(n²) BFS

## v0.17.0 (2026-05-12)

### Feat

- bump focused stop/station radii and trim setFocusedStop logs
- per-trip brouter links, upload icon, click-away modals
- render shape_id as dropdown in timetable trip properties
- add brouter deep-link to timetable direction tabs
- add ShapesManager modal with GPX import/replace/delete
- add GPX parser utility for shapes import
- split pathways into out/in sections and add boarding areas for platforms
- split station child-stop list into grouped sections by location type
- add renderStopReference and renderPathwayReference helpers in entity-references
- breadcrumb depth + empty-click navigate-up for stops/pathways
- route pathway endpoints through nearest coord-having ancestor
- station icon white+X and ancestor-aware stops filter
- replace Transit Network section with Timetables on stop page

### Fix

- use promoteId for stops/pathways so string ids work with feature-state
- guard queryRenderedFeatures against missing dynamic layers
- render station ✕ via map.addImage and instrument focus state
- use update op when re-assigning trips to replaced shape
- re-assign trips to shape geometry after GPX replace

### Refactor

- knip
- replace station ✕ symbol layer with small black inner-dot
- simplify ShapesManager types and file picker
- consolidate stop_times queries into fetchStopRelations

## v0.16.1 (2026-05-11)

## v0.16.0 (2026-05-11)

### Feat

- show 'Reading file...' indicator immediately on file upload
- show 'Downloading feed...' indicator immediately on URL load
- replace text delete buttons with trash icon across all object types
- add agency deletion with cascade routes, trips, and stop_times
- add service deletion with cascade trips, stop_times, and calendar_dates
- add route deletion with cascade trips and stop_times
- add trip deletion from timetable header with cascade stop_times
- highlight route on map when navigating to timetable page
- add focusFeed() to MapController and wire home/service pages
- enrich agency page route items with renderRouteReference and trip counts
- enrich home page service cards with renderServiceReference
- refactor service page timetables to use renderRouteReference rows
- replace route page service rows with renderServiceReference, rename section to Timetables
- add entity-references utility with route and service reference renderers
- include calendar_dates-only services on home page
- add agency-helpers utilities and fix empty agency display
- **fares**: move Fares button from home page to navbar
- **fares-modal**: add schema-driven column header tooltips to fare table panels
- **fares**: add Fares section to home page wired to showFaresModal
- **fares**: add showFaresModal with CRUD for fare_media, fare_products, rider_categories
- **db**: register fare_media, fare_products, rider_categories tables (schema v9)
- **map**: feature-state pathway focus replaces hardcoded line-width
- **map**: feature-state stop focus replaces stops-highlight layer

### Fix

- wire agency map focus and fix highlightAgencyRoutes loop bug
- remove unused TIMETABLE_REF_BTN export
- derive date range from calendar_dates for calendar_dates-only services
- include calendar_dates-only services in 'Add timetable' dropdown
- normalize agency_id in map highlight and remaining view consumers
- apply agencyRouteFilter in all relationship query methods
- add agency_id fieldMaps for agency and routes virtual tables
- tooltip directions fixed
- lil fixes to Fares
- **fares**: make ID fields editable in add mode, readonly only in edit mode

### Refactor

- **map**: unified FocusedObject replaces expandedStationId + currentHighlight

## v0.15.0 (2026-05-04)

### Feat

- **map**: patch-driven incremental route updates (Phase 2)

### Perf

- **route-renderer**: dedupe features by (route_id, geometry_key)

## v0.14.0 (2026-04-29)

### Feat

- **ui**: add CORS proxy checkbox to Atlas Search modal
- **ui**: add CORS proxy checkbox to Load from URL modal
- **pathways**: add pathway creation tool and stop pathways section (phase 5)
- **pathways**: add pathway visualization and detail view (phase 4)
- **map**: add station hierarchy and expanded view (phase 3)
- **levels**: add levels management modal and level_id dropdown in stop view
- **db**: add pathways and levels object stores, bump schema to v9
- **atlas-search**: migrate showAtlasSearchModal to showModal
- **modal-utils**: wire enterAction/escapeAction at all showModal call sites
- **timetable**: phase 3 — shared tooltip abstraction and floating header fix

### Fix

- place checkbox in bottom of modal
- simpler display
- replace (i) SVG with ⓘ glyph and fix timetable sticky-column tooltip stacking

### Refactor

- **modal-utils**: replace dismissable with enterAction/escapeAction API

## v0.13.1 (2026-04-11)

### Fix

- link to gtfs zone and clean

## v0.13.0 (2026-04-11)

### Feat

- improve timetable direction tabs and trip property rows
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

- remove all of the npm version stuff to stick with cz
- add config
- rm unused files

### Perf

- npm update

## v0.4.1 (2025-12-24)

### Fix

- slight styling improvements to the map

## v0.4.0 (2025-10-06)

### Feat

- ability to add new services
- implement handling of different gtfs field types
- **map**: add projection and basemap controls

## v0.3.0 (2025-10-05)

## v0.2.1 (2025-10-05)

### Feat

- add feed info to the home browse page

### Fix

- compromise with tooltips and scrolling

## v0.22.0 (2026-08-04)

### Feat

- **map**: fade stations by zoom on a gentler band than plain stops
- **map**: mute hashed route colors with a perceptual OKLCH ramp
- **map**: order route lines by mode, trip count, and focus
- **search**: prioritize stations, then routes, then stops
- **search**: fuzzy map search wired to page state

## v0.21.1 (2026-08-02)

### Fix

- **scs**: fold pairwise with an iterative two-sequence DP

## v0.21.0 (2026-07-17)

### Feat

- **map**: case route lines and add spotlight selection styling
- **notifications**: unify change wording via humanLabel

### Fix

- **map**: make MapController the sole owner of route spotlight state
- **notifications**: wrap long ids and highlight entity tokens

### Refactor

- **map**: drop single-element forEach wrappers, dedupe focused expr
- **map**: reuse indexed getStopIdsForRoute in flyToRoute/fitToRoutes
- **map**: centralize spotlight/fade constants in CONFIG
- **notifications**: patch spot is sole emitter for entity creates
- **notifications**: collapse to one notify API and fix toast overflow

## v0.20.0 (2026-05-26)

### Feat

- **gtfs-parser**: preserve unrecognized files as passthrough for export

### Fix

- **ui**: replace levels button text label with icon-only square button
- **gtfs-parser**: enable DEFLATE compression on ZIP export
- **timetable-database**: use 0-based stop_sequence indexing
- **gtfs-parser**: add trailing newline to all exported CSV files
- **gtfs-parser**: preserve full coordinate precision and field whitespace on import

## v0.19.1 (2026-05-26)

### Fix

- **layer-manager**: invalidate coord resolver on full map reload

## v0.19.0 (2026-05-25)

### Feat

- show FeedProgressIndicator during restore on page refresh

### Fix

- **route-renderer**: guard clearHighlight against uninitialized layers

### Perf

- add DEBUG_BOOT timing instrumentation for restore path
- skip snapshot/patch replay when blobs are current at the stored version
- defer map update to idle callback and unblock export/nav earlier
- switch blob format from CSV to JSON and parse off main thread
- drop startup validator call to eliminate redundant full-feed scan on boot

## v0.18.1 (2026-05-25)

### Fix

- **layer-manager**: suppress coord warning for generic nodes and boarding areas

## v0.18.0 (2026-05-25)

### Feat

- add map key section to about modal
- show coord-less stops with grey outline on map
- lay out coord-less child stops via pathway graph instead of circle
- append stop_id to child-stop labels universally
- bump focused stop/station radii and trim setFocusedStop logs
- split pathways into out/in sections and add boarding areas for platforms
- split station child-stop list into grouped sections by location type
- add renderStopReference and renderPathwayReference helpers in entity-references
- breadcrumb depth + empty-click navigate-up for stops/pathways
- route pathway endpoints through nearest coord-having ancestor
- station icon white+X and ancestor-aware stops filter
- **map**: feature-state pathway focus replaces hardcoded line-width
- **map**: feature-state stop focus replaces stops-highlight layer
- **pathways**: add pathway creation tool and stop pathways section (phase 5)
- **pathways**: add pathway visualization and detail view (phase 4)
- **map**: add station hierarchy and expanded view (phase 3)
- **levels**: add levels management modal and level_id dropdown in stop view
- **db**: add pathways and levels object stores, bump schema to v9
- polish timeline — dynamic label width, weekday dots, DaisyUI tooltips on exception ticks
- polish month grid — scrollable cells, full IDs, feed date markers
- implement timeline/gantt tab in calendar modal
- add calendar modal with month grid view

### Fix

- **calendar-modal**: fix timeline week order and add days-of-week tooltip
- **basemap-control**: prevent invisible container from blocking map clicks
- **entity-references**: escape route_id and service_id in data-* attrs
- **interaction-handler**: route add-pathway click through queryFeaturesOnLayers
- **map-controller**: replace falsy-zero stop coord checks with hasValidCoords
- **pathway-view**: attach delete handler to button elements, not container
- restore pathway layer after basemap change
- restore pathways layer after basemap/projection switch
- show id for pathways
- drop empty-coord stops from station fly-to bounds
- highlight pathway and zoom to station on side-panel/URL navigation
- properly escape CSV writes and drop (0,0) from feed fit-bounds
- render coord-less child stops in a circle around their station
- use promoteId for stops/pathways so string ids work with feature-state
- guard queryRenderedFeatures against missing dynamic layers
- render station ✕ via map.addImage and instrument focus state
- restore basemap FAB position within map container
- revert watercolor maxzoom to 16, redesign basemap FAB to vertical with labels
- correct maxzoom values based on live tile testing
- add maxzoom to all raster sources and update satellite icon

### Refactor

- knip
- **stop-view**: restore onTimetableClick to StopViewDependencies
- remove unused getCurrentHighlight (lossy for pathway focus)
- **stop-coords**: single-pass orphan/pinned classification
- knip
- replace station ✕ symbol layer with small black inner-dot
- **map**: unified FocusedObject replaces expandedStationId + currentHighlight

### Perf

- **stop-coords**: cache coord resolver and fix O(n²) BFS

## v0.17.0 (2026-05-12)

### Feat

- per-trip brouter links, upload icon, click-away modals
- render shape_id as dropdown in timetable trip properties
- add brouter deep-link to timetable direction tabs
- add ShapesManager modal with GPX import/replace/delete
- add GPX parser utility for shapes import
- replace Transit Network section with Timetables on stop page

### Fix

- use update op when re-assigning trips to replaced shape
- re-assign trips to shape geometry after GPX replace

### Refactor

- simplify ShapesManager types and file picker
- consolidate stop_times queries into fetchStopRelations

## v0.16.1 (2026-05-11)

## v0.16.0 (2026-05-11)

### Feat

- show 'Reading file...' indicator immediately on file upload
- show 'Downloading feed...' indicator immediately on URL load
- replace text delete buttons with trash icon across all object types
- add agency deletion with cascade routes, trips, and stop_times
- add service deletion with cascade trips, stop_times, and calendar_dates
- add route deletion with cascade trips and stop_times
- add trip deletion from timetable header with cascade stop_times
- highlight route on map when navigating to timetable page
- add focusFeed() to MapController and wire home/service pages
- enrich agency page route items with renderRouteReference and trip counts
- enrich home page service cards with renderServiceReference
- refactor service page timetables to use renderRouteReference rows
- replace route page service rows with renderServiceReference, rename section to Timetables
- add entity-references utility with route and service reference renderers
- include calendar_dates-only services on home page
- add agency-helpers utilities and fix empty agency display
- **fares**: move Fares button from home page to navbar
- **fares-modal**: add schema-driven column header tooltips to fare table panels
- **fares**: add Fares section to home page wired to showFaresModal
- **fares**: add showFaresModal with CRUD for fare_media, fare_products, rider_categories
- **db**: register fare_media, fare_products, rider_categories tables (schema v9)

### Fix

- wire agency map focus and fix highlightAgencyRoutes loop bug
- remove unused TIMETABLE_REF_BTN export
- derive date range from calendar_dates for calendar_dates-only services
- include calendar_dates-only services in 'Add timetable' dropdown
- normalize agency_id in map highlight and remaining view consumers
- apply agencyRouteFilter in all relationship query methods
- add agency_id fieldMaps for agency and routes virtual tables
- tooltip directions fixed
- lil fixes to Fares
- **fares**: make ID fields editable in add mode, readonly only in edit mode

## v0.15.0 (2026-05-04)

### Feat

- **map**: patch-driven incremental route updates (Phase 2)

### Perf

- **route-renderer**: dedupe features by (route_id, geometry_key)

## v0.14.0 (2026-04-29)

### Feat

- **ui**: add CORS proxy checkbox to Atlas Search modal
- **ui**: add CORS proxy checkbox to Load from URL modal
- **atlas-search**: migrate showAtlasSearchModal to showModal
- **modal-utils**: wire enterAction/escapeAction at all showModal call sites
- **timetable**: phase 3 — shared tooltip abstraction and floating header fix
- improve timetable direction tabs and trip property rows

### Fix

- place checkbox in bottom of modal
- simpler display
- replace (i) SVG with ⓘ glyph and fix timetable sticky-column tooltip stacking

### Refactor

- **modal-utils**: replace dismissable with enterAction/escapeAction API

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
