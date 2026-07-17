import { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FilterSpecification, ExpressionSpecification } from 'maplibre-gl';
import { Stops, StopTimes, Pathways } from '../types/gtfs-entities.js';
import type { GTFSParser } from './gtfs-parser.js';
import { CONFIG } from '../config.js';
import {
  buildStopCoordResolver,
  hasValidCoords,
} from '../utils/stop-coords.js';

export interface StopLayerOptions {
  showBackground: boolean;
  showClickArea: boolean;
  enableHover: boolean;
  backgroundColor: string;
  strokeColor: string;
  strokeWidth: number;
  radius: number;
  clickAreaRadius: number;
}

export interface HighlightLayerOptions {
  color: string;
  radius: number;
  strokeColor: string;
  strokeWidth: number;
}

// Default filter: show all top-level stops (empty parent_station) and stations (location_type=1), hide child stops.
const DEFAULT_STOPS_FILTER: FilterSpecification = [
  'any',
  ['==', ['get', 'parent_station'], ''],
  ['==', ['get', 'location_type'], 1],
] as FilterSpecification;

export class LayerManager {
  private map: MapLibreMap;
  private gtfsParser: GTFSParser;
  public onStopsDataUpdated:
    | ((data: GeoJSON.FeatureCollection) => void)
    | null = null;

  private activeStopsFilter: FilterSpecification = DEFAULT_STOPS_FILTER;
  private focusedStopId: string | null = null;
  private focusedPathwayId: string | null = null;
  // Stops of the currently spotlighted route (onRoute feature-state holders)
  private routeStopIds: string[] = [];

  private _resolverDirty = true;
  private _cachedResolver:
    | ((stop_id: string) => [number, number] | null)
    | null = null;

  private readonly onPathwayMouseEnter = () => {
    this.map.getCanvas().style.cursor = 'pointer';
  };
  private readonly onPathwayMouseLeave = () => {
    this.map.getCanvas().style.cursor = '';
  };

  // Default options
  private defaultStopOptions: StopLayerOptions = {
    showBackground: true,
    showClickArea: true,
    enableHover: true,
    backgroundColor: '#ffffff',
    strokeColor: '#37474f',
    strokeWidth: 2,
    radius: 5.5,
    clickAreaRadius: 15,
  };

  private defaultHighlightOptions: HighlightLayerOptions = {
    color: '#e74c3c',
    radius: 8,
    strokeColor: '#ffffff',
    strokeWidth: 3,
  };

  constructor(map: MapLibreMap, gtfsParser: GTFSParser) {
    this.map = map;
    this.gtfsParser = gtfsParser;
  }

