import { Map as MapLibreMap } from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import {
  Routes,
  Trips,
  Shapes,
  StopTimes,
  Stops,
} from '../types/gtfs-entities';
import type { GTFSParser } from './gtfs-parser';
import type { PatchOp } from '../types/patch';
import { CONFIG } from '../config';
import { routeSortKey } from 'interlocking/gtfs/route-sort';
import { yieldToEventLoop } from '../utils/async-yield';
import { ensureMapIcons } from 'interlocking/map/icons';
import {
  routeColor as deriveRouteColor,
  casingColor as deriveCasingColor,
} from 'interlocking/gtfs/route-colors';
import {
  NO_ROUTE_FILTER,
  ROUTES_BACKGROUND_LAYER,
  ROUTES_CASING_LAYER,
  ROUTES_CLICKAREA_LAYER,
  ROUTES_DIRECTION_LAYER,
  ROUTES_SOURCE,
  ROUTE_CASING_WIDTH_STOPS,
  ROUTE_WIDTH_STOPS,
  routeMatch,
  routeSortKeyExpression,
  routeSpotlightOpacity,
  zoomWidth,
} from 'interlocking/map/layer-specs';

/**
 * Thrown by an async feature build that a newer one has replaced.
 *
 * A superseded build must not return normally: its caller would then hand a
 * half-built feature map to setData and draw a mix of two feeds.
 */
export class BuildSupersededError extends Error {
  constructor() {
    super('Route feature build superseded by a newer feed');
    this.name = 'BuildSupersededError';
  }
}

export interface RouteFeature extends GeoJSON.Feature {
  id: string;
  geometry: GeoJSON.LineString;
  properties: {
    route_id: string;
    route_data: Routes;
    color: string;
    colorDark: string;
    route_short_name?: string;
    route_long_name?: string;
    trip_ids: string[];
    // line-sort-key: mode rank blended with the route's total trip count. Every
    // feature of a route carries the same value, so a route's segments never
    // reorder against each other. See route-sort.ts.
    sortKey: number;
  };
}

const ROUTE_LINE_WIDTH = zoomWidth(ROUTE_WIDTH_STOPS, null, 1);
const ROUTE_CASING_WIDTH = zoomWidth(ROUTE_CASING_WIDTH_STOPS, null, 1);

export class RouteRenderer {
  private map: MapLibreMap;
  private routeFeatures: Map<string, RouteFeature> = new Map();
  private gtfsParser: GTFSParser;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  // Fixed: routes always draw from shapes. The 'stops' branches below are the
  // per-trip fallback for a trip with no usable shape, not a user-facing mode.
  private readonly renderMode: 'shapes' | 'stops' = 'shapes';

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

  // The index build in flight, if any. Shared so a synchronous reader finishes
  // the same pass rather than starting a second one over the same rows.
  private buildIterator: Iterator<void> | null = null;

  // RAF-based coalescing
  private dirtyFlag = false;

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

