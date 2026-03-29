import { Map as MapLibreMap } from 'maplibre-gl';
import {
  Routes,
  Trips,
  Shapes,
  StopTimes,
  Stops,
} from '../types/gtfs-entities.js';
import type { GTFSParser } from './gtfs-parser.js';

export interface RouteFeature extends GeoJSON.Feature {
  id: string;
  geometry: GeoJSON.LineString;
  properties: {
    route_id: string;
    route_data: Routes;
    color: string;
    route_short_name?: string;
    route_long_name?: string;
  };
}

export interface RouteRenderingOptions {
  lineWidth: number;
  opacity: number;
  clickable: boolean;
}

export class RouteRenderer {
  private map: MapLibreMap;
  private routeFeatures: RouteFeature[] = [];
  private gtfsParser: GTFSParser;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  // Default rendering options
  private defaultOptions: RouteRenderingOptions = {
    lineWidth: 3,
    opacity: 0.7,
    clickable: true,
  };

  constructor(map: MapLibreMap, gtfsParser: GTFSParser) {
    this.map = map;
    this.gtfsParser = gtfsParser;

    // Start initialization and store promise
    // Always wait for the 'load' event to ensure style is fully loaded
    this.initializationPromise = new Promise((resolve) => {
      if (this.map.isStyleLoaded() && this.map.loaded()) {
        // Map and style are already loaded
        this.initializeMapLayers().then(resolve);
      } else {
        // Wait for both map and style to load
        this.map.once('load', async () => {
          await this.initializeMapLayers();
          resolve();
        });
      }
    });
  }

  /**
   * Ensure layers are initialized before use
   * @returns Promise that resolves when initialization is complete
   */
  public async ensureInitialized(): Promise<void> {
    // First, always wait for initial initialization to complete
    if (this.initializationPromise && !this.initialized) {
      await this.initializationPromise;
    }

    // Then check if source still exists (may have been removed by style change)
    if (this.initialized && !this.map.getSource('routes')) {
      console.log('🔄 Routes source missing, re-initializing...');
      this.initialized = false;
      this.initializationPromise = this.initializeMapLayers();
      await this.initializationPromise;
    }
  }

