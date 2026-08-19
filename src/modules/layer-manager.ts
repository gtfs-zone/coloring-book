import { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FilterSpecification, ExpressionSpecification } from 'maplibre-gl';
import { Stops, StopTimes, Pathways } from '../types/gtfs-entities.js';
import type { GTFSParser } from './gtfs-parser.js';
import { CONFIG } from '../config.js';
import {
  buildStopCoordResolver,
  hasValidCoords,
} from '../utils/stop-coords.js';
import { bufferedHull } from '../utils/station-hull.js';
import {
  clearThemeColorCache,
  resolveThemeColor,
} from '../utils/theme-color.js';
import {
  PATHWAY_CATEGORIES,
  PATHWAY_CATEGORY_ORDER,
  PATHWAY_MODES,
  modesInCategory,
  type PathwayCategory,
} from '../utils/pathway-modes.js';
import { ensureMapIcons } from './map-icons.js';
import { getZoneFeatures, zoneName } from './zone-store.js';
import {
  STOP_FOCUS_HALO_LAYER,
  STOP_FOCUS_RING_LAYER,
  STOP_FOCUS_TOP_LAYER,
  focusHaloPaint,
  focusRingPaint,
  focusTopPaint,
  stationDotPaint,
  stopFillColor,
  stopsBackgroundPaint,
  type StopStyleOptions,
} from './stop-layer-style.js';

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

/** On-demand zone polygons (locations.geojson). */
const ZONE_SOURCE = 'zones';
const ZONE_FILL_LAYER = 'zones-fill';
const ZONE_OUTLINE_LAYER = 'zones-outline';
const ZONE_FILL_OPACITY = 0.12;
const ZONE_FILL_OPACITY_FOCUSED = 0.3;
const ZONE_FILL_OPACITY_HOVERED = 0.2;
const ZONE_OUTLINE_OPACITY = 0.8;
// Applied to zones outside the route spotlight, mirroring SPOTLIGHT_STOP_DIM.
const ZONE_FILL_OPACITY_DIMMED = 0.03;
const ZONE_OUTLINE_OPACITY_DIMMED = 0.2;

/** Transfer edges of the focused stop. Ephemeral, like `trip-highlight`. */
const TRANSFER_SOURCE = 'transfer-edges';
const TRANSFER_DASHED_LAYER = 'transfer-edges-dashed';
const TRANSFER_SOLID_LAYER = 'transfer-edges-solid';
const TRANSFER_STUB_LAYER = 'transfer-edges-stub';
const TRANSFER_LAYER_IDS = [
  TRANSFER_DASHED_LAYER,
  TRANSFER_SOLID_LAYER,
  TRANSFER_STUB_LAYER,
];
/** Below this the two endpoints are the same place and the line has nothing to draw. */
const TRANSFER_STUB_LENGTH_M = 5;
const TRANSFER_WIDTH = 2.5;
const TRANSFER_WIDTH_HOVERED = 4.5;
const TRANSFER_OPACITY = 0.9;
const TRANSFER_OPACITY_HOVERED = 1;

/** Perpendicular spacing between parallel pathways sharing an endpoint pair. */
const PATHWAY_PARALLEL_OFFSET_M = 2;
/** Below this length a pathway is a blob rather than a line. */
const PATHWAY_STUB_LENGTH_M = 4;
/** How far the station ground plane extends past its outermost node. */
const STATION_GROUND_BUFFER_M = 16;

/** Pathway line weights. The casing dash scale is derived from the ratio. */
const PATHWAY_CORE_WIDTH_PX = 3;
const PATHWAY_CASING_EXTRA_PX = 3.5;
const PATHWAY_CASING_WIDTH_PX = PATHWAY_CORE_WIDTH_PX + PATHWAY_CASING_EXTRA_PX;

const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LNG_EQUATOR = 111320;

type Segment = [[number, number], [number, number]];

const metersPerDegLng = (lat: number): number =>
  METERS_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180);

function segmentLengthM([a, b]: Segment): number {
  const dx = (b[0] - a[0]) * metersPerDegLng(a[1]);
  const dy = (b[1] - a[1]) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Shift a segment sideways by `meters` (signed) along its own normal. */
function offsetSegment([a, b]: Segment, meters: number): Segment {
  const mPerDegLng = metersPerDegLng(a[1]);
  const dx = (b[0] - a[0]) * mPerDegLng;
  const dy = (b[1] - a[1]) * METERS_PER_DEG_LAT;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return [a, b];
  }
  const ox = ((-dy / len) * meters) / mPerDegLng;
  const oy = ((dx / len) * meters) / METERS_PER_DEG_LAT;
  return [
    [a[0] + ox, a[1] + oy],
    [b[0] + ox, b[1] + oy],
  ];
}

