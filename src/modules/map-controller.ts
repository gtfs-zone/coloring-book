import { Map as MapLibreMap, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { RouteRenderer } from './route-renderer.js';
import { LayerManager } from './layer-manager.js';
import {
  InteractionHandler,
  InteractionCallbacks,
} from './interaction-handler.js';
import { PageStateManager } from './page-state-manager.js';
import { GTFSParser } from './gtfs-parser.js';
import { PatchManager } from './patch-manager.js';
import {
  Stops,
  StopTimes,
  Trips,
  Routes,
  Pathways,
  Agency,
} from '../types/gtfs.js';
import {
  agencyRouteFilter,
  normalizeAgencyId,
} from '../utils/agency-helpers.js';
import { BasemapControl } from './basemap-control.js';
import type { PatchRecord, SingleGTFSPatch } from '../types/patch.js';

// Map interaction modes
export enum MapMode {
  NAVIGATE = 'navigate',
  ADD_STOP = 'add_stop',
  ADD_PATHWAY = 'add_pathway',
}

export type FocusedObject =
  | { type: 'stop'; id: string }
  | { type: 'pathway'; id: string }
  | { type: 'route'; id: string }
  | { type: 'trip'; id: string }
  | { type: 'none' };

// Callback interfaces
interface MapControllerCallbacks {
  onRouteSelect?: (route_id: string) => void;
  onStopSelect?: (stop_id: string) => void;
  onPathwaySelect?: (pathway_id: string) => void;
  onModeChange?: (mode: MapMode) => void;
  onEmptyClick?: () => void;
  onStationExpandChange?: () => void;
}

/**
 * Professional MapController with modular architecture and Deck.gl integration
 *
 * Responsibilities:
 * - Map initialization and lifecycle management
 * - Coordination between RouteRenderer, LayerManager, and InteractionHandler
 * - Public API for map operations
 * - Integration with page state management
 */
export class MapController {
  private map: MapLibreMap | null = null;
  private mapElementId: string;

  // Core modules
  private routeRenderer: RouteRenderer | null = null;
  private layerManager: LayerManager | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private basemapControl: BasemapControl | null = null;

  // Dependencies (injected)
  private gtfsParser: GTFSParser | null = null;
  private pageStateManager: PageStateManager | null = null;

  // Callbacks
  private callbacks: MapControllerCallbacks = {};

  // State
  private isInitialized = false;
  private resizeTimeout: NodeJS.Timeout | null = null;
  private basemapChangeHandlerSet = false;
  private focusedObject: FocusedObject = { type: 'none' };

  private bottomPadding = 0;

  constructor(mapElementId = 'map') {
    this.mapElementId = mapElementId;
  }

  public setBottomPadding(px: number): void {
    this.bottomPadding = px;
  }

  /**
   * Initialize the map controller with dependencies
   */
  public async initialize(
    gtfsParser: GTFSParser,
    patchManager: PatchManager
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn('MapController already initialized');
      return;
    }

    this.gtfsParser = gtfsParser;
    this.initializeMap();
    await this.initializeModules();
    this.setupModuleCallbacks();
    this.subscribeToPatchEvents(patchManager);
    this.isInitialized = true;

    console.log('🗺️ MapController initialized successfully');
  }

  /**
   * Subscribe to patch events for incremental map updates.
   * - change: surgical invalidation per affected table
   * - undo/redo/jump: hard reset (full rebuild)
   */
  private subscribeToPatchEvents(patchManager: PatchManager): void {
    const hardReset = () => {
      this.updateMap().catch((e: unknown) =>
        console.error('[MapController] hard reset failed:', e)
      );
    };

    patchManager.on('undo', hardReset);
    patchManager.on('redo', hardReset);
    patchManager.on('jump', hardReset);

    patchManager.on('change', (record) => {
      if (!record) {
        return;
      }
      this.handlePatchChange(record);
    });
  }

  /**
   * Dispatch a change patch to the appropriate surgical invalidation method.
   */
  private handlePatchChange(record: PatchRecord): void {
    if (!this.routeRenderer || !this.layerManager) {
      return;
    }

    const patch = record.patch;
    const ops: SingleGTFSPatch[] = patch.op === 'batch' ? patch.ops : [patch];

    for (const op of ops) {
      const { table, id } = op.source;
      console.log(
        `[MapController] patch ${table}:${id} op=${op.op} → dispatching invalidation`
      );

      switch (table) {
        case 'routes': {
          const forwardChanges =
            op.op === 'update'
              ? (op.forward as { changes: Record<string, unknown> }).changes
              : undefined;
          this.routeRenderer.invalidateRoute(id, op.op, forwardChanges);
          break;
        }
        case 'trips': {
          let beforeShapeId: string | null = null;
          let afterShapeId: string | null = null;

          if (op.op === 'update') {
            const fwd = (op.forward as { changes: Record<string, unknown> })
              .changes;
            const inv = (op.inverse as { changes: Record<string, unknown> })
              .changes;
            if (!('shape_id' in fwd) && !('route_id' in fwd)) {
              break; // No map-visible change (e.g. trip_headsign edit)
            }
            if ('shape_id' in fwd) {
              beforeShapeId =
                (inv.shape_id as string | null | undefined) ?? null;
              afterShapeId =
                (fwd.shape_id as string | null | undefined) ?? null;
            }
          } else if (op.op === 'insert') {
            const rec = (op.forward as { record: Record<string, unknown> })
              .record;
            afterShapeId = (rec.shape_id as string | null | undefined) ?? null;
          } else if (op.op === 'delete') {
            const rec = (op.inverse as { record: Record<string, unknown> })
              .record;
            beforeShapeId = (rec.shape_id as string | null | undefined) ?? null;
          }

          this.routeRenderer.invalidateTrip(
            id,
            op.op,
            beforeShapeId,
            afterShapeId
          );
          break;
        }
        case 'shapes': {
          // Composite key: shape_id:shape_pt_sequence — extract shape_id
          const shapeId = id.slice(0, id.lastIndexOf(':'));
          this.routeRenderer.invalidateShape(shapeId, op.op);
          break;
        }
        case 'stop_times': {
          // Composite key: trip_id:stop_sequence — extract trip_id
          const tripId = id.slice(0, id.lastIndexOf(':'));
          this.routeRenderer.invalidateStopTimes(tripId, op.op);
          break;
        }
        case 'stops':
          this.routeRenderer.invalidateStop(id, op.op);
          this.layerManager.updateStopsData();
          break;
        default:
          break;
      }
    }
  }

  /**
   * Initialize MapLibre GL map
   */
  private initializeMap(): void {
    this.map = new MapLibreMap({
      container: this.mapElementId,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: [-74.006, 40.7128], // NYC default
      zoom: 10,
    });
  }

  /**
   * Initialize core modules
   */
  private async initializeModules(): Promise<void> {
    if (!this.map || !this.gtfsParser) {
      throw new Error(
        'Map or gtfsParser not available for module initialization'
      );
    }

    // Initialize modules
    this.layerManager = new LayerManager(this.map, this.gtfsParser);
    this.routeRenderer = new RouteRenderer(this.map, this.gtfsParser);
    this.interactionHandler = new InteractionHandler(this.map, this.gtfsParser);
    this.basemapControl = new BasemapControl(this.map, (mode) => {
      this.routeRenderer?.setRenderMode(mode);
    });

    // Keep InteractionHandler's GeoJSON cache in sync with LayerManager
    this.layerManager.onStopsDataUpdated = (data) => {
      this.interactionHandler?.setStopsGeoJSON(data);
    };

    // Let InteractionHandler read the expanded station id for contextual stop creation
    this.interactionHandler.setGetExpandedStationId(() =>
      this.getExpandedStationId()
    );

    // Setup basemap change handler to re-add layers
    this.setupBasemapChangeHandler();

    // Start RouteRenderer initialization in the background — don't block UI setup.
    // ensureInitialized() is called lazily from renderRoutes/updateMap when needed.
  }

  /**
   * Setup callbacks between modules
   */
  private setupModuleCallbacks(): void {
    if (!this.interactionHandler || !this.routeRenderer) {
      return;
    }

    // Setup interaction callbacks
    const interactionCallbacks: InteractionCallbacks = {
      onRouteClick: this.handleRouteClick.bind(this),
      onStopClick: this.handleStopClick.bind(this),
      onPathwayClick: this.handlePathwayClick.bind(this),
      onPathwayCreated: this.handlePathwayCreated.bind(this),
      onModeChange: this.handleModeChange.bind(this),
      onStopDragComplete: this.handleStopDragComplete.bind(this),
      onStopCreated: this.handleStopCreated.bind(this),
      onEmptyClick: () => {
        this.clearHighlights();
        this.callbacks.onEmptyClick?.();
      },
    };

    this.interactionHandler.setCallbacks(interactionCallbacks);
  }

  /**
   * Setup basemap change handler to re-add GTFS layers
   */
  private setupBasemapChangeHandler(): void {
    if (!this.map || this.basemapChangeHandlerSet) {
      return;
    }

    this.basemapChangeHandlerSet = true;

    this.map.on('basemap:changed', async () => {
      console.log('🗺️ Re-adding GTFS layers after basemap change...');

      // Check if we have GTFS data loaded
      if (!this.gtfsParser || !this.gtfsParser.getFileDataSync('stops.txt')) {
        console.log('⏭️ No GTFS data loaded, skipping layer re-add');
        return;
      }

      // Re-render routes and stops after basemap change
      if (this.routeRenderer && this.layerManager) {
        try {
          // Wait for style to load
          await this.routeRenderer.ensureInitialized();

          // Clear existing layers first
          this.layerManager.clearAllLayers();
          this.routeRenderer.clearRoutes();

          // Re-render routes
          await this.routeRenderer.renderRoutes({
            lineWidth: 3,
            opacity: 0.8,
          });

          // Re-add stops layer
          this.layerManager.addStopsLayer({
            showBackground: true,
            showClickArea: true,
            enableHover: true,
            backgroundColor: '#ffffff',
            strokeColor: '#000000',
            strokeWidth: 2,
            radius: 4,
            clickAreaRadius: 15,
          });

          // Restore highlights if any
          const obj = this.focusedObject;
          if (obj.type === 'route') {
            this.routeRenderer.highlightRoute(obj.id);
          } else if (obj.type === 'stop') {
            this.layerManager.highlightStop(obj.id);
          } else if (obj.type === 'trip') {
            this.layerManager.highlightTrip(obj.id);
          }

          console.log('✅ GTFS layers re-added after basemap change');
        } catch (error) {
          console.error('❌ Failed to re-add GTFS layers:', error);
        }
      }
    });
  }

  /**
   * Set page state manager for URL integration
   */
  public setPageStateManager(pageStateManager: PageStateManager): void {
    this.pageStateManager = pageStateManager;
  }

  /**
   * Set callbacks for external integration
   */
  public setCallbacks(callbacks: Partial<MapControllerCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Update map with current GTFS data
   */
  public async updateMap(): Promise<void> {
    if (!this.isMapReady()) {
      return;
    }

    // Reset focus state when feed changes
    this.focusedObject = { type: 'none' };
    this.layerManager?.setStopsFilter(null);

    // Ensure RouteRenderer is initialized (this waits for map style to load)
    await this.routeRenderer!.ensureInitialized();

    // Clear existing layers
    this.layerManager!.clearAllLayers();
    this.routeRenderer!.clearRoutes();

    // Wait for route rendering to complete
    await this.routeRenderer!.renderRoutes({
      lineWidth: 3,
      opacity: 0.8,
    });

    // Add stops using LayerManager
    this.layerManager!.addStopsLayer({
      showBackground: true,
      showClickArea: true,
      enableHover: true,
      backgroundColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 2,
      radius: 4,
      clickAreaRadius: 15,
    });

    // Fit map to show all data
    this.fitMapToData();

    console.log('✅ Map update completed');
  }

  /**
   * Check if map is ready for operations
   */
  private isMapReady(): boolean {
    if (
      !this.gtfsParser ||
      !this.gtfsParser.getFileDataSync('stops.txt') ||
      !this.map
    ) {
      return false;
    }
    return true;
  }

  public focusFeed(): void {
    this.clearHighlights();
    this.fitMapToData();
  }

  /**
   * Fit map to show all GTFS data
   */
  private fitMapToData(): void {
    const stops = this.gtfsParser!.getFileDataSyncTyped<Stops>('stops.txt');
    if (!stops || stops.length === 0) {
      return;
    }

    const validStops = stops.filter(
      (stop) =>
        stop.stop_lat !== null &&
        stop.stop_lon !== null &&
        !isNaN(stop.stop_lat) &&
        !isNaN(stop.stop_lon)
    );

    if (validStops.length === 0) {
      return;
    }

    const coordinates = validStops.map(
      (stop) => [stop.stop_lon!, stop.stop_lat!] as [number, number]
    );

    const bounds = coordinates.reduce(
      (bounds, coord) => bounds.extend(coord),
      new LngLatBounds(coordinates[0], coordinates[0])
    );

    this.map!.fitBounds(bounds, {
      padding: {
        top: 50,
        bottom: 50 + this.bottomPadding,
        left: 50,
        right: 50,
      },
    });
  }

  // ========================================
  // FOCUS STATE MANAGEMENT
  // ========================================

  /**
   * Derive the currently expanded station from the focused object.
   * Returns the station stop_id, or null if no station should be expanded.
   */
  private deriveExpandedStation(): string | null {
    const obj = this.focusedObject;
    const stops =
      this.gtfsParser?.getFileDataSyncTyped<Stops>('stops.txt') || [];

    if (obj.type === 'stop') {
      const stop = stops.find((s) => s.stop_id === obj.id);
      if (!stop) {
        return null;
      }
      const locationType =
        typeof stop.location_type === 'number'
          ? stop.location_type
          : parseInt(stop.location_type ?? '0', 10) || 0;
      if (locationType === 1) {
        return stop.stop_id;
      }
      if (stop.parent_station) {
        return stop.parent_station as string;
      }
      return null;
    }

    if (obj.type === 'pathway') {
      const pathways =
        this.gtfsParser?.getFileDataSyncTyped<Pathways>('pathways.txt') || [];
      const pathway = pathways.find((p) => p.pathway_id === obj.id);
      if (!pathway) {
        return null;
      }
      const fromStop = stops.find((s) => s.stop_id === pathway.from_stop_id);
      if (!fromStop) {
        return null;
      }
      if (fromStop.parent_station) {
        return fromStop.parent_station as string;
      }
      const lt =
        typeof fromStop.location_type === 'number'
          ? fromStop.location_type
          : parseInt(fromStop.location_type ?? '0', 10) || 0;
      if (lt === 1) {
        return fromStop.stop_id as string;
      }
      return null;
    }

    return null;
  }

  /**
   * Fly to the bounding box of a station and its children.
   */
  private flyToStation(stationId: string): void {
    const stops =
      this.gtfsParser!.getFileDataSyncTyped<Stops>('stops.txt') || [];
    const coords: [number, number][] = stops
      .filter(
        (s) =>
          (s.stop_id === stationId || s.parent_station === stationId) &&
          s.stop_lat !== null &&
          s.stop_lat !== undefined &&
          s.stop_lon !== null &&
          s.stop_lon !== undefined
      )
      .map((s) => [Number(s.stop_lon), Number(s.stop_lat)]);

    if (coords.length === 0) {
      return;
    }

    if (coords.length === 1) {
      this.map!.flyTo({
        center: coords[0],
        zoom: 17,
        duration: 1000,
        essential: true,
        padding: {
          top: 80,
          bottom: 80 + this.bottomPadding,
          left: 80,
          right: 80,
        },
      });
    } else {
      const bounds = coords
        .slice(1)
        .reduce(
          (b, coord) => b.extend(coord),
          new LngLatBounds(coords[0], coords[0])
        );
      this.map!.fitBounds(bounds, {
        padding: {
          top: 80,
          bottom: 80 + this.bottomPadding,
          left: 80,
          right: 80,
        },
        maxZoom: 18,
        duration: 1000,
        essential: true,
      });
    }
  }

  /**
   * Set the focused object and apply any station expand/collapse side effects.
   */
  private applyFocusedObject(obj: FocusedObject): void {
    const oldStation = this.deriveExpandedStation();
    this.focusedObject = obj;
    const newStation = this.deriveExpandedStation();
    this.layerManager?.setFocusedStop(obj.type === 'stop' ? obj.id : null);

    if (oldStation !== newStation) {
      if (newStation) {
        this.layerManager?.setStopsFilter([
          'any',
          ['==', ['get', 'stop_id'], newStation],
          ['==', ['get', 'station_id'], newStation],
        ] as unknown as import('maplibre-gl').FilterSpecification);
        this.layerManager?.updatePathwaysLayer(newStation);
        this.layerManager?.setFocusedPathway(
          obj.type === 'pathway' ? obj.id : null
        );
        this.flyToStation(newStation);
      } else {
        this.layerManager?.setStopsFilter(null);
        this.layerManager?.clearPathwaysLayer();
      }
      this.callbacks.onStationExpandChange?.();
    } else if (newStation) {
      // Station unchanged but focused object may have changed — update pathway highlight
      this.layerManager?.setFocusedPathway(
        obj.type === 'pathway' ? obj.id : null
      );
    }
  }

  /**
   * Get the currently expanded station id (derived from focusedObject).
   */
  public getExpandedStationId(): string | null {
    return this.deriveExpandedStation();
  }

  // ========================================
  // HIGHLIGHTING AND NAVIGATION METHODS
  // ========================================

  /**
   * Highlight specific route
   */
  public highlightRoute(route_id: string): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.routeRenderer?.clearHighlight();

    this.applyFocusedObject({ type: 'route', id: route_id });

    this.routeRenderer?.highlightRoute(route_id);

    // Smoothly fly to route bounds
    this.flyToRoute(route_id);

    console.log(`🎯 Highlighted route: ${route_id}`);
  }

  /**
   * Highlight specific stop
   */
  public highlightStop(stop_id: string): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.routeRenderer?.clearHighlight();

    this.applyFocusedObject({ type: 'stop', id: stop_id });

    this.interactionHandler?.setHighlightedStop(stop_id);

    // Get routes that serve this stop and highlight them
    const routesAtStop = this.gtfsParser?.getRoutesForStop?.(stop_id) || [];
    if (routesAtStop.length > 0) {
      const route_ids = routesAtStop.map((route) => route.route_id as string);
      this.routeRenderer?.highlightRoutes(route_ids);
    }

    // Smoothly fly to stop location
    const stops =
      this.gtfsParser!.getFileDataSyncTyped<Stops>('stops.txt') || [];
    const stop = stops.find((s) => s.stop_id === stop_id);

    if (stop && stop.stop_lat && stop.stop_lon) {
      const lat = stop.stop_lat;
      const lon = stop.stop_lon;

      this.map!.flyTo({
        center: [lon, lat],
        zoom: Math.max(this.map!.getZoom(), 13),
        duration: 1500,
        essential: true,
        padding: {
          top: 50,
          bottom: 50 + this.bottomPadding,
          left: 50,
          right: 50,
        },
      });
    }
    console.log(`🎯 Highlighted stop: ${stop_id}`);
  }

  /**
   * Highlight trip path
   */
  public highlightTrip(trip_id: string, color = '#e74c3c'): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.routeRenderer?.clearHighlight();

    this.applyFocusedObject({ type: 'trip', id: trip_id });

    this.layerManager?.highlightTrip(trip_id, { color });

    // Fit map to trip if available
    this.fitMapToTrip(trip_id);
    console.log(`🎯 Highlighted trip: ${trip_id}`);
  }

  /**
   * Fit map to show specific trip
   */
  private fitMapToTrip(trip_id: string): void {
    const stopTimes =
      this.gtfsParser!.getFileDataSyncTyped<StopTimes>('stop_times.txt') || [];
    const stops =
      this.gtfsParser!.getFileDataSyncTyped<Stops>('stops.txt') || [];

    const tripStopTimes = stopTimes
      .filter((st) => st.trip_id === trip_id)
      .sort((a, b) => a.stop_sequence - b.stop_sequence);

    const coordinates: [number, number][] = [];
    const stopsLookup: { [key: string]: { lat: number; lon: number } } = {};

    stops.forEach((stop) => {
      if (stop.stop_lat && stop.stop_lon) {
        stopsLookup[stop.stop_id] = {
          lat: stop.stop_lat,
          lon: stop.stop_lon,
        };
      }
    });

    tripStopTimes.forEach((st) => {
      const stopCoords = stopsLookup[st.stop_id];
      if (stopCoords) {
        coordinates.push([stopCoords.lon, stopCoords.lat]);
      }
    });

    if (coordinates.length > 0) {
      const bounds = coordinates.reduce(
        (bounds, coord) => bounds.extend(coord),
        new LngLatBounds(coordinates[0], coordinates[0])
      );

      this.map!.fitBounds(bounds, {
        padding: {
          top: 50,
          bottom: 50 + this.bottomPadding,
          left: 50,
          right: 50,
        },
      });
    }
  }

  /**
   * Clear all highlights
   */
  public clearHighlights(): void {
    this.interactionHandler?.setHighlightedStop(null);
    this.layerManager?.clearHighlights();
    this.routeRenderer?.clearHighlight();
    this.applyFocusedObject({ type: 'none' });
  }

  /**
   * Get current highlight state
   */
  public getCurrentHighlight(): {
    type: 'none' | 'route' | 'stop' | 'trip';
    id: string | null;
  } {
    const obj = this.focusedObject;
    if (obj.type === 'route' || obj.type === 'stop' || obj.type === 'trip') {
      return { type: obj.type, id: obj.id };
    }
    return { type: 'none', id: null };
  }

  /**
   * Smoothly fly to show a specific route
   */
  private flyToRoute(route_id: string): void {
    const trips =
      this.gtfsParser!.getFileDataSyncTyped<Trips>('trips.txt') || [];
    const stopTimes =
      this.gtfsParser!.getFileDataSyncTyped<StopTimes>('stop_times.txt') || [];
    const stops =
      this.gtfsParser!.getFileDataSyncTyped<Stops>('stops.txt') || [];

    // Find all stops for this route
    const routeStops = new Set<string>();
    const routeTrips = trips.filter((trip) => trip.route_id === route_id);
    routeTrips.forEach((trip) => {
      const tripStopTimes = stopTimes.filter(
        (st) => st.trip_id === trip.trip_id
      );
      tripStopTimes.forEach((st) => routeStops.add(st.stop_id));
    });

    // Get coordinates for all stops
    const coordinates: [number, number][] = [];
    stops.forEach((stop) => {
      if (routeStops.has(stop.stop_id) && stop.stop_lat && stop.stop_lon) {
        coordinates.push([stop.stop_lon, stop.stop_lat]);
      }
    });

    if (coordinates.length > 0) {
      const bounds = coordinates.reduce(
        (bounds, coord) => bounds.extend(coord),
        new LngLatBounds(coordinates[0], coordinates[0])
      );

      this.map!.fitBounds(bounds, {
        padding: {
          top: 80,
          bottom: 80 + this.bottomPadding,
          left: 80,
          right: 80,
        },
        duration: 2000,
        essential: true,
      });
    }
  }

  /**
   * Fit map to show specific routes
   */
  public fitToRoutes(route_ids: string[]): void {
    const trips =
      this.gtfsParser!.getFileDataSyncTyped<Trips>('trips.txt') || [];
    const stopTimes =
      this.gtfsParser!.getFileDataSyncTyped<StopTimes>('stop_times.txt') || [];
    const stops =
      this.gtfsParser!.getFileDataSyncTyped<Stops>('stops.txt') || [];

    // Find all stops for these routes
    const allStops = new Set<string>();

    route_ids.forEach((route_id) => {
      const routeTrips = trips.filter((trip) => trip.route_id === route_id);
      routeTrips.forEach((trip) => {
        const tripStopTimes = stopTimes.filter(
          (st) => st.trip_id === trip.trip_id
        );
        tripStopTimes.forEach((st) => allStops.add(st.stop_id));
      });
    });

    // Get coordinates for all stops
    const coordinates: [number, number][] = [];
    stops.forEach((stop) => {
      if (allStops.has(stop.stop_id) && stop.stop_lat && stop.stop_lon) {
        coordinates.push([stop.stop_lon, stop.stop_lat]);
      }
    });

    if (coordinates.length > 0) {
      const bounds = coordinates.reduce(
        (bounds, coord) => bounds.extend(coord),
        new LngLatBounds(coordinates[0], coordinates[0])
      );

      this.map!.fitBounds(bounds, {
        padding: {
          top: 50,
          bottom: 50 + this.bottomPadding,
          left: 50,
          right: 50,
        },
      });
    }
  }

  /**
   * Highlight all routes for a specific agency
   */
  public highlightAgencyRoutes(agency_id: string): void {
    const routes =
      this.gtfsParser!.getFileDataSyncTyped<Routes>('routes.txt') || [];
    const agencies =
      this.gtfsParser!.getFileDataSyncTyped<Agency>('agency.txt') || [];
    const acceptedIds = agencyRouteFilter(agency_id, agencies.length);
    const agencyRoutes = routes.filter((route) =>
      acceptedIds.includes(normalizeAgencyId(route.agency_id))
    );

    if (agencyRoutes.length === 0) {
      return;
    }

    const agencyRouteIds = agencyRoutes.map((r) => r.route_id);

    this.clearHighlights();
    this.routeRenderer?.highlightRoutes(agencyRouteIds);
    this.fitToRoutes(agencyRouteIds);
  }

  // ========================================
  // MODE MANAGEMENT
  // ========================================

  /**
   * Set map interaction mode
   */
  public setMapMode(mode: MapMode): void {
    this.interactionHandler?.setMapMode(mode);
  }

  /**
   * Get current map mode
   */
  public getCurrentMode(): MapMode {
    return this.interactionHandler?.getCurrentMode() || MapMode.NAVIGATE;
  }

  /**
   * Toggle add stop mode
   */
  public toggleAddStopMode(): void {
    this.interactionHandler?.toggleAddStopMode();
  }

  /**
   * Toggle add pathway mode
   */
  public toggleAddPathwayMode(): void {
    this.interactionHandler?.toggleAddPathwayMode();
  }

  // ========================================
  // UI INTEGRATION METHODS
  // ========================================

  /**
   * Force map resize (for layout changes)
   */
  public resizeNow(): void {
    this.map?.resize();
  }

  public forceMapResize(): void {
    if (!this.map) {
      return;
    }

    // Clear any pending resize operations
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    // Wait for CSS transition to complete
    this.resizeTimeout = setTimeout(() => {
      const center = this.map!.getCenter();
      const zoom = this.map!.getZoom();

      this.map!.resize();

      // Restore center and zoom to prevent jumping
      this.map!.setCenter(center);
      this.map!.setZoom(zoom);

      this.resizeTimeout = null;
    }, 350);
  }

  /**
   * Highlight file data (legacy compatibility)
   */
  public highlightFileData(fileName: string): void {
    console.log(`Highlighting data for ${fileName}`);
    // Could be enhanced to highlight specific file types
  }

  // ========================================
  // EVENT HANDLERS
  // ========================================

  /**
   * Handle route click events
   */
  private async handleRouteClick(route_id: string): Promise<void> {
    console.log('Route clicked:', route_id);

    this.applyFocusedObject({ type: 'route', id: route_id });

    // Navigate using page state manager
    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({ type: 'route', route_id });
    }

    // Legacy callback support
    if (this.callbacks.onRouteSelect) {
      this.callbacks.onRouteSelect(route_id);
    }
  }

  /**
   * Handle stop click events
   */
  private async handleStopClick(stop_id: string): Promise<void> {
    console.log('Stop clicked:', stop_id);

    this.applyFocusedObject({ type: 'stop', id: stop_id });

    // Navigate using page state manager
    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({ type: 'stop', stop_id });
    }

    // Legacy callback support
    if (this.callbacks.onStopSelect) {
      this.callbacks.onStopSelect(stop_id);
    }
  }

  /**
   * Handle mode change events
   */
  private handleModeChange(mode: MapMode): void {
    console.log('Map mode changed to:', mode);

    if (this.callbacks.onModeChange) {
      this.callbacks.onModeChange(mode);
    }
  }

  /**
   * Handle pathway click events
   */
  private async handlePathwayClick(pathway_id: string): Promise<void> {
    console.log('Pathway clicked:', pathway_id);

    this.applyFocusedObject({ type: 'pathway', id: pathway_id });

    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({
        type: 'pathway',
        pathway_id,
      });
    }

    if (this.callbacks.onPathwaySelect) {
      this.callbacks.onPathwaySelect(pathway_id);
    }
  }

  /**
   * Handle stop drag completion
   */
  private async handleStopDragComplete(
    stop_id: string,
    lat: number,
    lng: number
  ): Promise<void> {
    console.log(`Stop ${stop_id} dragged to: ${lat}, ${lng}`);

    try {
      if (this.gtfsParser?.updateStopCoordinates) {
        await this.gtfsParser.updateStopCoordinates(stop_id, lat, lng);
        console.log(`✅ Updated coordinates for stop ${stop_id}`);

        // Update layer data
        this.layerManager?.updateStopsData();

        // Rebuild pathways if a station is expanded (stop drag may shift endpoints)
        const expandedStation = this.deriveExpandedStation();
        if (expandedStation) {
          this.layerManager?.rebuildPathwaysSource(expandedStation);
        }
      }
    } catch (error) {
      console.error(`Failed to update coordinates for stop ${stop_id}:`, error);

      // Show error notification
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.showNotification(
        `Failed to update stop coordinates: ${errorMessage}`,
        'error'
      );

      // Refresh map to revert visual changes
      await this.updateMap();
    }
  }

  /**
   * Handle pathway creation — rebuild pathways layer and navigate to the new pathway
   */
  private async handlePathwayCreated(pathway_id: string): Promise<void> {
    console.log(`Pathway ${pathway_id} created`);
    const expandedStation = this.deriveExpandedStation();
    if (expandedStation) {
      this.layerManager?.rebuildPathwaysSource(expandedStation);
    }
    if (this.pageStateManager) {
      await this.pageStateManager.setPageState({ type: 'pathway', pathway_id });
    }
    this.callbacks.onPathwaySelect?.(pathway_id);
  }

  /**
   * Handle stop creation
   */
  private handleStopCreated(stop_id: string): void {
    console.log(`Stop ${stop_id} created`);

    // Update layer data to show the new stop
    this.layerManager?.updateStopsData();
  }

  /**
   * Show notification (integration with notification system)
   */
  private showNotification(
    message: string,
    type: 'success' | 'error' | 'warning' = 'success'
  ): void {
    import('./notification-system.js')
      .then(({ notifications }) => {
        if (type === 'success') {
          notifications.showSuccess(message);
        } else if (type === 'error') {
          notifications.showError(message);
        } else if (type === 'warning') {
          notifications.showWarning(message);
        }
      })
      .catch((err) => {
        console.error('Failed to load notification system:', err);
        console.log(`${type.toUpperCase()}: ${message}`);
      });
  }

  // ========================================
  // LEGACY COMPATIBILITY METHODS
  // ========================================

  /**
   * Legacy compatibility methods for existing code
   */
  public focusRoute(route_id: string): void {
    this.highlightRoute(route_id);
  }

  public focusStop(stop_id: string): void {
    this.highlightStop(stop_id);
  }

  public clearFocus(): void {
    this.clearHighlights();
  }

  public setRouteSelectCallback(callback: (route_id: string) => void): void {
    this.callbacks.onRouteSelect = callback;
  }

  public setStopSelectCallback(callback: (stop_id: string) => void): void {
    this.callbacks.onStopSelect = callback;
  }

  public refreshStops(): void {
    this.layerManager?.updateStopsData();
  }

  public setModeChangeCallback(callback: (mode: MapMode) => void): void {
    this.callbacks.onModeChange = callback;
  }

  // ========================================
  // LIFECYCLE MANAGEMENT
  // ========================================

  /**
   * Destroy the map controller and clean up resources
   */
  public destroy(): void {
    if (!this.isInitialized) {
      return;
    }

    // Clean up timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    // Destroy modules
    this.routeRenderer?.destroy();
    this.interactionHandler?.destroy();
    this.basemapControl?.destroy();
    // LayerManager doesn't need explicit cleanup as it's tied to the map

    // Clean up map
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    // Reset state
    this.routeRenderer = null;
    this.layerManager = null;
    this.interactionHandler = null;
    this.basemapControl = null;
    this.gtfsParser = null;
    this.pageStateManager = null;
    this.callbacks = {};
    this.focusedObject = { type: 'none' };
    this.isInitialized = false;

    console.log('🧹 MapController destroyed');
  }

  /**
   * Get debug information about the map controller
   */
  public getDebugInfo(): object {
    return {
      isInitialized: this.isInitialized,
      mapElementId: this.mapElementId,
      hasMap: !!this.map,
      hasRouteRenderer: !!this.routeRenderer,
      hasLayerManager: !!this.layerManager,
      hasInteractionHandler: !!this.interactionHandler,
      hasBasemapControl: !!this.basemapControl,
      hasGtfsParser: !!this.gtfsParser,
      hasPageStateManager: !!this.pageStateManager,
      currentMode: this.getCurrentMode(),
      currentBasemap: this.basemapControl?.getCurrentBasemap(),
      mapCenter: this.map?.getCenter(),
      mapZoom: this.map?.getZoom(),
      routeDataCount: this.routeRenderer?.getRouteFeatures().length || 0,
      focusedObject: this.focusedObject,
    };
  }

  // ========================================
  // BASEMAP CONTROL METHODS
  // ========================================

  /**
   * Get the basemap control instance
   */
  public getBasemapControl(): BasemapControl | null {
    return this.basemapControl;
  }

  /**
   * Set basemap style
   */
  public setBasemap(basemapId: string): void {
    this.basemapControl?.setBasemap(basemapId);
  }
}
