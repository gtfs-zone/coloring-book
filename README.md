# GTFS.zone

A browser-based GTFS (General Transit Feed Specification) transit data editor, inspired by geojson.io. Upload, visualize, edit, and export GTFS transit data with no login required and no backend: all data stays in the browser via IndexedDB.

## Features

- **File Upload**: Drag-and-drop or button upload for GTFS ZIP files
- **URL Loading**: Load GTFS feeds directly from URLs
- **Interactive Map**: Visualize stops and routes on an interactive map
- **Text Editor**: Edit GTFS files with syntax highlighting
- **Fares v2**: Editor for fare products, rules, timeframes, areas, and networks
- **Export**: Download modified GTFS as a ZIP file
- **Responsive**: Works on desktop and mobile devices

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build
```

## Technology Stack

- **Language**: TypeScript
- **Mapping**: Leaflet.js
- **Editor**: CodeMirror 6
- **Build**: Vite
- **Styling**: Tailwind CSS + DaisyUI
- **Testing**: Playwright

## GTFS Implementation Status

Not all GTFS Schedule files have dedicated views: see [docs/gtfs-implementation-status.md](docs/gtfs-implementation-status.md) for a full breakdown of which files are fully supported, partially supported (table editor only), or not yet supported.

## Releasing

Deployments are triggered by pushing a version tag. The Forgejo CI will build and copy the output to the server.

```bash
cz bump              # bumps version, updates changelog, creates tag (run on main only)
git push --follow-tags
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm lint` and fix any issues
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [Live Demo](https://gtfs.zone)
- [GTFS Specification](https://developers.google.com/transit/gtfs)
- [Issue Tracker](https://git.kcfam.us/gtfs.zone/coloring-book/issues)
