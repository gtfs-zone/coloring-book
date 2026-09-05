/**
 * Browse page for one on-demand zone (a locations.geojson feature).
 *
 * A zone has no CSV row, so there are no spec-driven property fields here: its
 * name and description live in the feature's properties and are edited by the
 * details form below, and its geometry goes through the geojson.io round trip
 * in `zone-geometry-editor`.
 */

import type { GTFSParser } from './gtfs-parser.js';
import { escapeHtml } from '../utils/escape-html.js';
import { getRouteDisplay, renderCardLabel } from '../utils/entity-display.js';
import { renderTrashIcon } from './modal-utils.js';
import { notify } from './notification-system.js';
import {
  attachZoneGeometryHandlers,
  renderZoneGeometrySection,
} from './zone-geometry-editor.js';
import {
  getZoneFeature,
  setZoneProperties,
  zoneDescription,
  zoneName,
  type ZoneFeature,
  type ZonePatchRecorder,
} from './zone-store.js';

/**
 * Own row class rather than the shared ROUTE_REF_ROW: the agency view
 * controller binds that class on every container it is handed, so reusing it
 * here would navigate twice per click.
 */
const ZONE_ROUTE_ROW = 'zone-route-row';

const DETAILS_FORM = 'zone-details-form';
const DELETE_BTN = 'zone-delete-btn';

export interface ZoneViewDependencies {
  gtfsParser?: GTFSParser;
  patchManager?: ZonePatchRecorder | null;
  /** Trips whose stop_times reference this zone. */
  getTripsForZone?: (location_id: string) => Array<Record<string, unknown>>;
  getRouteAsync?: (route_id: string) => Promise<unknown>;
  onRouteClick?: (route_id: string) => void;
  /** Re-render the page after the geometry is rewritten. */
  onGeometryChanged?: (location_id: string) => void;
  /** Re-render the page after the name or description is rewritten. */
  onPropertiesChanged?: (location_id: string) => void;
  /** Remove the zone, cascading to the stop_times that reference it. */
  onDeleteZone?: (location_id: string) => Promise<void>;
}

export class ZoneViewController {
  private dependencies: ZoneViewDependencies;

  constructor(dependencies: ZoneViewDependencies) {
    this.dependencies = dependencies;
  }

