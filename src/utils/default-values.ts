/**
 * Default GTFS Values Generator
 * Provides sensible defaults for creating new GTFS entities
 */

import type { Agency, Routes, Calendar } from '../types/gtfs';

/**
 * Get current date in YYYYMMDD format
 */
function getTodayYYYYMMDD(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Get date one year from now in YYYYMMDD format
 */
function getOneYearFromNowYYYYMMDD(): string {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const year = future.getFullYear();
  const month = String(future.getMonth() + 1).padStart(2, '0');
  const day = String(future.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Create a new agency with default values
 */
export function createDefaultAgency(agency_id: string): Agency {
  return {
    agency_id,
    agency_name: agency_id, // Use ID as name initially
    agency_url: 'https://example.com',
    agency_timezone: 'America/New_York',
  };
}

/**
 * Create a new service (calendar entry) with default values
 */
export function createDefaultService(service_id: string): Calendar {
  return {
    service_id,
    monday: 1,
    tuesday: 1,
    wednesday: 1,
    thursday: 1,
    friday: 1,
    saturday: 1,
    sunday: 1,
    start_date: getTodayYYYYMMDD(),
    end_date: getOneYearFromNowYYYYMMDD(),
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
    route_short_name: route_id,
    route_long_name: '',
    route_type: 3, // Bus
  };

  if (agency_id) {
    route.agency_id = agency_id;
  }

  return route as Routes;
}
