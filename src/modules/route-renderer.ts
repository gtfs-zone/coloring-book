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
    trip_ids: string[];
  };
}

export interface RouteRenderingOptions {
  lineWidth: number;
  opacity: number;
  clickable: boolean;
}

export class RouteRenderer {
  private map: MapLibreMap;
  private routeFeatures: Map<string, RouteFeature> = new Map();
  private gtfsParser: GTFSParser;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private renderMode: 'shapes' | 'stops' = 'shapes';

  // Cached indexes (null = not yet built / invalidated)
  private shapeIndex: Map<string, [number, number][]> | null = null;
  private stopSeqIndex: Map<string, [number, number][]> | null = null;
  private tripsByGeomKey: Map<
    string,
    { route_id: string; trip_ids: Set<string> }
  > | null = null;

  private defaultOptions: RouteRenderingOptions = {
    lineWidth: 3,
    opacity: 0.7,
    clickable: true,
  };

  constructor(map: MapLibreMap, gtfsParser: GTFSParser) {
    this.map = map;
    this.gtfsParser = gtfsParser;

    this.initializationPromise = new Promise((resolve) => {
      if (this.map.isStyleLoaded() && this.map.loaded()) {
        this.initializeMapLayers().then(resolve);
      } else {
        this.map.once('load', async () => {
          await this.initializeMapLayers();
          resolve();
        });
      }
    });
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initializationPromise && !this.initialized) {
      await this.initializationPromise;
    }

