import {
  Map as MapLibreMap,
  GeoJSONSource,
  MapMouseEvent,
  MapTouchEvent,
  Point,
  MapGeoJSONFeature,
} from 'maplibre-gl';
import { Stops } from '../types/gtfs-entities.js';
import { MapMode } from './map-controller.js';
import type { GTFSParser } from './gtfs-parser.js';
import { showModal } from './modal-utils.js';
import { generateId } from '../utils/uuid.js';

export interface InteractionCallbacks {
  onRouteClick?: (route_id: string) => void;
  onStopClick?: (stop_id: string) => void;
  onPathwayClick?: (pathway_id: string) => void;
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

  // Local copy of stops GeoJSON for drag: avoids reading MapLibre's private _data
  private stopsGeoJSON: GeoJSON.FeatureCollection | null = null;

  // Callback to retrieve the currently expanded station id from MapController
  private getExpandedStationId: (() => string | null) | null = null;

  // First stop selected during ADD_PATHWAY mode
  private addPathwayFirstStopId: string | null = null;

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

    // Mouse events for dragging
    this.map.on('mousedown', this.handleMouseDown.bind(this));
    this.map.on('mousemove', this.handleMouseMove.bind(this));
    this.map.on('mouseup', this.handleMouseUp.bind(this));

    // Touch events for dragging (mobile)
    this.map.on('touchstart', this.handleTouchStart.bind(this));
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
  }

  /**
   * Handle map click events based on current mode
   */
  private handleMapClick(e: MapMouseEvent): void {
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
    const pathwayFeatures = this.queryFeaturesOnLayers(e.point, [
      'pathways-clickarea',
      'pathways-lines',
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
    const suggestedId = generateId();
    const expandedStationId = this.getExpandedStationId?.() ?? null;

    const locationTypeSelect = expandedStationId
      ? `
        <label class="label mt-2"><span class="label-text">Location Type</span></label>
        <select id="new-stop-type-select" class="select select-bordered w-full">
          <option value="0">0: Platform (stop within a station)</option>
          <option value="2">2: Entrance / Exit</option>
          <option value="3">3: Generic Node</option>
          <option value="4">4: Boarding Area</option>
        </select>`
      : '';

    const parentInfo = expandedStationId
      ? `<p class="text-xs opacity-60 mt-2">Will be added as a child of station <code>${expandedStationId}</code>.</p>`
      : '';

    const bodyHtml = `
      <label class="label"><span class="label-text">Stop ID</span></label>
      <input
        id="new-stop-id-input"
        type="text"
        class="input input-bordered w-full font-mono"
        value="${suggestedId}"
      />
      ${locationTypeSelect}
      <p class="text-xs opacity-60 mt-2">The Stop ID cannot be changed after creation.</p>
      ${parentInfo}
      <p id="stop-id-error" class="text-xs text-error mt-1 hidden"></p>
    `;

    const createStop = async (): Promise<boolean | void> => {
      const input = document.getElementById(
        'new-stop-id-input'
      ) as HTMLInputElement;
      const stopId = input.value.trim();
      const errorEl = document.getElementById('stop-id-error') as HTMLElement;

      if (!stopId) {
        errorEl.textContent = 'Stop ID is required.';
        errorEl.classList.remove('hidden');
        return true;
      }

      const stops =
        this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];
      if (stops.some((s) => s.stop_id === stopId)) {
        errorEl.textContent = 'Stop ID already exists.';
        errorEl.classList.remove('hidden');
        return true;
      }

      let locationType = 0;
      if (expandedStationId) {
        const typeSelect = document.getElementById(
          'new-stop-type-select'
        ) as HTMLSelectElement;
        locationType = parseInt(typeSelect?.value ?? '0', 10);
      }

      const newStop: Stops = {
        stop_id: stopId,
        stop_name: '',
        stop_lat: parseFloat(lat.toFixed(6)),
        stop_lon: parseFloat(lng.toFixed(6)),
        parent_station: expandedStationId ?? '',
        location_type: locationType,
      };

      console.log('Creating new stop:', newStop);

      try {
        await this.addStopToData(newStop);
        this.setMapMode(MapMode.NAVIGATE);
        if (this.callbacks.onStopClick) {
          this.callbacks.onStopClick(stopId);
        }
        console.log(
          `Created stop ${stopId} at ${lat.toFixed(6)}, ${lng.toFixed(6)}`
        );
      } catch (error) {
        console.error('Failed to create stop:', error);
        errorEl.textContent = 'Failed to create stop. See console for details.';
        errorEl.classList.remove('hidden');
        return true;
      }
    };

    showModal({
      title: expandedStationId ? 'New Child Stop' : 'New Stop',
      body: bodyHtml,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        {
          label: 'Cancel',
          onClick: () => {
            this.setMapMode(MapMode.NAVIGATE);
          },
        },
        { label: 'Create Stop', className: 'btn-primary', onClick: createStop },
      ],
      onMount: () => {
        const input = document.getElementById(
          'new-stop-id-input'
        ) as HTMLInputElement;
        input.focus();
        input.select();
      },
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
      const { notify } = await import('./notification-system.js');
      notify.info(`From: ${stop_id}. Now click the second stop to connect.`);
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
    const bodyHtml = `
      <div class="space-y-2">
        <div>
          <div class="label-text text-sm opacity-70 mb-1">From Stop</div>
          <div class="font-mono text-sm bg-base-200 px-3 py-2 rounded">${fromStopId}</div>
        </div>
        <div>
          <div class="label-text text-sm opacity-70 mb-1">To Stop</div>
          <div class="font-mono text-sm bg-base-200 px-3 py-2 rounded">${toStopId}</div>
        </div>
        <label class="form-control w-full">
          <div class="label"><span class="label-text">Pathway Mode</span></div>
          <select id="new-pathway-mode" class="select select-bordered select-sm w-full">
            <option value="1">1: Walkway</option>
            <option value="2">2: Stairs</option>
            <option value="3">3: Moving Sidewalk</option>
            <option value="4">4: Escalator</option>
            <option value="5">5: Elevator</option>
            <option value="6">6: Fare Gate</option>
            <option value="7">7: Exit Gate</option>
          </select>
        </label>
        <label class="label cursor-pointer justify-start gap-3">
          <input type="checkbox" id="new-pathway-bidirectional" class="checkbox checkbox-sm" checked />
          <span class="label-text">Bidirectional</span>
        </label>
        <p id="pathway-error" class="text-xs text-error hidden"></p>
      </div>
    `;

    const createPathway = async (): Promise<boolean | void> => {
      const modeSelect = document.getElementById(
        'new-pathway-mode'
      ) as HTMLSelectElement;
      const bidirEl = document.getElementById(
        'new-pathway-bidirectional'
      ) as HTMLInputElement;
      const errorEl = document.getElementById('pathway-error');

      const pathway_mode = parseInt(modeSelect.value, 10);
      const is_bidirectional = bidirEl.checked ? 1 : 0;

      if (pathway_mode === 7 && is_bidirectional === 1) {
        if (errorEl) {
          errorEl.textContent =
            'Exit gates (mode 7) must not be bidirectional.';
          errorEl.classList.remove('hidden');
        }
        return true;
      }

      const newPathway = {
        pathway_id: pathwayId,
        from_stop_id: fromStopId,
        to_stop_id: toStopId,
        pathway_mode,
        is_bidirectional,
      };

      try {
        await this.gtfsParser.createPathway(newPathway);
        this.setMapMode(MapMode.NAVIGATE);
        this.callbacks.onPathwayCreated?.(pathwayId);
        console.log(`Created pathway ${pathwayId}`);
      } catch (error) {
        console.error('Failed to create pathway:', error);
        if (errorEl) {
          errorEl.textContent = 'Failed to create pathway. See console.';
          errorEl.classList.remove('hidden');
        }
        return true;
      }
    };

    showModal({
      title: 'New Pathway',
      body: bodyHtml,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        {
          label: 'Cancel',
          onClick: () => {
            this.setMapMode(MapMode.NAVIGATE);
          },
        },
        {
          label: 'Create Pathway',
          className: 'btn-primary',
          onClick: createPathway,
        },
      ],
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

      // Also move the highlight circle so it follows the dragged stop
      const highlightSource = this.map.getSource('stops-highlight') as
        | GeoJSONSource
        | undefined;
      if (highlightSource) {
        const existingProps =
          (highlightSource as unknown as { _data: GeoJSON.FeatureCollection })
            ._data?.features?.[0]?.properties ?? {};
        highlightSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [e.lngLat.lng, e.lngLat.lat],
              },
              properties: existingProps,
            },
          ],
        });
      }
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

      const highlightSource = this.map.getSource('stops-highlight') as
        | GeoJSONSource
        | undefined;
      if (highlightSource) {
        const existingProps =
          (highlightSource as unknown as { _data: GeoJSON.FeatureCollection })
            ._data?.features?.[0]?.properties ?? {};
        highlightSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [e.lngLat.lng, e.lngLat.lat],
              },
              properties: existingProps,
            },
          ],
        });
      }
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
      previousMode === MapMode.ADD_PATHWAY &&
      newMode !== MapMode.ADD_PATHWAY
    ) {
      this.addPathwayFirstStopId = null;
    }
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
