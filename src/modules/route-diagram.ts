/**
 * The route page's branching diagram: every trip of a route, in one strip per
 * direction.
 *
 * The timetable draws the same rail for a single service; this draws it for the
 * whole route, which is what makes the branches visible. The engine
 * (`route-sequence` / `route-graph` / `route-strip`) is shared with the
 * timetable and with test-track, so all this module does is pick the data and
 * lay out the rows.
 *
 * Each row is a two-column grid: the rail cell, then the content. Row heights
 * are content-driven, which the rail SVG already handles by stretching a fixed
 * viewBox.
 */

import type { GTFSParser } from './gtfs-parser';
import { GTFSRouteSource } from './gtfs-route-source';
import { routeGraph } from 'interlocking/modules/route-graph';
import type { RouteSequence } from 'interlocking/modules/route-sequence';
import {
  directionsForRoute,
  routeSequence,
} from 'interlocking/modules/route-sequence';
import {
  endpointNote,
  endpointThreshold,
  gutterWidth,
  isEndpoint,
  isMinority,
  railCell,
  rowPaths,
  STRIP_ROW_CLASS,
} from 'interlocking/modules/route-strip';
import type { RowDot } from 'interlocking/modules/route-strip';
import { GTFS_TABLES } from '../types/gtfs';
import type { Stops } from '../types/gtfs-entities';
import { getStopDisplay, renderCardLabel } from '../utils/entity-display';
import { escapeHtml } from 'interlocking/utils/escape-html';
import { routeColor } from 'interlocking/utils/route-colors';

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
    notes.push(`${stats.serves} of ${sequence.totalTrips} trips`);
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
  const kindLabel = stop.ref.kind === 'location_group' ? 'Group' : 'Zone';
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
      ? `<span class="opacity-50 text-xs ml-1">(visit ${stop.occurrence + 1})</span>`
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
      title="Served by ${stats.serves} of ${sequence.totalTrips} trips"
    >
      ${rail}
      <div class="py-1 min-h-8 flex items-center gap-2 min-w-0 pr-2">
        <span class="flex-1 min-w-0 truncate text-sm ${minority ? 'opacity-60' : ''}">${label}${revisit}</span>
        ${statsNotes(sequence, index)}
      </div>
    </div>
  `;
}

/** What the strip is and is not showing, when that is not obvious. */
function renderCoverage(sequence: RouteSequence): string {
  const notes: string[] = [];
  if (sequence.totalPatterns > 1) {
    notes.push(
      `${sequence.totalPatterns} stop patterns across ${sequence.totalTrips} trips, all of them on the strip. A trip count marks a stop fewer than half the trips call at; a filled dot marks where trips start or end. Platforms are shown under their parent station.`
    );
  }
  if (sequence.isLoop) {
    notes.push(
      'Some trips visit a stop more than once. Repeat visits are shown as separate rows rather than collapsed onto one.'
    );
  }
  if (notes.length === 0) {
    return '';
  }
  return `<div class="text-xs opacity-60 space-y-1">${notes
    .map((note) => `<p>${escapeHtml(note)}</p>`)
    .join('')}</div>`;
}

function renderDirection(
  source: GTFSRouteSource,
  sequence: RouteSequence,
  label: string,
  showLabel: boolean,
  color: string,
  stopsById: Map<string, Stops>
): string {
  if (sequence.stops.length === 0) {
    return '';
  }
  const heading = showLabel
    ? `<h3 class="text-sm font-semibold opacity-70">${escapeHtml(label)}</h3>`
    : '';
  const rows = sequence.stops
    .map((_stop, index) => renderRow(source, sequence, index, color, stopsById))
    .join('');
  return `
    <div class="space-y-2">
      ${heading}
      ${renderCoverage(sequence)}
      <div>${rows}</div>
    </div>
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
  const sections = directions
    .map((direction) =>
      renderDirection(
        source,
        // service_id omitted: the diagram covers every trip of the route.
        routeSequence(source, route_id, direction.direction_id),
        direction.label,
        directions.length > 1,
        color,
        stopsById
      )
    )
    .filter((html) => html !== '')
    .join('');

  if (sections === '') {
    return '';
  }

  return `
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Route diagram</h2>
      <div class="card bg-base-100 shadow-lg">
        <div class="card-body p-4 space-y-4">
          ${sections}
        </div>
      </div>
    </div>
  `;
}
