# GTFS.zone

A web-based GTFS (General Transit Feed Specification) editor inspired by geojson.io. Upload, visualize, edit, and export GTFS transit data with no login required.

## Features

- 📁 **File Upload**: Drag-and-drop or button upload for GTFS ZIP files
- 🌐 **URL Loading**: Load GTFS feeds directly from URLs
- 🗺️ **Interactive Map**: Visualize stops and routes on an interactive map
- ✏️ **Text Editor**: Edit GTFS files with syntax highlighting
- 📦 **Export**: Download modified GTFS as ZIP file
- 📱 **Responsive**: Works on desktop and mobile devices

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Run tests
npm test

# Build for production
npm run build
```

## Technology Stack

- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Mapping**: Leaflet.js
- **Editor**: CodeMirror 6
- **Build**: Rollup with Tailwind CSS
- **Testing**: Playwright

## Todo List - Future Features

### Core Functionality
- [ ] **GTFS Validation**: Integrate MobilityData GTFS validator
- [ ] **Advanced Error Handling**: Better user feedback for parsing errors
- [ ] **Undo/Redo**: Text editor history management
- [ ] **File Templates**: Pre-configured GTFS file templates
- [ ] **Bulk Operations**: Multi-file editing capabilities

### User Experience
- [ ] **Dark Mode**: Toggle between light and dark themes
- [ ] **Keyboard Shortcuts**: Editor shortcuts for power users
- [ ] **Progress Indicators**: Loading states for large files
- [ ] **Tour/Onboarding**: First-time user guidance
- [ ] **Recent Files**: Quick access to recently edited feeds

### Data Visualization
- [ ] **Route Visualization**: Color-coded route lines on map
- [ ] **Stop Clustering**: Performance optimization for dense stop networks
- [ ] **Service Calendar**: Visual representation of service patterns
- [ ] **Statistics Dashboard**: Feed statistics and data quality metrics
- [ ] **3D Visualization**: Elevation and terrain integration

### Advanced Editing
- [ ] **Smart Autocomplete**: Context-aware field suggestions
- [ ] **Relationship Validation**: Real-time foreign key validation
- [ ] **Batch Import**: CSV import from external sources
- [ ] **Field Mapping**: Map external data to GTFS fields
- [ ] **Version Control**: Track changes and revert functionality

### Performance & Scale
- [ ] **Streaming Parser**: Handle very large GTFS files
- [ ] **Web Workers**: Background processing for heavy operations
- [ ] **Caching Strategy**: Improve load times for repeated operations
- [ ] **Memory Optimization**: Better garbage collection for large datasets

### Integration & Export
- [ ] **Multiple Formats**: Export to JSON, GeoJSON, KML
- [ ] **API Integration**: Connect to transit agency APIs
- [ ] **Real-time Data**: GTFS-Realtime feed integration
- [ ] **Share Links**: Generate shareable URLs for feeds
- [ ] **Embed Widget**: Embeddable map widget for websites

### Quality & Standards
- [ ] **GTFS Extensions**: Support for GTFS-Flex, GTFS-Fares v2
- [ ] **Accessibility**: Full WCAG 2.1 compliance
- [ ] **Internationalization**: Multi-language support
- [ ] **Print Support**: Printable route maps and schedules
- [ ] **Offline Mode**: Service worker for offline editing

### Developer Experience
- [ ] **Plugin System**: Extensible architecture for custom features
- [ ] **API Documentation**: Comprehensive developer docs
- [ ] **TypeScript**: Type safety and better IDE support
- [ ] **Component Library**: Reusable UI components
- [ ] **Performance Monitoring**: Real-time performance metrics

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
4. Add tests for new functionality
5. Run `npm run lint` and fix any issues
6. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [Live Demo](https://gtfs.zone)
- [GTFS Specification](https://developers.google.com/transit/gtfs)
- [Issue Tracker](https://github.com/yourusername/gtfs.zone/issues)