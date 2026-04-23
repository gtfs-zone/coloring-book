import { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';
import { Stops, StopTimes, Pathways } from '../types/gtfs-entities.js';
import type { GTFSParser } from './gtfs-parser.js';

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

  // Default options
  private defaultStopOptions: StopLayerOptions = {
    showBackground: true,
    showClickArea: true,
    enableHover: true,
    backgroundColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 2,
    radius: 4,
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

    const validStops = stops.filter(
      (stop) =>
        stop.stop_lat !== null &&
        stop.stop_lon !== null &&
        !isNaN(stop.stop_lat) &&
        !isNaN(stop.stop_lon)
    );

    // Create GeoJSON for stops
    const stopsGeoJSON = this.createStopsGeoJSON(validStops);

    // Add source with feature IDs for state management
    const stopsGeoJSONWithIds = {
      ...stopsGeoJSON,
      features: stopsGeoJSON.features.map((feature) => ({
        ...feature,
        id: feature.properties?.stop_id, // Add ID for feature state
      })),
    };

    // Check if source already exists before adding
    if (!this.map.getSource('stops')) {
      this.map.addSource('stops', {
        type: 'geojson',
        data: stopsGeoJSONWithIds,
      });
    }
    this.onStopsDataUpdated?.(stopsGeoJSONWithIds);

    // Add background stops layer if enabled
    if (finalOptions.showBackground) {
      this.addStopsBackgroundLayer(finalOptions);
    }

    // Add invisible click areas if enabled
    if (finalOptions.showClickArea) {
      this.addStopsClickAreaLayer(finalOptions);
    }

    // Add hover behavior if enabled
    if (finalOptions.enableHover) {
      this.addStopsHoverBehavior();
    }

    console.log(`🗺️ Added ${validStops.length} stops to map`);
  }

  /**
   * Create GeoJSON data for stops
   */
  private createStopsGeoJSON(stops: Stops[]): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: stops.map((stop) => {
        const lat = stop.stop_lat;
        const lon = stop.stop_lon;
        const stopType =
          typeof stop.location_type === 'number'
            ? stop.location_type
            : parseInt(stop.location_type ?? '0', 10) || 0;

        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lon, lat], // [lng, lat] for MapLibre
          },
          properties: {
            stop_id: stop.stop_id,
            stop_name: stop.stop_name || 'Unnamed Stop',
            stop_code: stop.stop_code || '',
            stop_desc: stop.stop_desc || '',
            location_type: stopType,
            parent_station: stop.parent_station ?? '',
            wheelchair_boarding: stop.wheelchair_boarding || '',
          },
        };
      }),
    };
  }

  /**
   * Add background stops layer
   */
  private addStopsBackgroundLayer(options: StopLayerOptions): void {
    // Check if layer already exists
    if (this.map.getLayer('stops-background')) {
      return;
    }

    this.map.addLayer({
      id: 'stops-background',
      type: 'circle',
      source: 'stops',
      filter: this.activeStopsFilter,
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'location_type'], 1],
          10, // Station
          ['==', ['get', 'location_type'], 2],
          5, // Entrance/Exit
          ['==', ['get', 'location_type'], 3],
          5, // Generic node
          ['==', ['get', 'location_type'], 4],
          7, // Boarding area
          options.radius,
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'location_type'], 1],
          '#3b82f6', // Station: blue
          ['==', ['get', 'location_type'], 2],
          '#f59e0b', // Entrance: amber
          ['==', ['get', 'location_type'], 3],
          '#8b5cf6', // Generic node: purple
          ['==', ['get', 'location_type'], 4],
          '#10b981', // Boarding area: green
          options.backgroundColor,
        ],
        'circle-stroke-color': options.strokeColor,
        'circle-stroke-width': options.strokeWidth,
        'circle-opacity': 1,
        'circle-stroke-opacity': 1,
      },
    });
  }

  /**
   * Add invisible click areas for stops
   */
  private addStopsClickAreaLayer(options: StopLayerOptions): void {
    // Check if layer already exists
    if (this.map.getLayer('stops-clickarea')) {
      return;
    }

    this.map.addLayer({
      id: 'stops-clickarea',
      type: 'circle',
      source: 'stops',
      filter: this.activeStopsFilter,
      paint: {
        'circle-radius': options.clickAreaRadius,
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
  }

  /**
   * Add hover behavior for stops
   */
  private addStopsHoverBehavior(): void {
    ['stops-background', 'stops-clickarea'].forEach((layerId) => {
      this.map.on('mouseenter', layerId, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });

      this.map.on('mouseleave', layerId, () => {
        this.map.getCanvas().style.cursor = '';
      });
    });
  }

  /**
   * Highlight specific stop
   */
  public highlightStop(
    stop_id: string,
    options: Partial<HighlightLayerOptions> = {}
  ): void {
    const finalOptions = { ...this.defaultHighlightOptions, ...options };
    const stops =
      this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];

    // Clear existing highlights
    this.clearHighlights();

    const stop = stops.find((s) => s.stop_id === stop_id);
    if (!stop || !stop.stop_lat || !stop.stop_lon) {
      console.warn(`Stop ${stop_id} not found or missing coordinates`);
      return;
    }

    const lat = stop.stop_lat;
    const lon = stop.stop_lon;

    // Create highlight GeoJSON
    const highlightGeoJSON = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lon, lat],
          },
          properties: {
            stop_id: stop.stop_id,
            stop_name: stop.stop_name || 'Unnamed Stop',
            stop_code: stop.stop_code || '',
          },
        },
      ],
    };

    // Add highlight source and layer
    this.map.addSource('stops-highlight', {
      type: 'geojson',
      data: highlightGeoJSON,
    });

    // Use size increase instead of color change - keep white background and black stroke like normal stops
    this.map.addLayer({
      id: 'stops-highlight',
      type: 'circle',
      source: 'stops-highlight',
      paint: {
        'circle-radius': finalOptions.radius, // Use larger radius (default 12 vs normal 4)
        'circle-color': '#ffffff', // Keep white background like normal stops
        'circle-stroke-color': '#000000', // Keep black stroke like normal stops
        'circle-stroke-width': finalOptions.strokeWidth, // Use thicker stroke (default 3 vs normal 2)
        'circle-opacity': 1,
        'circle-stroke-opacity': 1,
      },
    });

    console.log(`🎯 Highlighted stop: ${stop_id}`);
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
   * Clear all highlights
   */
  public clearHighlights(): void {
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

    const validStops = stops.filter(
      (stop) =>
        stop.stop_lat !== null &&
        stop.stop_lon !== null &&
        !isNaN(stop.stop_lat) &&
        !isNaN(stop.stop_lon)
    );

    const stopsGeoJSON = this.createStopsGeoJSON(validStops);
    const stopsGeoJSONWithIds = {
      ...stopsGeoJSON,
      features: stopsGeoJSON.features.map((feature) => ({
        ...feature,
        id: feature.properties?.stop_id,
      })),
    };

    stopsSource.setData(stopsGeoJSONWithIds);
    this.onStopsDataUpdated?.(stopsGeoJSONWithIds);
    console.log(`🔄 Updated stops data: ${validStops.length} stops`);
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

    // Build stop coordinate lookup
    const coordMap = new Map<string, [number, number]>();
    stops.forEach((s) => {
      if (
        s.stop_lat !== null &&
        s.stop_lat !== undefined &&
        s.stop_lon !== null &&
        s.stop_lon !== undefined
      ) {
        coordMap.set(s.stop_id, [Number(s.stop_lon), Number(s.stop_lat)]);
      }
    });

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
      const from = coordMap.get(pw.from_stop_id);
      const to = coordMap.get(pw.to_stop_id);
      if (!from || !to) {
        return;
      }
      features.push({
        type: 'Feature',
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
      this.map.addSource('pathways', { type: 'geojson', data: geojson });
    }

    if (!this.map.getLayer('pathways-lines')) {
      this.map.addLayer(
        {
          id: 'pathways-lines',
          type: 'line',
          source: 'pathways',
          paint: {
            'line-width': 3,
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
        this.map.on('mouseenter', layerId, () => {
          this.map.getCanvas().style.cursor = 'pointer';
        });
        this.map.on('mouseleave', layerId, () => {
          this.map.getCanvas().style.cursor = '';
        });
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
    ['pathways-clickarea', 'pathways-lines'].forEach((layerId) => {
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
