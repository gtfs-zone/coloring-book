/**
 * Default GTFS Values Generator
 * Provides sensible defaults for creating new GTFS entities
 */

import type { Agency, Routes, Calendar } from '../types/gtfs';
import { toGtfsDateLocal, todayGtfsDate } from './gtfs-date';
import { feedBounds, type FeedBoundsSource } from './feed-bounds';

/**
 * Get date one year from now in YYYYMMDD format
 */
function getOneYearFromNowYYYYMMDD(): string {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return toGtfsDateLocal(future);
}

/**
 * Create a new agency with an empty name and URL. The timezone is the given
 * one (an existing agency's), else the browser's.
 */
export function createDefaultAgency(
  agency_id: string,
  timezone: string
): Agency {
  return {
    agency_id,
    agency_name: '',
    agency_url: '',
    agency_timezone:
      timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** A new service's date range. */
export interface ServiceRange {
  start: string;
  end: string;
}

/**
 * The date range a new service starts with: the feed_info bounds, each
 * falling back to today and today +1 year.
 */
export async function defaultServiceRange(
  db: FeedBoundsSource
): Promise<ServiceRange> {
  const bounds = await feedBounds(db);
  return {
    start: bounds.start ?? todayGtfsDate(),
    end: bounds.end ?? getOneYearFromNowYYYYMMDD(),
  };
}

/**
 * Create a new service (calendar entry) running on no weekdays
 */
export function createDefaultService(
  service_id: string,
  range: ServiceRange
): Calendar {
  return {
    service_id,
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
    start_date: range.start,
    end_date: range.end,
  };
}

/**
 * Create a new route with default values
 */
export function createDefaultRoute(
  route_id: string,
  agency_id?: string
): Routes {
  const route: Partial<Routes> = {
    route_id,
    route_short_name: '',
    route_long_name: '',
    route_type: 3, // Bus
  };

  if (agency_id) {
    route.agency_id = agency_id;
  }

  return route as Routes;
}