    if (this.initialized && !this.map.getSource(ROUTES_SOURCE)) {
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

    if (this.map.getSource(ROUTES_SOURCE)) {
      this.initialized = true;
      return;
    }

    this.map.addSource(ROUTES_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    this.map.addLayer({
      id: ROUTES_CASING_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': ['get', 'colorDark'],
        'line-width': ROUTE_CASING_WIDTH,
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    this.map.addLayer({
      id: ROUTES_BACKGROUND_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ROUTE_LINE_WIDTH,
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    // Direction chevrons for the single spotlighted route. Above the ribbon so
    // it can never cover them, below every stop layer (LayerManager adds those
    // later). Starts filtered to nothing; applySpotlight owns the filter.
    ensureMapIcons(this.map);
    this.map.addLayer({
      id: ROUTES_DIRECTION_LAYER,
      type: 'symbol',
      source: ROUTES_SOURCE,
      filter: NO_ROUTE_FILTER,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          80,
          16,
          140,
        ],
        'icon-image': 'route-arrow',
        'icon-rotation-alignment': 'map',
        // An upright flip would reverse the arrow, the one thing this layer
        // must never do.
        'icon-keep-upright': false,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1],
        // Let collision detection interleave the arrows where two
        // opposite-direction features share a corridor, rather than stacking
        // them on top of each other.
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
      paint: {
        'icon-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CONFIG.ROUTE_ARROW_FADE_ZOOM_MIN,
          0,
          CONFIG.ROUTE_ARROW_FADE_ZOOM_MAX,
          CONFIG.ROUTE_ARROW_OPACITY,
        ],
      },
    });

    this.map.addLayer({
      id: ROUTES_CLICKAREA_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': 'transparent',
        'line-width': 15,
        'line-opacity': 0,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        // Sorted identically to the drawn layers so queryRenderedFeatures()[0]
        // resolves to whichever route visually reads as on top.
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    this.initialized = true;
    console.log('[RouteRenderer] Layers initialized');
  }

  private invalidateAll(): void {
    // Drops any build in flight: its drain loop sees the swap and stops rather
    // than writing rows of the old feed into the fresh maps.
    this.buildIterator = null;
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
      const source = this.map.getSource(
        ROUTES_SOURCE
      ) as maplibregl.GeoJSONSource;
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
   * Run the index build to completion in one task.
   *
   * Only for the synchronous readers (getRouteFeatures). A build already in
   * flight is finished here rather than restarted, so a caller never reads a
   * half-built index.
   */
  private createRouteFeatures(): void {
    const iterator = this.startFeatureBuild();
    while (this.buildIterator === iterator && !iterator.next().done) {
      // Drain without yielding.
    }
    this.finishFeatureBuild(iterator);
  }

  /** The same build, yielding to the event loop between chunks. */
  private async createRouteFeaturesAsync(): Promise<void> {
    const iterator = this.startFeatureBuild();
    for (;;) {
      // A feed swap during a yield replaces the iterator. Throwing rather than
      // returning is the point: the caller must not draw what was built.
      if (this.buildIterator !== iterator) {
        throw new BuildSupersededError();
      }
      if (iterator.next().done) {
        break;
      }
      await yieldToEventLoop();
    }
    this.finishFeatureBuild(iterator);
  }

  /** The in-flight build, or a fresh one. */
  private startFeatureBuild(): Iterator<void> {
    this.buildIterator ??= this.buildRouteFeatures();
    return this.buildIterator;
  }

  /** Clear the in-flight build unless invalidateAll already replaced it. */
  private finishFeatureBuild(iterator: Iterator<void>): void {
    if (this.buildIterator === iterator) {
      this.buildIterator = null;
    }
  }

  /**
   * Build all cached indexes and populate routeFeatures, deduplicating by (route_id, geometry_key).
   * Lazily called, noop if caches are already warm.
   *
   * A generator so one body serves both drainers above: it yields at chunk
   * boundaries, and whether that yield reaches the event loop is the caller's
   * choice. On the MBTA feed this loop walks 4.5M stop_times and ~70k trips,
   * which is seconds of frozen page if it runs in one task.
   */
  private *buildRouteFeatures(): Generator<void> {
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
      let bucketed = 0;
      for (const pt of shapes) {
        if (++bucketed % CONFIG.HYDRATE_YIELD_ROWS === 0) {
          yield;
        }
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
    let bucketedStopTimes = 0;
    for (const st of stopTimes) {
      if (++bucketedStopTimes % CONFIG.HYDRATE_YIELD_ROWS === 0) {
        yield;
      }
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
      const routeColor = deriveRouteColor(route_id, route.route_color);
      const routeTrips = tripsByRoute.get(route_id) ?? [];
      const sortKey = routeSortKey(route.route_type, routeTrips.length);

      for (const trip of routeTrips) {
        if (++tripsProcessed % CONFIG.ROUTE_BUILD_TRIP_CHUNK === 0) {
          yield;
        }
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
          // Stops mode or missing/unknown shape, derive from stop sequence
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
              colorDark: deriveCasingColor(routeColor),
              route_short_name: route.route_short_name,
              route_long_name: route.route_long_name,
              trip_ids: [trip.trip_id],
              sortKey,
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
      `[RouteRenderer] Index build complete: ${tripsProcessed} trips -> ${this.routeFeatures.size} features (${((1 - this.routeFeatures.size / Math.max(tripsProcessed, 1)) * 100).toFixed(1)}% dedupe)`
    );
  }

  public async renderRoutes(): Promise<void> {
    console.log('[RouteRenderer] Rendering routes...');

    await this.ensureInitialized();

    this.invalidateAll();
    try {
      await this.createRouteFeaturesAsync();
    } catch (error) {
      if (error instanceof BuildSupersededError) {
        console.log('[RouteRenderer] Render superseded by a newer feed');
        return;
      }
      throw error;
    }

    const featureCount = this.routeFeatures.size;
    if (featureCount === 0) {
      console.warn('[RouteRenderer] No route features available for rendering');
      return;
    }

    const source = this.map.getSource(
      ROUTES_SOURCE
    ) as maplibregl.GeoJSONSource;
    source.setData({
      type: 'FeatureCollection' as const,
      features: [...this.routeFeatures.values()],
    });
    this.map.triggerRepaint();

    console.log(`[RouteRenderer] setData called with ${featureCount} features`);
  }

  public clearRoutes(): void {
    const source = this.map.getSource(
      ROUTES_SOURCE
    ) as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    this.invalidateAll();
  }

  /**
   * Spotlight the given routes (or reset with null): non-matching routes dim
   * to CONFIG.SPOTLIGHT_ROUTE_DIM opacity, matching routes get a width bump.
   */
  private applySpotlight(route_ids: string[] | null): void {
    if (!this.map.getLayer(ROUTES_BACKGROUND_LAYER)) {
      return;
    }
    const match = routeMatch(route_ids);
    const opacity = routeSpotlightOpacity(match, CONFIG.SPOTLIGHT_ROUTE_DIM);
    this.map.setPaintProperty(ROUTES_BACKGROUND_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(ROUTES_CASING_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(
      ROUTES_BACKGROUND_LAYER,
      'line-width',
      zoomWidth(ROUTE_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_LINE_BUMP)
    );
    this.map.setPaintProperty(
      ROUTES_CASING_LAYER,
      'line-width',
      zoomWidth(ROUTE_CASING_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_CASING_BUMP)
    );

    // Lift the spotlighted routes above everything else. line-sort-key is a
    // layout property, so it cannot read feature-state, but the same literal
    // route_id match used for opacity works here unchanged. Layout changes
    // force a tile re-layout, which is fine once per selection but must never
    // be driven from hover.
    const sortKey = routeSortKeyExpression(match, CONFIG.SPOTLIGHT_SORT_KEY);
    for (const id of [
      ROUTES_CASING_LAYER,
      ROUTES_BACKGROUND_LAYER,
      ROUTES_CLICKAREA_LAYER,
    ]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'line-sort-key', sortKey);
      }
    }

    // Direction arrows only when exactly one route is spotlighted: a stop click
    // spotlights every route serving the stop, and arrows on all of them are
    // noise.
    if (this.map.getLayer(ROUTES_DIRECTION_LAYER)) {
      this.map.setFilter(
        ROUTES_DIRECTION_LAYER,
        route_ids && route_ids.length === 1
          ? ([
              '==',
              ['get', 'route_id'],
              route_ids[0],
            ] as unknown as ExpressionSpecification)
          : NO_ROUTE_FILTER
      );
    }
  }

  public highlightRoute(route_id: string): void {
    if (this.routeFeatures.size === 0) {
      return;
    }

    console.log(`[RouteRenderer] Highlighting route: ${route_id}`);
    this.applySpotlight([route_id]);
  }

  public highlightRoutes(route_ids: string[]): void {
    if (this.routeFeatures.size === 0 || route_ids.length === 0) {
      return;
    }

    console.log(`[RouteRenderer] Highlighting ${route_ids.length} routes`);
    this.applySpotlight(route_ids);
  }

  public clearHighlight(): void {
    if (!this.initialized) {
      return;
    }
    this.applySpotlight(null);
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

  /**
   * The built route lines. Builds the index first if it has not been built
   * yet: the map's feed-wide fit can run before renderRoutes has, and an empty
   * answer there silently drops every shape from the viewport.
   */
  public getRouteFeatures(): RouteFeature[] {
    this.createRouteFeatures();
    return [...this.routeFeatures.values()];
  }

  // ========================================
  // SURGICAL PATCH INVALIDATION
  // ========================================

  /**
   * Recompute the line-sort-key for every feature of a route after its trip
   * set or route_type changed. The key uses the route's *total* trip count, so
   * all of its features must be rewritten together, otherwise one route's
   * segments would sort against each other.
   */
  private refreshRouteSortKey(route_id: string): void {
    const featureKeys = this.routeToFeatureKeys?.get(route_id);
    if (!featureKeys || featureKeys.size === 0) {
      return;
    }

    let tripCount = 0;
    let routeType: unknown;
    for (const fk of featureKeys) {
      const feat = this.routeFeatures.get(fk);
      if (feat) {
        tripCount += feat.properties.trip_ids.length;
        routeType = feat.properties.route_data.route_type;
      }
    }

    const sortKey = routeSortKey(routeType, tripCount);
    for (const fk of featureKeys) {
      const feat = this.routeFeatures.get(fk);
      if (feat) {
        feat.properties.sortKey = sortKey;
      }
    }
  }

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
      // Bucket empty, remove the feature and clean up indexes
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

    this.refreshRouteSortKey(bucket.route_id);
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
      const routeColor = deriveRouteColor(route_id, route.route_color);

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
          colorDark: deriveCasingColor(routeColor),
          route_short_name: route.route_short_name,
          route_long_name: route.route_long_name,
          trip_ids: [trip_id],
          // Placeholder, refreshRouteSortKey below recomputes it from the
          // route's full trip set once this feature is in the index.
          sortKey: 0,
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
    this.refreshRouteSortKey(route_id);
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
        !('route_long_name' in forwardChanges) &&
        !('route_type' in forwardChanges)
      ) {
        return;
      }
      const routes = this.gtfsParser.getFileDataSyncTyped<Routes>('routes.txt');
      const route = routes.find((r) => r.route_id === route_id);
      if (!route) {
        return;
      }
      const newColor = deriveRouteColor(route_id, route.route_color);
      const featureKeys = this.routeToFeatureKeys?.get(route_id);
      if (!featureKeys) {
        return;
      }
      for (const fk of featureKeys) {
        const feat = this.routeFeatures.get(fk);
        if (feat) {
          feat.properties.color = newColor;
          feat.properties.colorDark = deriveCasingColor(newColor);
          feat.properties.route_data = route;
          feat.properties.route_short_name = route.route_short_name;
          feat.properties.route_long_name = route.route_long_name;
        }
      }
      // route_data now carries the new route_type; recompute paint order.
      this.refreshRouteSortKey(route_id);
      console.log(
        `[RouteRenderer] invalidateRoute route_id=${route_id} op=update -> updated ${featureKeys.size} features`
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
        `[RouteRenderer] invalidateRoute route_id=${route_id} op=delete -> removed ${featureKeys.size} features`
      );
      this.scheduleSetData();
    } else if (op === 'insert') {
      const trips = this.gtfsParser.getFileDataSyncTyped<Trips>('trips.txt');
      const routeTrips = trips.filter((t) => t.route_id === route_id);
      for (const trip of routeTrips) {
        this.addTripToBucket(trip.trip_id);
      }
      console.log(
        `[RouteRenderer] invalidateRoute route_id=${route_id} op=insert -> processed ${routeTrips.length} trips`
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

    // Vacate the current bucket for every op: an insert for a trip id that
    // already has a bucket would otherwise leave the old feature orphaned.
    const oldFeatureKey = this.tripToFeatureKey?.get(trip_id);
    if (oldFeatureKey) {
      this.removeTripFromBucket(trip_id, oldFeatureKey);
    }

    if (op === 'insert' || op === 'update') {
      this.addTripToBucket(trip_id);
    }

    const newFeatureKey = this.tripToFeatureKey?.get(trip_id);
    console.log(
      `[RouteRenderer] invalidateTrip trip_id=${trip_id} op=${op} -> ${oldFeatureKey ?? 'none'} => ${newFeatureKey ?? 'none'}`
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
          `[RouteRenderer] invalidateShape shape_id=${shape_id} op=${op} -> updated coords (${newCoords.length} pts)`
        );
      }
    } else if (op === 'delete' || pts.length === 0) {
      // Shape has too few points, remove it and reassign trips to stop-sequence fallback
      this.shapeIndex.delete(shape_id);
      this.handleShapeRemoved(shape_id);
      console.log(
        `[RouteRenderer] invalidateShape shape_id=${shape_id} op=${op} -> shape removed, trips reassigned`
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
        return; // Shape-mode trip with valid shape, stop_times don't matter
      }
    }

    // Treat as a trip bucket-move: vacate the current bucket for every op, then
    // re-add. An inserted stop_time changes the stop-sequence geometry key too,
    // so the old bucket is always wrong.
    const oldFeatureKey = this.tripToFeatureKey?.get(trip_id);
    if (oldFeatureKey) {
      this.removeTripFromBucket(trip_id, oldFeatureKey);
    }

    // Re-add on delete too: the trip keeps its remaining stops, and
    // addTripToBucket bails on its own if fewer than two are left or if the
    // trip itself is gone.
    this.addTripToBucket(trip_id);

    const newFeatureKey = this.tripToFeatureKey?.get(trip_id);
    console.log(
      `[RouteRenderer] invalidateStopTimes trip_id=${trip_id} op=${op} -> ${oldFeatureKey ?? 'none'} => ${newFeatureKey ?? 'none'}`
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
      `[RouteRenderer] invalidateStop stop_id=${stop_id} op=${op} -> updated ${affectedGeomKeys.size} geom keys`
    );
    this.scheduleSetData();
  }

  public destroy(): void {
    this.clearRoutes();

    if (this.map.getLayer(ROUTES_CLICKAREA_LAYER)) {
      this.map.removeLayer(ROUTES_CLICKAREA_LAYER);
    }
    if (this.map.getLayer(ROUTES_DIRECTION_LAYER)) {
      this.map.removeLayer(ROUTES_DIRECTION_LAYER);
    }
    if (this.map.getLayer(ROUTES_BACKGROUND_LAYER)) {
      this.map.removeLayer(ROUTES_BACKGROUND_LAYER);
    }
    if (this.map.getLayer(ROUTES_CASING_LAYER)) {
      this.map.removeLayer(ROUTES_CASING_LAYER);
    }
    if (this.map.getSource(ROUTES_SOURCE)) {
      this.map.removeSource(ROUTES_SOURCE);
    }
  }
}
