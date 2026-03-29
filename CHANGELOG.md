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
