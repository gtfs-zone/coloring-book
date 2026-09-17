import {
  Map as MapLibreMap,
  GeoJSONSource,
  MapMouseEvent,
  MapTouchEvent,
  Point,
  MapGeoJSONFeature,
} from 'maplibre-gl';
import { Stops } from '../types/gtfs-entities';
import { MapMode } from './map-controller';
import type { GTFSParser } from './gtfs-parser';
import { showModal } from 'interlocking/ui/modal-utils';
import { generateId } from '../utils/uuid';
import { hasLiveEditor } from '../utils/inline-edit';
import { promptNewEntity, type EntityFormField } from './entity-form-modal';
import { GTFS_TABLES } from '../types/gtfs';

export interface InteractionCallbacks {
  onRouteClick?: (route_id: string) => void;
  onStopClick?: (stop_id: string) => void;
  onPathwayClick?: (pathway_id: string) => void;
  onZoneClick?: (location_id: string) => void;
  onPathwayCreated?: (pathway_id: string) => void;
  onModeChange?: (mode: MapMode) => void;
  onStopDragComplete?: (stop_id: string, lat: number, lng: number) => void;
  onStopCreated?: (stop_id: string) => void;
  onEmptyClick?: () => void;
}

export class InteractionHandler {
  private map: MapLibreMap;
  private gtfsParser: GTFSParser;
  private callbacks: InteractionCallbacks = {};
  private currentMode: MapMode = MapMode.NAVIGATE;

  // Drag state
  private isDragging = false;
  private draggedStopId: string | null = null;

  // Currently highlighted stop (draggable in NAVIGATE mode)
  private highlightedStopId: string | null = null;

  // Whether an inline editor was open when the current press started
  private hadLiveEditorOnPress = false;

  // Local copy of stops GeoJSON for drag: avoids reading MapLibre's private _data
  private stopsGeoJSON: GeoJSON.FeatureCollection | null = null;

  // Callback to retrieve the currently expanded station id from MapController
  private getExpandedStationId: (() => string | null) | null = null;

  // First stop selected during ADD_PATHWAY mode
  private addPathwayFirstStopId: string | null = null;

  // Id of the persistent "click two stops" / "From: ..." notification shown while in ADD_PATHWAY mode
  private addPathwayNotificationId: number | null = null;

  constructor(map: MapLibreMap, gtfsParser: GTFSParser) {
    this.map = map;
    this.gtfsParser = gtfsParser;
    this.setupEventListeners();
  }

  /**
   * Set interaction callbacks
   */
  public setCallbacks(callbacks: Partial<InteractionCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public setStopsGeoJSON(data: GeoJSON.FeatureCollection): void {
    this.stopsGeoJSON = data;
  }

  public setGetExpandedStationId(fn: () => string | null): void {
    this.getExpandedStationId = fn;
  }

  public setHighlightedStop(stop_id: string | null): void {
    this.highlightedStopId = stop_id;
  }

  /**
   * Set current map mode
   */
  public setMapMode(mode: MapMode): void {
    if (this.currentMode === mode) {
      return;
    }

    const previousMode = this.currentMode;
    this.currentMode = mode;

    // Update cursor based on mode
    this.updateCursor(mode);

    // Handle mode-specific setup
    this.handleModeChange(previousMode, mode);

    // Notify callback
    if (this.callbacks.onModeChange) {
      this.callbacks.onModeChange(mode);
    }
  }

  /**
   * Get current map mode
   */
  public getCurrentMode(): MapMode {
    return this.currentMode;
  }

  /**
   * Setup base event listeners
   */
  private setupEventListeners(): void {
    // Primary click handler
    this.map.on('click', this.handleMapClick.bind(this));

    // Mouse events for dragging. The live-editor snapshot is taken here, not
    // in the click handler: the browser blurs and commits the editor as the
    // default action of this same mousedown, so by click time it is gone.
    this.map.on('mousedown', (e) => {
      this.hadLiveEditorOnPress = hasLiveEditor();
      this.handleMouseDown(e);
    });
    this.map.on('mousemove', this.handleMouseMove.bind(this));
    this.map.on('mouseup', this.handleMouseUp.bind(this));

    // Touch events for dragging (mobile)
    this.map.on('touchstart', (e) => {
      this.hadLiveEditorOnPress = hasLiveEditor();
      this.handleTouchStart(e);
    });
    this.map.on('touchmove', this.handleTouchMove.bind(this));
    this.map.on('touchend', this.handleTouchEnd.bind(this));

    // Always-on hover handlers for the stop clickarea layer: show grab
    // cursor on highlighted stop. Only the clickarea is used for hit-testing:
    // its radius collapses to 0 for stops hidden by the low-zoom fade, so
    // invisible stops don't react to hover or clicks.
    this.map.on('mouseenter', 'stops-clickarea', (e) => {
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: ['stops-clickarea'],
      });
      const stop_id = features[0]?.properties?.stop_id;
      if (
        this.currentMode === MapMode.NAVIGATE &&
        stop_id === this.highlightedStopId &&
        !this.isDragging
      ) {
        this.map.getCanvas().style.cursor = 'grab';
      } else if (this.currentMode === MapMode.NAVIGATE) {
        this.map.getCanvas().style.cursor = 'pointer';
      }
    });

