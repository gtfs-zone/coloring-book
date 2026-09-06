/**
 * Shared geojson.io exchange block: the stored GeoJSON as an editable
 * textarea, a link out to geojson.io, and a URL import.
 *
 * Rendered as an HTML string plus an event-binding call, matching how the view
 * controllers work, so any page or modal can drop it in. What the block holds
 * is caller-defined: a zone's polygon feature, a shape's line feature.
 */

import {
  isEncodedGeojsonIoUrl,
  parseGeojsonIoInput,
} from '../utils/geojson-io.js';
import {
  describeHttpError,
  describeNetworkError,
  maybeProxy,
} from './feed-selection.js';
import { showModal } from './modal-utils.js';
import { escapeHtml } from '../utils/escape-html.js';

/** Chooses which feature of a pasted collection the caller meant. */
export type FeaturePicker = (
  collection: GeoJSON.FeatureCollection
) => GeoJSON.Feature;

/**
 * Pick a feature out of a parsed collection by id.
 *
 * An id match wins. Failing that a lone feature is taken to be the one,
 * because geojson.io drops the feature id on the way back.
 */
export function pickFeatureById(
  collection: GeoJSON.FeatureCollection,
  id: string
): GeoJSON.Feature {
  const byId = collection.features.find((f) => String(f.id ?? '') === id);
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
    `No feature with id "${id}" in the GeoJSON. Found: ${ids || 'nothing'}.`
  );
}

/** Picker for a paste with no id to match on: accepts a lone feature only. */
export function pickLoneFeature(
  collection: GeoJSON.FeatureCollection
): GeoJSON.Feature {
  if (collection.features.length === 1) {
    return collection.features[0];
  }
  throw new Error(
    `Expected one feature, got ${collection.features.length}. Keep only the one you want.`
  );
}

/**
 * Accept a pasted geojson.io link, a bare Feature or a FeatureCollection and
 * return one feature. The link carries its payload inline, so it is decoded
 * here rather than fetched: geojson.io itself only serves its app HTML.
 */
export async function readIncomingFeature(
  text: string,
  pick: FeaturePicker
): Promise<GeoJSON.Feature> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('The editor is empty.');
  }

  if (isEncodedGeojsonIoUrl(trimmed)) {
    return pick(await parseGeojsonIoInput(trimmed));
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
    return pick(collection);
  }
  throw new Error(
    `Expected a GeoJSON Feature or FeatureCollection, got ${JSON.stringify(value?.type ?? null)}.`
  );
}

