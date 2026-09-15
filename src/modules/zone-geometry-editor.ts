/**
 * Geometry block for an on-demand zone: a summary plus the shared geojson.io
 * exchange block, holding the stored GeoJSON as an editable textarea.
 *
 * Rendered as an HTML string plus an event-binding call, matching how the
 * other view controllers work, so the zone browse page can drop it in.
 *
 * The textarea holds *this zone's feature only* and every save merges
 * (`removeMissing=false`), so a round trip can never delete another zone.
 */

import type { GTFSParser } from './gtfs-parser';
import { encodeGeojsonIoUrl } from '../utils/geojson-io';
import {
  attachGeojsonExchangeHandlers,
  renderGeojsonExchangeBlock,
} from './geojson-exchange';
import {
  getZoneFeature,
  getZoneFeatures,
  hasZoneGeometry,
  mergeZoneFeatures,
  writeZoneFeatures,
  zoneBounds,
  zoneVertexCount,
  type ZonePatchRecorder,
} from './zone-store';
import { notify } from 'interlocking/modules/notification-system';
import { escapeHtml } from 'interlocking/utils/escape-html';

export interface ZoneGeometryDependencies {
  gtfsParser: GTFSParser;
  patchManager: ZonePatchRecorder | null;
  /** Called after a successful write, so the page can re-render. */
  onGeometryChanged?: (location_id: string) => void;
}

/** Scopes the exchange block's selectors to this zone. */
function exchangeId(location_id: string): string {
  return `zone-${location_id}`;
}

/** A polygonal geometry, i.e. one this zone can actually take. */
function isDrawn(feature: GeoJSON.Feature): boolean {
  const type = feature.geometry?.type;
  return type === 'Polygon' || type === 'MultiPolygon';
}

/**
 * Choose which feature of a pasted collection is this zone's geometry.
 *
 * An id match wins, but only when it carries a polygon: geojson.io returns the
 * feature it was handed with a null geometry and the shape the user drew as a
 * separate, id-less feature, and preferring the id match there would throw the
 * drawing away. So a lone drawn feature is adopted as this zone's geometry.
 */
export function pickZoneFeature(
  collection: GeoJSON.FeatureCollection,
  location_id: string
): GeoJSON.Feature {
  const byId = collection.features.find(
    (f) => String(f.id ?? '') === location_id
  );
  if (byId && isDrawn(byId)) {
    return byId;
  }
  const drawn = collection.features.filter(isDrawn);
  if (drawn.length === 1) {
    return drawn[0];
  }
  const described = collection.features
    .map((f) => `${String(f.id ?? '(no id)')}: ${String(f.geometry?.type)}`)
    .join(', ');
  throw new Error(
    `No polygon for zone "${location_id}" in the GeoJSON. Found: ${described || 'nothing'}.`
  );
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

  // geojson.io cannot draw a feature with no geometry: it drops the geometry
  // and hands back whatever was drawn as a new feature. Send it an empty
  // collection instead, so the user gets a blank map to draw on.
  const drawn = hasZoneGeometry(feature);
  const editUrl = await encodeGeojsonIoUrl({
    type: 'FeatureCollection',
    features: drawn ? [feature as GeoJSON.Feature] : [],
  });

  // The reference requires a geometry, so this is a feed the editor is being
  // used to repair. Say so loudly rather than showing an empty summary that
  // reads as broken.
  const emptyWarning = drawn
    ? ''
    : `<div class="alert alert-warning">
          <span>This zone has no geometry. Draw it in geojson.io or paste GeoJSON below.</span>
        </div>`;

  return `
    <div class="space-y-3 zone-geometry-section" data-location-id="${escapeHtml(location_id)}">
      ${emptyWarning}
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="opacity-60">Type</dt><dd class="font-mono">${escapeHtml(feature.geometry?.type ?? 'none')}</dd>
        <dt class="opacity-60">Vertices</dt><dd class="font-mono">${zoneVertexCount(feature)}</dd>
        <dt class="opacity-60">Bounds</dt><dd class="font-mono text-xs">${escapeHtml(boundsLabel)}</dd>
      </dl>
      ${renderGeojsonExchangeBlock({
        instanceId: exchangeId(location_id),
        featureJson: JSON.stringify(feature, null, 2),
        editUrl,
        title: 'Geometry',
        saveLabel: 'Save geometry',
      })}
    </div>
  `;
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

  attachGeojsonExchangeHandlers(section, {
    instanceId: exchangeId(location_id),
    logPrefix: `[ZoneGeometry] ${location_id}`,
    pick: (collection) => pickZoneFeature(collection, location_id),
    prepare: (feature) => ({ ...feature, id: location_id }),
    onApply: async (edited) => {
      const current = getZoneFeatures(deps.gtfsParser);
      if (!current.some((f) => String(f.id ?? '') === location_id)) {
        throw new Error(
          `Zone ${location_id} is no longer in locations.geojson. Reload the page.`
        );
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
    },
  });
}
