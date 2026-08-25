/**
 * Breadcrumb building for edit.gtfs.zone.
 *
 * Which crumbs a page state has, and how their labels are resolved through the
 * injected `BreadcrumbLookup`. The markup and the title format come from the
 * shared `breadcrumb-trail.ts`.
 */

import { PageState } from '../types/page-state.js';
import { BreadcrumbItem, stopTypeLabel } from './breadcrumb-trail.js';

/** Name used as the tail of every page title. */
export const APP_NAME = 'edit.gtfs.zone';

/** A stop in an ancestor chain, with the word its `location_type` earns it. */
export interface StopAncestor {
  stop_id: string;
  label: string;
  location_type?: number;
}

/**
 * Breadcrumb lookup functions, injected so the builder never touches the
 * database directly.
 */
export interface BreadcrumbLookup {
  getAgencyName: (agency_id: string) => Promise<string>;
  getRouteName: (route_id: string) => Promise<string>;
  getStopName: (stop_id: string) => Promise<string>;
  getStopLocationType: (stop_id: string) => Promise<number | undefined>;
  getAgencyIdForRoute: (route_id: string) => Promise<string>;
  getStopAncestors: (stop_id: string) => Promise<StopAncestor[]>;
  getPathwayAncestors: (pathway_id: string) => Promise<StopAncestor[]>;
  getZoneName: (location_id: string) => Promise<string>;
  getLocationGroupName: (location_group_id: string) => Promise<string>;
}

const HOME: BreadcrumbItem = {
  typeLabel: 'Feed',
  label: 'Home',
  pageState: { type: 'home' },
};

/** Fallback name when there is no lookup, or the lookup threw. */
function fallbackName(type: string, id: string): string {
  return `${type.charAt(0).toUpperCase() + type.slice(1)} ${id}`;
}

async function nameOf(
  lookup: BreadcrumbLookup | null,
  type: 'agency' | 'route' | 'stop',
  id: string
): Promise<string> {
  if (!lookup) {
    return fallbackName(type, id);
  }
  try {
    switch (type) {
      case 'agency':
        return await lookup.getAgencyName(id);
      case 'route':
        return await lookup.getRouteName(id);
      case 'stop':
        return await lookup.getStopName(id);
    }
  } catch (error) {
    console.warn(`Failed to lookup ${type} name for ID ${id}:`, error);
    return fallbackName(type, id);
  }
}

function ancestorCrumbs(ancestors: StopAncestor[]): BreadcrumbItem[] {
  return ancestors.map((ancestor) => ({
    typeLabel: stopTypeLabel(ancestor.location_type),
    label: ancestor.label,
    pageState: { type: 'stop', stop_id: ancestor.stop_id } as PageState,
  }));
}

/**
 * The crumb trail for a page state, outermost first. Home has no trail; every
 * other page starts at Home.
 */
export async function buildBreadcrumbs(
  pageState: PageState,
  lookup: BreadcrumbLookup | null
): Promise<BreadcrumbItem[]> {
  try {
    switch (pageState.type) {
      case 'home':
        return [];

      case 'agency':
        return [
          HOME,
          {
            typeLabel: 'Agency',
            label: await nameOf(lookup, 'agency', pageState.agency_id),
            pageState: { type: 'agency', agency_id: pageState.agency_id },
          },
        ];

      case 'route': {
        const agency_id = lookup
          ? await lookup.getAgencyIdForRoute(pageState.route_id)
          : 'unknown';
        return [
          HOME,
          {
            typeLabel: 'Agency',
            label: await nameOf(lookup, 'agency', agency_id),
            pageState: { type: 'agency', agency_id },
          },
          {
            typeLabel: 'Route',
            label: await nameOf(lookup, 'route', pageState.route_id),
            pageState: { type: 'route', route_id: pageState.route_id },
          },
        ];
      }

      case 'timetable': {
        const agency_id = lookup
          ? await lookup.getAgencyIdForRoute(pageState.route_id)
          : 'unknown';
        return [
          HOME,
          {
            typeLabel: 'Agency',
            label: await nameOf(lookup, 'agency', agency_id),
            pageState: { type: 'agency', agency_id },
          },
          {
            typeLabel: 'Route',
            label: await nameOf(lookup, 'route', pageState.route_id),
            pageState: { type: 'route', route_id: pageState.route_id },
          },
          {
            typeLabel: 'Timetable',
            label: pageState.service_id,
            pageState,
          },
        ];
      }

      case 'stop': {
        const ancestors = lookup
          ? await lookup.getStopAncestors(pageState.stop_id)
          : [];
        const locationType = lookup
          ? await lookup.getStopLocationType(pageState.stop_id)
          : undefined;
        return [
          HOME,
          ...ancestorCrumbs(ancestors),
          {
            typeLabel: stopTypeLabel(locationType),
            label: await nameOf(lookup, 'stop', pageState.stop_id),
            pageState: { type: 'stop', stop_id: pageState.stop_id },
          },
        ];
      }

      case 'service':
        return [
          HOME,
          {
            typeLabel: 'Service',
            label: pageState.service_id,
            pageState: { type: 'service', service_id: pageState.service_id },
          },
        ];

      case 'pathway': {
        const ancestors = lookup
          ? await lookup.getPathwayAncestors(pageState.pathway_id)
          : [];
        return [
          HOME,
          ...ancestorCrumbs(ancestors),
          {
            typeLabel: 'Pathway',
            label: pageState.pathway_id,
            pageState: { type: 'pathway', pathway_id: pageState.pathway_id },
          },
        ];
      }

      case 'zone': {
        // A zone has no parent object: it is a standalone polygon.
        const zoneName = lookup
          ? await lookup.getZoneName(pageState.location_id)
          : pageState.location_id;
        return [
          HOME,
          {
            typeLabel: 'Zone',
            label: zoneName,
            pageState: { type: 'zone', location_id: pageState.location_id },
          },
        ];
      }

      case 'location_group': {
        // No stop parent: a group has many member stops, none of them owning it.
        const groupName = lookup
          ? await lookup.getLocationGroupName(pageState.location_group_id)
          : pageState.location_group_id;
        return [
          HOME,
          {
            typeLabel: 'Location group',
            label: groupName,
            pageState: {
              type: 'location_group',
              location_group_id: pageState.location_group_id,
            },
          },
        ];
      }

      default:
        return [HOME];
    }
  } catch (error) {
    console.error('Error building breadcrumbs:', error);
    return [HOME];
  }
}