  /**
   * Clear all managed layers and sources
   */
  public clearAllLayers(): void {
    const layersToRemove = [
      'pathways-lines',
      'pathways-clickarea',
      'stops-station-dot',
      'stops-background',
      'stops-clickarea',
      'stops-highlight',
      'trip-highlight',
      // Legacy layers for backward compatibility
      'stops',
      'routes',
      'shapes',
    ];

    const sourcesToRemove = [
      'pathways',
      'stops',
      'stops-highlight',
      'trip-highlight',
    ];

    layersToRemove.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });

    sourcesToRemove.forEach((sourceId) => {
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    });
  }

  /**
   * Add stops to map with enhanced styling and functionality
   */
  public addStopsLayer(options: Partial<StopLayerOptions> = {}): void {
    const stops = this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt');
    if (!stops) {
      console.warn('No stops data available for rendering');
      return;
    }

    const finalOptions = { ...this.defaultStopOptions, ...options };

    // Create GeoJSON for stops (resolver places coord-less children via Tutte
    // layout over the pathway graph; stops with no resolvable coords or in
    // orphan pathway components are skipped + warned).
    const stopsGeoJSON = this.createStopsGeoJSON(stops);

    // Check if source already exists before adding.
    // promoteId tells MapLibre to use the stop_id property as the feature id
    // for feature-state lookups, preserving string ids like "place-jfk" that
    // would otherwise be coerced to 0 by the vector-tile encoder.
    if (!this.map.getSource('stops')) {
      this.map.addSource('stops', {
        type: 'geojson',
        data: stopsGeoJSON,
        promoteId: 'stop_id',
      });
    }
    this.onStopsDataUpdated?.(stopsGeoJSON);

    // Add background stops layer if enabled
    if (finalOptions.showBackground) {
      this.addStopsBackgroundLayer(finalOptions);
      this.addStationDotLayer();
    }

    // Add invisible click areas if enabled
    if (finalOptions.showClickArea) {
      this.addStopsClickAreaLayer(finalOptions);
    }

    // Add hover behavior if enabled
    if (finalOptions.enableHover) {
      this.addStopsHoverBehavior();
    }

    const featureCount = stopsGeoJSON.features.length;
    console.log(`🗺️ Added ${featureCount} stops to map`);
  }

  /**
   * Create GeoJSON data for stops.
   *
   * Coord-less child stops are placed via Tutte's barycentric embedding over
   * the pathway graph (see buildStopCoordResolver). Stops with no own coords
   * and no coord-having ancestor, or in pathway components disconnected from
   * any pinned sibling, are skipped with a warning.
   */
  private createStopsGeoJSON(stops: Stops[]): GeoJSON.FeatureCollection {
    const stopById = new Map<string, Stops>();
    stops.forEach((s) => stopById.set(String(s.stop_id), s));

    const resolveStationId = (stop: Stops): string => {
      const locType =
        typeof stop.location_type === 'number'
          ? stop.location_type
          : parseInt(stop.location_type ?? '0', 10) || 0;
      if (locType === 1) {
        return String(stop.stop_id);
      }
      let current = stop;
      for (let i = 0; i < 5; i++) {
        const parentId = current.parent_station;
        if (!parentId) {
          break;
        }
        const parent = stopById.get(String(parentId));
        if (!parent) {
          break;
        }
        const parentType =
          typeof parent.location_type === 'number'
            ? parent.location_type
            : parseInt(parent.location_type ?? '0', 10) || 0;
        if (parentType === 1) {
          return String(parent.stop_id);
        }
        current = parent;
      }
      return '';
    };

    const pathways =
      this.gtfsParser.getFileDataSyncTyped<Pathways>('pathways.txt') || [];
    const resolveCoord = this.getCachedResolver(stops, pathways);

    const features: GeoJSON.Feature[] = [];
    for (const stop of stops) {
      const coord = resolveCoord(String(stop.stop_id));
      if (!coord) {
        const locType =
          typeof stop.location_type === 'number'
            ? stop.location_type
            : parseInt(stop.location_type ?? '0', 10) || 0;
        const coordsOptional = locType === 3 || locType === 4;
        if (!hasValidCoords(stop) && !coordsOptional) {
          console.warn(
            `[LayerManager] Skipping stop without resolvable coords: stop_id=${stop.stop_id} location_type=${stop.location_type ?? ''} parent_station=${stop.parent_station ?? ''}`
          );
        }
        continue;
      }
      const stopType =
        typeof stop.location_type === 'number'
          ? stop.location_type
          : parseInt(stop.location_type ?? '0', 10) || 0;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: coord, // [lng, lat] for MapLibre
        },
        properties: {
          stop_id: stop.stop_id,
          stop_name: stop.stop_name || 'Unnamed Stop',
          stop_code: stop.stop_code || '',
          stop_desc: stop.stop_desc || '',
          location_type: stopType,
          parent_station: stop.parent_station ?? '',
          station_id: resolveStationId(stop),
          wheelchair_boarding: stop.wheelchair_boarding || '',
          has_own_coords: hasValidCoords(stop),
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }

  /**
   * A stop is "special" when it must stay visible and clickable at any zoom:
   * either focused (clicked) or on the currently spotlighted route.
   */
  private static readonly SPECIAL_STOP: ExpressionSpecification = [
    'any',
    ['boolean', ['feature-state', 'focused'], false],
    ['boolean', ['feature-state', 'onRoute'], false],
  ] as unknown as ExpressionSpecification;

  /**
   * Opacity expression that keeps special stops at full opacity and dims
   * everything else to `dim`. Shared by `stopFadeOpacity`'s full-zoom branch
   * and `setRouteStops`'s station-dot opacity so the two stay in lockstep.
   */
  private specialOrDim(dim: number): ExpressionSpecification {
    return [
      'case',
      LayerManager.SPECIAL_STOP,
      1,
      dim,
    ] as unknown as ExpressionSpecification;
  }

  /**
   * Opacity expression for the stops layers. Plain stops (location_type 0)
   * fade out below ~CONFIG.STOP_FADE_ZOOM_MAX so zoomed-out views show the
   * network instead of a pile of dots; stations, child nodes, and special
   * stops always render. When `dim` is set (route spotlight active), all
   * non-special stops render at `dim` opacity at every zoom.
   */
  private stopFadeOpacity(dim: number | null): ExpressionSpecification {
    const lowZoom = [
      'case',
      LayerManager.SPECIAL_STOP,
      1,
      ['==', ['get', 'location_type'], 0],
      0,
      dim ?? 1,
    ];
    const fullZoom = dim === null ? 1 : this.specialOrDim(dim);
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      CONFIG.STOP_FADE_ZOOM_MIN,
      lowZoom,
      CONFIG.STOP_FADE_ZOOM_MAX,
      fullZoom,
    ] as unknown as ExpressionSpecification;
  }

  /**
   * Per-location-type circle radius wrapped in the focused feature-state
   * case, evaluated at one zoom stop. `scale` is the multiplier relative to
   * the reference zoom (z16); focused stops render ~1.7x larger. Stations are
   * the largest so they read as hubs; child node types sit in between.
   */
  private stopRadiusAt(
    plainRadius: number,
    scale: number
  ): ExpressionSpecification {
    const byType = (mult: number) => [
      'case',
      ['==', ['get', 'location_type'], 1],
      8 * scale * mult,
      ['==', ['get', 'location_type'], 2],
      4.5 * scale * mult,
      ['==', ['get', 'location_type'], 3],
      4.5 * scale * mult,
      ['==', ['get', 'location_type'], 4],
      5 * scale * mult,
      plainRadius * scale * mult,
    ];
    return [
      'case',
      ['boolean', ['feature-state', 'focused'], false],
      byType(1.7),
      byType(1),
    ] as unknown as ExpressionSpecification;
  }

  /**
   * Add background stops layer.
   *
   * Cased transit look: circles scale with zoom (top-level zoom interpolate —
   * MapLibre requires zoom as input to a top-level interpolate/step only),
   * plain stops fade out below ~z12.5 so zoomed-out views show the network
   * instead of a pile of dots, and stations stay visible at all zooms.
   * Focused stops grow and get an accent-colored ring.
   */
  private addStopsBackgroundLayer(options: StopLayerOptions): void {
    // Check if layer already exists
    if (this.map.getLayer('stops-background')) {
      return;
    }

    const focused: ExpressionSpecification = [
      'boolean',
      ['feature-state', 'focused'],
      false,
    ];
    const fadeOpacity = this.stopFadeOpacity(null);

    this.map.addLayer({
      id: 'stops-background',
      type: 'circle',
      source: 'stops',
      filter: this.activeStopsFilter,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          this.stopRadiusAt(options.radius, 0.45),
          13.5,
          this.stopRadiusAt(options.radius, 0.7),
          16,
          this.stopRadiusAt(options.radius, 1),
          19,
          this.stopRadiusAt(options.radius, 1.5),
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'location_type'], 1],
          '#ffffff', // Station: white (black inner dot drawn by stops-station-dot layer)
          ['==', ['get', 'location_type'], 2],
          '#f59e0b', // Entrance: amber
          ['==', ['get', 'location_type'], 3],
          '#8b5cf6', // Generic node: purple
          ['==', ['get', 'location_type'], 4],
          '#10b981', // Boarding area: green
          options.backgroundColor,
        ],
        'circle-stroke-color': [
          'case',
          focused,
          '#e74c3c', // Focused: accent ring
          ['==', ['get', 'has_own_coords'], false],
          '#9ca3af', // No own lat/lon: grey stroke
          ['==', ['get', 'location_type'], 1],
          '#111111', // Station: near-black stroke
          options.strokeColor, // Plain stops: dark slate casing
        ],
        'circle-stroke-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          ['case', focused, 2.5, 1.2],
          16,
          ['case', focused, 3.5, options.strokeWidth],
          19,
          ['case', focused, 4.5, options.strokeWidth + 0.8],
        ],
        'circle-opacity': fadeOpacity,
        'circle-stroke-opacity': fadeOpacity,
      },
    });
  }

  /**
   * Add a small black dot at the center of each station feature.
   * Sits on top of the white station circle to mark it as a station.
   * Uses paint-side feature-state so the dot grows with focus.
   */
  private addStationDotLayer(): void {
    if (this.map.getLayer('stops-station-dot')) {
      return;
    }

    const focused: ExpressionSpecification = [
      'boolean',
      ['feature-state', 'focused'],
      false,
    ];

    this.map.addLayer({
      id: 'stops-station-dot',
      type: 'circle',
      source: 'stops',
      filter: [
        '==',
        ['get', 'location_type'],
        1,
      ] as unknown as FilterSpecification,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          ['case', focused, 2.2, 1.3],
          16,
          ['case', focused, 4.5, 2.6],
          19,
          ['case', focused, 6, 3.8],
        ],
        'circle-color': '#111111',
        'circle-opacity': 1,
        'circle-stroke-width': 0,
      },
    });
  }

  /**
   * Add invisible click areas for stops.
   *
   * The hit radius mirrors the visible layer's fade: it collapses to 0 where
   * plain stops are fully faded out, so invisible stops are simply not
   * returned by queryRenderedFeatures — no JS-side visibility predicate to
   * keep in sync. Special (focused / on-route) stops keep a full hit area.
   */
  private addStopsClickAreaLayer(options: StopLayerOptions): void {
    // Check if layer already exists
    if (this.map.getLayer('stops-clickarea')) {
      return;
    }

    const r = options.clickAreaRadius;
    this.map.addLayer({
      id: 'stops-clickarea',
      type: 'circle',
      source: 'stops',
      filter: this.activeStopsFilter,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CONFIG.STOP_FADE_ZOOM_MIN,
          [
            'case',
            LayerManager.SPECIAL_STOP,
            r,
            ['==', ['get', 'location_type'], 0],
            0,
            r,
          ],
          CONFIG.STOP_FADE_ZOOM_MAX,
          r,
          // Stay larger than the biggest visual circle (focused station at
          // high zoom) so the clickarea is the sole hit-test layer.
          19,
          r * 1.6,
        ] as unknown as ExpressionSpecification,
        'circle-color': 'transparent',
        'circle-opacity': 0,
      },
    });
  }

  /**
   * Set or reset the filter on the stops layers.
   * Pass null to restore the default filter (hide child stops).
   * Pass an array filter expression to apply a custom filter (e.g., station-expanded view).
   */
  public setStopsFilter(filter: FilterSpecification | null): void {
    this.activeStopsFilter = filter ?? DEFAULT_STOPS_FILTER;
    if (this.map.getLayer('stops-background')) {
      this.map.setFilter('stops-background', this.activeStopsFilter);
    }
    if (this.map.getLayer('stops-clickarea')) {
      this.map.setFilter('stops-clickarea', this.activeStopsFilter);
    }
    // Station-dot layer always filters to location_type=1; compose with activeStopsFilter when non-default
    if (this.map.getLayer('stops-station-dot')) {
      const stationDotFilter: FilterSpecification =
        filter === null
          ? ([
              '==',
              ['get', 'location_type'],
              1,
            ] as unknown as FilterSpecification)
          : ([
              'all',
              ['==', ['get', 'location_type'], 1],
              filter,
            ] as unknown as FilterSpecification);
      this.map.setFilter('stops-station-dot', stationDotFilter);
    }
  }

  /**
   * Add hover behavior for stops
   */
  private addStopsHoverBehavior(): void {
    // Only the clickarea layer: its radius collapses for hidden stops, so
    // hovering an invisible stop doesn't show a pointer cursor.
    this.map.on('mouseenter', 'stops-clickarea', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'stops-clickarea', () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  /**
   * Highlight specific stop via feature state (grows in-place, same color).
   */
  public highlightStop(stop_id: string): void {
    this.setFocusedStop(stop_id);
  }

  /**
   * Highlight trip path
   */
  public highlightTrip(
    trip_id: string,
    options: Partial<HighlightLayerOptions> = {}
  ): void {
    const finalOptions = { ...this.defaultHighlightOptions, ...options };
    const stopTimes =
      this.gtfsParser.getFileDataSyncTyped<StopTimes>('stop_times.txt') || [];
    const stops =
      this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];

    // Clear existing highlights
    this.clearHighlights();

    // Create stops lookup
    const stopsLookup: {
      [key: string]: { lat: number; lon: number; name: string };
    } = {};
    stops.forEach((stop) => {
      if (stop.stop_lat !== null && stop.stop_lon !== null) {
        stopsLookup[stop.stop_id] = {
          lat: stop.stop_lat,
          lon: stop.stop_lon,
          name: stop.stop_name,
        };
      }
    });

    // Get stop times for this trip
    const tripStopTimes = stopTimes
      .filter((st) => st.trip_id === trip_id)
      .sort((a, b) => a.stop_sequence - b.stop_sequence);

    const tripPath: [number, number][] = [];
    const tripStopsFeatures: GeoJSON.Feature[] = [];

    tripStopTimes.forEach((st, index) => {
      const stopCoords = stopsLookup[st.stop_id];
      if (stopCoords) {
        tripPath.push([stopCoords.lon, stopCoords.lat]);

        const isFirst = index === 0;
        const isLast = index === tripStopTimes.length - 1;

        tripStopsFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [stopCoords.lon, stopCoords.lat],
          },
          properties: {
            stop_name: stopCoords.name,
            is_first: isFirst,
            is_last: isLast,
            stop_type: isFirst ? 'first' : isLast ? 'last' : 'middle',
          },
        });
      }
    });

    if (tripPath.length >= 2) {
      this.addTripHighlightLayers(tripPath, tripStopsFeatures, finalOptions);
    }

    console.log(
      `🎯 Highlighted trip: ${trip_id} with ${tripPath.length} stops`
    );
  }

  /**
   * Add trip highlight layers (line and stops)
   */
  private addTripHighlightLayers(
    tripPath: [number, number][],
    tripStopsFeatures: GeoJSON.Feature[],
    options: HighlightLayerOptions
  ): void {
    // Create trip line GeoJSON
    const tripLineGeoJSON = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: tripPath,
          },
          properties: {},
        },
      ],
    };

    // Add trip line
    this.map.addSource('trip-highlight', {
      type: 'geojson',
      data: tripLineGeoJSON,
    });

    this.map.addLayer({
      id: 'trip-highlight',
      type: 'line',
      source: 'trip-highlight',
      paint: {
        'line-color': options.color,
        'line-width': 5,
        'line-opacity': 0.9,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Add trip stops if available
    if (tripStopsFeatures.length > 0) {
      const stopsGeoJSON = {
        type: 'FeatureCollection' as const,
        features: tripStopsFeatures,
      };

      this.map.addSource('stops-highlight', {
        type: 'geojson',
        data: stopsGeoJSON,
      });

      this.map.addLayer({
        id: 'stops-highlight',
        type: 'circle',
        source: 'stops-highlight',
        paint: {
          'circle-radius': 8,
          'circle-color': [
            'case',
            ['==', ['get', 'stop_type'], 'first'],
            '#27ae60', // Green for first stop
            ['==', ['get', 'stop_type'], 'last'],
            '#e74c3c', // Red for last stop
            options.color, // Default color for middle stops
          ],
          'circle-stroke-color': options.strokeColor,
          'circle-stroke-width': 2,
          'circle-opacity': 1,
          'circle-stroke-opacity': 1,
        },
      });
    }
  }

  /**
   * Spotlight the stops of a route: mark them with the onRoute feature-state
   * (always visible + clickable at any zoom, see stopFadeOpacity /
   * addStopsClickAreaLayer) and dim all other stops. Pass an empty array to
   * clear the spotlight.
   */
  public setRouteStops(stop_ids: string[]): void {
    console.log(`[LayerManager] Spotlighting ${stop_ids.length} route stops`);

    if (this.map.getSource('stops')) {
      for (const id of this.routeStopIds) {
        this.map.setFeatureState({ source: 'stops', id }, { onRoute: false });
      }
      for (const id of stop_ids) {
        this.map.setFeatureState({ source: 'stops', id }, { onRoute: true });
      }
    }
    this.routeStopIds = this.map.getSource('stops') ? stop_ids : [];

    const dim = stop_ids.length > 0 ? CONFIG.SPOTLIGHT_STOP_DIM : null;
    if (this.map.getLayer('stops-background')) {
      const fade = this.stopFadeOpacity(dim);
      this.map.setPaintProperty('stops-background', 'circle-opacity', fade);
      this.map.setPaintProperty(
        'stops-background',
        'circle-stroke-opacity',
        fade
      );
    }
    if (this.map.getLayer('stops-station-dot')) {
      this.map.setPaintProperty(
        'stops-station-dot',
        'circle-opacity',
        dim === null ? 1 : this.specialOrDim(dim)
      );
    }
  }

  /**
   * Clear all highlights
   */
  public clearHighlights(): void {
    this.setFocusedStop(null);
    if (this.routeStopIds.length > 0) {
      this.setRouteStops([]);
    }
    const highlightLayers = ['trip-highlight', 'stops-highlight'];

    highlightLayers.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
      if (this.map.getSource(layerId)) {
        this.map.removeSource(layerId);
      }
    });
  }

  public setFocusedStop(stop_id: string | null): void {
    if (this.focusedStopId === stop_id) {
      return;
    }
    console.log('[LayerManager] setFocusedStop', {
      prev: this.focusedStopId,
      next: stop_id,
    });
    try {
      if (this.focusedStopId !== null && this.map.getSource('stops')) {
        this.map.setFeatureState(
          { source: 'stops', id: this.focusedStopId },
          { focused: false }
        );
      }
      this.focusedStopId = stop_id;
      if (stop_id !== null && this.map.getSource('stops')) {
        this.map.setFeatureState(
          { source: 'stops', id: stop_id },
          { focused: true }
        );
      }
    } catch (error) {
      console.warn(
        '[LayerManager] Could not set focused stop:',
        stop_id,
        error
      );
    }
  }

  public setFocusedPathway(pathway_id: string | null): void {
    if (this.focusedPathwayId === pathway_id) {
      return;
    }
    console.log('[LayerManager] setFocusedPathway', {
      prev: this.focusedPathwayId,
      next: pathway_id,
    });
    try {
      if (this.focusedPathwayId !== null && this.map.getSource('pathways')) {
        this.map.setFeatureState(
          { source: 'pathways', id: this.focusedPathwayId },
          { focused: false }
        );
      }
      this.focusedPathwayId = pathway_id;
      if (pathway_id !== null && this.map.getSource('pathways')) {
        this.map.setFeatureState(
          { source: 'pathways', id: pathway_id },
          { focused: true }
        );
      }
    } catch (error) {
      console.warn(
        '[LayerManager] Could not set focused pathway:',
        pathway_id,
        error
      );
    }
  }

  /**
   * Update stop feature state (for dragging, selection, etc.)
   */
  public setStopFeatureState(
    stop_id: string,
    state: Record<string, unknown>
  ): void {
    try {
      this.map.setFeatureState({ source: 'stops', id: stop_id }, state);
    } catch (error) {
      console.debug('Could not set feature state for stop:', stop_id, error);
    }
  }

  public invalidateCoordResolver(): void {
    this._resolverDirty = true;
  }

  private getCachedResolver(
    stops: Stops[],
    pathways: Pathways[]
  ): (stop_id: string) => [number, number] | null {
    if (!this._resolverDirty && this._cachedResolver) {
      return this._cachedResolver;
    }
    this._cachedResolver = buildStopCoordResolver(stops, pathways);
    this._resolverDirty = false;
    return this._cachedResolver;
  }

  /**
   * Update stops data source
   */
  public updateStopsData(): void {
    const stopsSource = this.map.getSource('stops') as GeoJSONSource;
    if (!stopsSource) {
      return;
    }

    const stops = this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt');
    if (!stops) {
      return;
    }

    const stopsGeoJSON = this.createStopsGeoJSON(stops);
    stopsSource.setData(stopsGeoJSON);
    this.onStopsDataUpdated?.(stopsGeoJSON);
    console.log(`🔄 Updated stops data: ${stopsGeoJSON.features.length} stops`);
  }

  /**
   * Check if a layer exists
   */
  public hasLayer(layerId: string): boolean {
    return !!this.map.getLayer(layerId);
  }

  /**
   * Check if a source exists
   */
  public hasSource(sourceId: string): boolean {
    return !!this.map.getSource(sourceId);
  }

  /**
   * Build GeoJSON FeatureCollection of pathway LineStrings for the given station.
   * Only includes pathways where both endpoints are children of the station (or the station itself).
   */
  private buildPathwaysGeoJSON(stationId: string): GeoJSON.FeatureCollection {
    const stops =
      this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];
    const pathways =
      this.gtfsParser.getFileDataSyncTyped<Pathways>('pathways.txt') || [];

    // Shared coord resolver: own coords if available, otherwise a Tutte-layout
    // position over the pathway graph (matches how stops are drawn so pathway
    // endpoints align with the rendered child dots).
    const resolveCoord = this.getCachedResolver(stops, pathways);

    // Identify stop IDs that belong to this station
    const stationStopIds = new Set(
      stops
        .filter(
          (s) => s.stop_id === stationId || s.parent_station === stationId
        )
        .map((s) => s.stop_id)
    );

    const features: GeoJSON.Feature[] = [];
    pathways.forEach((pw) => {
      if (
        !stationStopIds.has(pw.from_stop_id) ||
        !stationStopIds.has(pw.to_stop_id)
      ) {
        return;
      }
      const from = resolveCoord(String(pw.from_stop_id));
      const to = resolveCoord(String(pw.to_stop_id));
      if (!from || !to) {
        return;
      }
      features.push({
        type: 'Feature',
        id: pw.pathway_id,
        geometry: {
          type: 'LineString',
          coordinates: [from, to],
        },
        properties: {
          pathway_id: pw.pathway_id,
          from_stop_id: pw.from_stop_id,
          to_stop_id: pw.to_stop_id,
          pathway_mode: Number(pw.pathway_mode) || 1,
          is_bidirectional: pw.is_bidirectional,
        },
      });
    });

    return { type: 'FeatureCollection', features };
  }

  /**
   * Add (or update) pathway source and layers for the given station.
   * Call when a station is expanded.
   */
  public updatePathwaysLayer(stationId: string): void {
    const geojson = this.buildPathwaysGeoJSON(stationId);

    const pathwaySource = this.map.getSource('pathways') as
      | GeoJSONSource
      | undefined;
    if (pathwaySource) {
      pathwaySource.setData(geojson);
    } else {
      this.map.addSource('pathways', {
        type: 'geojson',
        data: geojson,
        promoteId: 'pathway_id',
      });
    }

    if (!this.map.getLayer('pathways-lines')) {
      this.map.addLayer(
        {
          id: 'pathways-lines',
          type: 'line',
          source: 'pathways',
          paint: {
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'focused'], false],
              6,
              3,
            ],
            'line-color': [
              'case',
              ['==', ['get', 'pathway_mode'], 1],
              '#22c55e', // walkway: green
              ['==', ['get', 'pathway_mode'], 2],
              '#f97316', // stairs: orange
              ['==', ['get', 'pathway_mode'], 3],
              '#06b6d4', // moving sidewalk: cyan
              ['==', ['get', 'pathway_mode'], 4],
              '#a855f7', // escalator: purple
              ['==', ['get', 'pathway_mode'], 5],
              '#3b82f6', // elevator: blue
              ['==', ['get', 'pathway_mode'], 6],
              '#ef4444', // fare gate: red
              ['==', ['get', 'pathway_mode'], 7],
              '#6b7280', // exit gate: gray
              '#ffffff',
            ],
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        },
        'stops-background'
      );
    }

    if (!this.map.getLayer('pathways-clickarea')) {
      this.map.addLayer(
        {
          id: 'pathways-clickarea',
          type: 'line',
          source: 'pathways',
          paint: {
            'line-width': 16,
            'line-opacity': 0,
          },
        },
        'stops-background'
      );

      ['pathways-lines', 'pathways-clickarea'].forEach((layerId) => {
        this.map.on('mouseenter', layerId, this.onPathwayMouseEnter);
        this.map.on('mouseleave', layerId, this.onPathwayMouseLeave);
      });
    }

    console.log(
      `[LayerManager] Updated pathways layer for station: ${stationId} (${geojson.features.length} pathways)`
    );
  }

  /**
   * Remove pathway source and layers from the map.
   * Call when a station is collapsed.
   */
  public clearPathwaysLayer(): void {
    this.setFocusedPathway(null);
    ['pathways-clickarea', 'pathways-lines'].forEach((layerId) => {
      this.map.off('mouseenter', layerId, this.onPathwayMouseEnter);
      this.map.off('mouseleave', layerId, this.onPathwayMouseLeave);
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });
    if (this.map.getSource('pathways')) {
      this.map.removeSource('pathways');
    }
    console.log('[LayerManager] Cleared pathways layer');
  }

  /**
   * Rebuild the pathways source in-place after stops are moved.
   * Only has an effect if the pathway layers are currently visible.
   */
  public rebuildPathwaysSource(stationId: string): void {
    if (!this.map.getSource('pathways')) {
      return;
    }
    const geojson = this.buildPathwaysGeoJSON(stationId);
    (this.map.getSource('pathways') as GeoJSONSource).setData(geojson);
  }
}
