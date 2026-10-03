/**
 * The route page's branching diagram: every trip of a route, in one strip per
 * direction.
 *
 * The timetable draws the same rail for a single service; this draws it for the
 * whole route, which is what makes the branches visible. The engine
 * (`route-sequence` / `route-graph` / `route-strip`) is shared with the
 * timetable and with gtfs-zone-rt-viewer, so all this module does is pick the data and
 * lay out the rows.
 *
 * Each row is a two-column grid: the rail cell, then the content. Row heights
 * are content-driven, which the rail SVG already handles by stretching a fixed
 * viewBox.
 */

import type { GTFSParser } from './gtfs-parser';
import { GTFSRouteSource } from './gtfs-route-source';
import { routeGraph } from 'gtfs-zone-web-common/gtfs/route-graph';
import type { RouteSequence } from 'gtfs-zone-web-common/gtfs/route-sequence';
import {
  directionsForRoute,
  routeSequence,
} from 'gtfs-zone-web-common/gtfs/route-sequence';
import {
  endpointNote,
  endpointThreshold,
  gutterWidth,
  isEndpoint,
  isMinority,
  railCell,
  renderCoverage,
  renderDirectionSections,
  rowPaths,
  STRIP_ROW_CLASS,
} from 'gtfs-zone-web-common/gtfs/route-strip';
import type { RowDot } from 'gtfs-zone-web-common/gtfs/route-strip';
import { GTFS_TABLES } from '../types/gtfs';
import type { Stops } from '../types/gtfs-entities';
import { getStopDisplay, renderCardLabel } from '../utils/entity-display';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { routeColor } from 'gtfs-zone-web-common/gtfs/route-colors';
import { t } from '../i18n/messages';

/**
 * Marks a diagram row. Carries either `data-stop-id` (opens the stop page) or
 * `data-flex-kind` + `data-flex-id` (opens the zone / location group page).
 */
export const ROUTE_DIAGRAM_ROW = 'route-diagram-row';

/** Facts about a stop that are worth reading off the strip. */
function statsNotes(sequence: RouteSequence, index: number): string {
  const stats = sequence.stopStats[index];
  const threshold = endpointThreshold(sequence.totalTrips);
  const notes: string[] = [];

  const ends = endpointNote(stats, threshold);
  if (ends) {
    notes.push(ends);
  }
  if (isMinority(stats, sequence.totalTrips)) {
    notes.push(
      t('map.servedBy', { serves: stats.serves, total: sequence.totalTrips })
    );
  }

  return notes
    .map(
      (note) =>
        `<span class="text-xs opacity-60 tabular-nums shrink-0">${escapeHtml(note)}</span>`
    )
    .join('');
}

function renderRow(
  source: GTFSRouteSource,
  sequence: RouteSequence,
  index: number,
  color: string,
  stopsById: Map<string, Stops>
): string {
  const graph = routeGraph(sequence);
  const stop = sequence.stops[index];
  const stats = sequence.stopStats[index];
  const threshold = endpointThreshold(sequence.totalTrips);
  const minority = isMinority(stats, sequence.totalTrips);

  const dot: RowDot = {
    kind: isEndpoint(stats, threshold) ? 'solid' : 'open',
    lane: graph.rows[index].lane,
  };
  const rail = railCell(
    color,
    graph.laneCount,
    rowPaths(graph, index, { kind: 'stop', leadIn: false, leadOut: false }),
    dot
  );

  // Flex rows reference a location group or an on-demand zone, which have no
  // stops.txt row and are deliberately kept out of getStopDisplay.
  const isStop = stop.ref.kind === 'stop';
  const row = isStop ? stopsById.get(stop.ref.id) : undefined;
  // Same badge wording as the timetable's flex name block, so a zone reads the
  // same in both views.
  const kindLabel =
    stop.ref.kind === 'location_group' ? t('tt.group') : t('tt.zone');
  const label = isStop
    ? renderCardLabel(
        getStopDisplay(
          (row ?? { stop_id: stop.ref.id }) as unknown as Record<string, string>
        )
      )
    : `<span class="badge badge-xs badge-info badge-outline shrink-0 mr-1">${kindLabel}</span>${escapeHtml(
        source.refName(stop.ref) ?? stop.ref.id
      )}`;
  const revisit =
    stop.occurrence > 0
      ? `<span class="opacity-50 text-xs ml-1">${t('tt.visit', { n: stop.occurrence + 1 })}</span>`
      : '';

  return `
    <div
      class="${STRIP_ROW_CLASS} ${ROUTE_DIAGRAM_ROW} grid gap-2 items-stretch cursor-pointer rounded hover:bg-base-200"
      style="grid-template-columns:${gutterWidth(graph.laneCount)}px 1fr"
      ${
        isStop
          ? `data-stop-id="${escapeHtml(stop.ref.id)}"`
          : `data-flex-kind="${escapeHtml(stop.ref.kind)}" data-flex-id="${escapeHtml(stop.ref.id)}"`
      }
      title="${t('map.servedByTitle', { serves: stats.serves, total: sequence.totalTrips })}"
    >
      ${rail}
      <div class="py-1 min-h-8 flex items-center gap-2 min-w-0 pr-2">
        <span class="flex-1 min-w-0 truncate text-sm ${minority ? 'opacity-60' : ''}">${label}${revisit}</span>
        ${statsNotes(sequence, index)}
      </div>
    </div>
  `;
}

function renderDirection(
  source: GTFSRouteSource,
  sequence: RouteSequence,
  color: string,
  stopsById: Map<string, Stops>
): string {
  if (sequence.stops.length === 0) {
    return '';
  }
  const rows = sequence.stops
    .map((_stop, index) => renderRow(source, sequence, index, color, stopsById))
    .join('');
  return `
    ${renderCoverage(sequence)}
    <div>${rows}</div>
  `;
}

/**
 * The whole diagram section, one strip per direction, over every trip of the
 * route regardless of service.
 *
 * Returns an empty string when the route has no trips with stop times, so the
 * caller can drop the section entirely rather than render an empty card.
 */
export function renderRouteDiagram(
  gtfsParser: GTFSParser,
  routeData: Record<string, string>
): string {
  const route_id = routeData.route_id;
  const source = new GTFSRouteSource(gtfsParser);
  const directions = directionsForRoute(source, route_id);
  if (directions.length === 0) {
    return '';
  }

  const stopsById = new Map<string, Stops>();
  for (const stop of gtfsParser.getFileDataSyncTyped<Stops>(
    GTFS_TABLES.STOPS
  )) {
    stopsById.set(String(stop.stop_id), stop);
  }

  const color = routeColor(route_id, routeData.route_color);
  const sections = renderDirectionSections(directions, (direction) =>
    renderDirection(
      source,
      // service_id omitted: the diagram covers every trip of the route.
      routeSequence(source, route_id, direction.direction_id),
      color,
      stopsById
    )
  );

  if (sections === '') {
    return '';
  }

  return `
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">${t('map.routeDiagram')}</h2>
      <div class="card bg-base-100 shadow-lg">
        <div class="card-body p-4 space-y-4">
          ${sections}
        </div>
      </div>
    </div>
  `;
}
