import {
  Map as MapLibreMap,
  GeoJSONSource,
  MapMouseEvent,
  MapTouchEvent,
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

  // Local copy of stops GeoJSON for drag — avoids reading MapLibre's private _data
  private stopsGeoJSON: GeoJSON.FeatureCollection | null = null;

  // Callback to retrieve the currently expanded station id from MapController
  private getExpandedStationId: (() => string | null) | null = null;

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

    // Always-on hover handlers for stop layers — show grab cursor on highlighted stop
    ['stops-background', 'stops-clickarea'].forEach((layerId) => {
      this.map.on('mouseenter', layerId, (e) => {
        const features = this.map.queryRenderedFeatures(e.point, {
          layers: [layerId],
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

      this.map.on('mouseleave', layerId, () => {
        if (!this.isDragging) {
          this.updateCursor(this.currentMode);
        }
      });
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
      case MapMode.NAVIGATE:
      default:
        this.handleNavigationClick(e);
        break;
    }
  }

  /**
   * Handle navigation mode clicks (stops, pathways, and routes)
   */
  private handleNavigationClick(e: MapMouseEvent): void {
    // Query features at click point, prioritizing stops over pathways over routes
    const stopFeatures = this.map.queryRenderedFeatures(e.point, {
      layers: ['stops-clickarea', 'stops-background'],
    });

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
    const pathwayFeatures = this.map.queryRenderedFeatures(e.point, {
      layers: ['pathways-clickarea', 'pathways-lines'],
    });

    if (pathwayFeatures.length > 0) {
      const pathway_id = pathwayFeatures[0].properties?.pathway_id;
      if (pathway_id && this.callbacks.onPathwayClick) {
        console.log('clicked on pathway', pathway_id);
        this.callbacks.onPathwayClick(pathway_id);
      }
      return;
    }

    // If no stops or pathways found, check for route features
    const routeFeatures = this.map.queryRenderedFeatures(e.point, {
      layers: ['routes-clickarea', 'routes-background'],
    });

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
          <option value="0">0 — Platform (stop within a station)</option>
          <option value="2">2 — Entrance / Exit</option>
          <option value="3">3 — Generic Node</option>
          <option value="4">4 — Boarding Area</option>
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
          `✅ Created stop ${stopId} at ${lat.toFixed(6)}, ${lng.toFixed(6)}`
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
   * Handle mouse down events (for dragging)
   */
  private handleMouseDown(e: MapMouseEvent): void {
    if (this.currentMode !== MapMode.NAVIGATE) {
      return;
    }

    const features = this.map.queryRenderedFeatures(e.point, {
      layers: ['stops-clickarea', 'stops-background'],
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
      layers: ['stops-clickarea', 'stops-background'],
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
    console.log(`🔄 Map mode changed: ${previousMode} → ${newMode}`);
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

    console.log('🧹 Interaction handler destroyed');
  }
}
