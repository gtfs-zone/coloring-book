import { Map as MapLibreMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import { Stops } from '../types/gtfs-entities.js';
import { MapMode } from './map-controller.js';
import type { GTFSParser } from './gtfs-parser.js';

export interface InteractionCallbacks {
  onRouteClick?: (route_id: string) => void;
  onStopClick?: (stop_id: string) => void;
  onModeChange?: (mode: MapMode) => void;
  onStopDragComplete?: (stop_id: string, lat: number, lng: number) => void;
  onStopCreated?: (stop_id: string) => void;
}

export class InteractionHandler {
  private map: MapLibreMap;
  private gtfsParser: GTFSParser;
  private callbacks: InteractionCallbacks = {};
  private currentMode: MapMode = MapMode.NAVIGATE;

  // Drag state
  private isDragging = false;
  private draggedStopId: string | null = null;

  // Local copy of stops GeoJSON for drag — avoids reading MapLibre's private _data
  private stopsGeoJSON: GeoJSON.FeatureCollection | null = null;

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

    // Mouse events for dragging (will be activated based on mode)
    this.map.on('mousedown', this.handleMouseDown.bind(this));
    this.map.on('mousemove', this.handleMouseMove.bind(this));
    this.map.on('mouseup', this.handleMouseUp.bind(this));
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
   * Handle navigation mode clicks (stops and routes)
   */
  private handleNavigationClick(e: MapMouseEvent): void {
    // Query features at click point, prioritizing stops over routes
    const stopFeatures = this.map.queryRenderedFeatures(e.point, {
      layers: ['stops-clickarea', 'stops-background'],
    });

    if (stopFeatures.length > 0) {
      // Handle stop click - this takes priority over routes
      const stopFeature = stopFeatures[0];
      const stop_id = stopFeature.properties?.stop_id;

      if (stop_id && this.callbacks.onStopClick) {
        console.log('clicked on stop', stop_id);
        this.callbacks.onStopClick(stop_id);
      }
      return; // Exit early to prevent route clicks
    }

    // If no stops found, check for route features
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
  }

  /**
   * Handle add stop mode clicks
   */
  private async handleAddStopClick(e: MapMouseEvent): Promise<void> {
    if (!this.gtfsParser) {
      console.error('Cannot add stop: GTFSParser not initialized');
      return;
    }

    const { lng, lat } = e.lngLat;

    try {
      // Generate unique stop ID
      const stops =
        this.gtfsParser.getFileDataSyncTyped<Stops>('stops.txt') || [];
      const stopIds = stops.map((stop) => stop.stop_id);
      let newStopId = `stop_${Date.now()}`;

      // Ensure uniqueness
      while (stopIds.includes(newStopId)) {
        newStopId = `stop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      }

      // Create new stop object
      const newStop: Stops = {
        stop_id: newStopId,
        stop_name: `New Stop ${stops.length + 1}`,
        stop_lat: parseFloat(lat.toFixed(6)),
        stop_lon: parseFloat(lng.toFixed(6)),
        parent_station: '',
        location_type: 0, // Default to stop/platform
      };

      console.log('Creating new stop:', newStop);

      // Add stop to data (this should trigger a callback to the main controller)
      await this.addStopToData(newStop);

      // Switch back to navigation mode
      this.setMapMode(MapMode.NAVIGATE);

      console.log(
        `✅ Created stop ${newStopId} at ${lat.toFixed(6)}, ${lng.toFixed(6)}`
      );
    } catch (error) {
      console.error('Failed to create stop:', error);
      // Keep in add mode if creation failed
    }
  }

  /**
   * Handle mouse down events (for dragging)
   */
  private handleMouseDown(e: MapMouseEvent): void {
    if (this.currentMode !== MapMode.EDIT_STOPS) {
      return;
    }

    const features = this.map.queryRenderedFeatures(e.point, {
      layers: ['stops-clickarea', 'stops-background'],
    });

    if (features.length === 0) {
      return;
    }

    e.preventDefault();
    const feature = features[0];
    this.draggedStopId = feature.properties?.stop_id;

    if (!this.draggedStopId) {
      return;
    }

    this.isDragging = true;
    this.map.getCanvas().style.cursor = 'grabbing';

    // Visual feedback for dragging
    this.setStopDragState(this.draggedStopId, true);
  }

  /**
   * Handle mouse move events (for dragging)
   */
  private handleMouseMove(e: MapMouseEvent): void {
    if (
      !this.isDragging ||
      !this.draggedStopId ||
      this.currentMode !== MapMode.EDIT_STOPS
    ) {
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
      case MapMode.EDIT_STOPS:
        canvas.style.cursor = this.isDragging ? 'grabbing' : 'move';
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
    // Clean up previous mode
    if (previousMode === MapMode.EDIT_STOPS) {
      this.disableStopDragging();
    }

    // Setup new mode
    if (newMode === MapMode.EDIT_STOPS) {
      this.enableStopDragging();
    }

    console.log(`🔄 Map mode changed: ${previousMode} → ${newMode}`);
  }

  /**
   * Enable stop dragging interactions
   */
  private enableStopDragging(): void {
    // Add hover effects for edit mode
    ['stops-background', 'stops-clickarea'].forEach((layerId) => {
      this.map.on('mouseenter', layerId, () => {
        if (this.currentMode === MapMode.EDIT_STOPS && !this.isDragging) {
          this.map.getCanvas().style.cursor = 'grab';
        }
      });

      this.map.on('mouseleave', layerId, () => {
        if (this.currentMode === MapMode.EDIT_STOPS && !this.isDragging) {
          this.map.getCanvas().style.cursor = 'move';
        }
      });
    });

    console.log('🎯 Stop dragging enabled');
  }

  /**
   * Disable stop dragging interactions
   */
  private disableStopDragging(): void {
    // Reset any dragging states
    if (this.isDragging && this.draggedStopId) {
      this.setStopDragState(this.draggedStopId, false);
      this.isDragging = false;
      this.draggedStopId = null;
    }

    // Remove hover effects
    ['stops-background', 'stops-clickarea'].forEach((layerId) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.map as any).off('mouseenter', layerId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.map as any).off('mouseleave', layerId);

      // Re-add standard hover effects
      this.map.on('mouseenter', layerId, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });

      this.map.on('mouseleave', layerId, () => {
        this.map.getCanvas().style.cursor = '';
      });
    });

    console.log('🚫 Stop dragging disabled');
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
   * Toggle between edit stops mode and navigation mode
   */
  public toggleEditStopsMode(): void {
    const newMode =
      this.currentMode === MapMode.EDIT_STOPS
        ? MapMode.NAVIGATE
        : MapMode.EDIT_STOPS;
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

    console.log('🧹 Interaction handler destroyed');
  }
}
