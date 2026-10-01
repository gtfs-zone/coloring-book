# GTFS.zone

A browser-based editor for GTFS (General Transit Feed Specification) transit
data, inspired by geojson.io. Load a feed from a ZIP or a URL, view it on a map,
edit it, and export it again. There is no login and no backend: all data stays
in the browser, in IndexedDB.

Live: [edit.gtfs.zone](https://edit.gtfs.zone)

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