  /**
   * Initialize MapLibre layers for route rendering
   */
  private async initializeMapLayers(): Promise<void> {
    console.log('🔧 Initializing MapLibre route layers...');

    // Check if already initialized
    if (this.initialized) {
      console.log('✅ Routes already initialized');
      return;
    }

    // Check if source already exists
    if (this.map.getSource('routes')) {
      console.log('🔍 Routes source already exists');
      this.initialized = true;
      return;
    }

    // Add routes source
    this.map.addSource('routes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    console.log('✅ Routes source added');

    // Add route background layer for visual appearance
    this.map.addLayer({
      id: 'routes-background',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': this.defaultOptions.lineWidth,
        'line-opacity': this.defaultOptions.opacity,
      },
      layout: {
        'line-cap': 'round', // KEY: This creates smooth line ends
        'line-join': 'round', // KEY: This creates smooth line joints
      },
    });

    console.log('✅ Routes background layer added');

    // Add click area layer for interactions
    this.map.addLayer({
      id: 'routes-clickarea',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': 'transparent',
        'line-width': 15, // Wider click area
        'line-opacity': 0,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Add route highlight layer
    this.map.addLayer({
      id: 'routes-highlight',
      type: 'line',
      source: 'routes',
      filter: ['==', 'route_id', ''], // Initially matches nothing
      paint: {
        'line-color': ['get', 'color'], // Use route's original color
        'line-width': 8, // Thicker than normal (normal is 3)
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    this.initialized = true;
    console.log('✅ Routes layers initialized successfully');
  }

  /**
   * Create route features as GeoJSON FeatureCollection
   */
  private createRouteFeatures(): RouteFeature[] {
    const routes = this.gtfsParser.getFileDataSyncTyped<Routes>('routes.txt');
    const trips = this.gtfsParser.getFileDataSyncTyped<Trips>('trips.txt');
    const shapes = this.gtfsParser.getFileDataSyncTyped<Shapes>('shapes.txt');
    const stopTimes =
      this.gtfsParser.getFileDataSyncTyped<StopTimes>('stop_times.txt');
    const stops = this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt');

    if (routes.length === 0 || trips.length === 0) {
      return [];
    }

    // Build shape index: shape_id -> sorted coordinates (one pass, O(S))
    const shapeIndex = new Map<string, [number, number][]>();
    if (shapes.length > 0) {
      // Group points by shape_id
      const buckets = new Map<string, Shapes[]>();
      for (const pt of shapes) {
        const arr = buckets.get(pt.shape_id);
        if (arr) {
          arr.push(pt);
        } else {
          buckets.set(pt.shape_id, [pt]);
        }
      }
      // Sort each bucket once and convert to coordinates
      for (const [id, pts] of buckets) {
        pts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
        shapeIndex.set(
          id,
          pts.map((p) => [p.shape_pt_lon, p.shape_pt_lat])
        );
      }
    }

    // Build trips index: route_id -> trips (one pass, O(T))
    const tripsByRoute = new Map<string, Trips[]>();
    for (const trip of trips) {
      const arr = tripsByRoute.get(trip.route_id);
      if (arr) {
        arr.push(trip);
      } else {
        tripsByRoute.set(trip.route_id, [trip]);
      }
    }

    const routeFeatures: RouteFeature[] = [];

    routes.forEach((route) => {
      const route_id = route.route_id;
      const routeColor = this.getRouteColor(route_id, route.route_color);

      const routeTrips = tripsByRoute.get(route_id) ?? [];

      routeTrips.forEach((trip) => {
        let geometry = null;

        // Try to use shape data first
        if (trip.shape_id && shapeIndex.size > 0) {
          geometry = this.createRouteGeometryFromShape(
            trip.shape_id,
            shapeIndex
          );
        }

        // Fall back to stop connections if no shape
        if (!geometry && stopTimes.length > 0 && stops.length > 0) {
          console.warn(
            `No shape data for trip ${trip.trip_id}, falling back to stop connections (will be jagged)`
          );
          geometry = this.createRouteGeometryFromStops(
            trip.trip_id,
            stopTimes,
            stops
          );
        }

        if (geometry && geometry.coordinates.length >= 2) {
          routeFeatures.push({
            type: 'Feature',
            id: `${route_id}-${trip.trip_id}`,
            geometry: geometry,
            properties: {
              route_id,
              route_data: route,
              color: routeColor,
              route_short_name: route.route_short_name,
              route_long_name: route.route_long_name,
            },
          });
        }
      });
    });

    return routeFeatures;
  }

  /**
   * Create route geometry from pre-indexed shapes
   */
  private createRouteGeometryFromShape(
    shape_id: string,
    shapeIndex: Map<string, [number, number][]>
  ): GeoJSON.LineString | null {
    const coordinates = shapeIndex.get(shape_id);

    if (!coordinates || coordinates.length < 2) {
      return null;
    }

    return {
      type: 'LineString',
      coordinates,
    };
  }

  /**
   * Create route geometry from stop connections (fallback)
   */
  private createRouteGeometryFromStops(
    trip_id: string,
    stopTimes: StopTimes[],
    stops: Stops[]
  ): GeoJSON.LineString | null {
    // Create stops lookup
    const stopsLookup: { [key: string]: { lat: number; lon: number } } = {};
    stops.forEach((stop) => {
      if (stop.stop_lat !== null && stop.stop_lon !== null) {
        stopsLookup[stop.stop_id] = {
          lat: stop.stop_lat,
          lon: stop.stop_lon,
        };
      }
    });

    // Get stops for this trip
    const tripStopTimes = stopTimes
      .filter((st) => st.trip_id === trip_id)
      .sort((a, b) => a.stop_sequence - b.stop_sequence);

    const routePath: [number, number][] = [];
    tripStopTimes.forEach((st) => {
      const stopCoords = stopsLookup[st.stop_id];
      if (stopCoords) {
        routePath.push([stopCoords.lon, stopCoords.lat]);
      }
    });

    if (routePath.length < 2) {
      return null;
    }

    return {
      type: 'LineString',
      coordinates: routePath,
    };
  }

  /**
   * Generate deterministic color for route
   */
  private getRouteColor(route_id: string, gtfsRouteColor?: string): string {
    // Use GTFS route_color if available and valid
    if (
      gtfsRouteColor &&
      gtfsRouteColor.length === 6 &&
      /^[0-9A-Fa-f]+$/.test(gtfsRouteColor)
    ) {
      return `#${gtfsRouteColor}`;
    }

    // Generate deterministic color from route ID
    let hash = 0;
    for (let i = 0; i < route_id.length; i++) {
      const char = route_id.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  /**
   * Render routes using MapLibre with smooth line rendering
   */
  public async renderRoutes(
    _options: Partial<RouteRenderingOptions> = {}
  ): Promise<void> {
    console.log(
      '🎨 Rendering routes using MapLibre with smooth line rendering...'
    );

    // Ensure layers are initialized
    await this.ensureInitialized();

    // Create route features
    this.routeFeatures = this.createRouteFeatures();

    if (this.routeFeatures.length === 0) {
      console.warn('No route features available for rendering');
      return;
    }

    // Source is guaranteed to exist now
    const source = this.map.getSource('routes') as maplibregl.GeoJSONSource;
    const geoJsonData = {
      type: 'FeatureCollection' as const,
      features: this.routeFeatures,
    };

    source.setData(geoJsonData);
    this.map.triggerRepaint();

    console.log(
      `✅ Rendered ${this.routeFeatures.length} route features using MapLibre with smooth lines`
    );
  }

  /**
   * Clear all route rendering
   */
  public clearRoutes(): void {
    const source = this.map.getSource('routes') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    this.routeFeatures = [];
  }

  /**
   * Update route highlighting for specific route
   */
  public highlightRoute(route_id: string): void {
    if (this.routeFeatures.length === 0) {
      return;
    }

    console.log(`🎯 Highlighting route: ${route_id}`);

    // Update the highlight filter
    this.map.setFilter('routes-highlight', ['==', 'route_id', route_id]);

    console.log(`✅ Route highlight applied: ${route_id}`);
  }

  /**
   * Update route highlighting for multiple routes
   */
  public highlightRoutes(route_ids: string[]): void {
    if (this.routeFeatures.length === 0 || route_ids.length === 0) {
      return;
    }

    console.log(`🎯 Highlighting ${route_ids.length} routes`);

    // Store first route as the primary highlighted route

    // Update the highlight filter to match any of the route IDs
    this.map.setFilter('routes-highlight', ['in', 'route_id', ...route_ids]);

    console.log(`✅ Route highlights applied for ${route_ids.length} routes`);
  }

  /**
   * Clear route highlighting
   */
  public clearHighlight(): void {
    // Set filter to match nothing
    this.map.setFilter('routes-highlight', ['==', 'route_id', '']);
  }

  /**
   * Set click handler for route interactions (DEPRECATED - handled by InteractionHandler)
   */
  public setRouteClickHandler(
    _handler: (route_id: string, route_data: Routes) => void
  ): void {
    // NOTE: Route clicks are now handled by InteractionHandler to prevent conflicts with stop clicks
    // This method is kept for legacy compatibility but does nothing
    console.warn(
      'RouteRenderer.setRouteClickHandler is deprecated - route clicks are handled by InteractionHandler'
    );
  }

  /**
   * Get current route features for debugging
   */
  public getRouteFeatures(): RouteFeature[] {
    return this.routeFeatures;
  }

  /**
   * Destroy the route renderer and clean up resources
   */
  public destroy(): void {
    this.clearRoutes();

    // Remove layers and source
    if (this.map.getLayer('routes-highlight')) {
      this.map.removeLayer('routes-highlight');
    }
    if (this.map.getLayer('routes-clickarea')) {
      this.map.removeLayer('routes-clickarea');
    }
    if (this.map.getLayer('routes-background')) {
      this.map.removeLayer('routes-background');
    }
    if (this.map.getSource('routes')) {
      this.map.removeSource('routes');
    }

    this.routeFeatures = [];
  }
}
