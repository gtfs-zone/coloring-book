/**
 * Geometry block for an on-demand zone: a summary, the stored GeoJSON as an
 * editable textarea, and two side doors into it (geojson.io and a URL import).
 *
 * Rendered as an HTML string plus an event-binding call, matching how the
 * other view controllers work, so the zone browse page can drop it in.
 *
 * The textarea holds *this zone's feature only* and every save merges
 * (`removeMissing=false`), so a round trip can never delete another zone.
 */

import type { GTFSParser } from './gtfs-parser.js';
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
  type ZonePatchRecorder,
} from './zone-store.js';
import {
  describeHttpError,
  describeNetworkError,
  maybeProxy,
} from './feed-selection.js';
import { showModal } from './modal-utils.js';
import { notify } from './notification-system.js';
import { escapeHtml } from '../utils/escape-html.js';

export interface ZoneGeometryDependencies {
  gtfsParser: GTFSParser;
  patchManager: ZonePatchRecorder | null;
  /** Called after a successful write, so the page can re-render. */
  onGeometryChanged?: (location_id: string) => void;
}

/** Summary, GeoJSON editor and geojson.io handoff for one zone. */
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
        <div class="flex items-center gap-2">
          <button class="btn btn-xs btn-outline zone-geojson-import">Import from URL</button>
          <a href="${escapeHtml(editUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline">
            Edit in geojson.io
          </a>
        </div>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="opacity-60">Type</dt><dd class="font-mono">${escapeHtml(feature.geometry.type)}</dd>
        <dt class="opacity-60">Vertices</dt><dd class="font-mono">${zoneVertexCount(feature)}</dd>
        <dt class="opacity-60">Bounds</dt><dd class="font-mono text-xs">${escapeHtml(boundsLabel)}</dd>
      </dl>
      <div class="space-y-2">
        <textarea class="textarea textarea-bordered w-full font-mono text-xs resize-y zone-geojson-input"
          rows="14" spellcheck="false">${escapeHtml(JSON.stringify(feature, null, 2))}</textarea>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-primary zone-geojson-apply" disabled>Save geometry</button>
          <span class="text-xs text-error hidden zone-geojson-error"></span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Pick the feature that represents this zone out of a parsed collection.
 *
 * An id match wins. Failing that a lone feature is taken to be this zone,
 * because geojson.io drops the feature id on the way back.
 */
function pickZoneFeature(
  collection: GeoJSON.FeatureCollection,
  location_id: string
): GeoJSON.Feature {
  const byId = collection.features.find(
    (f) => String(f.id ?? '') === location_id
  );
  if (byId) {
    return byId;
  }
  if (collection.features.length === 1) {
    return collection.features[0];
  }
  const ids = collection.features
    .map((f) => String(f.id ?? '(no id)'))
    .join(', ');
  throw new Error(
    `No feature with id "${location_id}" in the GeoJSON. Found: ${ids || 'nothing'}.`
  );
}

/** Accept a bare Feature or a FeatureCollection and return the zone's feature. */
function readEditedFeature(text: string, location_id: string): GeoJSON.Feature {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('The editor is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    // The SyntaxError message already carries the character offset.
    throw new Error(
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const value = parsed as { type?: unknown };
  if (value?.type === 'Feature') {
    return parsed as GeoJSON.Feature;
  }
  if (value?.type === 'FeatureCollection') {
    const collection = parsed as GeoJSON.FeatureCollection;
    if (!Array.isArray(collection.features)) {
      throw new Error('FeatureCollection has no features array.');
    }
    return pickZoneFeature(collection, location_id);
  }
  throw new Error(
    `Expected a GeoJSON Feature or FeatureCollection, got ${JSON.stringify(value?.type ?? null)}.`
  );
}

/** Ask for a URL to import from, with the CORS proxy toggle the loader uses. */
async function promptForUrl(): Promise<{
  url: string;
  useCors: boolean;
} | null> {
  let result: { url: string; useCors: boolean } | null = null;
  let urlInput: HTMLInputElement | null = null;
  let corsInput: HTMLInputElement | null = null;

  await showModal({
    title: 'Import geometry from URL',
    body: `
      <div class="space-y-3">
        <p class="text-sm opacity-70">
          Fetch a GeoJSON file (or a geojson.io link) and load it into the editor.
          Nothing is saved until you press Save geometry.
        </p>
        <input type="url" class="input input-bordered w-full font-mono text-xs zone-import-url"
          placeholder="https://example.org/zones.geojson" />
        <label class="label cursor-pointer justify-start gap-2">
          <input type="checkbox" class="checkbox checkbox-sm zone-import-cors" checked />
          <span class="label-text">Use CORS proxy</span>
        </label>
      </div>
    `,
    actions: [
      { label: 'Cancel', onClick: () => {} },
      {
        label: 'Fetch',
        className: 'btn-primary',
        onClick: () => {
          const url = urlInput?.value.trim() ?? '';
          if (url) {
            result = { url, useCors: corsInput?.checked ?? false };
          }
        },
      },
    ],
    enterAction: 1,
    escapeAction: 0,
    onMount: () => {
      urlInput = document.querySelector<HTMLInputElement>('.zone-import-url');
      corsInput = document.querySelector<HTMLInputElement>('.zone-import-cors');
      urlInput?.focus();
    },
  });

  return result;
}

/** Bind the geometry editor. Call once per render of the section above. */
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
  const saveButton = section.querySelector<HTMLButtonElement>(
    '.zone-geojson-apply'
  );
  const importButton = section.querySelector<HTMLButtonElement>(
    '.zone-geojson-import'
  );
  const errorEl = section.querySelector<HTMLElement>('.zone-geojson-error');
  if (!input || !saveButton) {
    return;
  }

  const showError = (message: string): void => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
    console.warn(`[ZoneGeometry] ${location_id}: ${message}`);
  };

  const clearError = (): void => {
    errorEl?.classList.add('hidden');
  };

  // defaultValue is the JSON that was rendered into the textarea, so Save stays
  // disabled until the user (or an import) actually changes something.
  const syncSaveState = (): void => {
    saveButton.disabled = input.value === input.defaultValue;
  };

  input.addEventListener('input', () => {
    clearError();
    syncSaveState();
  });

  importButton?.addEventListener('click', async () => {
    clearError();
    const target = await promptForUrl();
    if (!target) {
      return;
    }
    const fetchUrl = maybeProxy(target.url, target.useCors);
    try {
      let response: Response;
      try {
        response = await fetch(fetchUrl);
      } catch (error) {
        showError(describeNetworkError(fetchUrl, error));
        return;
      }
      const body = await response.text();
      if (!response.ok) {
        showError(
          describeHttpError(
            fetchUrl,
            response.status,
            response.statusText,
            body
          )
        );
        return;
      }

      // parseGeojsonIoInput accepts raw GeoJSON and a geojson.io URL alike, so
      // a link file or a redirect page body both work here.
      const collection = await parseGeojsonIoInput(body);
      const feature = pickZoneFeature(collection, location_id);
      input.value = JSON.stringify({ ...feature, id: location_id }, null, 2);
      syncSaveState();
      console.log(
        `[ZoneGeometry] ${location_id}: loaded geometry from ${target.url}`
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  saveButton.addEventListener('click', async () => {
    clearError();
    try {
      const edited = readEditedFeature(input.value, location_id);

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
      notify.success(`Updated geometry for zone ${location_id}`);
      deps.onGeometryChanged?.(location_id);
    } catch (error) {
      // Leave the textarea alone on failure: the user's edit is the only copy.
      showError(error instanceof Error ? error.message : String(error));
    }
  });
}
