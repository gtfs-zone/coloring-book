# GTFS.zone

A browser-based editor for GTFS (General Transit Feed Specification) transit
data, inspired by geojson.io. Load a feed from a ZIP or a URL, view it on a map,
edit it, and export it again. There is no login and no backend: all data stays
in the browser, in IndexedDB.

Live: [edit.gtfs.zone](https://edit.gtfs.zone)

## Screenshots

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/01-home-overview.png">
  <img src="docs/screenshots/light/01-home-overview.png" alt="The MBTA network on the map.">
</picture>

The MBTA network on the map.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/03-search-typing.png">
  <img src="docs/screenshots/light/03-search-typing.png" alt="Search across stops and routes.">
</picture>

Search across stops and routes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/05-route-red.png">
  <img src="docs/screenshots/light/05-route-red.png" alt="A route page with its services and stop diagram.">
</picture>

A route page with its services and stop diagram.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/10-stop-station.png">
  <img src="docs/screenshots/light/10-stop-station.png" alt="A station, with its pathways and nodes on the map.">
</picture>

A station, with its pathways and nodes on the map.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/12-stop-inline-edit.png">
  <img src="docs/screenshots/light/12-stop-inline-edit.png" alt="Editing a stop field in place.">
</picture>

Editing a stop field in place.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/15-pathway.png">
  <img src="docs/screenshots/light/15-pathway.png" alt="A pathway between station nodes.">
</picture>

A pathway between station nodes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/18-timetable-dense.png">
  <img src="docs/screenshots/light/18-timetable-dense.png" alt="A timetable with a trip every 10 minutes.">
</picture>

A timetable with a trip every 10 minutes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/19-timetable-cr.png">
  <img src="docs/screenshots/light/19-timetable-cr.png" alt="A commuter rail timetable.">
</picture>

A commuter rail timetable.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/26-service-page.png">
  <img src="docs/screenshots/light/26-service-page.png" alt="A service calendar with its weekly pattern and exceptions.">
</picture>

A service calendar with its weekly pattern and exceptions.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/27-fares.png">
  <img src="docs/screenshots/light/27-fares.png" alt="Fares v2 tables.">
</picture>

Fares v2 tables.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/31-feed-issues.png">
  <img src="docs/screenshots/light/31-feed-issues.png" alt="Feed issues found on load.">
</picture>

Feed issues found on load.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/32-history.png">
  <img src="docs/screenshots/light/32-history.png" alt="Edit history, with undo and redo.">
</picture>

Edit history, with undo and redo.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/33-load-modal.png">
  <img src="docs/screenshots/light/33-load-modal.png" alt="Loading a feed from the feed catalogs.">
</picture>

Loading a feed from the feed catalogs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/37-basemap-satellite.png">
  <img src="docs/screenshots/light/37-basemap-satellite.png" alt="The satellite basemap.">
</picture>

The satellite basemap.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/39-zone-page.png">
  <img src="docs/screenshots/light/39-zone-page.png" alt="An on-demand zone.">
</picture>

An on-demand zone.

<img src="docs/screenshots/mobile/43-mobile-route.png" alt="A route page on a phone." width="390">

A route page on a phone.

<img src="docs/screenshots/gifs/g02-search-to-route.gif" alt="Searching for a route.">

Searching for a route.

<img src="docs/screenshots/gifs/g03-browse-route-station-platform.gif" alt="From a route to a station to a platform.">

From a route to a station to a platform.

<img src="docs/screenshots/gifs/g06-add-stop.gif" alt="Adding a stop on the map.">

Adding a stop on the map.

<img src="docs/screenshots/gifs/g08-calendar-edit.gif" alt="Adding weekend days to a service.">

Adding weekend days to a service.

<img src="docs/screenshots/gifs/g10-zone-edit.gif" alt="Editing a zone's geometry.">

Editing a zone's geometry.

Map data OpenStreetMap contributors. Satellite imagery Esri. Transit data MBTA.
## Quick start

```bash
pnpm install
pnpm dev      # dev server on http://localhost:8080
pnpm build    # production build into dist/
```

## Stack

- TypeScript
- MapLibre GL
- Vite
- Tailwind CSS v4 + DaisyUI 5
- IndexedDB (via `idb`)
- Zod
- [gtfs-zone-web-common](https://github.com/gtfs-zone/gtfs-zone-web-common), the UI, map and
  GTFS modules shared with the other gtfs.zone apps

## GTFS support

Not every GTFS Schedule file has a dedicated view. See
[docs/gtfs-implementation-status.md](docs/gtfs-implementation-status.md) for
which files have their own editor and which are only in the table viewer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bugs and feature requests go to the
[issue tracker](https://github.com/gtfs-zone/gtfs-zone-editor/issues).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`), see
[LICENSE.txt](LICENSE.txt). Per-file licensing is declared in
[REUSE.toml](REUSE.toml), with the license texts in [LICENSES/](LICENSES/).

### Third-party content

`reference/gtfs-reference.md`, `src/gtfs-spec/files/` and
`src/assets/gtfs-spec/` are derived from the
[GTFS Schedule reference](https://github.com/google/transit), Copyright Google
Inc. and contributors (maintained by MobilityData), licensed under the
[Apache License 2.0](LICENSES/Apache-2.0.txt).

## Links

- [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/)
- [Issue tracker](https://github.com/gtfs-zone/gtfs-zone-editor/issues)