    this.map.on('mouseleave', 'stops-clickarea', () => {
      if (!this.isDragging) {
        this.updateCursor(this.currentMode);
      }
    });

    // Pointer cursor over routes. Routes are not draggable, so this is a
    // plain pointer/reset pair; still gated on !isDragging so it doesn't
    // stomp the 'grabbing' cursor if a route passes under a dragged stop.
    this.map.on('mouseenter', 'routes-clickarea', () => {
      if (this.currentMode === MapMode.NAVIGATE && !this.isDragging) {
        this.map.getCanvas().style.cursor = 'pointer';
      }
    });

    this.map.on('mouseleave', 'routes-clickarea', () => {
      if (!this.isDragging) {
        this.updateCursor(this.currentMode);
      }
    });

    // Zone polygons. Registered up front like the route handlers above: the
    // layer is added later, when a feed with locations.geojson loads.
    this.map.on('mouseenter', 'zones-fill', () => {
      if (this.currentMode === MapMode.NAVIGATE && !this.isDragging) {
        this.map.getCanvas().style.cursor = 'pointer';
      }
    });

    this.map.on('mouseleave', 'zones-fill', () => {
      if (!this.isDragging) {
        this.updateCursor(this.currentMode);
      }
    });
  }

  /**
   * Handle map click events based on current mode
   */
  private handleMapClick(e: MapMouseEvent): void {
    // A click that closes an inline editor commits it and stops there: the
    // blur already fired on mousedown, so navigating now would move the panel
    // away from the row the user just edited. Explicit placement modes still
    // place on that click.
    const dismissedEditor = this.hadLiveEditorOnPress;
    this.hadLiveEditorOnPress = false;
    if (dismissedEditor && this.currentMode === MapMode.NAVIGATE) {
      console.log(
        '[InteractionHandler] map click swallowed, committing live editor'
      );
      return;
    }

    switch (this.currentMode) {
      case MapMode.ADD_STOP:
        this.handleAddStopClick(e);
        break;
      case MapMode.ADD_PATHWAY:
        void this.handleAddPathwayClick(e);
        break;
      case MapMode.NAVIGATE:
      default:
        this.handleNavigationClick(e);
        break;
    }
  }

  /**
   * Query rendered features, restricting to layers that currently exist.
   * MapLibre throws if any requested layer is missing, so callers that
   * reference dynamically-added layers (e.g. pathways) must filter first.
   */
  private queryFeaturesOnLayers(
    point: Point,
    layers: string[]
  ): MapGeoJSONFeature[] {
    const existing = layers.filter((id) => !!this.map.getLayer(id));
    if (existing.length === 0) {
      return [];
    }
    return this.map.queryRenderedFeatures(point, { layers: existing });
  }

  /**
   * Handle navigation mode clicks (stops, pathways, and routes)
   */
  private handleNavigationClick(e: MapMouseEvent): void {
    // Query features at click point, prioritizing stops over pathways over routes
    const stopFeatures = this.queryFeaturesOnLayers(e.point, [
      'stops-clickarea',
    ]);

    if (stopFeatures.length > 0) {
      // Handle stop click - this takes priority over everything
      const stopFeature = stopFeatures[0];
      const stop_id = stopFeature.properties?.stop_id;

      if (stop_id && this.callbacks.onStopClick) {
        console.log('clicked on stop', stop_id);
        this.callbacks.onStopClick(stop_id);
      }
      return; // Exit early to prevent route clicks
    }

    // Check for pathway features (only present when a station is expanded)
    // The clickarea is 16px wide and fully covers the drawn lines, so it is
    // the sole hit-test layer for pathways.
    const pathwayFeatures = this.queryFeaturesOnLayers(e.point, [
      'pathways-clickarea',
    ]);

    if (pathwayFeatures.length > 0) {
      const pathway_id = pathwayFeatures[0].properties?.pathway_id;
      if (pathway_id && this.callbacks.onPathwayClick) {
        console.log('clicked on pathway', pathway_id);
        this.callbacks.onPathwayClick(pathway_id);
      }
      return;
    }

    // If no stops or pathways found, check for route features
    const routeFeatures = this.queryFeaturesOnLayers(e.point, [
      'routes-clickarea',
      'routes-background',
    ]);

    if (routeFeatures.length > 0) {
      // Handle route click
      const routeFeature = routeFeatures[0];
      const route_id = routeFeature.properties?.route_id;

      if (route_id && this.callbacks.onRouteClick) {
        console.log('clicked on route', route_id);
        this.callbacks.onRouteClick(route_id);
      }
      return;
    }

    // Zones last: they are neighbourhood-sized polygons, so anything drawn on
    // top of one wins the click.
    const zoneFeatures = this.queryFeaturesOnLayers(e.point, ['zones-fill']);

    if (zoneFeatures.length > 0) {
      const location_id = zoneFeatures[0].properties?.location_id;
      if (location_id && this.callbacks.onZoneClick) {
        console.log('clicked on zone', location_id);
        this.callbacks.onZoneClick(location_id);
      }
      return;
    }

    // No features found at click point
    this.callbacks.onEmptyClick?.();
  }

  /**
   * Handle add stop mode clicks
   */
  private handleAddStopClick(e: MapMouseEvent): void {
    if (!this.gtfsParser) {
      console.error('Cannot add stop: GTFSParser not initialized');
      return;
    }

    const { lng, lat } = e.lngLat;
    const expandedStationId = this.getExpandedStationId?.() ?? null;

    // A child of an expanded station can be any of the non-station types; a
    // standalone stop is always a platform, so the field is not offered.
    const locationTypeField: EntityFormField[] = expandedStationId
      ? [
          {
            field: 'location_type',
            tableName: GTFS_TABLES.STOPS,
            label: 'Location Type',
            type: 'select',
            options: [
              { value: '0', label: '0: Platform (stop within a station)' },
              { value: '2', label: '2: Entrance / Exit' },
              { value: '3', label: '3: Generic Node' },
              { value: '4', label: '4: Boarding Area' },
            ],
          },
        ]
      : [];

    const parentInfo = expandedStationId
      ? `<p class="text-xs opacity-60">Will be added as a child of station <code>${expandedStationId}</code>.</p>`
      : '';

    void promptNewEntity({
      title: expandedStationId ? 'New Child Stop' : 'New Stop',
      createLabel: 'Create Stop',
      fields: [
        {
          field: 'stop_id',
          tableName: GTFS_TABLES.STOPS,
          label: 'Stop ID',
          mono: true,
          value: generateId(),
          note: 'The Stop ID cannot be changed after creation. Examples: <code>1234</code>, <code>STOP_1</code>, <code>place-gilman</code>.',
        },
        ...locationTypeField,
      ],
      extraBody: parentInfo,
      validate: (v) => {
        if (!v.stop_id) {
          return 'Stop ID is required.';
        }
        const stops =
          this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];
        if (stops.some((s) => s.stop_id === v.stop_id)) {
          return 'Stop ID already exists.';
        }
        return null;
      },
      onCreate: async (v) => {
        const newStop: Stops = {
          stop_id: v.stop_id,
          stop_name: '',
          stop_lat: parseFloat(lat.toFixed(6)),
          stop_lon: parseFloat(lng.toFixed(6)),
          parent_station: expandedStationId ?? '',
          location_type: parseInt(v.location_type ?? '0', 10),
        };
        console.log('Creating new stop:', newStop);
        await this.addStopToData(newStop);
        this.setMapMode(MapMode.NAVIGATE);
        this.callbacks.onStopClick?.(v.stop_id);
        console.log(
          `Created stop ${v.stop_id} at ${lat.toFixed(6)}, ${lng.toFixed(6)}`
        );
      },
    }).then((values) => {
      // Cancelling leaves add-stop mode, as the old Cancel action did.
      if (!values) {
        this.setMapMode(MapMode.NAVIGATE);
      }
    });
  }

  /**
   * Handle add pathway mode clicks (two-click: from_stop -> to_stop -> modal)
   */
  private async handleAddPathwayClick(e: MapMouseEvent): Promise<void> {
    const stopFeatures = this.queryFeaturesOnLayers(e.point, [
      'stops-clickarea',
    ]);

    if (stopFeatures.length === 0) {
      return;
    }

    const stop_id = stopFeatures[0].properties?.stop_id as string;
    if (!stop_id) {
      return;
    }

    const stops =
      this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];
    const clickedStop = stops.find((s) => s.stop_id === stop_id);
    const locationType =
      typeof clickedStop?.location_type === 'number'
        ? clickedStop.location_type
        : parseInt(clickedStop?.location_type ?? '0', 10) || 0;

    if (locationType === 1) {
      showModal({
        title: 'Invalid stop',
        body: '<p>Stations (location_type=1) cannot be pathway endpoints. Select a platform, entrance, generic node, or boarding area.</p>',
        enterAction: 0,
        escapeAction: 0,
        actions: [{ label: 'OK', onClick: () => {} }],
      });
      return;
    }

    if (this.addPathwayFirstStopId === null) {
      this.addPathwayFirstStopId = stop_id;
      await this.showAddPathwayNotification(
        `From: ${stop_id}. Now click the second stop to connect.`
      );
      return;
    }

    const fromStopId = this.addPathwayFirstStopId;
    const toStopId = stop_id;
    this.addPathwayFirstStopId = null;

    if (fromStopId === toStopId) {
      showModal({
        title: 'Invalid pathway',
        body: '<p>The two endpoints must be different stops.</p>',
        enterAction: 0,
        escapeAction: 0,
        actions: [{ label: 'OK', onClick: () => {} }],
      });
      return;
    }

    const pathwayId = generateId();
    const endpoints = `
      <div>
        <div class="label-text text-sm opacity-70 mb-1">From Stop</div>
        <div class="font-mono text-sm bg-base-200 px-3 py-2 rounded">${fromStopId}</div>
      </div>
      <div>
        <div class="label-text text-sm opacity-70 mb-1">To Stop</div>
        <div class="font-mono text-sm bg-base-200 px-3 py-2 rounded">${toStopId}</div>
      </div>
    `;

    void promptNewEntity({
      title: 'New Pathway',
      createLabel: 'Create Pathway',
      intro: endpoints,
      fields: [
        {
          field: 'pathway_mode',
          tableName: GTFS_TABLES.PATHWAYS,
          label: 'Pathway Mode',
          type: 'select',
          value: '1',
          options: [
            { value: '1', label: '1: Walkway' },
            { value: '2', label: '2: Stairs' },
            { value: '3', label: '3: Moving Sidewalk' },
            { value: '4', label: '4: Escalator' },
            { value: '5', label: '5: Elevator' },
            { value: '6', label: '6: Fare Gate' },
            { value: '7', label: '7: Exit Gate' },
          ],
        },
        {
          field: 'is_bidirectional',
          tableName: GTFS_TABLES.PATHWAYS,
          label: 'Bidirectional',
          type: 'select',
          value: '1',
          options: [
            { value: '0', label: '0: One way' },
            { value: '1', label: '1: Both ways' },
          ],
        },
      ],
      validate: (v) => {
        if (v.pathway_mode === '7' && v.is_bidirectional === '1') {
          return 'Exit gates (mode 7) must not be bidirectional.';
        }
        return null;
      },
      onCreate: async (v) => {
        await this.gtfsParser.createPathway({
          pathway_id: pathwayId,
          from_stop_id: fromStopId,
          to_stop_id: toStopId,
          pathway_mode: parseInt(v.pathway_mode, 10),
          is_bidirectional: parseInt(v.is_bidirectional, 10),
        });
        this.setMapMode(MapMode.NAVIGATE);
        this.callbacks.onPathwayCreated?.(pathwayId);
        console.log(`Created pathway ${pathwayId}`);
      },
    }).then((values) => {
      // Cancelling leaves add-pathway mode, as the old Cancel action did.
      if (!values) {
        this.setMapMode(MapMode.NAVIGATE);
      }
    });
  }

  /**
   * Handle mouse down events (for dragging)
   */
  private handleMouseDown(e: MapMouseEvent): void {
    if (this.currentMode !== MapMode.NAVIGATE) {
      return;
    }

    const features = this.map.queryRenderedFeatures(e.point, {
      layers: ['stops-clickarea'],
    });

    if (features.length === 0) {
      return;
    }

    const stop_id = features[0].properties?.stop_id;
    if (!stop_id || stop_id !== this.highlightedStopId) {
      return;
    }

    e.preventDefault();
    this.draggedStopId = stop_id;
    this.isDragging = true;
    this.map.getCanvas().style.cursor = 'grabbing';

    // Visual feedback for dragging
    this.setStopDragState(stop_id, true);
  }

  /**
   * Handle mouse move events (for dragging)
   */
  private handleMouseMove(e: MapMouseEvent): void {
    if (!this.isDragging || !this.draggedStopId) {
      return;
    }

    // Update the stop position in the GeoJSON source
    const source = this.map.getSource('stops') as GeoJSONSource;
    if (!source || !this.stopsGeoJSON) {
      return;
    }

    const data = this.stopsGeoJSON;

    // Find and update the feature coordinates
    const featureIndex = data.features.findIndex(
      (f) => f.properties && f.properties.stop_id === this.draggedStopId
    );

    if (featureIndex !== -1) {
      (data.features[featureIndex].geometry as GeoJSON.Point).coordinates = [
        e.lngLat.lng,
        e.lngLat.lat,
      ];
      source.setData(data);
    }
  }

  /**
   * Handle mouse up events (finish dragging)
   */
  private handleMouseUp(): void {
    if (!this.isDragging || !this.draggedStopId) {
      return;
    }

    const source = this.map.getSource('stops') as GeoJSONSource;
    if (!source || !this.stopsGeoJSON) {
      return;
    }

    const data = this.stopsGeoJSON;
    const finalPosition = data.features.find(
      (f) => f.properties && f.properties.stop_id === this.draggedStopId
    );

    if (finalPosition && this.callbacks.onStopDragComplete) {
      const [lng, lat] = (finalPosition.geometry as GeoJSON.Point).coordinates;
      console.log(`Stop ${this.draggedStopId} moved to: ${lat}, ${lng}`);

      // Notify callback about the drag completion
      this.callbacks.onStopDragComplete(this.draggedStopId, lat, lng);
    }

    // Clean up drag state
    this.setStopDragState(this.draggedStopId, false);
    this.draggedStopId = null;
    this.isDragging = false;
    this.updateCursor(this.currentMode);
  }

  /**
   * Handle touch start events (for dragging on mobile)
   */
  private handleTouchStart(e: MapTouchEvent): void {
    if (e.points.length !== 1) {
      return;
    }
    if (this.currentMode !== MapMode.NAVIGATE) {
      return;
    }

    const features = this.map.queryRenderedFeatures(e.point, {
      layers: ['stops-clickarea'],
    });

    if (features.length === 0) {
      return;
    }

    const stop_id = features[0].properties?.stop_id;
    if (!stop_id || stop_id !== this.highlightedStopId) {
      return;
    }

    e.preventDefault();
    this.draggedStopId = stop_id;
    this.isDragging = true;
    this.map.getCanvas().style.cursor = 'grabbing';

    this.setStopDragState(stop_id, true);
  }

  /**
   * Handle touch move events (for dragging on mobile)
   */
  private handleTouchMove(e: MapTouchEvent): void {
    if (e.points.length !== 1) {
      return;
    }
    if (!this.isDragging || !this.draggedStopId) {
      return;
    }

    e.preventDefault();

    const source = this.map.getSource('stops') as GeoJSONSource;
    if (!source || !this.stopsGeoJSON) {
      return;
    }

    const data = this.stopsGeoJSON;

    const featureIndex = data.features.findIndex(
      (f) => f.properties && f.properties.stop_id === this.draggedStopId
    );

    if (featureIndex !== -1) {
      (data.features[featureIndex].geometry as GeoJSON.Point).coordinates = [
        e.lngLat.lng,
        e.lngLat.lat,
      ];
      source.setData(data);
    }
  }

  /**
   * Handle touch end events (finish dragging on mobile)
   */
  private handleTouchEnd(_e: MapTouchEvent): void {
    this.handleMouseUp();
  }

  /**
   * Set visual feedback for stop dragging
   */
  private setStopDragState(stop_id: string, isDragging: boolean): void {
    try {
      this.map.setFeatureState(
        { source: 'stops', id: stop_id },
        { dragging: isDragging }
      );
    } catch (error) {
      console.debug('Could not set feature state for stop:', stop_id, error);
    }
  }

  /**
   * Update cursor based on current mode
   */
  private updateCursor(mode: MapMode): void {
    const canvas = this.map.getCanvas();

    switch (mode) {
      case MapMode.ADD_STOP:
      case MapMode.ADD_PATHWAY:
        canvas.style.cursor = 'crosshair';
        break;
      case MapMode.NAVIGATE:
      default:
        canvas.style.cursor = '';
        break;
    }
  }

  /**
   * Handle mode change logic
   */
  private handleModeChange(previousMode: MapMode, newMode: MapMode): void {
    console.log(`Map mode changed: ${previousMode} -> ${newMode}`);
    if (
      previousMode !== MapMode.ADD_PATHWAY &&
      newMode === MapMode.ADD_PATHWAY
    ) {
      void this.showAddPathwayNotification(
        'Click two stops to make a pathway between them.'
      );
    } else if (
      previousMode === MapMode.ADD_PATHWAY &&
      newMode !== MapMode.ADD_PATHWAY
    ) {
      this.addPathwayFirstStopId = null;
      void this.clearAddPathwayNotification();
    }
  }

  /**
   * Show the persistent ADD_PATHWAY hint notification, replacing any prior one.
   */
  private async showAddPathwayNotification(message: string): Promise<void> {
    const { notify } = await import('interlocking/ui/notification-system');
    if (this.addPathwayNotificationId !== null) {
      notify.removeNotification(this.addPathwayNotificationId);
    }
    this.addPathwayNotificationId = notify.info(message, { autoHide: false });
  }

  /**
   * Clear the persistent ADD_PATHWAY hint notification, if any.
   */
  private async clearAddPathwayNotification(): Promise<void> {
    if (this.addPathwayNotificationId === null) {
      return;
    }
    const { notify } = await import('interlocking/ui/notification-system');
    notify.removeNotification(this.addPathwayNotificationId);
    this.addPathwayNotificationId = null;
  }

  /**
   * Add stop to GTFS data (delegates to gtfsParser)
   */
  private async addStopToData(stop: Stops): Promise<void> {
    if (!this.gtfsParser || !this.gtfsParser.createStop) {
      throw new Error('GTFSParser or createStop method not available');
    }

    try {
      await this.gtfsParser.createStop(stop);
      console.log('Stop added successfully:', stop.stop_id);

      // Notify callback to refresh map layers properly
      if (this.callbacks.onStopCreated) {
        this.callbacks.onStopCreated(stop.stop_id);
      }
    } catch (error) {
      console.error('Failed to add stop:', error);
      throw error;
    }
  }

  /**
   * Toggle between add stop mode and navigation mode
   */
  public toggleAddStopMode(): void {
    const newMode =
      this.currentMode === MapMode.ADD_STOP
        ? MapMode.NAVIGATE
        : MapMode.ADD_STOP;
    this.setMapMode(newMode);
  }

  /**
   * Toggle between add pathway mode and navigation mode
   */
  public toggleAddPathwayMode(): void {
    const newMode =
      this.currentMode === MapMode.ADD_PATHWAY
        ? MapMode.NAVIGATE
        : MapMode.ADD_PATHWAY;
    this.setMapMode(newMode);
  }

  /**
   * Force navigation mode
   */
  public setNavigationMode(): void {
    this.setMapMode(MapMode.NAVIGATE);
  }

  /**
   * Clean up event listeners and state
   */
  public destroy(): void {
    // Clean up any active dragging
    if (this.isDragging && this.draggedStopId) {
      this.setStopDragState(this.draggedStopId, false);
    }

    // Reset state
    this.isDragging = false;
    this.draggedStopId = null;
    this.currentMode = MapMode.NAVIGATE;
    this.callbacks = {};

    // Remove event listeners
    this.map.off('click', this.handleMapClick);
    this.map.off('mousedown', this.handleMouseDown);
    this.map.off('mousemove', this.handleMouseMove);
    this.map.off('mouseup', this.handleMouseUp);
    this.map.off('touchstart', this.handleTouchStart);
    this.map.off('touchmove', this.handleTouchMove);
    this.map.off('touchend', this.handleTouchEnd);

    console.log('Interaction handler destroyed');
  }
}