  async renderZoneView(location_id: string): Promise<string> {
    console.log('[ZoneViewController] Rendering zone view for:', location_id);

    const parser = this.dependencies.gtfsParser;
    if (!parser) {
      return this.renderError('Zone data is not available.');
    }

    try {
      const feature = getZoneFeature(parser, location_id);
      if (!feature) {
        return this.renderError(
          `Zone ${escapeHtml(location_id)} is not in locations.geojson.`
        );
      }

      const name = zoneName(feature) || location_id;
      const geometryHtml = await renderZoneGeometrySection(parser, location_id);
      const routesHtml = await this.renderRoutes(location_id);

      return `
        <div class="p-4 space-y-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold">${escapeHtml(name)}</h2>
              <div class="text-xs opacity-60 font-mono">${escapeHtml(location_id)}</div>
              <div class="badge badge-sm badge-outline mt-1">On-demand zone</div>
            </div>
            <button type="button" class="btn btn-sm btn-error btn-outline ${DELETE_BTN}"
              data-location-id="${escapeHtml(location_id)}" title="Delete zone">
              ${renderTrashIcon()}
            </button>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              ${this.renderDetails(location_id, feature)}
            </div>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              ${geometryHtml}
            </div>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4 space-y-2">
              <h3 class="font-semibold">Routes serving this zone</h3>
              ${routesHtml}
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.error('[ZoneViewController] Error rendering zone view:', error);
      return this.renderError('Failed to load zone information.');
    }
  }

  /**
   * Name and description, the only two properties the flex reference gives a
   * locations.geojson feature. Save stays disabled until a value changes, the
   * same contract as the geometry block below it.
   */
  private renderDetails(location_id: string, feature: ZoneFeature): string {
    const name = zoneName(feature);
    const description = zoneDescription(feature);
    return `
      <div class="space-y-3 ${DETAILS_FORM}" data-location-id="${escapeHtml(location_id)}">
        <h3 class="font-semibold">Details</h3>
        <fieldset class="fieldset">
          <label class="label" for="zone-name-input">Name</label>
          <input id="zone-name-input" class="input w-full zone-name-input" type="text"
            placeholder="e.g. North service area" value="${escapeHtml(name)}" />
          <label class="label" for="zone-desc-input">Description</label>
          <input id="zone-desc-input" class="input w-full zone-desc-input" type="text"
            placeholder="Optional" value="${escapeHtml(description)}" />
        </fieldset>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-sm btn-primary zone-details-save" disabled>Save details</button>
          <span class="text-xs text-error hidden zone-details-error"></span>
        </div>
      </div>
    `;
  }

  /** Trips referencing the zone, collapsed to one row per route. */
  private async renderRoutes(location_id: string): Promise<string> {
    const trips = this.dependencies.getTripsForZone?.(location_id) ?? [];
    if (trips.length === 0) {
      return `<p class="text-sm opacity-60">No stop_times reference this zone.</p>`;
    }

    const counts = new Map<string, number>();
    for (const trip of trips) {
      const route_id = String(trip.route_id ?? '');
      if (route_id === '') {
        continue;
      }
      counts.set(route_id, (counts.get(route_id) ?? 0) + 1);
    }

    const rows: string[] = [];
    for (const [route_id, count] of counts) {
      const route = (await this.dependencies.getRouteAsync?.(route_id)) as
        | Record<string, string>
        | null
        | undefined;
      const label = route
        ? renderCardLabel(getRouteDisplay(route))
        : `<span class="font-mono">${escapeHtml(route_id)}</span>`;
      rows.push(`
        <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${ZONE_ROUTE_ROW}" data-route-id="${escapeHtml(route_id)}">
          <div class="flex-1 min-w-0">${label}</div>
          <div class="badge badge-outline badge-sm">${count} trip${count !== 1 ? 's' : ''}</div>
        </div>
      `);
    }
    return rows.join('');
  }

  addEventListeners(container: HTMLElement): void {
    const parser = this.dependencies.gtfsParser;
    if (parser) {
      attachZoneGeometryHandlers(container, {
        gtfsParser: parser,
        patchManager: this.dependencies.patchManager ?? null,
        onGeometryChanged: (location_id) =>
          this.dependencies.onGeometryChanged?.(location_id),
      });
      this.attachDetailsHandlers(container, parser);
    }

    container
      .querySelector<HTMLButtonElement>(`.${DELETE_BTN}`)
      ?.addEventListener('click', (event) => {
        const location_id =
          (event.currentTarget as HTMLElement).dataset.locationId ?? '';
        if (location_id) {
          void this.dependencies.onDeleteZone?.(location_id);
        }
      });

    if (!this.dependencies.onRouteClick) {
      return;
    }
    container.querySelectorAll(`.${ZONE_ROUTE_ROW}`).forEach((row) => {
      row.addEventListener('click', () => {
        const route_id = row.getAttribute('data-route-id');
        if (route_id) {
          this.dependencies.onRouteClick!(route_id);
        }
      });
    });
  }

  private attachDetailsHandlers(
    container: HTMLElement,
    parser: GTFSParser
  ): void {
    const form = container.querySelector<HTMLElement>(`.${DETAILS_FORM}`);
    if (!form) {
      return;
    }
    const location_id = form.dataset.locationId ?? '';
    const nameInput = form.querySelector<HTMLInputElement>('.zone-name-input');
    const descInput = form.querySelector<HTMLInputElement>('.zone-desc-input');
    const saveButton =
      form.querySelector<HTMLButtonElement>('.zone-details-save');
    const errorEl = form.querySelector<HTMLElement>('.zone-details-error');
    if (!nameInput || !descInput || !saveButton) {
      return;
    }

    // defaultValue is what was rendered, so Save stays disabled until the user
    // actually changes something.
    const syncSaveState = (): void => {
      saveButton.disabled =
        nameInput.value === nameInput.defaultValue &&
        descInput.value === descInput.defaultValue;
    };
    for (const input of [nameInput, descInput]) {
      input.addEventListener('input', () => {
        errorEl?.classList.add('hidden');
        syncSaveState();
      });
    }

    saveButton.addEventListener('click', async () => {
      errorEl?.classList.add('hidden');
      try {
        await setZoneProperties(
          parser,
          this.dependencies.patchManager ?? null,
          location_id,
          {
            stop_name: nameInput.value.trim(),
            stop_desc: descInput.value.trim(),
          }
        );
        notify.success(`Updated zone ${location_id}`);
        this.dependencies.onPropertiesChanged?.(location_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (errorEl) {
          errorEl.textContent = message;
          errorEl.classList.remove('hidden');
        }
        console.warn(`[ZoneViewController] ${location_id}: ${message}`);
      }
    });
  }

  private renderError(message: string): string {
    return `
      <div class="alert alert-error m-4">
        <span>${message}</span>
      </div>
    `;
  }
}
