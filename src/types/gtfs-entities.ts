/**
 * GTFS Entity Type Definitions
 *
 * Entity types for all GTFS files. Defined as Record<string, any> because the
 * Zod schemas are built dynamically at runtime from the hand-authored spec, so
 * TypeScript cannot infer specific field shapes statically. Runtime validation
 * is handled by the derived Zod schemas in GTFSSchemas.
 */

// Common base type for all GTFS records (fields are strings/numbers/booleans from CSV)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GTFSEntityRecord = Record<string, any>;

// Core GTFS entities (required files)
export type Agency = GTFSEntityRecord;
export type Stops = GTFSEntityRecord;
export type Routes = GTFSEntityRecord;
export type Trips = GTFSEntityRecord;
export type StopTimes = GTFSEntityRecord;
export type Calendar = GTFSEntityRecord;
export type CalendarDates = GTFSEntityRecord;

// Optional GTFS entities
export type FareAttributes = GTFSEntityRecord;
export type FareRules = GTFSEntityRecord;
export type Timeframes = GTFSEntityRecord;
export type RiderCategories = GTFSEntityRecord;
export type FareMedia = GTFSEntityRecord;
export type FareProducts = GTFSEntityRecord;
export type FareLegRules = GTFSEntityRecord;
export type FareLegJoinRules = GTFSEntityRecord;
export type FareTransferRules = GTFSEntityRecord;
export type Areas = GTFSEntityRecord;
export type StopAreas = GTFSEntityRecord;
export type Networks = GTFSEntityRecord;
export type RouteNetworks = GTFSEntityRecord;
export type Shapes = GTFSEntityRecord;
export type Frequencies = GTFSEntityRecord;
export type Transfers = GTFSEntityRecord;
export type Pathways = GTFSEntityRecord;
export type Levels = GTFSEntityRecord;
export type LocationGroups = GTFSEntityRecord;
export type LocationGroupStops = GTFSEntityRecord;
export type BookingRules = GTFSEntityRecord;
export type Translations = GTFSEntityRecord;
export type FeedInfo = GTFSEntityRecord;
export type Attributions = GTFSEntityRecord;

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
