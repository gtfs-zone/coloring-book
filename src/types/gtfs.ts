/**
 * GTFS (General Transit Feed Specification) TypeScript definitions and Zod schemas
 *
 * All exports are derived at runtime from the hand-authored spec in src/gtfs-spec/.
 * The authoritative source is src/gtfs-spec/files/*.ts.
 */

import { z } from 'zod';
import { gtfsSpec } from '../gtfs-spec/index.js';
import {
  deriveGTFSPrimaryKeys,
  deriveGTFSFieldTypes,
  deriveGTFSSchemas,
  deriveGTFSFileInfos,
} from '../gtfs-spec/adapter.js';
import { GTFS_FIELD_TYPE_METADATA } from './gtfs-field-types.js';

// File presence enum — kept for backward compat with consumers that compare
// against enum members (e.g. GTFSFilePresence.Required). String values are
// identical to GTFSPresence in the spec types, so comparisons are safe.
export enum GTFSFilePresence {
  Required = 'Required',
  Optional = 'Optional',
  ConditionallyRequired = 'Conditionally Required',
}

export interface GTFSFileInfo {
  filename: string;
  presence: GTFSFilePresence;
  description: string;
  schema: z.ZodSchema;
}

// ─── Core derived exports ──────────────────────────────────────────────────────

export const GTFS_PRIMARY_KEYS = deriveGTFSPrimaryKeys(gtfsSpec);
export const GTFS_FIELD_TYPES = deriveGTFSFieldTypes(gtfsSpec);
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
export const StopsSchema = GTFSSchemas['stops.txt'];
export const RoutesSchema = GTFSSchemas['routes.txt'];
export const TripsSchema = GTFSSchemas['trips.txt'];
export const StopTimesSchema = GTFSSchemas['stop_times.txt'];
export const CalendarSchema = GTFSSchemas['calendar.txt'];
export const CalendarDatesSchema = GTFSSchemas['calendar_dates.txt'];
export const ShapesSchema = GTFSSchemas['shapes.txt'];
export const FeedInfoSchema = GTFSSchemas['feed_info.txt'];

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
} from './gtfs-entities.js';

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

// ─── Utility functions ─────────────────────────────────────────────────────────

export function getFieldDescription(
  filename: string,
  fieldName: string
): string | undefined {
  const schema = GTFSSchemas[filename];
  if (!schema) {
    return undefined;
  }
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  if (!shape || !shape[fieldName]) {
    return undefined;
  }
  return (shape[fieldName] as unknown as { description?: string })?.description;
}

export function getFileSchema(filename: string): z.ZodSchema | undefined {
  return GTFSSchemas[filename];
}

export function getAllFieldDescriptions(
  filename: string
): Record<string, string> {
  const schema = GTFSSchemas[filename];
  if (!schema) {
    return {};
  }
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const descriptions: Record<string, string> = {};
  for (const [fieldName, fieldSchema] of Object.entries(shape || {})) {
    const desc = (fieldSchema as z.ZodSchema & { description?: string })
      ?.description;
    if (desc) {
      descriptions[fieldName] = desc;
    }
  }
  return descriptions;
}