/** Ask for a URL to import from, with the CORS proxy toggle the loader uses. */
export async function promptForGeojsonUrl(): Promise<{
  url: string;
  useCors: boolean;
} | null> {
  let result: { url: string; useCors: boolean } | null = null;
  let urlInput: HTMLInputElement | null = null;
  let corsInput: HTMLInputElement | null = null;

  await showModal({
    title: 'Import GeoJSON from URL',
    body: `
      <div class="space-y-3">
        <p class="text-sm opacity-70">
          Paste a geojson.io share link, or the URL of a GeoJSON file to fetch.
          Nothing is saved until you press Save.
        </p>
        <fieldset class="fieldset">
          <label class="label" for="geojson-import-url">URL</label>
          <input id="geojson-import-url" type="text"
            class="input input-bordered w-full font-mono text-xs geojson-import-url"
            placeholder="https://geojson.io/?data=gz:... or https://example.org/shape.geojson" />
        </fieldset>
        <label class="label cursor-pointer justify-start gap-2">
          <input type="checkbox" class="checkbox checkbox-sm geojson-import-cors" checked />
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
      urlInput = document.querySelector<HTMLInputElement>(
        '.geojson-import-url'
      );
      corsInput = document.querySelector<HTMLInputElement>(
        '.geojson-import-cors'
      );
      urlInput?.focus();
    },
  });

  return result;
}

/**
 * Fetch a URL and return the feature it carries.
 *
 * A geojson.io link carries the whole collection in its own URL. Fetching it
 * would only return the geojson.io app HTML, and the URL is long enough that a
 * CORS proxy may reject it outright, so it is decoded here instead.
 *
 * @returns the feature, or an error message to show the user.
 */
async function fetchIncomingFeature(
  target: { url: string; useCors: boolean },
  pick: FeaturePicker
): Promise<{ feature: GeoJSON.Feature } | { error: string }> {
  if (isEncodedGeojsonIoUrl(target.url)) {
    return { feature: pick(await parseGeojsonIoInput(target.url)) };
  }

  const fetchUrl = maybeProxy(target.url, target.useCors);
  let response: Response;
  try {
    response = await fetch(fetchUrl);
  } catch (error) {
    return { error: describeNetworkError(fetchUrl, error) };
  }
  const body = await response.text();
  if (!response.ok) {
    return {
      error: describeHttpError(
        fetchUrl,
        response.status,
        response.statusText,
        body
      ),
    };
  }

  // parseGeojsonIoInput accepts raw GeoJSON and a geojson.io URL alike, so a
  // link file or a redirect page body both work here.
  return { feature: pick(await parseGeojsonIoInput(body)) };
}

export interface GeojsonExchangeBlockOptions {
  /** Scopes the block's selectors, so two can share a page. */
  instanceId: string;
  /** Pretty-printed JSON to seed the textarea with. Empty for a paste box. */
  featureJson: string;
  /** geojson.io link to open. Omitted when there is nothing to hand over yet. */
  editUrl?: string;
  /** Heading shown to the left of the buttons. */
  title?: string;
  /** Explanatory line under the textarea. */
  hint?: string;
  /** Label of the in-block save button. Omitted when the modal owns saving. */
  saveLabel?: string;
  placeholder?: string;
  rows?: number;
}

const DEFAULT_HINT =
  'To pull an edit back in, use Share in geojson.io and paste the link here. ' +
  'geojson.io no longer keeps the data in the address bar while you draw.';

/** Markup for the exchange block. Pair with `attachGeojsonExchangeHandlers`. */
export function renderGeojsonExchangeBlock(
  options: GeojsonExchangeBlockOptions
): string {
  const id = escapeHtml(options.instanceId);
  const editLink = options.editUrl
    ? `<a href="${escapeHtml(options.editUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline">
         Edit in geojson.io
       </a>`
    : '';
  const saveButton = options.saveLabel
    ? `<div class="flex items-center gap-2">
         <button class="btn btn-sm btn-primary geojson-exchange-apply" disabled>${escapeHtml(options.saveLabel)}</button>
         <span class="text-xs text-error hidden geojson-exchange-error"></span>
       </div>`
    : `<span class="text-xs text-error hidden geojson-exchange-error"></span>`;

  return `
    <div class="space-y-3 geojson-exchange" data-exchange-id="${id}">
      <div class="flex items-center justify-between gap-2">
        <div>${options.title ? `<h3 class="font-semibold">${escapeHtml(options.title)}</h3>` : ''}</div>
        <div class="flex items-center gap-2">
          <button class="btn btn-xs btn-outline geojson-exchange-import">Import from URL</button>
          ${editLink}
        </div>
      </div>
      <div class="space-y-2">
        <textarea class="textarea textarea-bordered w-full font-mono text-xs resize-y geojson-exchange-input"
          rows="${options.rows ?? 14}" spellcheck="false"
          placeholder="${escapeHtml(options.placeholder ?? '')}">${escapeHtml(options.featureJson)}</textarea>
        ${saveButton}
        <p class="text-xs opacity-60">${escapeHtml(options.hint ?? DEFAULT_HINT)}</p>
      </div>
    </div>
  `;
}

export interface GeojsonExchangeHandlerOptions {
  instanceId: string;
  /** Which feature of a pasted collection this block is about. */
  pick: FeaturePicker;
  /** Applied to an imported feature before it lands in the textarea. */
  prepare?: (feature: GeoJSON.Feature) => GeoJSON.Feature;
  /**
   * Save. Throw to report the failure inline; the textarea is left alone
   * either way, because the user's edit is the only copy.
   */
  onApply?: (feature: GeoJSON.Feature) => Promise<void>;
  /** Prefix for console messages, e.g. `[ZoneGeometry] zone_1`. */
  logPrefix: string;
}

/** The block's textarea, for a modal that owns its own confirm button. */
export function geojsonExchangeInput(
  container: ParentNode,
  instanceId: string
): HTMLTextAreaElement | null {
  return container.querySelector<HTMLTextAreaElement>(
    `.geojson-exchange[data-exchange-id="${instanceId}"] .geojson-exchange-input`
  );
}

/** Bind the exchange block. Call once per render of the markup above. */
export function attachGeojsonExchangeHandlers(
  container: ParentNode,
  options: GeojsonExchangeHandlerOptions
): void {
  const block = container.querySelector<HTMLElement>(
    `.geojson-exchange[data-exchange-id="${options.instanceId}"]`
  );
  if (!block) {
    return;
  }
  const input = block.querySelector<HTMLTextAreaElement>(
    '.geojson-exchange-input'
  );
  const saveButton = block.querySelector<HTMLButtonElement>(
    '.geojson-exchange-apply'
  );
  const importButton = block.querySelector<HTMLButtonElement>(
    '.geojson-exchange-import'
  );
  const errorEl = block.querySelector<HTMLElement>('.geojson-exchange-error');
  if (!input) {
    return;
  }

  const showError = (message: string): void => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
    console.warn(`${options.logPrefix}: ${message}`);
  };

  const clearError = (): void => {
    errorEl?.classList.add('hidden');
  };

  // defaultValue is the JSON that was rendered into the textarea, so Save stays
  // disabled until the user (or an import) actually changes something.
  const syncSaveState = (): void => {
    if (saveButton) {
      saveButton.disabled = input.value === input.defaultValue;
    }
  };

  input.addEventListener('input', () => {
    clearError();
    syncSaveState();
  });

  importButton?.addEventListener('click', async () => {
    clearError();
    const target = await promptForGeojsonUrl();
    if (!target) {
      return;
    }
    try {
      const result = await fetchIncomingFeature(target, options.pick);
      if ('error' in result) {
        showError(result.error);
        return;
      }
      const feature = options.prepare
        ? options.prepare(result.feature)
        : result.feature;
      input.value = JSON.stringify(feature, null, 2);
      syncSaveState();
      console.log(`${options.logPrefix}: loaded GeoJSON from ${target.url}`);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  if (saveButton && options.onApply) {
    const onApply = options.onApply;
    saveButton.addEventListener('click', async () => {
      clearError();
      try {
        await onApply(await readIncomingFeature(input.value, options.pick));
      } catch (error) {
        // Leave the textarea alone on failure: the user's edit is the only copy.
        showError(error instanceof Error ? error.message : String(error));
      }
    });
  }
}

/** Show a message in the block's error slot, for a modal that owns saving. */
export function showGeojsonExchangeError(
  container: ParentNode,
  instanceId: string,
  message: string
): void {
  const errorEl = container.querySelector<HTMLElement>(
    `.geojson-exchange[data-exchange-id="${instanceId}"] .geojson-exchange-error`
  );
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
}
