/**
 * GTFS Entity Type Definitions
 *
 * Strongly-typed interfaces generated from Zod schemas for database storage.
 * Each interface extends the corresponding Zod schema type and uses natural
 * GTFS primary keys as defined in the GTFS specification.
 */

import { z } from 'zod';
import {
  AgencySchema,
  StopsSchema,
  RoutesSchema,
  TripsSchema,
  StopTimesSchema,
  CalendarSchema,
  CalendarDatesSchema,
  FareAttributesSchema,
  FareRulesSchema,
  TimeframesSchema,
  RiderCategoriesSchema,
  FareMediaSchema,
  FareProductsSchema,
  FareLegRulesSchema,
  FareLegJoinRulesSchema,
  FareTransferRulesSchema,
  AreasSchema,
  StopAreasSchema,
  NetworksSchema,
  RouteNetworksSchema,
  ShapesSchema,
  FrequenciesSchema,
  TransfersSchema,
  PathwaysSchema,
  LevelsSchema,
  LocationGroupsSchema,
  LocationGroupStopsSchema,
  BookingRulesSchema,
  TranslationsSchema,
  FeedInfoSchema,
  AttributionsSchema,
} from './gtfs.js';

// Core GTFS entities (required files)

/**
 * Agency - Transit agency information
 * Primary key: agency_id
 */
export type Agency = z.infer<typeof AgencySchema>;

/**
 * Stops - Transit stops and stations
 * Primary key: stop_id
 */
export type Stops = z.infer<typeof StopsSchema>;

/**
 * Routes - Transit routes
 * Primary key: route_id
 */
export type Routes = z.infer<typeof RoutesSchema>;

/**
 * Trips - Individual vehicle trips
 * Primary key: trip_id
 */
export type Trips = z.infer<typeof TripsSchema>;

/**
 * StopTimes - Stop times for trips
 * Composite primary key: trip_id + stop_sequence
 */
export type StopTimes = z.infer<typeof StopTimesSchema>;

/**
 * Calendar - Service calendar dates
 * Primary key: service_id
 */
export type Calendar = z.infer<typeof CalendarSchema>;

/**
 * CalendarDates - Service calendar date exceptions
 * Composite primary key: service_id + date
 */
export type CalendarDates = z.infer<typeof CalendarDatesSchema>;

// Optional GTFS entities

/**
 * FareAttributes - Fare information
 * Primary key: fareId
 */
export type FareAttributes = z.infer<typeof FareAttributesSchema>;

/**
 * FareRules - Fare rules
 * Primary key: fareId
 */
export type FareRules = z.infer<typeof FareRulesSchema>;

/**
 * Timeframes - Extended GTFS timeframes
 * Composite primary key: all provided fields
 */
export type Timeframes = z.infer<typeof TimeframesSchema>;

/**
 * RiderCategories - Extended GTFS rider categories
 * Primary key: riderCategoryId
 */
export type RiderCategories = z.infer<typeof RiderCategoriesSchema>;

/**
 * FareMedia - Extended GTFS fare media
 * Primary key: fareMediaId
 */
export type FareMedia = z.infer<typeof FareMediaSchema>;

/**
 * FareProducts - Extended GTFS fare products
 * Composite primary key: fareProductId + riderCategoryId + fareMediaId
 */
export type FareProducts = z.infer<typeof FareProductsSchema>;

/**
 * FareLegRules - Extended GTFS fare leg rules
 * Composite primary key: networkId + fromAreaId + toAreaId + fromTimeframeGroupId + toTimeframeGroupId + fareProductId
 */
export type FareLegRules = z.infer<typeof FareLegRulesSchema>;

/**
 * FareLegJoinRules - Extended GTFS fare leg join rules
 * Composite primary key: fromNetworkId + toNetworkId + fromStopId + toStopId
 */
export type FareLegJoinRules = z.infer<typeof FareLegJoinRulesSchema>;

/**
 * FareTransferRules - Extended GTFS fare transfer rules
 * Primary key: TBD (requires investigation)
 */
export type FareTransferRules = z.infer<typeof FareTransferRulesSchema>;

/**
 * Areas - Extended GTFS areas
 * Primary key: areaId (likely)
 */
export type Areas = z.infer<typeof AreasSchema>;

/**
 * StopAreas - Extended GTFS stop areas
 * Composite primary key: areaId + stop_id (likely)
 */
export type StopAreas = z.infer<typeof StopAreasSchema>;

/**
 * Networks - Extended GTFS networks
 * Primary key: networkId (likely)
 */
export type Networks = z.infer<typeof NetworksSchema>;

/**
 * RouteNetworks - Extended GTFS route networks
 * Composite primary key: networkId + route_id (likely)
 */
export type RouteNetworks = z.infer<typeof RouteNetworksSchema>;

/**
 * Shapes - Route shape data
 * Primary key: shape_id
 */
export type Shapes = z.infer<typeof ShapesSchema>;

/**
 * Frequencies - Headway-based service
 * Primary key: trip_id
 */
export type Frequencies = z.infer<typeof FrequenciesSchema>;

/**
 * Transfers - Transfer rules between stops
 * Primary key: fromStopId
 */
export type Transfers = z.infer<typeof TransfersSchema>;

/**
 * Pathways - Pathways between locations
 * Primary key: pathwayId
 */
export type Pathways = z.infer<typeof PathwaysSchema>;

/**
 * Levels - Location levels
 * Primary key: level_id
 */
export type Levels = z.infer<typeof LevelsSchema>;

/**
 * LocationGroups - Extended GTFS location groups
 * Primary key: locationGroupId (likely)
 */
export type LocationGroups = z.infer<typeof LocationGroupsSchema>;

/**
 * LocationGroupStops - Extended GTFS location group stops
 * Composite primary key: locationGroupId + stop_id (likely)
 */
export type LocationGroupStops = z.infer<typeof LocationGroupStopsSchema>;

/**
 * BookingRules - Extended GTFS booking rules
 * Primary key: bookingRuleId (likely)
 */
export type BookingRules = z.infer<typeof BookingRulesSchema>;

/**
 * Translations - GTFS translations
 * Composite primary key: tableName + fieldName + language + recordId
 */
export type Translations = z.infer<typeof TranslationsSchema>;

/**
 * FeedInfo - GTFS feed information
 * No primary key (single record file)
 */
export type FeedInfo = z.infer<typeof FeedInfoSchema>;

/**
 * Attributions - Data attributions
 * Primary key: attributionId
 */
export type Attributions = z.infer<typeof AttributionsSchema>;

// Table name to entity type mapping for type safety
export type GTFSTableMap = {
  agencies: Agency;
  stops: Stops;
  routes: Routes;
  trips: Trips;
  stop_times: StopTimes;
  calendar: Calendar;
  calendar_dates: CalendarDates;
  fare_attributes: FareAttributes;
  fare_rules: FareRules;
  timeframes: Timeframes;
  rider_categories: RiderCategories;
  fare_media: FareMedia;
  fare_products: FareProducts;
  fare_leg_rules: FareLegRules;
  fare_leg_join_rules: FareLegJoinRules;
  fare_transfer_rules: FareTransferRules;
  areas: Areas;
  stop_areas: StopAreas;
  networks: Networks;
  route_networks: RouteNetworks;
  shapes: Shapes;
  frequencies: Frequencies;
  transfers: Transfers;
  pathways: Pathways;
  levels: Levels;
  location_groups: LocationGroups;
  location_group_stops: LocationGroupStops;
  booking_rules: BookingRules;
  translations: Translations;
  feed_info: FeedInfo;
  attributions: Attributions;
};
