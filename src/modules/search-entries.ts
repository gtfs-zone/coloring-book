/**
 * Turns the loaded feed into search entries for `SearchController`.
 *
 * The payload is a `PageState`, so selecting a result can go straight through
 * the normal navigation path and leave the sidebar and URL correct.
 */

import { GTFS_TABLES } from '../types/gtfs.js';
import type { PageState } from '../types/page-state.js';
import {
  getAgencyDisplay,
  getRouteDisplay,
  getStopDisplay,
} from '../utils/entity-display.js';
import type { GTFSParser } from './gtfs-parser.js';
import { getZoneFeatures, zoneName } from './zone-store.js';
import {
  neutralMarker,
  routeMarker,
  stopMarker,
  type SearchEntry,
} from './search-controller.js';

/** Non-empty values only, so the haystack has no runs of blanks to match into. */
function haystack(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Row = Record<string, string>;

export async function buildSearchEntries(
  parser: GTFSParser
): Promise<SearchEntry<PageState>[]> {
  const [stops, routes, agencies, locationGroups] = (await Promise.all([
    parser.getFileData(GTFS_TABLES.STOPS),
    parser.getFileData(GTFS_TABLES.ROUTES),
    parser.getFileData(GTFS_TABLES.AGENCY),
    parser.getFileData(GTFS_TABLES.LOCATION_GROUPS),
  ])) as [Row[] | null, Row[] | null, Row[] | null, Row[] | null];

  const entries: SearchEntry<PageState>[] = [];

  for (const stop of stops ?? []) {
    const stop_id = stop['stop_id'];
    if (!stop_id) {
      continue;
    }
    entries.push({
      payload: { type: 'stop', stop_id },
      icon: stopMarker(stop['location_type']),
      primary: getStopDisplay(stop).primary,
      secondary: stop['stop_code'] || stop_id,
      haystack: haystack(
        stop['stop_name'],
        stop_id,
        stop['stop_code'],
        stop['stop_desc']
      ),
      // Stations outrank routes, which outrank plain stops.
      priority: Number(stop['location_type']) === 1 ? 0 : 2,
    });
  }

  for (const route of routes ?? []) {
    const route_id = route['route_id'];
    if (!route_id) {
      continue;
    }
    const display = getRouteDisplay(route);
    entries.push({
      payload: { type: 'route', route_id },
      icon: routeMarker(route['route_color']),
      primary: display.primary,
      secondary:
        route['route_long_name'] && route['route_long_name'] !== display.primary
          ? route['route_long_name']
          : route_id,
      haystack: haystack(
        route['route_short_name'],
        route['route_long_name'],
        route_id,
        route['route_desc']
      ),
      priority: 1,
    });
  }

  for (const agency of agencies ?? []) {
    const agency_id = agency['agency_id'];
    if (!agency_id) {
      continue;
    }
    entries.push({
      payload: { type: 'agency', agency_id },
      icon: neutralMarker(),
      primary: getAgencyDisplay(agency).primary,
      secondary: agency_id,
      haystack: haystack(agency['agency_name'], agency_id),
      priority: 2,
    });
  }

  // Flex objects rank below stops and routes: most feeds have none, and where
  // they exist they are far fewer than the scheduled objects above.
  for (const feature of getZoneFeatures(parser)) {
    const location_id = String(feature.id);
    const name = zoneName(feature);
    entries.push({
      payload: { type: 'zone', location_id },
      icon: neutralMarker(),
      primary: name || location_id,
      secondary: location_id,
      haystack: haystack(name, location_id, 'zone on-demand'),
      priority: 3,
    });
  }

  for (const group of locationGroups ?? []) {
    const location_group_id = group['location_group_id'];
    if (!location_group_id) {
      continue;
    }
    const name = group['location_group_name'];
    entries.push({
      payload: { type: 'location_group', location_group_id },
      icon: neutralMarker(),
      primary: name || location_group_id,
      secondary: location_group_id,
      haystack: haystack(name, location_group_id, 'location group'),
      priority: 3,
    });
  }

  return entries;
}
