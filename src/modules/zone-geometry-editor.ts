/**
 * Geometry block for an on-demand zone: a summary, a handoff to geojson.io and
 * a paste box that brings the edited shape back.
 *
 * Rendered as an HTML string plus an event-binding call, matching how the
 * other view controllers work, so the zone browse page can drop it in.
 */

import type { GTFSParser } from './gtfs-parser.js';
import type { PatchManager } from './patch-manager.js';
import {
  encodeGeojsonIoUrl,
  parseGeojsonIoInput,
} from '../utils/geojson-io.js';
import {
  getZoneFeature,
  getZoneFeatures,
  mergeZoneFeatures,
  writeZoneFeatures,
  zoneBounds,
  zoneVertexCount,
} from './zone-store.js';
import { notify } from './notification-system.js';
import { escapeHtml } from '../utils/escape-html.js';

export interface ZoneGeometryDependencies {
  gtfsParser: GTFSParser;
  patchManager: PatchManager | null;
  /** Called after a successful write, so the page can re-render. */
  onGeometryChanged?: (location_id: string) => void;
}

/**
 * Summary + geojson.io handoff for one zone.
 *
 * Only this zone's feature is sent to geojson.io, so the write-back merges
 * rather than replacing the collection: a feature missing from the paste is
 * left alone, not deleted.
 */
export async function renderZoneGeometrySection(
  parser: GTFSParser,
  location_id: string
): Promise<string> {
  const feature = getZoneFeature(parser, location_id);
  if (!feature) {
    return `
      <div class="alert alert-warning">
        <span>No geometry found for zone ${escapeHtml(location_id)}.</span>
      </div>
    `;
  }

  const bounds = zoneBounds(feature);
  const boundsLabel = bounds
    ? `${bounds[1].toFixed(5)}, ${bounds[0].toFixed(5)} to ${bounds[3].toFixed(5)}, ${bounds[2].toFixed(5)}`
    : 'unknown';
  const editUrl = await encodeGeojsonIoUrl({
    type: 'FeatureCollection',
    features: [feature],
  });

  return `
    <div class="space-y-3 zone-geometry-section" data-location-id="${escapeHtml(location_id)}">
      <div class="flex items-center justify-between gap-2">
        <h3 class="font-semibold">Geometry</h3>
        <a href="${escapeHtml(editUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline">
          Edit in geojson.io
        </a>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="opacity-60">Type</dt><dd class="font-mono">${escapeHtml(feature.geometry.type)}</dd>
        <dt class="opacity-60">Vertices</dt><dd class="font-mono">${zoneVertexCount(feature)}</dd>
        <dt class="opacity-60">Bounds</dt><dd class="font-mono text-xs">${escapeHtml(boundsLabel)}</dd>
      </dl>
      <div class="space-y-2">
        <textarea class="textarea textarea-bordered w-full font-mono text-xs zone-geojson-input" rows="3"
          placeholder="Paste the geojson.io URL (or raw GeoJSON) to update this zone"></textarea>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-primary zone-geojson-apply">Apply geometry</button>
          <span class="text-xs text-error hidden zone-geojson-error"></span>
        </div>
      </div>
    </div>
  `;
}

/** Bind the paste box. Call once per render of the section above. */
export function attachZoneGeometryHandlers(
  container: HTMLElement,
  deps: ZoneGeometryDependencies
): void {
  const section = container.querySelector<HTMLElement>(
    '.zone-geometry-section'
  );
  if (!section) {
    return;
  }
  const location_id = section.dataset.locationId ?? '';
  const input = section.querySelector<HTMLTextAreaElement>(
    '.zone-geojson-input'
  );
  const button = section.querySelector<HTMLButtonElement>(
    '.zone-geojson-apply'
  );
  const errorEl = section.querySelector<HTMLElement>('.zone-geojson-error');
  if (!input || !button) {
    return;
  }

  const showError = (message: string): void => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
    console.warn(`[ZoneGeometry] ${location_id}: ${message}`);
  };

  button.addEventListener('click', async () => {
    errorEl?.classList.add('hidden');
    try {
      const collection = await parseGeojsonIoInput(input.value);
      // geojson.io drops the feature id, so a lone pasted feature is taken to
      // be this zone whatever id came back with it.
      const edited =
        collection.features.length === 1
          ? collection.features[0]
          : collection.features.find((f) => String(f.id ?? '') === location_id);
      if (!edited) {
        showError(`No feature with id "${location_id}" in the pasted GeoJSON.`);
        return;
      }

      const current = getZoneFeatures(deps.gtfsParser);
      if (!current.some((f) => String(f.id) === location_id)) {
        showError(
          `Zone ${location_id} is no longer in locations.geojson. Reload the page.`
        );
        return;
      }

      const merged = mergeZoneFeatures(
        current,
        [{ ...edited, id: location_id }],
        false
      );
      await writeZoneFeatures(
        deps.gtfsParser,
        deps.patchManager,
        merged.features
      );
      input.value = '';
      notify.success(`Updated geometry for zone ${location_id}`);
      deps.onGeometryChanged?.(location_id);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });
}