// Default filter: show all top-level stops (empty parent_station) and stations (location_type=1), hide child stops.
export const DEFAULT_STOPS_FILTER: FilterSpecification = [
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
  // Several at once: a location group hover lights all of its member stops.
  private hoveredStopIds: string[] = [];
  private focusedPathwayId: string | null = null;
  private focusedZoneId: string | null = null;
  private hoveredZoneId: string | null = null;
  // Stops of the currently spotlighted route (onRoute feature-state holders)
  private routeStopIds: string[] = [];
  // Stops kept visible on top of the spotlight (kept feature-state holders)
  private keptStopIds: string[] = [];
  // The transfer edge under the pointer elsewhere in the app, if any
  private hoveredTransfer: { from_stop_id: string; to_stop_id: string } | null =
    null;
  // Zones of the currently spotlighted route (onRoute feature-state holders)
  private routeZoneIds: string[] = [];

  private _resolverDirty = true;
  private _cachedResolver:
    | ((stop_id: string) => [number, number] | null)
    | null = null;

  /**
   * line-dasharray is not data-driven in MapLibre, so each dash pattern needs
   * its own layer. One casing + one core per pathway category.
   */
  private static readonly PATHWAY_LAYER_IDS: string[] = [
    'station-ground-fill',
    'station-ground-line',
    ...PATHWAY_CATEGORY_ORDER.map((c) => `pathways-casing-${c}`),
    ...PATHWAY_CATEGORY_ORDER.map((c) => `pathways-core-${c}`),
    'pathways-icons',
    'pathways-clickarea',
  ];

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
    color: this.accent(),
    radius: 8,
    strokeColor: '#ffffff',
    strokeWidth: 3,
  };

  constructor(map: MapLibreMap, gtfsParser: GTFSParser) {
    this.map = map;
    this.gtfsParser = gtfsParser;
  }

  /**
   * Selection color, taken from the active DaisyUI theme. Red is reserved for
   * errors, so selection must not use it.
   */
  private accent(): string {
    return resolveThemeColor('--color-primary', '#3b82f6');
  }

  /**
   * Re-resolve the accent against the now-active theme and repaint every
   * property that uses it. Called by the theme controller.
   */
  public refreshAccentColor(): void {
    clearThemeColorCache();
    const accent = this.accent();
    this.defaultHighlightOptions = {
      ...this.defaultHighlightOptions,
      color: accent,
    };

    for (const layerId of [STOP_FOCUS_HALO_LAYER, STOP_FOCUS_RING_LAYER]) {
      if (this.map.getLayer(layerId)) {
        this.map.setPaintProperty(layerId, 'circle-color', accent);
        this.map.setPaintProperty(layerId, 'circle-stroke-color', accent);
      }
    }
    const fill = stopFillColor(accent, this.defaultStopOptions.backgroundColor);
    for (const layerId of ['stops-background', STOP_FOCUS_TOP_LAYER]) {
      if (this.map.getLayer(layerId)) {
        this.map.setPaintProperty(layerId, 'circle-color', fill);
      }
    }
    if (this.map.getLayer(ZONE_FILL_LAYER)) {
      this.map.setPaintProperty(ZONE_FILL_LAYER, 'fill-color', accent);
    }
    if (this.map.getLayer(ZONE_OUTLINE_LAYER)) {
      this.map.setPaintProperty(ZONE_OUTLINE_LAYER, 'line-color', accent);
    }
    console.log(`[LayerManager] Accent color refreshed to ${accent}`);
  }

  /**
   * Clear all managed layers and sources
   */
  public clearAllLayers(): void {
    const layersToRemove = [
      ...LayerManager.PATHWAY_LAYER_IDS,
      'stops-station-dot',
      'stops-background',
      'stops-focus-halo',
      'stops-focus-ring',
      'stops-focus-top',
      'stops-clickarea',
      'stops-highlight',
      'trip-highlight',
      ...TRANSFER_LAYER_IDS,
      ZONE_FILL_LAYER,
      ZONE_OUTLINE_LAYER,
      // Legacy layers for backward compatibility
      'stops',
      'routes',
      'shapes',
    ];

    const sourcesToRemove = [
      'pathways',
      'station-ground',
      'stops',
      'stops-highlight',
      'trip-highlight',
      TRANSFER_SOURCE,
      ZONE_SOURCE,
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
   * Build (or refresh) the on-demand zone polygons from locations.geojson.
   *
   * The stored feature ids are copied into a `location_id` property because
   * MapLibre coerces non-numeric GeoJSON feature ids, and feature-state (the
   * focus highlight) has to survive a string id like "zone-north".
   */
  public updateZonesLayer(): void {
    const features: GeoJSON.Feature[] = getZoneFeatures(this.gtfsParser).map(
      (feature) => ({
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          ...(feature.properties ?? {}),
          location_id: String(feature.id),
          zone_name: zoneName(feature),
        },
      })
    );
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    const source = this.map.getSource(ZONE_SOURCE) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      this.map.addSource(ZONE_SOURCE, {
        type: 'geojson',
        data,
        promoteId: 'location_id',
      });
      // A fresh source means setStyle wiped the old one and its feature state.
      this.focusedZoneId = null;
      this.hoveredZoneId = null;
      this.routeZoneIds = [];
    }

    this.addZoneLayers();
    console.log(
      `[LayerManager] Zones layer updated (${features.length} zones)`
    );
  }

  /**
   * Fill + outline for the zone polygons.
   *
   * Both go in below the route lines and the stop circles: a zone covers whole
   * neighbourhoods, and on top it would swallow every stop and route click.
   */
  private addZoneLayers(): void {
    if (this.map.getLayer(ZONE_FILL_LAYER)) {
      return;
    }
    const accent = this.accent();
    const before = [
      'routes-casing',
      'stops-focus-halo',
      'stops-background',
    ].find((id) => !!this.map.getLayer(id));

    this.map.addLayer(
      {
        id: ZONE_FILL_LAYER,
        type: 'fill',
        source: ZONE_SOURCE,
        paint: {
          'fill-color': accent,
          'fill-opacity': this.zoneFillOpacity(this.routeZoneIds.length > 0),
        },
      },
      before
    );

    this.map.addLayer(
      {
        id: ZONE_OUTLINE_LAYER,
        type: 'line',
        source: ZONE_SOURCE,
        paint: {
          'line-color': accent,
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'focused'], false],
            3,
            ['boolean', ['feature-state', 'hovered'], false],
            2.5,
            1.5,
          ] as unknown as ExpressionSpecification,
          'line-opacity': this.zoneOutlineOpacity(this.routeZoneIds.length > 0),
          'line-dasharray': [4, 2],
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      },
      before
    );
  }

  /**
   * Zone fill opacity. Focused wins over hovered: hovering must never disturb
   * the selection, same rule as the stop layers. When a route spotlight is
   * active, zones outside it are dimmed instead of getting the base value.
   */
  private zoneFillOpacity(dimmed: boolean): ExpressionSpecification {
    const base = [
      'case',
      ['boolean', ['feature-state', 'focused'], false],
      ZONE_FILL_OPACITY_FOCUSED,
      ['boolean', ['feature-state', 'hovered'], false],
      ZONE_FILL_OPACITY_HOVERED,
      ZONE_FILL_OPACITY,
    ];
    if (!dimmed) {
      return base as unknown as ExpressionSpecification;
    }
    return [
      'case',
      ['boolean', ['feature-state', 'onRoute'], false],
      base,
      ZONE_FILL_OPACITY_DIMMED,
    ] as unknown as ExpressionSpecification;
  }

  /** The outline counterpart of zoneFillOpacity. */
  private zoneOutlineOpacity(dimmed: boolean): ExpressionSpecification {
    if (!dimmed) {
      return ZONE_OUTLINE_OPACITY as unknown as ExpressionSpecification;
    }
    return [
      'case',
      ['boolean', ['feature-state', 'onRoute'], false],
      ZONE_OUTLINE_OPACITY,
      ZONE_OUTLINE_OPACITY_DIMMED,
    ] as unknown as ExpressionSpecification;
  }

  /**
   * The zone half of the route spotlight: marks the zones a route touches with
   * the onRoute feature-state and dims every other polygon. Pass an empty array
   * to clear. Owned by MapController.applySpotlight, same as setRouteStops.
   */
  public setRouteZones(location_ids: string[]): void {
    console.log(`[LayerManager] Spotlighting ${location_ids.length} zones`);

    if (this.map.getSource(ZONE_SOURCE)) {
      for (const id of this.routeZoneIds) {
        this.map.setFeatureState(
          { source: ZONE_SOURCE, id },
          { onRoute: false }
        );
      }
      for (const id of location_ids) {
        this.map.setFeatureState(
          { source: ZONE_SOURCE, id },
          { onRoute: true }
        );
      }
    }
    this.routeZoneIds = this.map.getSource(ZONE_SOURCE) ? location_ids : [];

    const dimmed = this.routeZoneIds.length > 0;
    if (this.map.getLayer(ZONE_FILL_LAYER)) {
      this.map.setPaintProperty(
        ZONE_FILL_LAYER,
        'fill-opacity',
        this.zoneFillOpacity(dimmed)
      );
    }
    if (this.map.getLayer(ZONE_OUTLINE_LAYER)) {
      this.map.setPaintProperty(
        ZONE_OUTLINE_LAYER,
        'line-opacity',
        this.zoneOutlineOpacity(dimmed)
      );
    }
  }

  /**
   * Light the focused zone. Separate from setFocusedStop: a zone is a polygon
   * in its own source and nothing about the stop layers applies to it.
   */
  public setFocusedZone(location_id: string | null): void {
    if (this.focusedZoneId === location_id) {
      return;
    }
    console.log('[LayerManager] setFocusedZone', {
      prev: this.focusedZoneId,
      next: location_id,
    });
    try {
      if (this.focusedZoneId !== null && this.map.getSource(ZONE_SOURCE)) {
        this.map.setFeatureState(
          { source: ZONE_SOURCE, id: this.focusedZoneId },
          { focused: false }
        );
      }
      this.focusedZoneId = location_id;
      if (location_id !== null && this.map.getSource(ZONE_SOURCE)) {
        this.map.setFeatureState(
          { source: ZONE_SOURCE, id: location_id },
          { focused: true }
        );
      }
    } catch (error) {
      console.warn(
        '[LayerManager] Could not set focused zone:',
        location_id,
        error
      );
    }
  }

  /**
   * Light a zone being hovered elsewhere in the app. Separate feature state
   * from `focused` for the same reason as stops: hovering must not disturb the
   * selection, and a zone that is both reads as focused.
   */
  public setHoveredZone(location_id: string | null): void {
    if (this.hoveredZoneId === location_id) {
      return;
    }
    try {
      if (this.hoveredZoneId !== null && this.map.getSource(ZONE_SOURCE)) {
        this.map.setFeatureState(
          { source: ZONE_SOURCE, id: this.hoveredZoneId },
          { hovered: false }
        );
      }
      this.hoveredZoneId = location_id;
      if (location_id !== null && this.map.getSource(ZONE_SOURCE)) {
        this.map.setFeatureState(
          { source: ZONE_SOURCE, id: location_id },
          { hovered: true }
        );
      }
    } catch (error) {
      console.warn(
        '[LayerManager] Could not set hovered zone:',
        location_id,
        error
      );
    }
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
      // A fresh source means setStyle wiped the old one and every feature
      // state with it. Drop the cached ids, or setFocusedStop's no-op guard
      // would swallow the caller re-focusing the same stop and the selection
      // would never come back after a basemap switch.
      this.focusedStopId = null;
      this.hoveredStopIds = [];
      this.focusedPathwayId = null;
      this.routeStopIds = [];
      this.keptStopIds = [];
    }
    this.onStopsDataUpdated?.(stopsGeoJSON);

    // Add background stops layer if enabled. Order matters: the halo sits
    // under the circles (and under the pathways, which insert themselves
    // before stops-background), the focus redraw sits over them, and the
    // station dot goes last so a focused station keeps its center dot.
    if (finalOptions.showBackground) {
      this.addFocusHaloLayers();
      this.addStopsBackgroundLayer(finalOptions);
      this.addFocusTopLayer(finalOptions);
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
    console.log(`Added ${featureCount} stops to map`);
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
   * focused (clicked), on the currently spotlighted route, or kept (a member of
   * the expanded station, or an endpoint of the focused stop's transfers).
   */
  private static readonly SPECIAL_STOP: ExpressionSpecification = [
    'any',
    ['boolean', ['feature-state', 'focused'], false],
    ['boolean', ['feature-state', 'onRoute'], false],
    ['boolean', ['feature-state', 'kept'], false],
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
   * Everything that isn't a special stop is gone. Used as the bottom stop of
   * both fade bands, below which the map shows routes only.
   */
  private specialOnly(): ExpressionSpecification {
    return [
      'case',
      LayerManager.SPECIAL_STOP,
      1,
      0,
    ] as unknown as ExpressionSpecification;
  }

  /**
   * Opacity expression for the stops layers. Two nested fade bands, both
   * driven by zoom:
   *
   *   < STATION_FADE_ZOOM_MIN   nothing but special stops
   *   ~ STATION_FADE_ZOOM_MAX   stations and child nodes have faded in
   *   ~ STOP_FADE_ZOOM_MAX      plain stops (location_type 0) have faded in
   *
   * Stations get the gentler band because they're far more spaced out, a
   * zoomed-out view of them still reads as a network, where the same view of
   * every plain stop reads as a pile of dots. Special stops (focused, or on
   * the spotlighted route) are exempt at every zoom. When `dim` is set (route
   * spotlight active), non-special stops top out at `dim` rather than 1.
   */
  private stopFadeOpacity(dim: number | null): ExpressionSpecification {
    const stationsOnly = [
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
      CONFIG.STATION_FADE_ZOOM_MIN,
      this.specialOnly(),
      CONFIG.STATION_FADE_ZOOM_MAX,
      stationsOnly,
      CONFIG.STOP_FADE_ZOOM_MIN,
      stationsOnly,
      CONFIG.STOP_FADE_ZOOM_MAX,
      fullZoom,
    ] as unknown as ExpressionSpecification;
  }

  /**
   * Opacity for the station-dot layer, which is filtered to location_type 1 and
   * so only needs the station band. Without this the white station circle
   * fades out at low zoom and leaves its black center dot floating.
   */
  private stationFadeOpacity(dim: number | null): ExpressionSpecification {
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      CONFIG.STATION_FADE_ZOOM_MIN,
      this.specialOnly(),
      CONFIG.STATION_FADE_ZOOM_MAX,
      dim === null ? 1 : this.specialOrDim(dim),
    ] as unknown as ExpressionSpecification;
  }

  /**
   * The subset of StopLayerOptions the shared paint builders need, plus the
   * theme accent they cannot resolve themselves.
   */
  private stopStyle(options: StopLayerOptions): StopStyleOptions {
    return {
      accent: this.accent(),
      backgroundColor: options.backgroundColor,
      strokeColor: options.strokeColor,
      strokeWidth: options.strokeWidth,
      radius: options.radius,
    };
  }

  /**
   * Add the two focus-only layers that sit under the stop circles: a soft
   * accent disc and a thin crisp ring. Paint comes from `stop-layer-style.ts`.
   */
  private addFocusHaloLayers(): void {
    if (this.map.getLayer(STOP_FOCUS_HALO_LAYER)) {
      return;
    }
    const accent = this.accent();

    this.map.addLayer({
      id: STOP_FOCUS_HALO_LAYER,
      type: 'circle',
      source: 'stops',
      filter: this.activeStopsFilter,
      paint: focusHaloPaint(accent),
    });

    this.map.addLayer({
      id: STOP_FOCUS_RING_LAYER,
      type: 'circle',
      source: 'stops',
      filter: this.activeStopsFilter,
      paint: focusRingPaint(accent),
    });
  }

  /**
   * Add background stops layer.
   *
   * Cased transit look: circles scale with zoom (top-level zoom interpolate,
   * since MapLibre requires zoom as input to a top-level interpolate/step only),
   * plain stops fade out below ~z12.5 so zoomed-out views show the network
   * instead of a pile of dots, and stations stay visible at all zooms.
   * Focused stops grow and get an accent-colored ring.
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
      paint: stopsBackgroundPaint(
        this.stopStyle(options),
        this.stopFadeOpacity(null)
      ),
    });
  }

  /**
   * Redraw of the focused stop above every other stop layer, so a neighbouring
   * circle can never paint over the thing that was just selected. Hidden by
   * collapsing radius and opacity when unfocused, since filters cannot read
   * feature-state.
   */
  private addFocusTopLayer(options: StopLayerOptions): void {
    if (this.map.getLayer(STOP_FOCUS_TOP_LAYER)) {
      return;
    }

    this.map.addLayer({
      id: STOP_FOCUS_TOP_LAYER,
      type: 'circle',
      source: 'stops',
      filter: this.activeStopsFilter,
      paint: focusTopPaint(this.stopStyle(options)),
    });
  }

  /**
   * Add a small black dot at the center of each station feature.
   * Sits on top of the white station circle to mark it as a station.
   * Added after the focus layer so a focused station keeps its dot.
   */
  private addStationDotLayer(): void {
    if (this.map.getLayer('stops-station-dot')) {
      return;
    }

    this.map.addLayer({
      id: 'stops-station-dot',
      type: 'circle',
      source: 'stops',
      filter: [
        '==',
        ['get', 'location_type'],
        1,
      ] as unknown as FilterSpecification,
      paint: stationDotPaint(this.stationFadeOpacity(null)),
    });
  }

  /**
   * Add invisible click areas for stops.
   *
   * The hit radius mirrors the visible layer's fade: it collapses to 0 where
   * plain stops are fully faded out, so invisible stops are simply not
   * returned by queryRenderedFeatures: no JS-side visibility predicate to
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
          CONFIG.STATION_FADE_ZOOM_MIN,
          ['case', LayerManager.SPECIAL_STOP, r, 0],
          CONFIG.STATION_FADE_ZOOM_MAX,
          [
            'case',
            LayerManager.SPECIAL_STOP,
            r,
            ['==', ['get', 'location_type'], 0],
            0,
            r,
          ],
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
    for (const layerId of [
      'stops-background',
      'stops-focus-top',
      'stops-focus-halo',
      'stops-focus-ring',
      'stops-clickarea',
    ]) {
      if (this.map.getLayer(layerId)) {
        this.map.setFilter(layerId, this.activeStopsFilter);
      }
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

    console.log(`Highlighted trip: ${trip_id} with ${tripPath.length} stops`);
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
   * Draw the transfers of one stop as edges to the stops they connect to.
   *
   * Scoped to the focused stop rather than being a feed-wide layer: transfers
   * are a property of the stop the user is looking at, and a whole feed's worth
   * of them is unreadable. Types 4 and 5 link two trips rather than two places,
   * so they have no geometry here and are left out.
   */
  public showTransferEdges(stop_id: string): void {
    this.clearTransferEdges();

    const stops =
      this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];
    const pathways =
      this.gtfsParser.getFileDataSyncTyped<Pathways>('pathways.txt') || [];
    const transfers = this.gtfsParser.getFileDataSync('transfers.txt') || [];
    // Own coords where a stop has them, otherwise its laid-out position in the
    // pathway graph, so an edge lands on the dot that is actually drawn.
    const resolveCoord = this.getCachedResolver(stops, pathways);

    const features: GeoJSON.Feature[] = [];
    for (const transfer of transfers) {
      const from = String(transfer.from_stop_id ?? '');
      const to = String(transfer.to_stop_id ?? '');
      if (from !== stop_id && to !== stop_id) {
        continue;
      }
      const type = Number(transfer.transfer_type ?? 0) || 0;
      if (type === 4 || type === 5) {
        continue;
      }

      const fromCoord = from === '' ? null : resolveCoord(from);
      const toCoord = to === '' ? null : resolveCoord(to);
      if (!fromCoord || !toCoord) {
        console.warn(
          `[LayerManager] transfer ${from || '(none)'} -> ${to || '(none)'} cannot be drawn: endpoint has no coordinates`
        );
        continue;
      }

      const properties = {
        from_stop_id: from,
        to_stop_id: to,
        transfer_type: type,
      };
      // Two stops at the same place (a transfer within one station) would be a
      // zero-length line, which MapLibre draws as nothing at all. Mark the
      // place with a dot instead of losing the transfer.
      const geometry: GeoJSON.Geometry =
        segmentLengthM([fromCoord, toCoord]) < TRANSFER_STUB_LENGTH_M
          ? { type: 'Point', coordinates: fromCoord }
          : { type: 'LineString', coordinates: [fromCoord, toCoord] };
      features.push({ type: 'Feature', geometry, properties });
    }

    console.log(
      `[LayerManager] transfer edges for ${stop_id}: ${features.length}`
    );
    if (features.length === 0) {
      return;
    }

    this.map.addSource(TRANSFER_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Red is the error color and type 3 means the transfer is not possible,
    // which is the one case where it is the right read.
    const color = [
      'case',
      ['==', ['get', 'transfer_type'], 3],
      resolveThemeColor('--color-error', '#ef4444'),
      this.accent(),
    ] as unknown as ExpressionSpecification;
    // line-dasharray is not data-driven, so the dashed types need their own
    // layer. 0 (or empty) is a suggestion; 1, 2 and 3 are rules.
    const before = this.map.getLayer('stops-background')
      ? 'stops-background'
      : undefined;
    const width = this.transferEmphasis(TRANSFER_WIDTH, TRANSFER_WIDTH_HOVERED);
    const opacity = this.transferEmphasis(
      TRANSFER_OPACITY,
      TRANSFER_OPACITY_HOVERED
    );

    this.map.addLayer(
      {
        id: TRANSFER_DASHED_LAYER,
        type: 'line',
        source: TRANSFER_SOURCE,
        filter: [
          '==',
          ['get', 'transfer_type'],
          0,
        ] as unknown as FilterSpecification,
        paint: {
          'line-color': color,
          'line-width': width,
          'line-opacity': opacity,
          'line-dasharray': [2, 2],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      } as unknown as Parameters<MapLibreMap['addLayer']>[0],
      before
    );

    this.map.addLayer(
      {
        id: TRANSFER_SOLID_LAYER,
        type: 'line',
        source: TRANSFER_SOURCE,
        filter: [
          '!=',
          ['get', 'transfer_type'],
          0,
        ] as unknown as FilterSpecification,
        paint: {
          'line-color': color,
          'line-width': width,
          'line-opacity': opacity,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      } as unknown as Parameters<MapLibreMap['addLayer']>[0],
      before
    );

    // Point features only: a circle layer ignores the line geometries.
    this.map.addLayer(
      {
        id: TRANSFER_STUB_LAYER,
        type: 'circle',
        source: TRANSFER_SOURCE,
        paint: {
          'circle-radius': 10,
          'circle-color': 'transparent',
          'circle-stroke-color': color,
          'circle-stroke-width': width,
          'circle-stroke-opacity': opacity,
        },
      } as unknown as Parameters<MapLibreMap['addLayer']>[0],
      before
    );
  }

  /**
   * Emphasis expression for the hovered transfer edge, matched on the endpoint
   * pair the features carry. Built in one place so the three transfer layers
   * and `setHoveredTransfer` never drift apart.
   */
  private transferEmphasis(
    plain: number,
    emphasized: number
  ): ExpressionSpecification | number {
    if (!this.hoveredTransfer) {
      return plain;
    }
    return [
      'case',
      [
        'all',
        ['==', ['get', 'from_stop_id'], this.hoveredTransfer.from_stop_id],
        ['==', ['get', 'to_stop_id'], this.hoveredTransfer.to_stop_id],
      ],
      emphasized,
      plain,
    ] as unknown as ExpressionSpecification;
  }

  /**
   * Light one transfer edge, e.g. from a hovered row in the stop page's
   * transfers list. Purely visual, like `setHoveredStop`. Pass null to clear.
   */
  public setHoveredTransfer(
    edge: { from_stop_id: string; to_stop_id: string } | null
  ): void {
    const same =
      this.hoveredTransfer?.from_stop_id === edge?.from_stop_id &&
      this.hoveredTransfer?.to_stop_id === edge?.to_stop_id;
    if (same) {
      return;
    }
    this.hoveredTransfer = edge;

    const width = this.transferEmphasis(TRANSFER_WIDTH, TRANSFER_WIDTH_HOVERED);
    const opacity = this.transferEmphasis(
      TRANSFER_OPACITY,
      TRANSFER_OPACITY_HOVERED
    );
    for (const layerId of [TRANSFER_DASHED_LAYER, TRANSFER_SOLID_LAYER]) {
      if (this.map.getLayer(layerId)) {
        this.map.setPaintProperty(layerId, 'line-width', width);
        this.map.setPaintProperty(layerId, 'line-opacity', opacity);
      }
    }
    if (this.map.getLayer(TRANSFER_STUB_LAYER)) {
      this.map.setPaintProperty(
        TRANSFER_STUB_LAYER,
        'circle-stroke-width',
        width
      );
      this.map.setPaintProperty(
        TRANSFER_STUB_LAYER,
        'circle-stroke-opacity',
        opacity
      );
    }
  }

  public clearTransferEdges(): void {
    this.hoveredTransfer = null;
    for (const layerId of TRANSFER_LAYER_IDS) {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    }
    if (this.map.getSource(TRANSFER_SOURCE)) {
      this.map.removeSource(TRANSFER_SOURCE);
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
        this.stationFadeOpacity(dim)
      );
    }
  }

  /**
   * Keep stops fully visible and clickable regardless of the route spotlight.
   *
   * Selection is additive: expanding a station must not hide the platforms it
   * contains, and a transfer edge must land on a dot that is actually drawn.
   * Separate from `setRouteStops` because it never touches the dim level, which
   * belongs to the route spotlight. Pass an empty array to clear.
   */
  public setKeptStops(stop_ids: string[]): void {
    const next = [...new Set(stop_ids)];
    if (
      next.length === this.keptStopIds.length &&
      next.every((stop_id) => this.keptStopIds.includes(stop_id))
    ) {
      return;
    }
    console.log(`[LayerManager] Keeping ${next.length} stops visible`);

    if (this.map.getSource('stops')) {
      for (const id of this.keptStopIds) {
        this.map.setFeatureState({ source: 'stops', id }, { kept: false });
      }
      for (const id of next) {
        this.map.setFeatureState({ source: 'stops', id }, { kept: true });
      }
      this.keptStopIds = next;
    } else {
      this.keptStopIds = [];
    }
  }

  /**
   * Clear all highlights
   */
  public clearHighlights(): void {
    this.clearTransferEdges();
    this.setFocusedStop(null);
    this.setHoveredStop(null);
    this.setHoveredZone(null);
    if (this.routeStopIds.length > 0) {
      this.setRouteStops([]);
    }
    if (this.keptStopIds.length > 0) {
      this.setKeptStops([]);
    }
    if (this.routeZoneIds.length > 0) {
      this.setRouteZones([]);
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

  /**
   * Light the halo for a stop being hovered elsewhere in the app. Separate
   * feature state from `focused` so hovering never disturbs the selection, and
   * so a stop that is both reads as focused.
   */
  public setHoveredStop(stop_id: string | null): void {
    this.setHoveredStops(stop_id === null ? [] : [stop_id]);
  }

  /**
   * The set-valued form: a location group hover lights every member stop at
   * once. Clearing always clears the whole previous set, so no stop stays lit
   * after the pointer leaves.
   */
  public setHoveredStops(stop_ids: string[]): void {
    const next = [...new Set(stop_ids)];
    const prev = this.hoveredStopIds;
    if (
      next.length === prev.length &&
      next.every((stop_id) => prev.includes(stop_id))
    ) {
      return;
    }
    try {
      if (this.map.getSource('stops')) {
        for (const stop_id of prev) {
          this.map.setFeatureState(
            { source: 'stops', id: stop_id },
            { hovered: false }
          );
        }
      }
      this.hoveredStopIds = next;
      if (this.map.getSource('stops')) {
        for (const stop_id of next) {
          this.map.setFeatureState(
            { source: 'stops', id: stop_id },
            { hovered: true }
          );
        }
      }
    } catch (error) {
      console.warn(
        '[LayerManager] Could not set hovered stops:',
        stop_ids,
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
    console.log(`Updated stops data: ${stopsGeoJSON.features.length} stops`);
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

    // Group by unordered endpoint pair first: parallel edges (a walkway, some
    // stairs and a lift between the same two nodes) would otherwise be drawn
    // exactly on top of each other, leaving only the last one visible.
    const groups = new Map<string, Pathways[]>();
    pathways.forEach((pw) => {
      if (
        !stationStopIds.has(pw.from_stop_id) ||
        !stationStopIds.has(pw.to_stop_id)
      ) {
        return;
      }
      const key = [String(pw.from_stop_id), String(pw.to_stop_id)]
        .sort()
        .join('\u0000');
      const existing = groups.get(key);
      if (existing) {
        existing.push(pw);
      } else {
        groups.set(key, [pw]);
      }
    });

    const features: GeoJSON.Feature[] = [];
    for (const members of groups.values()) {
      members.forEach((pw, index) => {
        const from = resolveCoord(String(pw.from_stop_id));
        const to = resolveCoord(String(pw.to_stop_id));
        if (!from || !to) {
          return;
        }

        let coords: [number, number][] = [from, to];
        const offsetFromGroup =
          (index - (members.length - 1) / 2) * PATHWAY_PARALLEL_OFFSET_M;
        // Groups use an unordered endpoint pair. Keep offsets relative to that
        // canonical direction, otherwise a reverse-direction pathway flips its
        // normal and can land on the same geographic side as its sibling.
        const offset =
          String(pw.from_stop_id) < String(pw.to_stop_id)
            ? offsetFromGroup
            : -offsetFromGroup;
        if (offset !== 0) {
          const [offsetFrom, offsetTo] = offsetSegment([from, to], offset);
          // Keep endpoints at their nodes while separating only the middle run.
          coords = [from, offsetFrom, offsetTo, to];
        }

        features.push({
          type: 'Feature',
          id: pw.pathway_id,
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
          properties: {
            pathway_id: pw.pathway_id,
            from_stop_id: pw.from_stop_id,
            to_stop_id: pw.to_stop_id,
            pathway_mode: Number(pw.pathway_mode) || 1,
            is_bidirectional: pw.is_bidirectional,
            // Elevators between two nodes at nearly the same coordinates
            // collapse to a blob; too small to carry an icon.
            is_stub: segmentLengthM([from, to]) < PATHWAY_STUB_LENGTH_M,
          },
        });
      });
    }

    return { type: 'FeatureCollection', features };
  }

  /**
   * Convex hull of the expanded station's nodes, used as a ground plane so the
   * pathway graph reads as sitting on a surface instead of floating on the
   * basemap. Returns null when the station has too few placeable nodes.
   */
  private buildStationGroundGeoJSON(
    stationId: string
  ): GeoJSON.FeatureCollection | null {
    const stops =
      this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];
    const pathways =
      this.gtfsParser.getFileDataSyncTyped<Pathways>('pathways.txt') || [];
    const resolveCoord = this.getCachedResolver(stops, pathways);

    const coords: [number, number][] = [];
    for (const stop of stops) {
      if (stop.stop_id !== stationId && stop.parent_station !== stationId) {
        continue;
      }
      const coord = resolveCoord(String(stop.stop_id));
      if (coord) {
        coords.push(coord);
      }
    }

    const ring = bufferedHull(coords, STATION_GROUND_BUFFER_M);
    if (!ring) {
      return null;
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {},
        },
      ],
    };
  }

  /**
   * Add (or update) pathway source and layers for the given station.
   * Call when a station is expanded.
   */
  public updatePathwaysLayer(stationId: string): void {
    // setStyle (basemap switch) drops every registered image, and this method
    // is re-run on that path, so re-register before the icon layer is added.
    ensureMapIcons(this.map);

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

    this.updateStationGroundLayer(stationId);
    this.addPathwayLineLayers();
    this.addPathwayIconLayer();
    this.addPathwayClickAreaLayer();

    console.log(
      `[LayerManager] Updated pathways layer for station: ${stationId} (${geojson.features.length} pathways)`
    );
  }

  /** Ground plane under the expanded station's pathway graph. */
  private updateStationGroundLayer(stationId: string): void {
    const geojson = this.buildStationGroundGeoJSON(stationId);
    if (!geojson) {
      // Too few placeable nodes to form a polygon. Drop any plane left over
      // from a previously expanded station rather than showing a stale hull.
      this.removeStationGroundLayer();
      return;
    }

    const source = this.map.getSource('station-ground') as
      | GeoJSONSource
      | undefined;
    if (source) {
      source.setData(geojson);
      return;
    }

    this.map.addSource('station-ground', { type: 'geojson', data: geojson });

    // Below the halo, which is itself below the pathways and the stops.
    const before = this.map.getLayer('stops-focus-halo')
      ? 'stops-focus-halo'
      : 'stops-background';

    this.map.addLayer(
      {
        id: 'station-ground-fill',
        type: 'fill',
        source: 'station-ground',
        paint: { 'fill-color': '#8ea3bd', 'fill-opacity': 0.2 },
      },
      before
    );
    this.map.addLayer(
      {
        id: 'station-ground-line',
        type: 'line',
        source: 'station-ground',
        paint: {
          'line-color': '#8ea3bd',
          'line-width': 1.2,
          'line-opacity': 0.5,
          'line-dasharray': [3, 2],
        },
      },
      before
    );
  }

  private removeStationGroundLayer(): void {
    for (const layerId of ['station-ground-fill', 'station-ground-line']) {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    }
    if (this.map.getSource('station-ground')) {
      this.map.removeSource('station-ground');
    }
  }

  /**
   * One casing + one core layer per pathway category. All casings go in first
   * so a neighbour's casing can never paint over an already-drawn core.
   */
  private addPathwayLineLayers(): void {
    const coreWidth: ExpressionSpecification = [
      'case',
      ['boolean', ['feature-state', 'focused'], false],
      6,
      PATHWAY_CORE_WIDTH_PX,
    ] as unknown as ExpressionSpecification;

    const categoryFilter = (category: PathwayCategory): FilterSpecification =>
      [
        'in',
        ['get', 'pathway_mode'],
        ['literal', modesInCategory(category)],
      ] as unknown as FilterSpecification;

    for (const category of PATHWAY_CATEGORY_ORDER) {
      const id = `pathways-casing-${category}`;
      if (this.map.getLayer(id)) {
        continue;
      }
      const { dash } = PATHWAY_CATEGORIES[category];
      const casingPaint: Record<string, unknown> = {
        'line-color': '#0f172a',
        'line-width': ['+', coreWidth, PATHWAY_CASING_EXTRA_PX],
        'line-opacity': 0.8,
      };
      if (dash) {
        // dasharray is measured in line widths, so the casing needs the
        // pattern scaled by the width ratio to line up with the core. A solid
        // casing under a dashed core would fill the gaps back in and the line
        // would read as solid-dark-with-colored-dashes.
        casingPaint['line-dasharray'] = dash.map(
          (d) => (d * PATHWAY_CORE_WIDTH_PX) / PATHWAY_CASING_WIDTH_PX
        );
      }
      this.map.addLayer(
        {
          id,
          type: 'line',
          source: 'pathways',
          filter: categoryFilter(category),
          paint: casingPaint,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        } as unknown as Parameters<MapLibreMap['addLayer']>[0],
        'stops-background'
      );
    }

    for (const category of PATHWAY_CATEGORY_ORDER) {
      const id = `pathways-core-${category}`;
      if (this.map.getLayer(id)) {
        continue;
      }
      const { color, dash } = PATHWAY_CATEGORIES[category];
      const paint: Record<string, unknown> = {
        'line-color': color,
        'line-width': coreWidth,
      };
      if (dash) {
        paint['line-dasharray'] = dash;
      }
      this.map.addLayer(
        {
          id,
          type: 'line',
          source: 'pathways',
          filter: categoryFilter(category),
          paint,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        } as unknown as Parameters<MapLibreMap['addLayer']>[0],
        'stops-background'
      );
    }
  }

  /**
   * Mode glyph at the center of each pathway. This is what actually names the
   * mode: the line color only says which category it belongs to.
   */
  private addPathwayIconLayer(): void {
    if (this.map.getLayer('pathways-icons')) {
      return;
    }

    const cases: unknown[] = ['case'];
    for (const [mode, info] of Object.entries(PATHWAY_MODES)) {
      cases.push(['==', ['get', 'pathway_mode'], Number(mode)], info.icon);
    }
    cases.push('');
    const iconImage = cases as unknown as ExpressionSpecification;

    this.map.addLayer(
      {
        id: 'pathways-icons',
        type: 'symbol',
        source: 'pathways',
        filter: [
          '!=',
          ['get', 'is_stub'],
          true,
        ] as unknown as FilterSpecification,
        layout: {
          'icon-image': iconImage,
          'symbol-placement': 'line-center',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'viewport',
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            16,
            0.55,
            19,
            1,
          ] as unknown as ExpressionSpecification,
        },
      },
      'stops-background'
    );
  }

  private addPathwayClickAreaLayer(): void {
    if (this.map.getLayer('pathways-clickarea')) {
      return;
    }
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

    this.map.on('mouseenter', 'pathways-clickarea', this.onPathwayMouseEnter);
    this.map.on('mouseleave', 'pathways-clickarea', this.onPathwayMouseLeave);
  }

  /**
   * Remove pathway source and layers from the map.
   * Call when a station is collapsed.
   */
  public clearPathwaysLayer(): void {
    this.setFocusedPathway(null);
    this.map.off('mouseenter', 'pathways-clickarea', this.onPathwayMouseEnter);
    this.map.off('mouseleave', 'pathways-clickarea', this.onPathwayMouseLeave);

    LayerManager.PATHWAY_LAYER_IDS.forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });
    for (const sourceId of ['pathways', 'station-ground']) {
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
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

    const ground = this.map.getSource('station-ground') as
      | GeoJSONSource
      | undefined;
    if (ground) {
      const groundGeoJSON = this.buildStationGroundGeoJSON(stationId);
      if (groundGeoJSON) {
        ground.setData(groundGeoJSON);
      }
    }
  }
}
