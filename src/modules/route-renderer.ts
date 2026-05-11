import { Map as MapLibreMap } from 'maplibre-gl';
import {
  Routes,
  Trips,
  Shapes,
  StopTimes,
  Stops,
} from '../types/gtfs-entities.js';
import type { GTFSParser } from './gtfs-parser.js';
import type { PatchOp } from '../types/patch.js';

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

  // Reverse indexes for surgical patch-driven invalidation
  private tripToFeatureKey: Map<string, string> | null = null;
  private routeToFeatureKeys: Map<string, Set<string>> | null = null;
  private stopToGeomKeys: Map<string, Set<string>> | null = null;
  private stopsLookupCache: Map<string, [number, number]> | null = null;

  // RAF-based coalescing
  private dirtyFlag = false;

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
    this.tripToFeatureKey = null;
    this.routeToFeatureKeys = null;
    this.stopToGeomKeys = null;
    this.stopsLookupCache = null;
    this.routeFeatures = new Map();
  }

  /**
   * Schedule a single RAF-coalesced setData call. Multiple invalidations in the
   * same task queue up to one paint update.
   */
  private scheduleSetData(): void {
    if (this.dirtyFlag) {
      return;
    }
    this.dirtyFlag = true;
    requestAnimationFrame(() => {
      this.dirtyFlag = false;
      const source = this.map.getSource('routes') as maplibregl.GeoJSONSource;
      if (!source) {
        return;
      }
      source.setData({
        type: 'FeatureCollection' as const,
        features: [...this.routeFeatures.values()],
      });
      this.map.triggerRepaint();
      console.log(
        `[RouteRenderer] setData (incremental) with ${this.routeFeatures.size} features`
      );
    });
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
      this.tripToFeatureKey = new Map();
      this.routeToFeatureKeys = new Map();
      this.stopToGeomKeys = new Map();
      this.stopsLookupCache = new Map();
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

    // Build stopsLookupCache: stop_id -> [lon, lat]
    this.stopsLookupCache = new Map();
    for (const stop of stops) {
      if (stop.stop_lat !== null && stop.stop_lon !== null) {
        this.stopsLookupCache.set(stop.stop_id, [stop.stop_lon, stop.stop_lat]);
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
    this.tripToFeatureKey = new Map();
    this.routeToFeatureKeys = new Map();
    this.stopToGeomKeys = new Map();

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
            .filter((sid) => this.stopsLookupCache!.has(sid));

          if (stopIds.length < 2) {
            continue; // Not enough stops to draw a line
          }

          geometryKey = `stops:${stopIds.join('|')}`;

          if (!this.stopSeqIndex.has(geometryKey)) {
            const coordArr = stopIds.map(
              (sid) => this.stopsLookupCache!.get(sid)!
            );
            this.stopSeqIndex.set(geometryKey, coordArr);

            // Build stopToGeomKeys reverse index
            for (const sid of stopIds) {
              const s = this.stopToGeomKeys.get(sid);
              if (s) {
                s.add(geometryKey);
              } else {
                this.stopToGeomKeys.set(sid, new Set([geometryKey]));
              }
            }
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

        // Build routeToFeatureKeys reverse index
        const rfk = this.routeToFeatureKeys.get(route_id);
        if (rfk) {
          rfk.add(featureKey);
        } else {
          this.routeToFeatureKeys.set(route_id, new Set([featureKey]));
        }

        // Build tripToFeatureKey reverse index
        this.tripToFeatureKey.set(trip.trip_id, featureKey);

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

  // ========================================
  // SURGICAL PATCH INVALIDATION
  // ========================================

  /**
   * Remove a trip from its current feature bucket. If the bucket becomes empty,
   * removes the feature entirely. Updates all reverse indexes.
   */
  private removeTripFromBucket(trip_id: string, featureKey: string): void {
    const bucket = this.tripsByGeomKey!.get(featureKey);
    if (!bucket) {
      return;
    }

    bucket.trip_ids.delete(trip_id);
    this.tripToFeatureKey!.delete(trip_id);

    if (bucket.trip_ids.size === 0) {
      // Bucket empty — remove the feature and clean up indexes
      this.tripsByGeomKey!.delete(featureKey);
      this.routeFeatures.delete(featureKey);

      const fks = this.routeToFeatureKeys!.get(bucket.route_id);
      fks?.delete(featureKey);

      // Clean up stopToGeomKeys if this was a stop-sequence geometry
      const geomKey = featureKey.slice(featureKey.indexOf('::') + 2);
      if (geomKey.startsWith('stops:')) {
        this.stopSeqIndex!.delete(geomKey);
        const stopIds = geomKey.slice('stops:'.length).split('|');
        for (const sid of stopIds) {
          const s = this.stopToGeomKeys!.get(sid);
          if (s) {
            s.delete(geomKey);
            if (s.size === 0) {
              this.stopToGeomKeys!.delete(sid);
            }
          }
        }
      }
    } else {
      // Update trip_ids list in feature properties
      const feat = this.routeFeatures.get(featureKey);
      if (feat) {
        feat.properties.trip_ids = [...bucket.trip_ids];
      }
    }
  }

  /**
   * Add a trip to its appropriate feature bucket based on current parser state.
   * Creates a new feature if no bucket exists for the computed (route_id, geometry_key).
   */
  private addTripToBucket(trip_id: string): void {
    const trips = this.gtfsParser.getFileDataSyncTyped<Trips>('trips.txt');
    const trip = trips.find((t) => t.trip_id === trip_id);
    if (!trip) {
      return;
    }

    const route_id = trip.route_id;
    let geometryKey: string;
    let coords: [number, number][] | null = null;

    if (
      this.renderMode === 'shapes' &&
      trip.shape_id &&
      this.shapeIndex!.has(trip.shape_id)
    ) {
      geometryKey = `shape:${trip.shape_id}`;
      coords = this.shapeIndex!.get(trip.shape_id)!;
    } else {
      if (trip.shape_id && this.renderMode === 'shapes') {
        console.warn(
          `[RouteRenderer] Trip ${trip_id} references unknown shape_id "${trip.shape_id}", falling back to stop connections`
        );
      }
      // Re-read stop_times from parser for this trip (parser has up-to-date state)
      const allStopTimes =
        this.gtfsParser.getFileDataSyncTyped<StopTimes>('stop_times.txt');
      const tripSTs = allStopTimes
        .filter((st) => st.trip_id === trip_id)
        .sort((a, b) => a.stop_sequence - b.stop_sequence);

      const stopIds = tripSTs
        .map((st) => st.stop_id)
        .filter((sid) => this.stopsLookupCache!.has(sid));

      if (stopIds.length < 2) {
        return;
      }

      geometryKey = `stops:${stopIds.join('|')}`;

      if (!this.stopSeqIndex!.has(geometryKey)) {
        const coordArr = stopIds.map((sid) => this.stopsLookupCache!.get(sid)!);
        this.stopSeqIndex!.set(geometryKey, coordArr);
        for (const sid of stopIds) {
          const s = this.stopToGeomKeys!.get(sid);
          if (s) {
            s.add(geometryKey);
          } else {
            this.stopToGeomKeys!.set(sid, new Set([geometryKey]));
          }
        }
      }
      coords = this.stopSeqIndex!.get(geometryKey)!;
    }

    if (!coords || coords.length < 2) {
      return;
    }

    const featureKey = `${route_id}::${geometryKey}`;
    const bucket = this.tripsByGeomKey!.get(featureKey);

    if (bucket) {
      bucket.trip_ids.add(trip_id);
      const feat = this.routeFeatures.get(featureKey);
      if (feat) {
        feat.properties.trip_ids = [...bucket.trip_ids];
      }
    } else {
      const routes = this.gtfsParser.getFileDataSyncTyped<Routes>('routes.txt');
      const route = routes.find((r) => r.route_id === route_id);
      if (!route) {
        return;
      }
      const routeColor = this.getRouteColor(route_id, route.route_color);

      this.tripsByGeomKey!.set(featureKey, {
        route_id,
        trip_ids: new Set([trip_id]),
      });
      this.routeFeatures.set(featureKey, {
        type: 'Feature',
        id: featureKey,
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          route_id,
          route_data: route,
          color: routeColor,
          route_short_name: route.route_short_name,
          route_long_name: route.route_long_name,
          trip_ids: [trip_id],
        },
      });

      const fks = this.routeToFeatureKeys!.get(route_id);
      if (fks) {
        fks.add(featureKey);
      } else {
        this.routeToFeatureKeys!.set(route_id, new Set([featureKey]));
      }
    }

    this.tripToFeatureKey!.set(trip_id, featureKey);
  }

  /**
   * Surgically update features when a route record changes.
   * forwardChanges: the `changes` map from the update patch (for update op).
   */
  public invalidateRoute(
    route_id: string,
    op: PatchOp,
    forwardChanges?: Record<string, unknown>
  ): void {
    if (this.tripsByGeomKey === null) {
      return;
    }

    if (op === 'update') {
      // Only matters for map if visual properties changed
      if (
        forwardChanges &&
        !('route_color' in forwardChanges) &&
        !('route_short_name' in forwardChanges) &&
        !('route_long_name' in forwardChanges)
      ) {
        return;
      }
      const routes = this.gtfsParser.getFileDataSyncTyped<Routes>('routes.txt');
      const route = routes.find((r) => r.route_id === route_id);
      if (!route) {
        return;
      }
      const newColor = this.getRouteColor(route_id, route.route_color);
      const featureKeys = this.routeToFeatureKeys?.get(route_id);
      if (!featureKeys) {
        return;
      }
      for (const fk of featureKeys) {
        const feat = this.routeFeatures.get(fk);
        if (feat) {
          feat.properties.color = newColor;
          feat.properties.route_data = route;
          feat.properties.route_short_name = route.route_short_name;
          feat.properties.route_long_name = route.route_long_name;
        }
      }
      console.log(
        `[RouteRenderer] invalidateRoute route_id=${route_id} op=update → updated ${featureKeys.size} features`
      );
      this.scheduleSetData();
    } else if (op === 'delete') {
      const featureKeys = this.routeToFeatureKeys?.get(route_id);
      if (!featureKeys) {
        return;
      }
      for (const fk of featureKeys) {
        this.routeFeatures.delete(fk);
        const bucket = this.tripsByGeomKey?.get(fk);
        if (bucket) {
          for (const tid of bucket.trip_ids) {
            this.tripToFeatureKey?.delete(tid);
          }
          this.tripsByGeomKey?.delete(fk);
        }
      }
      this.routeToFeatureKeys?.delete(route_id);
      console.log(
        `[RouteRenderer] invalidateRoute route_id=${route_id} op=delete → removed ${featureKeys.size} features`
      );
      this.scheduleSetData();
    } else if (op === 'insert') {
      const trips = this.gtfsParser.getFileDataSyncTyped<Trips>('trips.txt');
      const routeTrips = trips.filter((t) => t.route_id === route_id);
      for (const trip of routeTrips) {
        this.addTripToBucket(trip.trip_id);
      }
      console.log(
        `[RouteRenderer] invalidateRoute route_id=${route_id} op=insert → processed ${routeTrips.length} trips`
      );
      this.scheduleSetData();
    }
  }

  /**
   * Surgically update features when a trip record changes.
   * beforeShapeId / afterShapeId are extracted from the patch by the caller.
   */
  public invalidateTrip(
    trip_id: string,
    op: PatchOp,
    _beforeShapeId: string | null | undefined,
    _afterShapeId: string | null | undefined
  ): void {
    if (this.tripsByGeomKey === null || this.shapeIndex === null) {
      return;
    }

    if (op === 'update' || op === 'delete') {
      const oldFeatureKey = this.tripToFeatureKey?.get(trip_id);
      if (oldFeatureKey) {
        this.removeTripFromBucket(trip_id, oldFeatureKey);
      }
    }

    if (op === 'insert' || op === 'update') {
      this.addTripToBucket(trip_id);
    }

    console.log(
      `[RouteRenderer] invalidateTrip trip_id=${trip_id} op=${op} → done`
    );
    this.scheduleSetData();
  }

  /**
   * Surgically update features when shape points change.
   * shape_id is the GTFS shape_id (extracted from the composite patch key).
   */
  public invalidateShape(shape_id: string, op: PatchOp): void {
    if (this.shapeIndex === null) {
      return;
    }

    // Re-read all points for this shape from parser
    const shapes = this.gtfsParser.getFileDataSyncTyped<Shapes>('shapes.txt');
    const pts = shapes
      .filter((s) => s.shape_id === shape_id)
      .sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);

    if (pts.length >= 2) {
      const newCoords: [number, number][] = pts.map((p) => [
        p.shape_pt_lon,
        p.shape_pt_lat,
      ]);
      this.shapeIndex.set(shape_id, newCoords);

      // Update geometry.coordinates in-place for all features using this shape
      const geomKey = `shape:${shape_id}`;
      let anyUpdated = false;
      for (const [featureKey, feat] of this.routeFeatures) {
        if (featureKey.endsWith(`::${geomKey}`)) {
          feat.geometry.coordinates = newCoords;
          anyUpdated = true;
        }
      }

      if (!anyUpdated) {
        // Shape was previously removed (e.g. delete+insert from replace). Re-assign all trips
        // that reference this shape_id so they pick up the new shape geometry.
        const trips = this.gtfsParser.getFileDataSyncTyped<Trips>('trips.txt');
        const affected = trips.filter((t) => t.shape_id === shape_id);
        for (const trip of affected) {
          this.invalidateTrip(trip.trip_id, 'update', null, shape_id);
        }
        console.log(
          `[RouteRenderer] invalidateShape: no existing features for shape ${shape_id}, re-assigning ${affected.length} trips`
        );
      } else {
        console.log(
          `[RouteRenderer] invalidateShape shape_id=${shape_id} op=${op} → updated coords (${newCoords.length} pts)`
        );
      }
    } else if (op === 'delete' || pts.length === 0) {
      // Shape has too few points — remove it and reassign trips to stop-sequence fallback
      this.shapeIndex.delete(shape_id);
      this.handleShapeRemoved(shape_id);
      console.log(
        `[RouteRenderer] invalidateShape shape_id=${shape_id} op=${op} → shape removed, trips reassigned`
      );
    }

    this.scheduleSetData();
  }

  /** Called when a shape no longer has enough points; trips fall back to stop-sequence geometry. */
  private handleShapeRemoved(shape_id: string): void {
    const geomKey = `shape:${shape_id}`;
    const affectedFeatureKeys: string[] = [];
    for (const fk of this.routeFeatures.keys()) {
      if (fk.endsWith(`::${geomKey}`)) {
        affectedFeatureKeys.push(fk);
      }
    }

    for (const fk of affectedFeatureKeys) {
      const bucket = this.tripsByGeomKey!.get(fk);
      if (!bucket) {
        continue;
      }

      const tripIds = [...bucket.trip_ids];
      for (const tid of tripIds) {
        this.tripToFeatureKey!.delete(tid);
      }
      this.tripsByGeomKey!.delete(fk);
      this.routeFeatures.delete(fk);
      const fks = this.routeToFeatureKeys!.get(bucket.route_id);
      fks?.delete(fk);

      // Re-add each trip via stop-sequence fallback
      for (const tid of tripIds) {
        this.addTripToBucket(tid);
      }
    }
  }

  /**
   * Surgically update features when stop_times for a trip change.
   * This may change the trip's geometry_key in stops mode.
   */
  public invalidateStopTimes(trip_id: string, op: PatchOp): void {
    if (this.tripsByGeomKey === null || this.shapeIndex === null) {
      return;
    }

    // In shapes mode, stop_times don't affect geometry unless the trip has no valid shape
    if (this.renderMode === 'shapes') {
      const trips = this.gtfsParser.getFileDataSyncTyped<Trips>('trips.txt');
      const trip = trips.find((t) => t.trip_id === trip_id);
      if (trip && trip.shape_id && this.shapeIndex.has(trip.shape_id)) {
        return; // Shape-mode trip with valid shape — stop_times don't matter
      }
    }

    // Treat as a trip bucket-move: remove from old, add to new
    if (op === 'update' || op === 'delete') {
      const oldFeatureKey = this.tripToFeatureKey?.get(trip_id);
      if (oldFeatureKey) {
        this.removeTripFromBucket(trip_id, oldFeatureKey);
      }
    }

    if (op === 'insert' || op === 'update') {
      this.addTripToBucket(trip_id);
    }

    console.log(
      `[RouteRenderer] invalidateStopTimes trip_id=${trip_id} op=${op} → done`
    );
    this.scheduleSetData();
  }

  /**
   * Surgically update features when a stop's coordinates change.
   * Updates all stop-sequence geometries that include this stop.
   */
  public invalidateStop(stop_id: string, op: PatchOp): void {
    if (this.stopsLookupCache === null || this.stopSeqIndex === null) {
      return;
    }

    // Update stopsLookupCache for this stop
    if (op === 'update' || op === 'insert') {
      const stops = this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt');
      const stop = stops.find((s) => s.stop_id === stop_id);
      if (stop && stop.stop_lat !== null && stop.stop_lon !== null) {
        this.stopsLookupCache.set(stop_id, [stop.stop_lon, stop.stop_lat]);
      } else {
        this.stopsLookupCache.delete(stop_id);
      }
    } else if (op === 'delete') {
      this.stopsLookupCache.delete(stop_id);
    }

    // Recompute coords for all stop-sequence geometries using this stop
    const affectedGeomKeys = this.stopToGeomKeys?.get(stop_id);
    if (!affectedGeomKeys || affectedGeomKeys.size === 0) {
      this.scheduleSetData();
      return;
    }

    for (const geomKey of affectedGeomKeys) {
      const stopIds = geomKey.slice('stops:'.length).split('|');
      const newCoords = stopIds
        .map((sid) => this.stopsLookupCache!.get(sid))
        .filter((c): c is [number, number] => c !== undefined);

      if (newCoords.length >= 2) {
        this.stopSeqIndex!.set(geomKey, newCoords);
        for (const [featureKey, feat] of this.routeFeatures) {
          if (featureKey.endsWith(`::${geomKey}`)) {
            feat.geometry.coordinates = newCoords;
          }
        }
      }
    }

    console.log(
      `[RouteRenderer] invalidateStop stop_id=${stop_id} op=${op} → updated ${affectedGeomKeys.size} geom keys`
    );
    this.scheduleSetData();
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
