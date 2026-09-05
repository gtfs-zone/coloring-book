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

import type { GTFSParser } from './gtfs-parser.js';
import { encodeGeojsonIoUrl } from '../utils/geojson-io.js';
import {
  attachGeojsonExchangeHandlers,
  pickFeatureById,
  renderGeojsonExchangeBlock,
} from './geojson-exchange.js';
import {
  getZoneFeature,
  getZoneFeatures,
  mergeZoneFeatures,
  writeZoneFeatures,
  zoneBounds,
  zoneVertexCount,
  type ZonePatchRecorder,
} from './zone-store.js';
import { notify } from './notification-system.js';
import { escapeHtml } from '../utils/escape-html.js';

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

  // A zone created from the On-Demand modal starts with no coordinates. Say so
  // loudly rather than showing an empty summary that reads as broken.
  const emptyWarning =
    zoneVertexCount(feature) === 0
      ? `<div class="alert alert-warning">
          <span>This zone has no geometry yet. Draw it in geojson.io or paste GeoJSON below.</span>
        </div>`
      : '';

  return `
    <div class="space-y-3 zone-geometry-section" data-location-id="${escapeHtml(location_id)}">
      ${emptyWarning}
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="opacity-60">Type</dt><dd class="font-mono">${escapeHtml(feature.geometry.type)}</dd>
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
    pick: (collection) => pickFeatureById(collection, location_id),
    prepare: (feature) => ({ ...feature, id: location_id }),
    onApply: async (edited) => {
      const current = getZoneFeatures(deps.gtfsParser);
      if (!current.some((f) => String(f.id) === location_id)) {
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
