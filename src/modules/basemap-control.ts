/**
 * Basemap control UI component using DaisyUI FAB and speed dial
 */

import { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { basemapStyles, getBasemapStyle } from './basemap-styles.js';

export class BasemapControl {
  private map: MapLibreMap;
  private container: HTMLElement | null = null;
  private currentBasemap: string = 'standard';
  private currentProjection: 'mercator' | 'globe' = 'globe';

  constructor(map: MapLibreMap) {
    this.map = map;
    this.createControl();

    // Apply initial globe projection
    this.applyInitialProjection();
  }

  /**
   * Apply initial globe projection to the map
   */
  private applyInitialProjection(): void {
    // Wait for map to be ready
    if (this.map.isStyleLoaded()) {
      this.applyProjectionToStyle();
    } else {
      this.map.once('load', () => {
        this.applyProjectionToStyle();
      });
    }
  }

  /**
   * Apply current projection to the map style
   */
  private applyProjectionToStyle(): void {
    const currentStyle = this.map.getStyle();
    if (!currentStyle) {
      return;
    }

    const newStyle = {
      ...currentStyle,
      projection:
        this.currentProjection === 'globe'
          ? { type: 'globe' }
          : { type: 'mercator' },
      sky:
        this.currentProjection === 'globe'
          ? {
              'sky-color': '#199EF3',
              'sky-horizon-blend': 0.5,
              'horizon-color': '#ffffff',
              'horizon-fog-blend': 0.5,
              'fog-color': '#0000ff',
              'fog-ground-blend': 0.5,
              'atmosphere-blend': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                1,
                10,
                1,
                12,
                0,
              ],
            }
          : undefined,
    };

    this.map.setStyle(newStyle as unknown as StyleSpecification);
  }

  /**
   * Create the basemap control UI
   */
  private createControl(): void {
    // Create container
    this.container = document.createElement('div');
    this.container.className = 'basemap-control';
    this.container.style.cssText = `
      position: absolute;
      bottom: 40px;
      right: 10px;
      display: flex;
      gap: 12px;
      align-items: flex-end;
      flex-direction: row;
      pointer-events: none;
    `;

    // Get current basemap
    const currentStyle = basemapStyles.find(
      (s) => s.id === this.currentBasemap
    );
    const otherStyles = basemapStyles.filter(
      (s) => s.id !== this.currentBasemap
    );

    // Create FAB structure with vertical labeled layout
    this.container.innerHTML = `
      <div class="fab">
        <!-- Main FAB button (shows current basemap) -->
        <div tabindex="0" role="button" class="btn btn-lg btn-circle btn-neutral basemap-fab-main">
          ${currentStyle?.icon || basemapStyles[0].icon}
        </div>

        <!-- Main Action button (appears when FAB is open) -->
        <button class="fab-main-action btn btn-circle btn-lg btn-neutral basemap-current" data-basemap="${this.currentBasemap}" title="${currentStyle?.name || 'Standard'}">
          ${currentStyle?.icon || basemapStyles[0].icon}
        </button>

        <!-- Other basemap buttons with labels -->
        ${otherStyles
          .map(
            (style) => `
          <div class="flex items-center gap-2">
            <span class="bg-base-100 text-base-content text-sm px-2 py-1 rounded-lg shadow whitespace-nowrap">${style.name}</span>
            <button class="btn btn-lg btn-circle btn-base-100 basemap-btn" data-basemap="${style.id}">
              ${style.icon}
            </button>
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Globe/flat projection toggle -->
      <label class="swap swap-rotate btn btn-lg btn-circle btn-neutral projection-swap" title="Toggle globe / flat projection" aria-label="Toggle globe / flat projection">
        <input type="checkbox" class="projection-toggle" ${this.currentProjection === 'globe' ? 'checked' : ''} />
        <!-- Globe icon (when checked) -->
        <svg class="swap-on w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <circle cx="12" cy="12" r="9" />
          <path stroke-linecap="round" d="M3 12h18" />
          <path d="M12 3a4.5 9 0 010 18a4.5 9 0 010-18" />
        </svg>
        <!-- Flat graticule icon (when unchecked) -->
        <svg class="swap-off w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path stroke-linecap="round" d="M9 5v14M15 5v14M3 9.667h18M3 14.333h18" />
        </svg>
      </label>
    `;

    // Add minimal custom styles
    const style = document.createElement('style');
    style.textContent = `
      .basemap-control .fab {
        position: relative;
        inset-inline-end: 0;
        bottom: auto;
        pointer-events: none;
      }

      .basemap-control .fab button,
      .basemap-control .fab [role="button"],
      .basemap-control .fab label {
        pointer-events: auto;
      }

      .basemap-control .projection-swap {
        flex-shrink: 0;
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);

    // Attach event listeners
    this.attachEventListeners();

    // Add to map container
    const mapContainer = this.map.getContainer();

    // Ensure map container has position relative for absolute positioning to work
    const computedStyle = window.getComputedStyle(mapContainer);
    if (computedStyle.position === 'static') {
      mapContainer.style.position = 'relative';
    }

    mapContainer.appendChild(this.container);
  }

  /**
   * Attach event listeners for basemap selection and projection toggle
   */
  private attachEventListeners(): void {
    if (!this.container) {
      return;
    }

    // Basemap selection buttons
    const basemapButtons = this.container.querySelectorAll('.basemap-btn');
    basemapButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const basemapId = (button as HTMLElement).getAttribute('data-basemap');
        if (basemapId) {
          this.changeBasemap(basemapId);
        }
      });
    });

    // Current basemap button (in center when FAB is open)
    const currentBtn = this.container.querySelector('.basemap-current');
    if (currentBtn) {
      currentBtn.addEventListener('click', () => {
        const basemapId = (currentBtn as HTMLElement).getAttribute(
          'data-basemap'
        );
        if (basemapId) {
          this.changeBasemap(basemapId);
        }
      });
    }

    // Projection toggle
    const projectionToggle = this.container.querySelector('.projection-toggle');
    if (projectionToggle) {
      projectionToggle.addEventListener('change', (e) => {
        const isGlobe = (e.target as HTMLInputElement).checked;
        this.changeProjection(isGlobe ? 'globe' : 'mercator');
      });
    }

    // Main FAB button (just for accessibility, opening is handled by CSS hover/focus)
    const mainFab = this.container.querySelector('.basemap-fab-main');
    if (mainFab) {
      mainFab.addEventListener('keydown', (e) => {
        if (
          (e as KeyboardEvent).key === 'Enter' ||
          (e as KeyboardEvent).key === ' '
        ) {
          (e.target as HTMLElement).focus();
        }
      });
    }
  }

  /**
   * Change the basemap style
   */
  private changeBasemap(basemapId: string): void {
    // Skip if already on this basemap
    if (basemapId === this.currentBasemap) {
      console.log(`Already on basemap: ${basemapId}`);
      return;
    }

    const basemapStyle = getBasemapStyle(basemapId);
    if (!basemapStyle) {
      console.error(`Basemap style not found: ${basemapId}`);
      return;
    }

    // Store current center and zoom
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const bearing = this.map.getBearing();
    const pitch = this.map.getPitch();

    // Apply projection and sky to the new basemap style
    const styleWithProjection = {
      ...basemapStyle.style,
      projection:
        this.currentProjection === 'globe'
          ? { type: 'globe' }
          : { type: 'mercator' },
      sky:
        this.currentProjection === 'globe'
          ? {
              'sky-color': '#199EF3',
              'sky-horizon-blend': 0.5,
              'horizon-color': '#ffffff',
              'horizon-fog-blend': 0.5,
              'fog-color': '#0000ff',
              'fog-ground-blend': 0.5,
              'atmosphere-blend': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                1,
                10,
                1,
                12,
                0,
              ],
            }
          : undefined,
    };

    // Set new style with projection
    this.map.setStyle(styleWithProjection as unknown as StyleSpecification);

    // Wait for style to load, then restore view and re-add layers
    this.map.once('styledata', () => {
      // Restore view
      this.map.setCenter(center);
      this.map.setZoom(zoom);
      this.map.setBearing(bearing);
      this.map.setPitch(pitch);

      console.log('Style loaded, firing basemap:changed event');

      // Trigger custom event for other modules to re-add their layers
      this.map.fire('basemap:changed', { basemapId });
    });

    // Update active state
    this.currentBasemap = basemapId;
    this.rebuildControl();

    console.log(`Basemap changed to: ${basemapStyle.name}`);
  }

  /**
   * Rebuild the control UI to reflect new basemap selection
   */
  private rebuildControl(): void {
    if (!this.container) {
      return;
    }

    // Store reference to parent
    const parent = this.container.parentNode;
    if (!parent) {
      return;
    }

    // Remove old container
    this.container.remove();

    // Create new control
    this.createControl();
  }

  /**
   * Change map projection (globe vs mercator)
   */
  private changeProjection(projection: 'mercator' | 'globe'): void {
    this.currentProjection = projection;

    // Store current view
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const bearing = this.map.getBearing();
    const pitch = this.map.getPitch();

    // Get current style
    const currentStyle = this.map.getStyle();
    if (!currentStyle) {
      return;
    }

    // Update projection and sky in style
    const newStyle = {
      ...currentStyle,
      projection:
        projection === 'globe' ? { type: 'globe' } : { type: 'mercator' },
      sky:
        projection === 'globe'
          ? {
              'sky-color': '#199EF3',
              'sky-horizon-blend': 0.5,
              'horizon-color': '#ffffff',
              'horizon-fog-blend': 0.5,
              'fog-color': '#0000ff',
              'fog-ground-blend': 0.5,
              'atmosphere-blend': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                1,
                10,
                1,
                12,
                0,
              ],
            }
          : undefined,
    };

    // Set new style with projection
    this.map.setStyle(newStyle as unknown as StyleSpecification);

    // Wait for style to load, then restore view
    this.map.once('styledata', () => {
      // Restore view
      this.map.setCenter(center);
      this.map.setZoom(zoom);
      this.map.setBearing(bearing);
      this.map.setPitch(pitch);

      console.log(`Projection changed to: ${projection}`);

      // Trigger event to re-add layers
      this.map.fire('basemap:changed', { projection });
    });
  }

  /**
   * Get current basemap ID
   */
  public getCurrentBasemap(): string {
    return this.currentBasemap;
  }

  /**
   * Programmatically set basemap
   */
  public setBasemap(basemapId: string): void {
    this.changeBasemap(basemapId);
  }

  /**
   * Remove the control from the map
   */
  public destroy(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }
}
