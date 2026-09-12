/**
 * GTFS (General Transit Feed Specification) TypeScript definitions and Zod schemas
 *
 * All exports are derived at runtime from the hand-authored spec in src/gtfs-spec/.
 * The authoritative source is src/gtfs-spec/files/*.ts.
 */

import { z } from 'zod';
import { gtfsSpec } from '../gtfs-spec/index';
import type { GTFSPresence } from '../gtfs-spec/types';
import {
  deriveGTFSPrimaryKeys,
  deriveGTFSFieldTypes,
  deriveGTFSSchemas,
  deriveGTFSFileInfos,
  deriveGTFSFieldSpecs,
  deriveGTFSForeignKeys,
} from '../gtfs-spec/adapter';
import { GTFS_FIELD_TYPE_METADATA } from './gtfs-field-types';

export interface GTFSFileInfo {
  filename: string;
  presence: GTFSPresence;
  description: string;
  schema: z.ZodSchema;
}

// ─── Core derived exports ──────────────────────────────────────────────────────

export const GTFS_PRIMARY_KEYS = deriveGTFSPrimaryKeys(gtfsSpec);
export const GTFS_FIELD_TYPES = deriveGTFSFieldTypes(gtfsSpec);
export const GTFS_FIELD_SPECS = deriveGTFSFieldSpecs(gtfsSpec);
export const GTFS_FOREIGN_KEYS = deriveGTFSForeignKeys(gtfsSpec);
export const GTFSSchemas = deriveGTFSSchemas(
  gtfsSpec,
  GTFS_FIELD_TYPE_METADATA
);
export const GTFS_FILES = deriveGTFSFileInfos(
  gtfsSpec,
  GTFSSchemas
) as GTFSFileInfo[];

// ─── Individual schema exports (backward compat) ───────────────────────────────

export const AgencySchema = GTFSSchemas['agency.txt'];
export const RoutesSchema = GTFSSchemas['routes.txt'];
export const TripsSchema = GTFSSchemas['trips.txt'];
export const StopTimesSchema = GTFSSchemas['stop_times.txt'];
export const CalendarSchema = GTFSSchemas['calendar.txt'];

// ─── Individual type exports ───────────────────────────────────────────────────
// Re-exported from gtfs-entities for consumers that import types from this module.

export type {
  Agency,
  Stops,
  Routes,
  Trips,
  StopTimes,
  Calendar,
  Shapes,
  Frequencies,
  Transfers,
  Pathways,
  Levels,
  LocationGroups,
  LocationGroupStops,
  BookingRules,
  Translations,
  FeedInfo,
  Attributions,
} from './gtfs-entities';

// ─── Table name constants ──────────────────────────────────────────────────────
// Kept as a literal `as const` object so consumers get narrow string literal
// types for type-safe table references (e.g. GTFS_TABLES.STOPS: 'stops.txt').

export const GTFS_TABLES = {
  AGENCY: 'agency.txt',
  STOPS: 'stops.txt',
  ROUTES: 'routes.txt',
  TRIPS: 'trips.txt',
  STOP_TIMES: 'stop_times.txt',
  CALENDAR: 'calendar.txt',
  CALENDAR_DATES: 'calendar_dates.txt',
  FARE_ATTRIBUTES: 'fare_attributes.txt',
  FARE_RULES: 'fare_rules.txt',
  TIMEFRAMES: 'timeframes.txt',
  RIDER_CATEGORIES: 'rider_categories.txt',
  FARE_MEDIA: 'fare_media.txt',
  FARE_PRODUCTS: 'fare_products.txt',
  FARE_LEG_RULES: 'fare_leg_rules.txt',
  FARE_LEG_JOIN_RULES: 'fare_leg_join_rules.txt',
  FARE_TRANSFER_RULES: 'fare_transfer_rules.txt',
  AREAS: 'areas.txt',
  STOP_AREAS: 'stop_areas.txt',
  NETWORKS: 'networks.txt',
  ROUTE_NETWORKS: 'route_networks.txt',
  SHAPES: 'shapes.txt',
  FREQUENCIES: 'frequencies.txt',
  TRANSFERS: 'transfers.txt',
  PATHWAYS: 'pathways.txt',
  LEVELS: 'levels.txt',
  LOCATION_GROUPS: 'location_groups.txt',
  LOCATION_GROUP_STOPS: 'location_group_stops.txt',
  LOCATIONS_GEOJSON: 'locations.geojson',
  BOOKING_RULES: 'booking_rules.txt',
  TRANSLATIONS: 'translations.txt',
  FEED_INFO: 'feed_info.txt',
  ATTRIBUTIONS: 'attributions.txt',
} as const;