    if (this.initialized && !this.map.getSource('routes')) {
      console.log('[RouteRenderer] Routes source missing, re-initializing...');
      this.initialized = false;
      this.initializationPromise = this.initializeMapLayers();
      await this.initializationPromise;
    }
  }

  private async initializeMapLayers(): Promise<void> {
    console.log('[RouteRenderer] Initializing MapLibre route layers...');

    if (this.initialized) {
      return;
    }

    if (this.map.getSource('routes')) {
      this.initialized = true;
      return;
    }

    this.map.addSource('routes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

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
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    this.map.addLayer({
      id: 'routes-clickarea',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': 'transparent',
        'line-width': 15,
        'line-opacity': 0,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    this.map.addLayer({
      id: 'routes-highlight',
      type: 'line',
      source: 'routes',
      filter: ['==', 'route_id', ''],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 8,
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    this.initialized = true;
    console.log('[RouteRenderer] Layers initialized');
  }

  private invalidateAll(): void {
    this.shapeIndex = null;
    this.stopSeqIndex = null;
    this.tripsByGeomKey = null;
    this.routeFeatures = new Map();
  }

  /**
   * Build all cached indexes and populate routeFeatures, deduplicating by (route_id, geometry_key).
   * Lazily called — noop if caches are already warm.
   */
  private createRouteFeatures(): void {
    if (this.shapeIndex !== null) {
      return; // Already built
    }

    const routes = this.gtfsParser.getFileDataSyncTyped<Routes>('routes.txt');
    const trips = this.gtfsParser.getFileDataSyncTyped<Trips>('trips.txt');
    const shapes = this.gtfsParser.getFileDataSyncTyped<Shapes>('shapes.txt');
    const stopTimes =
      this.gtfsParser.getFileDataSyncTyped<StopTimes>('stop_times.txt');
    const stops = this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt');

    if (routes.length === 0 || trips.length === 0) {
      this.shapeIndex = new Map();
      this.stopSeqIndex = new Map();
      this.tripsByGeomKey = new Map();
      return;
    }

    console.log(
      `[RouteRenderer] Building indexes: ${shapes.length} shapes, ${stopTimes.length} stop_times, ${stops.length} stops, ${trips.length} trips, ${routes.length} routes`
    );

    // Build shapeIndex: shape_id -> sorted [lon, lat] coords
    this.shapeIndex = new Map();
    if (shapes.length > 0) {
      const buckets = new Map<string, Shapes[]>();
      for (const pt of shapes) {
        const arr = buckets.get(pt.shape_id);
        if (arr) {
          arr.push(pt);
        } else {
          buckets.set(pt.shape_id, [pt]);
        }
      }
      for (const [id, pts] of buckets) {
        pts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
        this.shapeIndex.set(
          id,
          pts.map((p) => [p.shape_pt_lon, p.shape_pt_lat])
        );
      }
    }

    // Build stopsLookup: stop_id -> {lon, lat}
    const stopsLookup = new Map<string, [number, number]>();
    for (const stop of stops) {
      if (stop.stop_lat !== null && stop.stop_lon !== null) {
        stopsLookup.set(stop.stop_id, [stop.stop_lon, stop.stop_lat]);
      }
    }

    // Build tripStopTimesIndex: trip_id -> stop_times sorted by stop_sequence
    const tripStopTimesIndex = new Map<string, StopTimes[]>();
    for (const st of stopTimes) {
      const arr = tripStopTimesIndex.get(st.trip_id);
      if (arr) {
        arr.push(st);
      } else {
        tripStopTimesIndex.set(st.trip_id, [st]);
      }
    }
    for (const arr of tripStopTimesIndex.values()) {
      arr.sort((a, b) => a.stop_sequence - b.stop_sequence);
    }

    // Build routes lookup: route_id -> route
    const routesLookup = new Map<string, Routes>();
    for (const route of routes) {
      routesLookup.set(route.route_id, route);
    }

    // Build tripsByRoute: route_id -> trips (preserve routes.txt order)
    const tripsByRoute = new Map<string, Trips[]>();
    for (const trip of trips) {
      const arr = tripsByRoute.get(trip.route_id);
      if (arr) {
        arr.push(trip);
      } else {
        tripsByRoute.set(trip.route_id, [trip]);
      }
    }

    this.stopSeqIndex = new Map();
    this.tripsByGeomKey = new Map();

    let tripsProcessed = 0;

    for (const route of routes) {
      const route_id = route.route_id;
      const routeColor = this.getRouteColor(route_id, route.route_color);
      const routeTrips = tripsByRoute.get(route_id) ?? [];

      for (const trip of routeTrips) {
        tripsProcessed++;
        let geometryKey: string;
        let coords: [number, number][] | null = null;

        // Determine geometry_key and coords
        if (
          this.renderMode === 'shapes' &&
          trip.shape_id &&
          this.shapeIndex.has(trip.shape_id)
        ) {
          geometryKey = `shape:${trip.shape_id}`;
          coords = this.shapeIndex.get(trip.shape_id)!;
        } else {
          // Stops mode or missing/unknown shape — derive from stop sequence
          if (trip.shape_id && this.renderMode === 'shapes') {
            console.warn(
              `[RouteRenderer] Trip ${trip.trip_id} references unknown shape_id "${trip.shape_id}", falling back to stop connections`
            );
          }
          const tripSTs = tripStopTimesIndex.get(trip.trip_id) ?? [];
          const stopIds = tripSTs
            .map((st) => st.stop_id)
            .filter((sid) => stopsLookup.has(sid));

          if (stopIds.length < 2) {
            continue; // Not enough stops to draw a line
          }

          geometryKey = `stops:${stopIds.join('|')}`;

          if (!this.stopSeqIndex.has(geometryKey)) {
            const coordArr = stopIds.map((sid) => stopsLookup.get(sid)!);
            this.stopSeqIndex.set(geometryKey, coordArr);
          }
          coords = this.stopSeqIndex.get(geometryKey)!;
        }

        if (!coords || coords.length < 2) {
          continue;
        }

        const featureKey = `${route_id}::${geometryKey}`;

        // Update tripsByGeomKey bucket
        const bucket = this.tripsByGeomKey.get(featureKey);
        if (bucket) {
          bucket.trip_ids.add(trip.trip_id);
        } else {
          this.tripsByGeomKey.set(featureKey, {
            route_id,
            trip_ids: new Set([trip.trip_id]),
          });
        }

        // Create or update feature
        if (!this.routeFeatures.has(featureKey)) {
          this.routeFeatures.set(featureKey, {
            type: 'Feature',
            id: featureKey,
            geometry: {
              type: 'LineString',
              coordinates: coords,
            },
            properties: {
              route_id,
              route_data: route,
              color: routeColor,
              route_short_name: route.route_short_name,
              route_long_name: route.route_long_name,
              trip_ids: [trip.trip_id],
            },
          });
        } else {
          // Append trip_id to existing feature's trip_ids list
          this.routeFeatures
            .get(featureKey)!
            .properties.trip_ids.push(trip.trip_id);
        }
      }
    }

    console.log(
      `[RouteRenderer] Index build complete: ${tripsProcessed} trips → ${this.routeFeatures.size} features (${((1 - this.routeFeatures.size / Math.max(tripsProcessed, 1)) * 100).toFixed(1)}% dedupe)`
    );
  }

  private getRouteColor(route_id: string, gtfsRouteColor?: string): string {
    if (
      gtfsRouteColor &&
      gtfsRouteColor.length === 6 &&
      /^[0-9A-Fa-f]+$/.test(gtfsRouteColor)
    ) {
      return `#${gtfsRouteColor}`;
    }

    let hash = 0;
    for (let i = 0; i < route_id.length; i++) {
      const char = route_id.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  public setRenderMode(mode: 'shapes' | 'stops'): void {
    console.log(`[RouteRenderer] Setting render mode: ${mode}`);
    this.renderMode = mode;
    void this.renderRoutes();
  }

  public async renderRoutes(
    _options: Partial<RouteRenderingOptions> = {}
  ): Promise<void> {
    console.log('[RouteRenderer] Rendering routes...');

    await this.ensureInitialized();

    // Phase 1: full rebuild on every render call (Phase 2 will replace this
    // with surgical patch-driven invalidation)
    this.invalidateAll();
    this.createRouteFeatures();

    const featureCount = this.routeFeatures.size;
    if (featureCount === 0) {
      console.warn('[RouteRenderer] No route features available for rendering');
      return;
    }

    const source = this.map.getSource('routes') as maplibregl.GeoJSONSource;
    source.setData({
      type: 'FeatureCollection' as const,
      features: [...this.routeFeatures.values()],
    });
    this.map.triggerRepaint();

    console.log(`[RouteRenderer] setData called with ${featureCount} features`);
  }

  public clearRoutes(): void {
    const source = this.map.getSource('routes') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    this.invalidateAll();
  }

  public highlightRoute(route_id: string): void {
    if (this.routeFeatures.size === 0) {
      return;
    }

    console.log(`[RouteRenderer] Highlighting route: ${route_id}`);
    this.map.setFilter('routes-highlight', ['==', 'route_id', route_id]);
  }

  public highlightRoutes(route_ids: string[]): void {
    if (this.routeFeatures.size === 0 || route_ids.length === 0) {
      return;
    }

    console.log(`[RouteRenderer] Highlighting ${route_ids.length} routes`);
    this.map.setFilter('routes-highlight', ['in', 'route_id', ...route_ids]);
  }

  public clearHighlight(): void {
    this.map.setFilter('routes-highlight', ['==', 'route_id', '']);
  }

  /**
   * @deprecated Route clicks are handled by InteractionHandler
   */
  public setRouteClickHandler(
    _handler: (route_id: string, route_data: Routes) => void
  ): void {
    console.warn(
      'RouteRenderer.setRouteClickHandler is deprecated - route clicks are handled by InteractionHandler'
    );
  }

  public getRouteFeatures(): RouteFeature[] {
    return [...this.routeFeatures.values()];
  }

  public destroy(): void {
    this.clearRoutes();

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
  }
}
