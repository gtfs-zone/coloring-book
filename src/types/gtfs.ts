/**
 * GTFS (General Transit Feed Specification) TypeScript definitions and Zod schemas
 *
 * Generated from https://gtfs.org/documentation/schedule/reference
 * Scraped at: 2025-10-06T07:31:38.143Z
 *
 * This file contains TypeScript interfaces and Zod schemas for all GTFS files and their fields.
 * Zod schemas include field descriptions accessible at runtime and foreign key validation.
 */

import { z } from 'zod';

// Primary key mappings for GTFS files
export const GTFS_PRIMARY_KEYS = {
  'agency.txt': 'agency_id',
  'stops.txt': 'stop_id',
  'routes.txt': 'route_id',
  'trips.txt': 'trip_id',
  'calendar.txt': 'service_id',
  'fare_attributes.txt': 'fare_id',
  'timeframes.txt': 'timeframe_group_id',
  'rider_categories.txt': 'rider_category_id',
  'fare_media.txt': 'fare_media_id',
  'fare_products.txt': 'fare_product_id',
  'fare_leg_rules.txt': 'leg_group_id',
  'areas.txt': 'area_id',
  'networks.txt': 'network_id',
  'shapes.txt': 'shape_id',
  'pathways.txt': 'pathway_id',
  'levels.txt': 'level_id',
  'location_groups.txt': 'location_group_id',
  'booking_rules.txt': 'booking_rule_id',
  'attributions.txt': 'attribution_id',
} as const;

// Field type mappings extracted from GTFS specification
// Maps filename -> fieldName -> GTFS type string (e.g., "Text", "Integer", "Enum")
export const GTFS_FIELD_TYPES = {
  'agency.txt': {
    agency_id: 'Unique ID',
    agency_name: 'Text',
    agency_url: 'URL',
    agency_timezone: 'Timezone',
    agency_lang: 'Language code',
    agency_phone: 'Phone number',
    agency_fare_url: 'URL',
    agency_email: 'Email',
  },
  'stops.txt': {
    stop_id: 'Unique ID',
    stop_code: 'Text',
    stop_name: 'Text',
    tts_stop_name: 'Text',
    stop_desc: 'Text',
    stop_lat: 'Latitude',
    stop_lon: 'Longitude',
    zone_id: 'ID',
    stop_url: 'URL',
    location_type: 'Enum',
    parent_station: 'Foreign ID referencing stops.stop_id',
    stop_timezone: 'Timezone',
    wheelchair_boarding: 'Enum',
    level_id: 'Foreign ID referencing levels.level_id',
    platform_code: 'Text',
  },
  'routes.txt': {
    route_id: 'Unique ID',
    agency_id: 'Foreign ID referencing agency.agency_id',
    route_short_name: 'Text',
    route_long_name: 'Text',
    route_desc: 'Text',
    route_type: 'Enum',
    route_url: 'URL',
    route_color: 'Color',
    route_text_color: 'Color',
    route_sort_order: 'Non-negative integer',
    continuous_pickup: 'Enum',
    continuous_drop_off: 'Enum',
    network_id: 'ID',
  },
  'trips.txt': {
    route_id: 'Foreign ID referencing routes.route_id',
    service_id:
      'Foreign ID referencing calendar.service_id or calendar_dates.service_id',
    trip_id: 'Unique ID',
    trip_headsign: 'Text',
    trip_short_name: 'Text',
    direction_id: 'Enum',
    block_id: 'ID',
    shape_id: 'Foreign ID referencing shapes.shape_id',
    wheelchair_accessible: 'Enum',
    bikes_allowed: 'Enum',
    cars_allowed: 'Enum',
  },
  'stop_times.txt': {
    trip_id: 'Foreign ID referencing trips.trip_id',
    arrival_time: 'Time',
    departure_time: 'Time',
    stop_id: 'Foreign ID referencing stops.stop_id',
    location_group_id:
      'Foreign ID referencing location_groups.location_group_id',
    location_id: 'Foreign ID referencing id from locations.geojson',
    stop_sequence: 'Non-negative integer',
    stop_headsign: 'Text',
    start_pickup_drop_off_window: 'Time',
    end_pickup_drop_off_window: 'Time',
    pickup_type: 'Enum',
    drop_off_type: 'Enum',
    continuous_pickup: 'Enum',
    continuous_drop_off: 'Enum',
    shape_dist_traveled: 'Non-negative float',
    timepoint: 'Enum',
    pickup_booking_rule_id:
      'Foreign ID referencing booking_rules.booking_rule_id',
    drop_off_booking_rule_id:
      'Foreign ID referencing booking_rules.booking_rule_id',
  },
  'calendar.txt': {
    service_id: 'Unique ID',
    monday: 'Enum',
    tuesday: 'Enum',
    wednesday: 'Enum',
    thursday: 'Enum',
    friday: 'Enum',
    saturday: 'Enum',
    sunday: 'Enum',
    start_date: 'Date',
    end_date: 'Date',
  },
  'calendar_dates.txt': {
    service_id: 'Foreign ID referencing calendar.service_id or ID',
    date: 'Date',
    exception_type: 'Enum',
  },
  'fare_attributes.txt': {
    fare_id: 'Unique ID',
    price: 'Non-negative float',
    currency_type: 'Currency code',
    payment_method: 'Enum',
    transfers: 'Enum',
    agency_id: 'Foreign ID referencing agency.agency_id',
    transfer_duration: 'Non-negative integer',
  },
  'fare_rules.txt': {
    fare_id: 'Foreign ID referencing fare_attributes.fare_id',
    route_id: 'Foreign ID referencing routes.route_id',
    origin_id: 'Foreign ID referencing stops.zone_id',
    destination_id: 'Foreign ID referencing stops.zone_id',
    contains_id: 'Foreign ID referencing stops.zone_id',
  },
  'timeframes.txt': {
    timeframe_group_id: 'ID',
    start_time: 'Time',
    end_time: 'Time',
    service_id:
      'Foreign ID referencing calendar.service_id or calendar_dates.service_id',
  },
  'rider_categories.txt': {
    rider_category_id: 'Unique ID',
    rider_category_name: 'Text',
    is_default_fare_category: 'Enum',
    eligibility_url: 'URL',
  },
  'fare_media.txt': {
    fare_media_id: 'Unique ID',
    fare_media_name: 'Text',
    fare_media_type: 'Enum',
  },
  'fare_products.txt': {
    fare_product_id: 'ID',
    fare_product_name: 'Text',
    rider_category_id:
      'Foreign ID referencing rider_categories.rider_category_id',
    fare_media_id: 'Foreign ID referencing fare_media.fare_media_id',
    amount: 'Currency amount',
    currency: 'Currency code',
  },
  'fare_leg_rules.txt': {
    leg_group_id: 'ID',
    network_id:
      'Foreign ID referencing routes.network_id or networks.network_id',
    from_area_id: 'Foreign ID referencing areas.area_id',
    to_area_id: 'Foreign ID referencing areas.area_id',
    from_timeframe_group_id:
      'Foreign ID referencing timeframes.timeframe_group_id',
    to_timeframe_group_id:
      'Foreign ID referencing timeframes.timeframe_group_id',
    fare_product_id: 'Foreign ID referencing fare_products.fare_product_id',
    rule_priority: 'Non-negative integer',
  },
  'fare_leg_join_rules.txt': {
    from_network_id:
      'Foreign ID referencing routes.network_id or networks.network_id',
    to_network_id:
      'Foreign ID referencing routes.network_id or networks.network_id',
    from_stop_id: 'Foreign ID referencing stops.stop_id',
    to_stop_id: 'Foreign ID referencing stops.stop_id',
  },
  'fare_transfer_rules.txt': {
    from_leg_group_id: 'Foreign ID referencing fare_leg_rules.leg_group_id',
    to_leg_group_id: 'Foreign ID referencing fare_leg_rules.leg_group_id',
    transfer_count: 'Non-zero integer',
    duration_limit: 'Positive integer',
    duration_limit_type: 'Enum',
    fare_transfer_type: 'Enum',
    fare_product_id: 'Foreign ID referencing fare_products.fare_product_id',
  },
  'areas.txt': {
    area_id: 'Unique ID',
    area_name: 'Text',
  },
  'stop_areas.txt': {
    area_id: 'Foreign ID referencing areas.area_id',
    stop_id: 'Foreign ID referencing stops.stop_id',
  },
  'networks.txt': {
    network_id: 'Unique ID',
    network_name: 'Text',
  },
  'route_networks.txt': {
    network_id: 'Foreign ID referencing networks.network_id',
    route_id: 'Foreign ID referencing routes.route_id',
  },
  'shapes.txt': {
    shape_id: 'ID',
    shape_pt_lat: 'Latitude',
    shape_pt_lon: 'Longitude',
    shape_pt_sequence: 'Non-negative integer',
    shape_dist_traveled: 'Non-negative float',
  },
  'frequencies.txt': {
    trip_id: 'Foreign ID referencing trips.trip_id',
    start_time: 'Time',
    end_time: 'Time',
    headway_secs: 'Positive integer',
    exact_times: 'Enum',
  },
  'transfers.txt': {
    from_stop_id: 'Foreign ID referencing stops.stop_id',
    to_stop_id: 'Foreign ID referencing stops.stop_id',
    from_route_id: 'Foreign ID referencing routes.route_id',
    to_route_id: 'Foreign ID referencing routes.route_id',
    from_trip_id: 'Foreign ID referencing trips.trip_id',
    to_trip_id: 'Foreign ID referencing trips.trip_id',
    transfer_type: 'Enum',
    min_transfer_time: 'Non-negative integer',
  },
  'pathways.txt': {
    pathway_id: 'Unique ID',
    from_stop_id: 'Foreign ID referencing stops.stop_id',
    to_stop_id: 'Foreign ID referencing stops.stop_id',
    pathway_mode: 'Enum',
    is_bidirectional: 'Enum',
    length: 'Non-negative float',
    traversal_time: 'Positive integer',
    stair_count: 'Non-null integer',
    max_slope: 'Float',
    min_width: 'Positive float',
    signposted_as: 'Text',
    reversed_signposted_as: 'Text',
  },
  'levels.txt': {
    level_id: 'Unique ID',
    level_index: 'Float',
    level_name: 'Text',
  },
  'location_groups.txt': {
    location_group_id: 'Unique ID',
    location_group_name: 'Text',
  },
  'location_group_stops.txt': {
    location_group_id:
      'Foreign ID referencing location_groups.location_group_id',
    stop_id: 'Foreign ID referencing stops.stop_id',
  },
  'booking_rules.txt': {
    booking_rule_id: 'Unique ID',
    booking_type: 'Enum',
    prior_notice_duration_min: 'Integer',
    prior_notice_duration_max: 'Integer',
    prior_notice_last_day: 'Integer',
    prior_notice_last_time: 'Time',
    prior_notice_start_day: 'Integer',
    prior_notice_start_time: 'Time',
    prior_notice_service_id: 'Foreign ID referencing calendar.service_id',
    message: 'Text',
    pickup_message: 'Text',
    drop_off_message: 'Text',
    phone_number: 'Phone number',
    info_url: 'URL',
    booking_url: 'URL',
  },
  'translations.txt': {
    table_name: 'Enum',
    field_name: 'Text',
    language: 'Language code',
    translation: 'Text or URL or Email or Phone number',
    record_id: 'Foreign ID',
    record_sub_id: 'Foreign ID',
    field_value: 'Text or URL or Email or Phone number',
  },
  'feed_info.txt': {
    feed_publisher_name: 'Text',
    feed_publisher_url: 'URL',
    feed_lang: 'Language code',
    default_lang: 'Language code',
    feed_start_date: 'Date',
    feed_end_date: 'Date',
    feed_version: 'Text',
    feed_contact_email: 'Email',
    feed_contact_url: 'URL',
  },
  'attributions.txt': {
    attribution_id: 'Unique ID',
    agency_id: 'Foreign ID referencing agency.agency_id',
    route_id: 'Foreign ID referencing routes.route_id',
    trip_id: 'Foreign ID referencing trips.trip_id',
    organization_name: 'Text',
    is_producer: 'Enum',
    is_operator: 'Enum',
    is_authority: 'Enum',
    attribution_url: 'URL',
    attribution_email: 'Email',
    attribution_phone: 'Phone number',
  },
} as const;

export const AgencySchema = z.object({
  agency_id: z
    .string()
    .describe(
      'Identifies a transit brand which is often synonymous with a transit agency. Note that in some cases, such as when a single agency operates multiple separate services, agencies and brands are distinct. This document uses the term "agency" in place of "brand". A dataset may contain data from multiple agencies.\n\nConditionally Required:\n- Required when the dataset contains data for multiple transit agencies.\n- Recommended otherwise.'
    ),
  agency_name: z.string().describe('Full name of the transit agency.'),
  agency_url: z.string().url().describe('URL of the transit agency.'),
  agency_timezone: z
    .string()
    .describe(
      'Timezone where the transit agency is located. If multiple agencies are specified in the dataset, each must have the same agency_timezone.'
    ),
  agency_lang: z
    .string()
    .regex(
      /^[a-z]{2,3}(-[A-Z]{2})?$/,
      'Must be a valid IETF BCP 47 language code'
    )
    .describe(
      'Primary language used by this transit agency. Should be provided to help GTFS consumers choose capitalization rules and other language-specific settings for the dataset.'
    )
    .optional(),
  agency_phone: z
    .string()
    .describe(
      'A voice telephone number for the specified agency. This field is a string value that presents the telephone number as typical for the agency\'s service area. It may contain punctuation marks to group the digits of the number. Dialable text (for example, TriMet\'s "503-238-RIDE") is permitted, but the field must not contain any other descriptive text.'
    )
    .optional(),
  agency_fare_url: z
    .string()
    .url()
    .describe(
      "URL of a web page where a rider can purchase tickets or other fare instruments for that agency, or a web page containing information about that agency's fares."
    )
    .optional(),
  agency_email: z
    .string()
    .email()
    .describe(
      'Email address actively monitored by the agency’s customer service department. This email address should be a direct contact point where transit riders can reach a customer service representative at the agency.'
    )
    .optional(),
});

// TypeScript interface inferred from Zod schema
export type Agency = z.infer<typeof AgencySchema>;

export const StopsSchema = z
  .object({
    stop_id: z
      .string()
      .describe(
        'Identifies a location: stop/platform, station, entrance/exit, generic node or boarding area (see location_type).\n\nID must be unique across all stops.stop_id, locations.geojson id, and location_groups.location_group_id values.\n\nMultiple routes may use the same stop_id.'
      ),
    stop_code: z
      .string()
      .describe(
        'Short text or a number that identifies the location for riders. These codes are often used in phone-based transit information systems or printed on signage to make it easier for riders to get information for a particular location. The stop_code may be the same as stop_id if it is public facing. This field should be left empty for locations without a code presented to riders.'
      )
      .optional(),
    stop_name: z
      .string()
      .describe(
        "Name of the location. The stop_name should match the agency's rider-facing name for the location as printed on a timetable, published online, or represented on signage. For translations into other languages, use translations.txt.\n\nWhen the location is a boarding area (location_type=4), the stop_name should contains the name of the boarding area as displayed by the agency. It could be just one letter (like on some European intercity railway stations), or text like “Wheelchair boarding area” (NYC’s Subway) or “Head of short trains” (Paris’ RER).\n\nConditionally Required:\n- Required for locations which are stops (location_type=0), stations (location_type=1) or entrances/exits (location_type=2).\n- Optional for locations which are generic nodes (location_type=3) or boarding areas (location_type=4)."
      ),
    tts_stop_name: z
      .string()
      .describe(
        'Readable version of the stop_name. See "Text-to-speech field" in the Term Definitions for more.'
      )
      .optional(),
    stop_desc: z
      .string()
      .describe(
        'Description of the location that provides useful, quality information. Should not be a duplicate of stop_name.'
      )
      .optional(),
    stop_lat: z
      .number()
      .min(-90.0)
      .max(90.0)
      .describe(
        'Latitude of the location.\n\nFor stops/platforms (location_type=0) and boarding area (location_type=4), the coordinates must be the ones of the bus pole — if exists — and otherwise of where the travelers are boarding the vehicle (on the sidewalk or the platform, and not on the roadway or the track where the vehicle stops).\n\nConditionally Required:\n- Required for locations which are stops (location_type=0), stations (location_type=1) or entrances/exits (location_type=2).\n- Optional for locations which are generic nodes (location_type=3) or boarding areas (location_type=4).'
      ),
    stop_lon: z
      .number()
      .min(-180.0)
      .max(180.0)
      .describe(
        'Longitude of the location.\n\nFor stops/platforms (location_type=0) and boarding area (location_type=4), the coordinates must be the ones of the bus pole — if exists — and otherwise of where the travelers are boarding the vehicle (on the sidewalk or the platform, and not on the roadway or the track where the vehicle stops).\n\nConditionally Required:\n- Required for locations which are stops (location_type=0), stations (location_type=1) or entrances/exits (location_type=2).\n- Optional for locations which are generic nodes (location_type=3) or boarding areas (location_type=4).'
      ),
    zone_id: z
      .string()
      .describe(
        'Identifies the fare zone for a stop. If this record represents a station or station entrance, the zone_id is ignored.'
      )
      .optional(),
    stop_url: z
      .string()
      .url()
      .describe(
        'URL of a web page about the location. This should be different from the agency.agency_url and the routes.route_url field values.'
      )
      .optional(),
    location_type: z
      .number()
      .describe(
        'Location type. Valid options are:\n\n0 (or empty) - Stop (or Platform). A location where passengers board or disembark from a transit vehicle. Is called a platform when defined within a parent_station.\n1 - Station. A physical structure or area that contains one or more platform.\n2 - Entrance/Exit. A location where passengers can enter or exit a station from the street. If an entrance/exit belongs to multiple stations, it may be linked by pathways to both, but the data provider must pick one of them as parent.\n3 - Generic Node. A location within a station, not matching any other location_type, that may be used to link together pathways define in pathways.txt.\n4 - Boarding Area. A specific location on a platform, where passengers can board and/or alight vehicles.'
      )
      .optional(),
    parent_station: z
      .string()
      .describe(
        'Defines hierarchy between the different locations defined in stops.txt. It contains the ID of the parent location, as followed:\n\n- Stop/platform (location_type=0): the parent_station field contains the ID of a station.\n- Station (location_type=1): this field must be empty.\n- Entrance/exit (location_type=2) or generic node (location_type=3): the parent_station field contains the ID of a station (location_type=1)\n- Boarding Area (location_type=4): the parent_station field contains ID of a platform.\n\nConditionally Required:\n- Required for locations which are entrances (location_type=2), generic nodes (location_type=3) or boarding areas (location_type=4).\n- Optional for stops/platforms (location_type=0).\n- Forbidden for stations (location_type=1).'
      ),
    stop_timezone: z
      .string()
      .describe(
        'Timezone of the location. If the location has a parent station, it inherits the parent station’s timezone instead of applying its own. Stations and parentless stops with empty stop_timezone inherit the timezone specified by agency.agency_timezone. The times provided in stop_times.txt are in the timezone specified by agency.agency_timezone, not stop_timezone. This ensures that the time values in a trip always increase over the course of a trip, regardless of which timezones the trip crosses.'
      )
      .optional(),
    wheelchair_boarding: z
      .number()
      .describe(
        'Indicates whether wheelchair boardings are possible from the location. Valid options are:\n\nFor parentless stops:\n0 or empty - No accessibility information for the stop.\n1 - Some vehicles at this stop can be boarded by a rider in a wheelchair.\n2 - Wheelchair boarding is not possible at this stop.\n\nFor child stops:\n0 or empty - Stop will inherit its wheelchair_boarding behavior from the parent station, if specified in the parent.\n1 - There exists some accessible path from outside the station to the specific stop/platform.\n2 - There exists no accessible path from outside the station to the specific stop/platform.\n\nFor station entrances/exits:\n0 or empty - Station entrance will inherit its wheelchair_boarding behavior from the parent station, if specified for the parent.\n1 - Station entrance is wheelchair accessible.\n2 - No accessible path from station entrance to stops/platforms.'
      )
      .optional(),
    level_id: z
      .string()
      .describe(
        'Level of the location. The same level may be used by multiple unlinked stations.'
      )
      .optional(),
    platform_code: z
      .string()
      .describe(
        'Platform identifier for a platform stop (a stop belonging to a station). This should be just the platform identifier (eg. "G" or "3"). Words like “platform” or "track" (or the feed’s language-specific equivalent) should not be included. This allows feed consumers to more easily internationalize and localize the platform identifier into other languages.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

// TypeScript interface inferred from Zod schema
export type Stops = z.infer<typeof StopsSchema>;

export const RoutesSchema = z
  .object({
    route_id: z.string().describe('Identifies a route.'),
    agency_id: z
      .string()
      .describe(
        'Agency for the specified route.\n\nConditionally Required:\n- Required if multiple agencies are defined in agency.txt.\n- Recommended otherwise.'
      ),
    route_short_name: z
      .string()
      .describe(
        'Short name of a route. Often a short, abstract identifier (e.g., "32", "100X", "Green") that riders use to identify a route. Both route_short_name and route_long_name may be defined.\n\nConditionally Required:\n- Required if routes.route_long_name is empty.\n- Recommended if there is a brief service designation. This should be the commonly-known passenger name of the service, and should be no longer than 12 characters.'
      ),
    route_long_name: z
      .string()
      .describe(
        "Full name of a route. This name is generally more descriptive than the route_short_name and often includes the route's destination or stop. Both route_short_name and route_long_name may be defined.\n\nConditionally Required:\n- Required if routes.route_short_name is empty.\n- Optional otherwise."
      ),
    route_desc: z
      .string()
      .describe(
        'Description of a route that provides useful, quality information. Should not be a duplicate of route_short_name or route_long_name. Example: "A" trains operate between Inwood-207 St, Manhattan and Far Rockaway-Mott Avenue, Queens at all times. Also from about 6AM until about midnight, additional "A" trains operate between Inwood-207 St and Lefferts Boulevard (trains typically alternate between Lefferts Blvd and Far Rockaway).'
      )
      .optional(),
    route_type: z
      .number()
      .describe(
        'Indicates the type of transportation used on a route. Valid options are:\n\n0 - Tram, Streetcar, Light rail. Any light rail or street level system within a metropolitan area.\n1 - Subway, Metro. Any underground rail system within a metropolitan area.\n2 - Rail. Used for intercity or long-distance travel.\n3 - Bus. Used for short- and long-distance bus routes.\n4 - Ferry. Used for short- and long-distance boat service.\n5 - Cable tram. Used for street-level rail cars where the cable runs beneath the vehicle (e.g., cable car in San Francisco).\n6 - Aerial lift, suspended cable car (e.g., gondola lift, aerial tramway). Cable transport where cabins, cars, gondolas or open chairs are suspended by means of one or more cables.\n7 - Funicular. Any rail system designed for steep inclines.\n11 - Trolleybus. Electric buses that draw power from overhead wires using poles.\n12 - Monorail. Railway in which the track consists of a single rail or a beam.'
      ),
    route_url: z
      .string()
      .url()
      .describe(
        'URL of a web page about the particular route. Should be different from the agency.agency_url value.'
      )
      .optional(),
    route_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hexadecimal color')
      .describe(
        'Route color designation that matches public facing material. Defaults to white (FFFFFF) when omitted or left empty. The color difference between route_color and route_text_color should provide sufficient contrast when viewed on a black and white screen.'
      )
      .optional(),
    route_text_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hexadecimal color')
      .describe(
        'Legible color to use for text drawn against a background of route_color. Defaults to black (000000) when omitted or left empty. The color difference between route_color and route_text_color should provide sufficient contrast when viewed on a black and white screen.'
      )
      .optional(),
    route_sort_order: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Orders the routes in a way which is ideal for presentation to customers. Routes with smaller route_sort_order values should be displayed first.'
      )
      .optional(),
    continuous_pickup: z
      .number()
      .describe(
        'Indicates that the rider can board the transit vehicle at any point along the vehicle’s travel path as described by shapes.txt, on every trip of the route. Valid options are:\n\n0 - Continuous stopping pickup.\n1 or empty - No continuous stopping pickup.\n2 - Must phone agency to arrange continuous stopping pickup.\n3 - Must coordinate with driver to arrange continuous stopping pickup.\n\nValues for routes.continuous_pickup may be overridden by defining values in stop_times.continuous_pickup for specific stop_times along the route.\n\nConditionally Forbidden:\n- Any value other than 1 or empty is Forbidden if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window are defined for any trip of this route.\n- Optional otherwise.'
      ),
    continuous_drop_off: z
      .number()
      .describe(
        'Indicates that the rider can alight from the transit vehicle at any point along the vehicle’s travel path as described by shapes.txt, on every trip of the route. Valid options are:\n\n0 - Continuous stopping drop off.\n1 or empty - No continuous stopping drop off.\n2 - Must phone agency to arrange continuous stopping drop off.\n3 - Must coordinate with driver to arrange continuous stopping drop off.\n\nValues for routes.continuous_drop_off may be overridden by defining values in stop_times.continuous_drop_off for specific stop_times along the route.\n\nConditionally Forbidden:\n- Any value other than 1 or empty is Forbidden if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window are defined for any trip of this route.\n- Optional otherwise.'
      ),
    network_id: z
      .string()
      .describe(
        'Identifies a group of routes. Multiple rows in routes.txt may have the same network_id.\n\nConditionally Forbidden:\n- Forbidden if the route_networks.txt file exists.\n- Optional otherwise.'
      ),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

// TypeScript interface inferred from Zod schema
export type Routes = z.infer<typeof RoutesSchema>;

export const TripsSchema = z
  .object({
    route_id: z.string().describe('Identifies a route.'),
    service_id: z
      .union([z.string(), z.string()])
      .describe(
        'Identifies a set of dates when service is available for one or more routes.'
      ),
    trip_id: z.string().describe('Identifies a trip.'),
    trip_headsign: z
      .string()
      .describe(
        "Text that appears on signage identifying the trip's destination to riders. This field is recommended for all services with headsign text displayed on the vehicle which may be used to distinguish amongst trips in a route.\n\nIf the headsign changes during a trip, values for trip_headsign may be overridden by defining values in stop_times.stop_headsign for specific stop_times along the trip."
      )
      .optional(),
    trip_short_name: z
      .string()
      .describe(
        'Public facing text used to identify the trip to riders, for instance, to identify train numbers for commuter rail trips. If riders do not commonly rely on trip names, trip_short_name should be empty. A trip_short_name value, if provided, should uniquely identify a trip within a service day; it should not be used for destination names or limited/express designations.'
      )
      .optional(),
    direction_id: z
      .number()
      .describe(
        'Indicates the direction of travel for a trip. This field should not be used in routing; it provides a way to separate trips by direction when publishing time tables. Valid options are:\n\n0 - Travel in one direction (e.g. outbound travel).\n1 - Travel in the opposite direction (e.g. inbound travel).Example: The trip_headsign and direction_id fields may be used together to assign a name to travel in each direction for a set of trips. A trips.txt file could contain these records for use in time tables:\ntrip_id,...,trip_headsign,direction_id\n1234,...,Airport,0\n1505,...,Downtown,1'
      )
      .optional(),
    block_id: z
      .string()
      .describe(
        'Identifies the block to which the trip belongs. A block consists of a single trip or many sequential trips made using the same vehicle, defined by shared service days and block_id. A block_id may have trips with different service days, making distinct blocks. See the example below. To provide in-seat transfers information, transfers of transfer_type 4 should be provided instead.'
      )
      .optional(),
    shape_id: z
      .string()
      .describe(
        'Identifies a geospatial shape describing the vehicle travel path for a trip.\n\nConditionally Required:\n- Required if the trip has a continuous pickup or drop-off behavior defined either in routes.txt or in stop_times.txt.\n- Optional otherwise.'
      ),
    wheelchair_accessible: z
      .number()
      .describe(
        'Indicates wheelchair accessibility. Valid options are:\n\n0 or empty - No accessibility information for the trip.\n1 - Vehicle being used on this particular trip can accommodate at least one rider in a wheelchair.\n2 - No riders in wheelchairs can be accommodated on this trip.'
      )
      .optional(),
    bikes_allowed: z
      .number()
      .describe(
        'Indicates whether bikes are allowed. Valid options are:\n\n0 or empty - No bike information for the trip.\n1 - Vehicle being used on this particular trip can accommodate at least one bicycle.\n2 - No bicycles are allowed on this trip.'
      )
      .optional(),
    cars_allowed: z
      .number()
      .describe(
        'Indicates whether cars are allowed. Valid options are:\n\n0 or empty - No car information for the trip.\n1 - Vehicle being used on this particular trip can accommodate at least one car.\n2 - No cars are allowed on this trip.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

// TypeScript interface inferred from Zod schema
export type Trips = z.infer<typeof TripsSchema>;

export const StopTimesSchema = z
  .object({
    trip_id: z.string().describe('Identifies a trip.'),
    arrival_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Arrival time at the stop (defined by stop_times.stop_id) for a specific trip (defined by stop_times.trip_id) in the time zone specified by agency.agency_timezone, not stops.stop_timezone.\n\nIf there are not separate times for arrival and departure at a stop, arrival_time and departure_time should be the same.\n\nFor times occurring after midnight on the service day, enter the time as a value greater than 24:00:00 in HH:MM:SS.\n\nIf exact arrival and departure times (timepoint=1) are not available, estimated or interpolated arrival and departure times (timepoint=0) should be provided.\n\nConditionally Required:\n- Required for the first and last stop in a trip (defined by stop_times.stop_sequence).\n- Required for timepoint=1.\n- Forbidden when start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.'
      ),
    departure_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Departure time from the stop (defined by stop_times.stop_id) for a specific trip (defined by stop_times.trip_id) in the time zone specified by agency.agency_timezone, not stops.stop_timezone.\n\nIf there are not separate times for arrival and departure at a stop, arrival_time and departure_time should be the same.\n\nFor times occurring after midnight on the service day, enter the time as a value greater than 24:00:00 in HH:MM:SS.\n\nIf exact arrival and departure times (timepoint=1) are not available, estimated or interpolated arrival and departure times (timepoint=0) should be provided.\n\nConditionally Required:\n- Required for timepoint=1.\n- Forbidden when start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.'
      ),
    stop_id: z
      .string()
      .describe(
        'Identifies the serviced stop. All stops serviced during a trip must have a record in stop_times.txt. Referenced locations must be stops/platforms, i.e. their stops.location_type value must be 0 or empty. A stop may be serviced multiple times in the same trip, and multiple trips and routes may service the same stop.\n\nOn-demand service using stops should be referenced in the sequence in which service is available at those stops. A data consumer should assume that travel is possible from one stop or location to any stop or location later in the trip, provided that the pickup/drop_off_type of each stop_time and the time constraints of each start/end_pickup_drop_off_window do not forbid it.\n\nConditionally Required:\n- Required if stop_times.location_group_id AND stop_times.location_id are NOT defined.\n- Forbidden if stop_times.location_group_id or stop_times.location_id are defined.'
      ),
    location_group_id: z
      .string()
      .describe(
        'Identifies the serviced location group that indicates groups of stops where riders may request pickup or drop off. All location groups serviced during a trip must have a record in stop_times.txt. Multiple trips and routes may service the same location group.\n\nOn-demand service using location groups should be referenced in the sequence in which service is available at those location groups. A data consumer should assume that travel is possible from one stop or location to any stop or location later in the trip, provided that the pickup/drop_off_type of each stop_time and the time constraints of each start/end_pickup_drop_off_window do not forbid it.\n\nConditionally Forbidden:\n- Forbidden if stop_times.stop_id or stop_times.location_id are defined.'
      ),
    location_id: z
      .string()
      .describe(
        'Identifies the GeoJSON location that corresponds to serviced zone where riders may request pickup or drop off. All GeoJSON locations serviced during a trip must have a record in stop_times.txt. Multiple trips and routes may service the same GeoJSON location.\n\nOn-demand service within locations should be referenced in the sequence in which service is available in those locations. A data consumer should assume that travel is possible from one stop or location to any stop or location later in the trip, provided that the pickup/drop_off_type of each stop_time and the time constraints of each start/end_pickup_drop_off_window do not forbid it.\n\nConditionally Forbidden:\n- Forbidden if stop_times.stop_id or stop_times.location_group_id are defined.'
      ),
    stop_sequence: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Order of stops, location groups, or GeoJSON locations for a particular trip. The values must increase along the trip but do not need to be consecutive.Example: The first location on the trip could have a stop_sequence=1, the second location on the trip could have a stop_sequence=23, the third location could have a stop_sequence=40, and so on.\n\nTravel within the same location group or GeoJSON location requires two records in stop_times.txt with the same location_group_id or location_id.'
      ),
    stop_headsign: z
      .string()
      .describe(
        "Text that appears on signage identifying the trip's destination to riders. This field overrides the default trips.trip_headsign when the headsign changes between stops. If the headsign is displayed for an entire trip, trips.trip_headsign should be used instead.\n\nA stop_headsign value specified for one stop_time does not apply to subsequent stop_times in the same trip. If you want to override the trip_headsign for multiple stop_times in the same trip, the stop_headsign value must be repeated in each stop_time row."
      )
      .optional(),
    start_pickup_drop_off_window: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Time that on-demand service becomes available in a GeoJSON location, location group, or stop.\n\nConditionally Required:\n- Required if stop_times.location_group_id or stop_times.location_id is defined.\n- Required if end_pickup_drop_off_window is defined.\n- Forbidden if arrival_time or departure_time is defined.\n- Optional otherwise.'
      ),
    end_pickup_drop_off_window: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Time that on-demand service ends in a GeoJSON location, location group, or stop.\n\nConditionally Required:\n- Required if stop_times.location_group_id or stop_times.location_id is defined.\n- Required if start_pickup_drop_off_window is defined.\n- Forbidden if arrival_time or departure_time is defined.\n- Optional otherwise.'
      ),
    pickup_type: z
      .number()
      .describe(
        'Indicates pickup method. Valid options are:\n\n0 or empty - Regularly scheduled pickup.\n1 - No pickup available.\n2 - Must phone agency to arrange pickup.\n3 - Must coordinate with driver to arrange pickup.\n\nConditionally Forbidden:\n- pickup_type=0 forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- pickup_type=3 forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.'
      ),
    drop_off_type: z
      .number()
      .describe(
        'Indicates drop off method. Valid options are:\n\n0 or empty - Regularly scheduled drop off.\n1 - No drop off available.\n2 - Must phone agency to arrange drop off.\n3 - Must coordinate with driver to arrange drop off.\n\nConditionally Forbidden:\n- drop_off_type=0 forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.'
      ),
    continuous_pickup: z
      .number()
      .describe(
        'Indicates that the rider can board the transit vehicle at any point along the vehicle’s travel path as described by shapes.txt, from this stop_time to the next stop_time in the trip’s stop_sequence. Valid options are:\n\n0 - Continuous stopping pickup.\n1 or empty - No continuous stopping pickup.\n2 - Must phone agency to arrange continuous stopping pickup.\n3 - Must coordinate with driver to arrange continuous stopping pickup.\n\nIf this field is populated, it overrides any continuous pickup behavior defined in routes.txt. If this field is empty, the stop_time inherits any continuous pickup behavior defined in routes.txt.\n\nConditionally Forbidden:\n- Any value other than 1 or empty is Forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.'
      ),
    continuous_drop_off: z
      .number()
      .describe(
        'Indicates that the rider can alight from the transit vehicle at any point along the vehicle’s travel path as described by shapes.txt, from this stop_time to the next stop_time in the trip’s stop_sequence. Valid options are:\n\n0 - Continuous stopping drop off.\n1 or empty - No continuous stopping drop off.\n2 - Must phone agency to arrange continuous stopping drop off.\n3 - Must coordinate with driver to arrange continuous stopping drop off.\n\nIf this field is populated, it overrides any continuous drop-off behavior defined in routes.txt. If this field is empty, the stop_time inherits any continuous drop-off behavior defined in routes.txt.\n\nConditionally Forbidden:\n- Any value other than 1 or empty is Forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.'
      ),
    shape_dist_traveled: z
      .number()
      .nonnegative()
      .describe(
        'Actual distance traveled along the associated shape, from the first stop to the stop specified in this record. This field specifies how much of the shape to draw between any two stops during a trip. Must be in the same units used in shapes.txt. Values used for shape_dist_traveled must increase along with stop_sequence; they must not be used to show reverse travel along a route.\n\nRecommended for routes that have looping or inlining (the vehicle crosses or travels over the same portion of alignment in one trip). See shapes.shape_dist_traveled. Example: If a bus travels a distance of 5.25 kilometers from the start of the shape to the stop,shape_dist_traveled=5.25.'
      )
      .optional(),
    timepoint: z
      .number()
      .describe(
        'Indicates if arrival and departure times for a stop are strictly adhered to by the vehicle or if they are instead approximate and/or interpolated times. This field allows a GTFS producer to provide interpolated stop-times, while indicating that the times are approximate. Valid options are:\n\n0 - Times are considered approximate.\n1 - Times are considered exact.\n\nAll records of stop_times.txt with defined arrival or departure times should have timepoint values populated. If no timepoint values are provided, all times are considered exact.'
      )
      .optional(),
    pickup_booking_rule_id: z
      .string()
      .describe(
        'Identifies the boarding booking rule at this stop time.\n\nRecommended when pickup_type=2.'
      )
      .optional(),
    drop_off_booking_rule_id: z
      .string()
      .describe(
        'Identifies the alighting booking rule at this stop time.\n\nRecommended when drop_off_type=2.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

// TypeScript interface inferred from Zod schema
export type StopTimes = z.infer<typeof StopTimesSchema>;

export const CalendarSchema = z.object({
  service_id: z
    .string()
    .describe(
      'Identifies a set of dates when service is available for one or more routes.'
    ),
  monday: z
    .number()
    .describe(
      'Indicates whether the service operates on all Mondays in the date range specified by the start_date and end_date fields. Note that exceptions for particular dates may be listed in calendar_dates.txt. Valid options are:\n\n1 - Service is available for all Mondays in the date range.\n0 - Service is not available for Mondays in the date range.'
    ),
  tuesday: z
    .number()
    .describe('Functions in the same way as monday except applies to Tuesdays'),
  wednesday: z
    .number()
    .describe(
      'Functions in the same way as monday except applies to Wednesdays'
    ),
  thursday: z
    .number()
    .describe(
      'Functions in the same way as monday except applies to Thursdays'
    ),
  friday: z
    .number()
    .describe('Functions in the same way as monday except applies to Fridays'),
  saturday: z
    .number()
    .describe(
      'Functions in the same way as monday except applies to Saturdays.'
    ),
  sunday: z
    .number()
    .describe('Functions in the same way as monday except applies to Sundays.'),
  start_date: z
    .string()
    .regex(/^\d{8}$/, 'Must be in YYYYMMDD format')
    .describe('Start service day for the service interval.'),
  end_date: z
    .string()
    .regex(/^\d{8}$/, 'Must be in YYYYMMDD format')
    .describe(
      'End service day for the service interval. This service day is included in the interval.'
    ),
});

// TypeScript interface inferred from Zod schema
export type Calendar = z.infer<typeof CalendarSchema>;

export const CalendarDatesSchema = z
  .object({
    service_id: z
      .union([z.string(), z.string()])
      .describe(
        'Identifies a set of dates when a service exception occurs for one or more routes. Each (service_id, date) pair may only appear once in calendar_dates.txt if using calendar.txt and calendar_dates.txt in conjunction. If a service_id value appears in both calendar.txt and calendar_dates.txt, the information in calendar_dates.txt modifies the service information specified in calendar.txt.'
      ),
    date: z
      .string()
      .regex(/^\d{8}$/, 'Must be in YYYYMMDD format')
      .describe('Date when service exception occurs.'),
    exception_type: z
      .number()
      .describe(
        'Indicates whether service is available on the date specified in the date field. Valid options are:\n\n1 - Service has been added for the specified date.\n2 - Service has been removed for the specified date.Example: Suppose a route has one set of trips available on holidays and another set of trips available on all other days. One service_id could correspond to the regular service schedule and another service_id could correspond to the holiday schedule. For a particular holiday, the calendar_dates.txt file could be used to add the holiday to the holiday service_id and to remove the holiday from the regular service_id schedule.'
      ),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const FareAttributesSchema = z
  .object({
    fare_id: z.string().describe('Identifies a fare class.'),
    price: z
      .number()
      .nonnegative()
      .describe('Fare price, in the unit specified by currency_type.'),
    currency_type: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code')
      .describe('Currency used to pay the fare.'),
    payment_method: z
      .number()
      .describe(
        'Indicates when the fare must be paid. Valid options are:\n\n0 - Fare is paid on board.\n1 - Fare must be paid before boarding.'
      ),
    transfers: z
      .number()
      .describe(
        'Indicates the number of transfers permitted on this fare. Valid options are:\n\n0 - No transfers permitted on this fare.\n1 - Riders may transfer once.\n2 - Riders may transfer twice.\nempty - Unlimited transfers are permitted.'
      ),
    agency_id: z
      .string()
      .describe(
        'Identifies the relevant agency for a fare.\n\nConditionally Required:\n- Required if multiple agencies are defined in agency.txt.\n- Recommended otherwise.'
      ),
    transfer_duration: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Length of time in seconds before a transfer expires. When transfers=0 this field may be used to indicate how long a ticket is valid for or it may be left empty.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const FareRulesSchema = z
  .object({
    fare_id: z.string().describe('Identifies a fare class.'),
    route_id: z
      .string()
      .describe(
        'Identifies a route associated with the fare class. If several routes with the same fare attributes exist, create a record in fare_rules.txt for each route.Example: If fare class "b" is valid on route "TSW" and "TSE", the fare_rules.txt file would contain these records for the fare class:\nfare_id,route_id\nb,TSW\nb,TSE'
      )
      .optional(),
    origin_id: z
      .string()
      .describe(
        'Identifies an origin zone. If a fare class has multiple origin zones, create a record in fare_rules.txt for each origin_id.Example: If fare class "b" is valid for all travel originating from either zone "2" or zone "8", the fare_rules.txt file would contain these records for the fare class:\nfare_id,...,origin_id\nb,...,2\nb,...,8'
      )
      .optional(),
    destination_id: z
      .string()
      .describe(
        'Identifies a destination zone. If a fare class has multiple destination zones, create a record in fare_rules.txt for each destination_id.Example: The origin_id and destination_id fields could be used together to specify that fare class "b" is valid for travel between zones 3 and 4, and for travel between zones 3 and 5, the fare_rules.txt file would contain these records for the fare class:\nfare_id,...,origin_id,destination_id\nb,...,3,4\nb,...,3,5'
      )
      .optional(),
    contains_id: z
      .string()
      .describe(
        'Identifies the zones that a rider will enter while using a given fare class. Used in some systems to calculate correct fare class. Example: If fare class "c" is associated with all travel on the GRT route that passes through zones 5, 6, and 7 the fare_rules.txt would contain these records:\nfare_id,route_id,...,contains_id\nc,GRT,...,5\nc,GRT,...,6\nc,GRT,...,7\nBecause all contains_id zones must be matched for the fare to apply, an itinerary that passes through zones 5 and 6 but not zone 7 would not have fare class "c". For more detail, see https://code.google.com/p/googletransitdatafeed/wiki/FareExamples in the GoogleTransitDataFeed project wiki.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const TimeframesSchema = z
  .object({
    timeframe_group_id: z
      .string()
      .describe('Identifies a timeframe or set of timeframes.'),
    start_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Defines the beginning of a timeframe. The interval includes the start time.\nValues greater than 24:00:00 are forbidden. An empty value in start_time is considered 00:00:00.\n\nConditionally Required:\n- Required if timeframes.end_time is defined.\n- Forbidden otherwise'
      ),
    end_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Defines the end of a timeframe. The interval does not include the end time.\nValues greater than 24:00:00 are forbidden. An empty value in end_time is considered 24:00:00.\n\nConditionally Required:\n- Required if timeframes.start_time is defined.\n- Forbidden otherwise'
      ),
    service_id: z
      .union([z.string(), z.string()])
      .describe('Identifies a set of dates that a timeframe is in effect.'),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const RiderCategoriesSchema = z.object({
  rider_category_id: z.string().describe('Identifies a rider category.'),
  rider_category_name: z
    .string()
    .describe('Rider category name as displayed to the rider.'),
  is_default_fare_category: z
    .number()
    .describe(
      'Specifies if an entry in rider_categories.txt should be considered the default category (i.e. the main category that should be displayed to riders). For example: Adult fare, Regular fare, etc. Valid options are:\n\n0 or empty - Category is not considered the default.\n1 - Category is considered the default one.\n\nWhen multiple rider categories are eligible for a single fare product specified by a fare_product_id, there must be exactly one of these eligible rider categories indicated as the default rider category (is_default_fare_category = 1).'
    ),
  eligibility_url: z
    .string()
    .url()
    .describe(
      'URL of a web page, usually from the operating agency, that provides detailed information about a specific rider category and/or describes its eligibility criteria.'
    )
    .optional(),
});

export const FareMediaSchema = z.object({
  fare_media_id: z.string().describe('Identifies a fare media.'),
  fare_media_name: z
    .string()
    .describe(
      'Name of the fare media.\n\nFor fare media which are transit cards (fare_media_type =2) or mobile apps (fare_media_type =4), the fare_media_name should be included and should match the rider-facing name used by the organizations delivering them.'
    )
    .optional(),
  fare_media_type: z
    .number()
    .describe(
      'The type of fare media. Valid options are:\n\n0 - None. Used when there is no fare media involved in purchasing or validating a fare product, such as paying cash to a driver or conductor with no physical ticket provided.\n1 - Physical paper ticket that allows a passenger to take either a certain number of pre-purchased trips or unlimited trips within a fixed period of time.\n2 - Physical transit card that has stored tickets, passes or monetary value.\n3 - cEMV (contactless Europay, Mastercard and Visa) as an open-loop token container for account-based ticketing.\n4 - Mobile app that have stored virtual transit cards, tickets, passes, or monetary value.'
    ),
});

export const FareProductsSchema = z
  .object({
    fare_product_id: z
      .string()
      .describe(
        'Identifies a fare product or set of fare products.\n\nMultiple records sharing the same fare_product_id are permitted as long as they contain different fare_media_ids or rider_category_ids. Differing fare_media_ids would indicate various methods are available for employing the fare product, potentially at different prices. Differing rider_category_ids would indicate multiple rider categories are eligible for the fare product, potentially at different prices.'
      ),
    fare_product_name: z
      .string()
      .describe('The name of the fare product as displayed to riders.')
      .optional(),
    rider_category_id: z
      .string()
      .describe(
        'Identifies a rider category eligible for the fare product.\n\nIf fare_products.rider_category_id is empty, the fare product is eligible for any rider_category_id.\n\nWhen multiple rider categories are eligible for a single fare product specified by a fare_product_id, there must be only one of these rider categories indicated as the default rider category (is_default_fare_category = 1).'
      )
      .optional(),
    fare_media_id: z
      .string()
      .describe(
        'Identifies a fare media that can be employed to use the fare product during the trip. When fare_media_id is empty, it is considered that the fare media is unknown.'
      )
      .optional(),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,4})?$/, 'Must be a valid decimal amount')
      .describe(
        'The cost of the fare product. May be negative to represent transfer discounts. May be zero to represent a fare product that is free.'
      ),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code')
      .describe('The currency of the cost of the fare product.'),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const FareLegRulesSchema = z
  .object({
    leg_group_id: z
      .string()
      .describe(
        'Identifies a group of entries in fare_leg_rules.txt.\n\nUsed to describe fare transfer rules between fare_transfer_rules.from_leg_group_id and fare_transfer_rules.to_leg_group_id.\n\nMultiple entries in fare_leg_rules.txt may belong to the same fare_leg_rules.leg_group_id.\n\nThe same entry in fare_leg_rules.txt (not including fare_leg_rules.leg_group_id) must not belong to multiple fare_leg_rules.leg_group_id.'
      )
      .optional(),
    network_id: z
      .union([z.string(), z.string()])
      .describe(
        'Identifies a route network that applies for the fare leg rule.\n\nIf the rule_priority field does not exist AND there are no matching fare_leg_rules.network_id values to the network_id being filtered, empty fare_leg_rules.network_id will be matched by default.\n\nAn empty entry in fare_leg_rules.network_id corresponds to all networks defined in routes.txt or networks.txt excluding the ones listed under fare_leg_rules.network_id\n\nIf the rule_priority field exists in the file, an empty fare_leg_rules.network_id indicates that the route network of the leg does not affect the matching of this rule.\n\nWhen matching against an effective fare leg of multiple legs, each leg must have the same network_id which will be used for matching.'
      )
      .optional(),
    from_area_id: z
      .string()
      .describe(
        'Identifies a departure area.\n\nIf the rule_priority field does not exist AND there are no matching fare_leg_rules.from_area_id values to the area_id being filtered, empty fare_leg_rules.from_area_id will be matched by default.\n\nAn empty entry in fare_leg_rules.from_area_id corresponds to all areas defined in areas.area_id excluding the ones listed under fare_leg_rules.from_area_id\n\nIf the rule_priority field exists in the file, an empty fare_leg_rules.from_area_id indicates that the departure area of the leg does not affect the matching of this rule.\n\nWhen matching against an effective fare leg of multiple legs, the first leg of the effective fare leg is used for determining the departure area.'
      )
      .optional(),
    to_area_id: z
      .string()
      .describe(
        'Identifies an arrival area.\n\nIf the rule_priority field does not exist AND there are no matching fare_leg_rules.to_area_id values to the area_id being filtered, empty fare_leg_rules.to_area_id will be matched by default.\n\nAn empty entry in fare_leg_rules.to_area_id corresponds to all areas defined in areas.area_id excluding the ones listed under fare_leg_rules.to_area_id\n\nIf the rule_priority field exists in the file, an empty fare_leg_rules.to_area_id indicates that the arrival area of the leg does not affect the matching of this rule.\n\nWhen matching against an effective fare leg of multiple legs, the last leg of the effective fare leg is used for determining the arrival area.'
      )
      .optional(),
    from_timeframe_group_id: z
      .string()
      .describe(
        "Defines the timeframe for the fare validation event at the start of the fare leg.\n\nThe “start time” of the fare leg is the time at which the event is scheduled to occur. For example, the time could be the scheduled departure time of a bus at the start of a fare leg where the rider boards and validates their fare. For the rule matching semantics below, the start time is computed in local time, as determined by Local Time Semantics of timeframes.txt. The stop or station of the fare leg’s departure event should be used for timezone resolution, where appropriate.\n\nFor a fare leg rule that specifies a from_timeframe_group_id, that rule will match a particular leg if there exists at least one record in timeframes.txt where all of the following conditions are true\n- The value of timeframe_group_id is equal to the from_timeframe_group_id value.\n- The set of days identified by the record’s service_id contains the “current day” of the fare leg’s start time.\n- The “time-of-day” of the fare leg's start time is greater than or equal to the record’s timeframes.start_time value and less than the timeframes.end_time value.\n\nAn empty fare_leg_rules.from_timeframe_group_id indicates that the start time of the leg does not affect the matching of this rule.\n\nWhen matching against an effective fare leg of multiple legs, the first leg of the effective fare leg is used for determining the starting fare validation event."
      )
      .optional(),
    to_timeframe_group_id: z
      .string()
      .describe(
        "Defines the timeframe for the fare validation event at the end of the fare leg.\n\nThe “end time” of the fare leg is the time at which the event is scheduled to occur. For example, the time could be the scheduled arrival time of a bus at the end of a fare leg where the rider gets off and validates their fare. For the rule matching semantics below, the end time is computed in local time, as determined by Local Time Semantics of timeframes.txt. The stop or station of the fare leg’s arrival event should be used for timezone resolution, where appropriate.\n\nFor a fare leg rule that specifies a to_timeframe_group_id, that rule will match a particular leg if there exists at least one record in timeframes.txt where all of the following conditions are true\n- The value of timeframe_group_id is equal to the to_timeframe_group_id value.\n- The set of days identified by the record’s service_id contains the “current day” of the fare leg’s end time.\n- The “time-of-day” of the fare leg's end time is greater than or equal to the record’s timeframes.start_time value and less than the timeframes.end_time value.\n\nAn empty fare_leg_rules.to_timeframe_group_id indicates that the end time of the leg does not affect the matching of this rule.\n\nWhen matching against an effective fare leg of multiple legs, the last leg of the effective fare leg is used for determining the ending fare validation event."
      )
      .optional(),
    fare_product_id: z
      .string()
      .describe('The fare product required to travel the leg.'),
    rule_priority: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Defines the order of priority in which matching rules are applied to legs, allowing certain rules to take precedence over others. When multiple entries in fare_leg_rules.txt match, the rule or set of rules with the highest value for rule_priority will be selected.\n\nAn empty value for rule_priority is treated as zero.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const FareLegJoinRulesSchema = z
  .object({
    from_network_id: z
      .union([z.string(), z.string()])
      .describe(
        'Matches a pre-transfer leg that uses the specified route network. If specified, the same to_network_id must also be specified.'
      ),
    to_network_id: z
      .union([z.string(), z.string()])
      .describe(
        'Matches a post-transfer leg that uses the specified route network. If specified, the same from_network_id must also be specified.'
      ),
    from_stop_id: z
      .string()
      .describe(
        'Matches a pre-transfer leg that ends at the specified stop (location_type=0 or empty) or station (location_type=1).\n\nConditionally Required:\n- Required if to_stop_id is defined.\n- Optional otherwise.'
      ),
    to_stop_id: z
      .string()
      .describe(
        'Matches a post-transfer leg that starts at the specified stop (location_type=0 or empty) or station (location_type=1).\n\nConditionally Required:\n- Required if from_stop_id is defined.\n- Optional otherwise.'
      ),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const FareTransferRulesSchema = z
  .object({
    from_leg_group_id: z
      .string()
      .describe(
        'Identifies a group of pre-transfer fare leg rules.\n\nIf there are no matching fare_transfer_rules.from_leg_group_id values to the leg_group_id being filtered, empty fare_transfer_rules.from_leg_group_id will be matched by default.\n\nAn empty entry in fare_transfer_rules.from_leg_group_id corresponds to all leg groups defined under fare_leg_rules.leg_group_id excluding the ones listed under fare_transfer_rules.from_leg_group_id'
      )
      .optional(),
    to_leg_group_id: z
      .string()
      .describe(
        'Identifies a group of post-transfer fare leg rules.\n\nIf there are no matching fare_transfer_rules.to_leg_group_id values to the leg_group_id being filtered, empty fare_transfer_rules.to_leg_group_id will be matched by default.\n\nAn empty entry in fare_transfer_rules.to_leg_group_id corresponds to all leg groups defined under fare_leg_rules.leg_group_id excluding the ones listed under fare_transfer_rules.to_leg_group_id'
      )
      .optional(),
    transfer_count: z
      .number()
      .int()
      .positive()
      .describe(
        'Defines how many consecutive transfers the transfer rule may be applied to.\n\nValid options are:\n-1 - No limit.\n1 or more - Defines how many transfers the transfer rule may span.\n\nIf a sub-journey matches multiple records with different transfer_counts, then the rule with the minimum transfer_count that is greater than or equal to the current transfer count of the sub-journey is to be selected.\n\nConditionally Forbidden:\n- Forbidden if fare_transfer_rules.from_leg_group_id does not equal fare_transfer_rules.to_leg_group_id.\n- Required if fare_transfer_rules.from_leg_group_id equals fare_transfer_rules.to_leg_group_id.'
      ),
    duration_limit: z
      .number()
      .int()
      .positive()
      .describe(
        'Defines the duration limit of the transfer.\n\nMust be expressed in integer increments of seconds.\n\nIf there is no duration limit, fare_transfer_rules.duration_limit must be empty.'
      )
      .optional(),
    duration_limit_type: z
      .number()
      .describe(
        'Defines the relative start and end of fare_transfer_rules.duration_limit.\n\nValid options are:\n0 - Between the departure fare validation of the current leg and the arrival fare validation of the next leg.\n1 - Between the departure fare validation of the current leg and the departure fare validation of the next leg.\n2 - Between the arrival fare validation of the current leg and the departure fare validation of the next leg.\n3 - Between the arrival fare validation of the current leg and the arrival fare validation of the next leg.\n\nConditionally Required:\n- Required if fare_transfer_rules.duration_limit is defined.\n- Forbidden if fare_transfer_rules.duration_limit is empty.'
      ),
    fare_transfer_type: z
      .number()
      .describe(
        'Indicates the cost processing method of transferring between legs in a journey:\n\nValid options are:\n0 - From-leg fare_leg_rules.fare_product_id plus fare_transfer_rules.fare_product_id; A + AB.\n1 - From-leg fare_leg_rules.fare_product_id plus fare_transfer_rules.fare_product_id plus to-leg fare_leg_rules.fare_product_id; A + AB + B.\n2 - fare_transfer_rules.fare_product_id; AB.\n\nCost processing interactions between multiple transfers in a journey:\n\nfare_transfer_typeProcessing A > BProcessing B > C0A + ABS + BC1A + AB +BS + BC + C2ABS + BCWhere S indicates the total processed cost of the preceding leg(s) and transfer(s).'
      ),
    fare_product_id: z
      .string()
      .describe(
        'The fare product required to transfer between two fare legs. If empty, the cost of the transfer rule is 0.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const AreasSchema = z.object({
  area_id: z
    .string()
    .describe('Identifies an area. Must be unique in areas.txt.'),
  area_name: z
    .string()
    .describe('The name of the area as displayed to the rider.')
    .optional(),
});

export const StopAreasSchema = z
  .object({
    area_id: z
      .string()
      .describe(
        'Identifies an area to which one or multiple stop_ids belong. The same stop_id may be defined in many area_ids.'
      ),
    stop_id: z
      .string()
      .describe(
        'Identifies a stop. If a station (i.e. a stop with stops.location_type=1) is defined in this field, it is assumed that all of its platforms (i.e. all stops with stops.location_type=0 that have this station defined as stops.parent_station) are part of the same area. This behavior can be overridden by assigning platforms to other areas.'
      ),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const NetworksSchema = z.object({
  network_id: z
    .string()
    .describe('Identifies a network. Must be unique in networks.txt.'),
  network_name: z
    .string()
    .describe(
      'The name of the network that apply for fare leg rules, as used by the local agency and its riders.'
    )
    .optional(),
});

export const RouteNetworksSchema = z
  .object({
    network_id: z
      .string()
      .describe(
        'Identifies a network to which one or multiple route_ids belong. A route_id can only be defined in one network_id.'
      ),
    route_id: z.string().describe('Identifies a route.'),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const ShapesSchema = z.object({
  shape_id: z.string().describe('Identifies a shape.'),
  shape_pt_lat: z
    .number()
    .min(-90.0)
    .max(90.0)
    .describe(
      'Latitude of a shape point. Each record in shapes.txt represents a shape point used to define the shape.'
    ),
  shape_pt_lon: z
    .number()
    .min(-180.0)
    .max(180.0)
    .describe('Longitude of a shape point.'),
  shape_pt_sequence: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Sequence in which the shape points connect to form the shape. Values must increase along the trip but do not need to be consecutive.Example: If the shape "A_shp" has three points in its definition, the shapes.txt file might contain these records to define the shape:\nshape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nA_shp,37.61956,-122.48161,0\nA_shp,37.64430,-122.41070,6\nA_shp,37.65863,-122.30839,11'
    ),
  shape_dist_traveled: z
    .number()
    .nonnegative()
    .describe(
      'Actual distance traveled along the shape from the first shape point to the point specified in this record. Used by trip planners to show the correct portion of the shape on a map. Values must increase along with shape_pt_sequence; they must not be used to show reverse travel along a route. Distance units must be consistent with those used in stop_times.txt.\n\nRecommended for routes that have looping or inlining (the vehicle crosses or travels over the same portion of alignment in one trip).\n\nIf a vehicle retraces or crosses the route alignment at points in the course of a trip, shape_dist_traveled is important to clarify how portions of the points in shapes.txt line up correspond with records in stop_times.txt.Example: If a bus travels along the three points defined above for A_shp, the additional shape_dist_traveled values (shown here in kilometers) would look like this:\nshape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\nA_shp,37.61956,-122.48161,0,0\nA_shp,37.64430,-122.41070,6,6.8310\nA_shp,37.65863,-122.30839,11,15.8765'
    )
    .optional(),
});

export const FrequenciesSchema = z
  .object({
    trip_id: z
      .string()
      .describe(
        'Identifies a trip to which the specified headway of service applies.'
      ),
    start_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Time at which the first vehicle departs from the first stop of the trip with the specified headway.'
      ),
    end_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Time at which service changes to a different headway (or ceases) at the first stop in the trip.'
      ),
    headway_secs: z
      .number()
      .int()
      .positive()
      .describe(
        'Time, in seconds, between departures from the same stop (headway) for the trip, during the time interval specified by start_time and end_time. Multiple headways may be defined for the same trip, but must not overlap. New headways may start at the exact time the previous headway ends.'
      ),
    exact_times: z
      .number()
      .describe(
        'Indicates the type of service for a trip. See the file description for more information. Valid options are:\n\n0 or empty - Frequency-based trips.\n1 - Schedule-based trips with the exact same headway throughout the day. In this case the end_time value must be greater than the last desired trip start_time but less than the last desired trip start_time + headway_secs.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const TransfersSchema = z
  .object({
    from_stop_id: z
      .string()
      .describe(
        'Identifies a stop (location_type=0) or a station (location_type=1) where a connection between routes begins. If this field refers to a station, the transfer rule applies to all its child stops. It must refer to a stop (location_type=0) if transfer_type is 4 or 5.\n\nConditionally Required:\n- Required if transfer_type is 1, 2, or 3.\n- Optional if transfer_type is 4 or 5.'
      ),
    to_stop_id: z
      .string()
      .describe(
        'Identifies a stop (location_type=0) or a station (location_type=1) where a connection between routes ends. If this field refers to a station, the transfer rule applies to all child stops. It must refer to a stop (location_type=0) if transfer_type is 4 or 5.\n\nConditionally Required:\n- Required if transfer_type is 1, 2, or 3.\n- Optional if transfer_type is 4 or 5.'
      ),
    from_route_id: z
      .string()
      .describe(
        'Identifies a route where a connection begins.\n\nIf from_route_id is defined, the transfer will apply to the arriving trip on the route for the given from_stop_id.\n\nIf both from_trip_id and from_route_id are defined, the trip_id must belong to the route_id, and from_trip_id will take precedence.'
      )
      .optional(),
    to_route_id: z
      .string()
      .describe(
        'Identifies a route where a connection ends.\n\nIf to_route_id is defined, the transfer will apply to the departing trip on the route for the given to_stop_id.\n\nIf both to_trip_id and to_route_id are defined, the trip_id must belong to the route_id, and to_trip_id will take precedence.'
      )
      .optional(),
    from_trip_id: z
      .string()
      .describe(
        'Identifies a trip where a connection between routes begins.\n\nIf from_trip_id is defined, the transfer will apply to the arriving trip for the given from_stop_id.\n\nIf both from_trip_id and from_route_id are defined, the trip_id must belong to the route_id, and from_trip_id will take precedence.\n\nConditionally Required:\n- Required if transfer_type is 4 or 5.\n- Optional otherwise.'
      ),
    to_trip_id: z
      .string()
      .describe(
        'Identifies a trip where a connection between routes ends.\n\nIf to_trip_id is defined, the transfer will apply to the departing trip for the given to_stop_id.\n\nIf both to_trip_id and to_route_id are defined, the trip_id must belong to the route_id, and to_trip_id will take precedence.\n\nConditionally Required:\n- Required if transfer_type is 4 or 5.\n- Optional otherwise.'
      ),
    transfer_type: z
      .number()
      .describe(
        'Indicates the type of connection for the specified (from_stop_id, to_stop_id) pair. Valid options are:\n\n0 or empty - Recommended transfer point between routes.\n1 - Timed transfer point between two routes. The departing vehicle is expected to wait for the arriving one and leave sufficient time for a rider to transfer between routes.\n2 - Transfer requires a minimum amount of time between arrival and departure to ensure a connection. The time required to transfer is specified by min_transfer_time.\n3 - Transfers are not possible between routes at the location.\n4 - Passengers can transfer from one trip to another by staying onboard the same vehicle (an "in-seat transfer"). More details about this type of transfer below.\n5 - In-seat transfers are not allowed between sequential trips. The passenger must alight from the vehicle and re-board. More details about this type of transfer below.'
      ),
    min_transfer_time: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Amount of time, in seconds, that must be available to permit a transfer between routes at the specified stops. The min_transfer_time should be sufficient to permit a typical rider to move between the two stops, including buffer time to allow for schedule variance on each route.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const PathwaysSchema = z
  .object({
    pathway_id: z
      .string()
      .describe(
        'Identifies a pathway. Used by systems as an internal identifier for the record. Must be unique in the dataset.\n\nDifferent pathways may have the same values for from_stop_id and to_stop_id.Example: When two escalators are side-by-side in opposite directions, or when a stair set and elevator go from the same place to the same place, different pathway_id may have the same from_stop_id and to_stop_id values.'
      ),
    from_stop_id: z
      .string()
      .describe(
        'Location at which the pathway begins.\n\nMust contain a stop_id that identifies a platform (location_type=0 or empty), entrance/exit (location_type=2), generic node (location_type=3) or boarding area (location_type=4).\n\nValues for stop_id that identify stations (location_type=1) are forbidden.'
      ),
    to_stop_id: z
      .string()
      .describe(
        'Location at which the pathway ends.\n\nMust contain a stop_id that identifies a platform (location_type=0 or empty), entrance/exit (location_type=2), generic node (location_type=3) or boarding area (location_type=4).\n\nValues for stop_id that identify stations (location_type=1) are forbidden.'
      ),
    pathway_mode: z
      .number()
      .describe(
        'Type of pathway between the specified (from_stop_id, to_stop_id) pair. Valid options are:\n\n1 - Walkway.\n2 - Stairs.\n3 - Moving sidewalk/travelator.\n4 - Escalator.\n5 - Elevator.\n6 - Fare gate (or payment gate): A pathway that crosses into an area of the station where proof of payment is required to cross. Fare gates may separate paid areas of the station from unpaid ones, or separate different payment areas within the same station from each other. This information can be used to avoid routing passengers through stations using shortcuts that would require passengers to make unnecessary payments, like directing a passenger to walk through a subway platform to reach a busway.\n7- Exit gate: A pathway exiting a paid area into an unpaid area where proof of payment is not required to cross.'
      ),
    is_bidirectional: z
      .number()
      .describe(
        'Indicates the direction that the pathway can be taken:\n\n0 - Unidirectional pathway that can only be used from from_stop_id to to_stop_id.\n1 - Bidirectional pathway that can be used in both directions.\n\nExit gates (pathway_mode=7) must not be bidirectional.'
      ),
    length: z
      .number()
      .nonnegative()
      .describe(
        'Horizontal length in meters of the pathway from the origin location (defined in from_stop_id) to the destination location (defined in to_stop_id).\n\nThis field is recommended for walkways (pathway_mode=1), fare gates (pathway_mode=6) and exit gates (pathway_mode=7).'
      )
      .optional(),
    traversal_time: z
      .number()
      .int()
      .positive()
      .describe(
        'Average time in seconds needed to walk through the pathway from the origin location (defined in from_stop_id) to the destination location (defined in to_stop_id).\n\nThis field is recommended for moving sidewalks (pathway_mode=3), escalators (pathway_mode=4) and elevator (pathway_mode=5).'
      )
      .optional(),
    stair_count: z
      .number()
      .int()
      .describe(
        'Number of stairs of the pathway.\n\nA positive stair_count implies that the rider walk up from from_stop_id to to_stop_id. And a negative stair_count implies that the rider walk down from from_stop_id to to_stop_id.\n\nThis field is recommended for stairs (pathway_mode=2).\n\nIf only an estimated stair count can be provided, it is recommended to approximate 15 stairs for 1 floor.'
      )
      .optional(),
    max_slope: z
      .number()
      .describe(
        'Maximum slope ratio of the pathway. Valid options are:\n\n0 or empty - No slope.\nFloat - Slope ratio of the pathway, positive for upwards, negative for downwards.\n\nThis field should only be used with walkways (pathway_mode=1) and moving sidewalks (pathway_mode=3).Example: In the US, 0.083 (also written 8.3%) is the maximum slope ratio for hand-propelled wheelchair, which mean an increase of 0.083m (so 8.3cm) for each 1m.'
      )
      .optional(),
    min_width: z
      .number()
      .positive()
      .describe(
        'Minimum width of the pathway in meters.\n\nThis field is recommended if the minimum width is less than 1 meter.'
      )
      .optional(),
    signposted_as: z
      .string()
      .describe(
        "Public facing text from physical signage that is visible to riders.\n\nMay be used to provide text directions to riders, such as 'follow signs to '. The text in singposted_as should appear exactly how it is printed on the signs.\n\nWhen the physical signage is multilingual, this field may be populated and translated following the example of stops.stop_name in the field definition of feed_info.feed_lang."
      )
      .optional(),
    reversed_signposted_as: z
      .string()
      .describe(
        'Same as signposted_as, but when the pathway is used from the to_stop_id to the from_stop_id.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const LevelsSchema = z.object({
  level_id: z.string().describe('Identifies a level in a station.'),
  level_index: z
    .number()
    .describe(
      'Numeric index of the level that indicates its relative position.\n\nGround level should have index 0, with levels above ground indicated by positive indices and levels below ground by negative indices.'
    ),
  level_name: z
    .string()
    .describe(
      'Name of the level as seen by the rider inside the building or station.Example: Take the elevator to "Mezzanine" or "Platform" or "-1".'
    )
    .optional(),
});

export const LocationGroupsSchema = z.object({
  location_group_id: z
    .string()
    .describe(
      'Identifies a location group. ID must be unique across all stops.stop_id, locations.geojson id, and location_groups.location_group_id values.\n\nA location group is a group of stops that together indicate locations where a rider may request pickup or drop off.'
    ),
  location_group_name: z
    .string()
    .describe('The name of the location group as displayed to the rider.')
    .optional(),
});

export const LocationGroupStopsSchema = z
  .object({
    location_group_id: z
      .string()
      .describe(
        'Identifies a location group to which one or multiple stop_ids belong. The same stop_id may be defined in many location_group_ids.'
      ),
    stop_id: z
      .string()
      .describe('Identifies a stop belonging to the location group.'),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const BookingRulesSchema = z
  .object({
    booking_rule_id: z.string().describe('Identifies a rule.'),
    booking_type: z
      .number()
      .describe(
        'Indicates how far in advance booking can be made. Valid options are:\n\n0 - Real time booking.\n1 - Up to same-day booking with advance notice.\n2 - Up to prior day(s) booking.'
      ),
    prior_notice_duration_min: z
      .number()
      .int()
      .describe(
        'Minimum number of minutes before travel to make the request.\n\nConditionally Required:\n- Required for booking_type=1.\n- Forbidden otherwise.'
      ),
    prior_notice_duration_max: z
      .number()
      .int()
      .describe(
        'Maximum number of minutes before travel to make the booking request.\n\nConditionally Forbidden:\n- Forbidden for booking_type=0 and booking_type=2.\n- Optional for booking_type=1.'
      ),
    prior_notice_last_day: z
      .number()
      .int()
      .describe(
        'Last day before travel to make the booking request.\n\nExample: “Ride must be booked 1 day in advance before 5PM” will be encoded as prior_notice_last_day=1.\n\nConditionally Required:\n- Required for booking_type=2.\n- Forbidden otherwise.'
      ),
    prior_notice_last_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Last time on the last day before travel to make the booking request.\n\nExample: “Ride must be booked 1 day in advance before 5PM” will be encoded as prior_notice_last_time=17:00:00.\n\nConditionally Required:\n- Required if prior_notice_last_day is defined.\n- Forbidden otherwise.'
      ),
    prior_notice_start_day: z
      .number()
      .int()
      .describe(
        'Earliest day before travel to make the booking request.\n\nExample: “Ride can be booked at the earliest one week in advance at midnight” will be encoded as prior_notice_start_day=7.\n\nConditionally Forbidden:\n- Forbidden for booking_type=0.\n- Forbidden for booking_type=1 if prior_notice_duration_max is defined.\n- Optional otherwise.'
      ),
    prior_notice_start_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format')
      .describe(
        'Earliest time on the earliest day before travel to make the booking request.\n\nExample: “Ride can be booked at the earliest one week in advance at midnight” will be encoded as prior_notice_start_time=00:00:00.\n\nConditionally Required:\n- Required if prior_notice_start_day is defined.\n- Forbidden otherwise.'
      ),
    prior_notice_service_id: z
      .string()
      .describe(
        'Indicates the service days on which prior_notice_last_day or prior_notice_start_day are counted.\n\nExample: If empty, prior_notice_start_day=2 will be two calendar days in advance. If defined as a service_id containing only business days (weekdays without holidays), prior_notice_start_day=2 will be two business days in advance.\n\nConditionally Forbidden:\n- Optional if booking_type=2.\n- Forbidden otherwise.'
      ),
    message: z
      .string()
      .describe(
        'Message to riders utilizing service at a stop_time when booking on-demand pickup and drop off. Meant to provide minimal information to be transmitted within a user interface about the action a rider must take in order to utilize the service.'
      )
      .optional(),
    pickup_message: z
      .string()
      .describe(
        'Functions in the same way as message but used when riders have on-demand pickup only.'
      )
      .optional(),
    drop_off_message: z
      .string()
      .describe(
        'Functions in the same way as message but used when riders have on-demand drop off only.'
      )
      .optional(),
    phone_number: z
      .string()
      .describe('Phone number to call to make the booking request.')
      .optional(),
    info_url: z
      .string()
      .url()
      .describe('URL providing information about the booking rule.')
      .optional(),
    booking_url: z
      .string()
      .url()
      .describe(
        'URL to an online interface or app where the booking request can be made.'
      )
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

export const TranslationsSchema = z.object({
  table_name: z
    .number()
    .describe(
      'Defines the table that contains the field to be translated. Allowed values are:\n\n- agency\n- stops\n- routes\n- trips\n- stop_times\n- pathways\n- levels\n- feed_info\n- attributions\n\nAny file added to GTFS will have a table_name value equivalent to the file name, as listed above (i.e., not including the .txt file extension).'
    ),
  field_name: z
    .string()
    .describe(
      'Name of the field to be translated. Fields with type Text may be translated, fields with type URL, Email and Phone number may also be “translated” to provide resources in the correct language. Fields with other types should not be translated.'
    ),
  language: z
    .string()
    .regex(
      /^[a-z]{2,3}(-[A-Z]{2})?$/,
      'Must be a valid IETF BCP 47 language code'
    )
    .describe(
      "Language of translation.\n\nIf the language is the same as in feed_info.feed_lang, the original value of the field will be assumed to be the default value to use in languages without specific translations (if default_lang doesn't specify otherwise).Example: In Switzerland, a city in an officially bilingual canton is officially called “Biel/Bienne”, but would simply be called “Bienne” in French and “Biel” in German."
    ),
  translation: z
    .union([z.string(), z.string(), z.string(), z.string()])
    .describe('Translated value.'),
  record_id: z
    .string()
    .describe(
      "Defines the record that corresponds to the field to be translated. The value in record_id must be the first or only field of a table's primary key, as defined in the primary key attribute for each table and below:\n\n- agency_id for agency.txt\n- stop_id for stops.txt;\n- route_id for routes.txt;\n- trip_id for trips.txt;\n- trip_id for stop_times.txt;\n- pathway_id for pathways.txt;\n- level_id for levels.txt;\n- attribution_id for attributions.txt.\n\nFields in tables not defined above should not be translated. However producers sometimes add extra fields that are outside the official specification and these unofficial fields may be translated. Below is the recommended way to use record_id for those tables:\n\n- service_id for calendar.txt;\n- service_id for calendar_dates.txt;\n- fare_id for fare_attributes.txt;\n- fare_id for fare_rules.txt;\n- shape_id for shapes.txt;\n- trip_id for frequencies.txt;\n- from_stop_id for transfers.txt.\n\nConditionally Required:\n- Forbidden if table_name is feed_info.\n- Forbidden if field_value is defined.\n- Required if field_value is empty."
    ),
  record_sub_id: z
    .string()
    .describe(
      'Helps the record that contains the field to be translated when the table doesn’t have a unique ID. Therefore, the value in record_sub_id is the secondary ID of the table, as defined by the table below:\n\n- None for agency.txt;\n- None for stops.txt;\n- None for routes.txt;\n- None for trips.txt;\n- stop_sequence for stop_times.txt;\n- None for pathways.txt;\n- None for levels.txt;\n- None for attributions.txt.\n\nFields in tables not defined above should not be translated. However producers sometimes add extra fields that are outside the official specification and these unofficial fields may be translated. Below is the recommended way to use record_sub_id for those tables:\n\n- None for calendar.txt;\n- date for calendar_dates.txt;\n- None for fare_attributes.txt;\n- route_id for fare_rules.txt;\n- None for shapes.txt;\n- start_time for frequencies.txt;\n- to_stop_id for transfers.txt.\n\nConditionally Required:\n- Forbidden if table_name is feed_info.\n- Forbidden if field_value is defined.\n- Required if table_name=stop_times and record_id is defined.'
    ),
  field_value: z
    .union([z.string(), z.string(), z.string(), z.string()])
    .describe(
      'Instead of defining which record should be translated by using record_id and record_sub_id, this field can be used to define the value which should be translated. When used, the translation will be applied when the fields identified by table_name and field_name contains the exact same value defined in field_value.\n\nThe field must have exactly the value defined in field_value. If only a subset of the value matches field_value, the translation won’t be applied.\n\nIf two translation rules match the same record (one with field_value, and the other one with record_id), the rule with record_id takes precedence.\n\nConditionally Required:\n- Forbidden if table_name is feed_info.\n- Forbidden if record_id is defined.\n- Required if record_id is empty.'
    ),
});

export const FeedInfoSchema = z.object({
  feed_publisher_name: z
    .string()
    .describe(
      'Full name of the organization that publishes the dataset. This may be the same as one of the agency.agency_name values.'
    ),
  feed_publisher_url: z
    .string()
    .url()
    .describe(
      "URL of the dataset publishing organization's website. This may be the same as one of the agency.agency_url values."
    ),
  feed_lang: z
    .string()
    .regex(
      /^[a-z]{2,3}(-[A-Z]{2})?$/,
      'Must be a valid IETF BCP 47 language code'
    )
    .describe(
      'Default language used for the text in this dataset. This setting helps GTFS consumers choose capitalization rules and other language-specific settings for the dataset. The file translations.txt can be used if the text needs to be translated into languages other than the default one.\n\nThe default language may be multilingual for datasets with the original text in multiple languages. In such cases, the feed_lang field should contain the language code mul defined by the norm ISO 639-2, and a translation for each language used in the dataset should be provided in translations.txt. If all the original text in the dataset is in the same language, then mul should not be used.Example: Consider a dataset from a multilingual country like Switzerland, with the original stops.stop_name field populated with stop names in different languages. Each stop name is written according to the dominant language in that stop’s geographic location, e.g. Genève for the French-speaking city of Geneva, Zürich for the German-speaking city of Zurich, and Biel/Bienne for the bilingual city of Biel/Bienne. The dataset feed_lang should be mul and translations would be provided in translations.txt, in German: Genf, Zürich and Biel; in French: Genève, Zurich and Bienne; in Italian: Ginevra, Zurigo and Bienna; and in English: Geneva, Zurich and Biel/Bienne.'
    ),
  default_lang: z
    .string()
    .regex(
      /^[a-z]{2,3}(-[A-Z]{2})?$/,
      'Must be a valid IETF BCP 47 language code'
    )
    .describe(
      'Defines the language that should be used when the data consumer doesn’t know the language of the rider. It will often be en (English).'
    )
    .optional(),
  feed_start_date: z
    .string()
    .regex(/^\d{8}$/, 'Must be in YYYYMMDD format')
    .describe(
      'The dataset provides complete and reliable schedule information for service in the period from the beginning of the feed_start_date day to the end of the feed_end_date day. Both days may be left empty if unavailable. The feed_end_date date must not precede the feed_start_date date if both are given. It is recommended that dataset providers give schedule data outside this period to advise of likely future service, but dataset consumers should treat it mindful of its non-authoritative status. If feed_start_date or feed_end_date extend beyond the active calendar dates defined in calendar.txt and calendar_dates.txt, the dataset is making an explicit assertion that there is no service for dates within the feed_start_date or feed_end_date range but not included in the active calendar dates.'
    ),
  feed_end_date: z
    .string()
    .regex(/^\d{8}$/, 'Must be in YYYYMMDD format')
    .describe('(see above)'),
  feed_version: z
    .string()
    .describe(
      'String that indicates the current version of their GTFS dataset. GTFS-consuming applications can display this value to help dataset publishers determine whether the latest dataset has been incorporated.'
    ),
  feed_contact_email: z
    .string()
    .email()
    .describe(
      "Email address for communication regarding the GTFS dataset and data publishing practices. feed_contact_email is a technical contact for GTFS-consuming applications. Provide customer service contact information through agency.txt. It's recommended that at least one of feed_contact_email or feed_contact_url are provided."
    )
    .optional(),
  feed_contact_url: z
    .string()
    .url()
    .describe(
      "URL for contact information, a web-form, support desk, or other tools for communication regarding the GTFS dataset and data publishing practices. feed_contact_url is a technical contact for GTFS-consuming applications. Provide customer service contact information through agency.txt. It's recommended that at least one of feed_contact_url or feed_contact_email are provided."
    )
    .optional(),
});

export const AttributionsSchema = z
  .object({
    attribution_id: z
      .string()
      .describe(
        'Identifies an attribution for the dataset or a subset of it. This is mostly useful for translations.'
      )
      .optional(),
    agency_id: z
      .string()
      .describe(
        'Agency to which the attribution applies.\n\nIf one agency_id, route_id, or trip_id attribution is defined, the other ones must be empty. If none of them is specified, the attribution will apply to the whole dataset.'
      )
      .optional(),
    route_id: z
      .string()
      .describe(
        'Functions in the same way as agency_id except the attribution applies to a route. Multiple attributions may apply to the same route.'
      )
      .optional(),
    trip_id: z
      .string()
      .describe(
        'Functions in the same way as agency_id except the attribution applies to a trip. Multiple attributions may apply to the same trip.'
      )
      .optional(),
    organization_name: z
      .string()
      .describe('Name of the organization that the dataset is attributed to.'),
    is_producer: z
      .number()
      .describe(
        'The role of the organization is producer. Valid options are:\n\n0 or empty - Organization doesn’t have this role.\n1 - Organization does have this role.\n\nAt least one of the fields is_producer, is_operator, or is_authority should be set at 1.'
      )
      .optional(),
    is_operator: z
      .number()
      .describe(
        'Functions in the same way as is_producer except the role of the organization is operator.'
      )
      .optional(),
    is_authority: z
      .number()
      .describe(
        'Functions in the same way as is_producer except the role of the organization is authority.'
      )
      .optional(),
    attribution_url: z
      .string()
      .url()
      .describe('URL of the organization.')
      .optional(),
    attribution_email: z
      .string()
      .email()
      .describe('Email of the organization.')
      .optional(),
    attribution_phone: z
      .string()
      .describe('Phone number of the organization.')
      .optional(),
  })
  .superRefine((_data, _ctx) => {
    // Foreign key validation will be added by GTFSValidator
    // This allows for context-aware validation with access to all GTFS data
  });

// Union type for all GTFS record schemas
export const GTFSSchemas = {
  'agency.txt': AgencySchema,
  'stops.txt': StopsSchema,
  'routes.txt': RoutesSchema,
  'trips.txt': TripsSchema,
  'stop_times.txt': StopTimesSchema,
  'calendar.txt': CalendarSchema,
  'calendar_dates.txt': CalendarDatesSchema,
  'fare_attributes.txt': FareAttributesSchema,
  'fare_rules.txt': FareRulesSchema,
  'timeframes.txt': TimeframesSchema,
  'rider_categories.txt': RiderCategoriesSchema,
  'fare_media.txt': FareMediaSchema,
  'fare_products.txt': FareProductsSchema,
  'fare_leg_rules.txt': FareLegRulesSchema,
  'fare_leg_join_rules.txt': FareLegJoinRulesSchema,
  'fare_transfer_rules.txt': FareTransferRulesSchema,
  'areas.txt': AreasSchema,
  'stop_areas.txt': StopAreasSchema,
  'networks.txt': NetworksSchema,
  'route_networks.txt': RouteNetworksSchema,
  'shapes.txt': ShapesSchema,
  'frequencies.txt': FrequenciesSchema,
  'transfers.txt': TransfersSchema,
  'pathways.txt': PathwaysSchema,
  'levels.txt': LevelsSchema,
  'location_groups.txt': LocationGroupsSchema,
  'location_group_stops.txt': LocationGroupStopsSchema,
  'booking_rules.txt': BookingRulesSchema,
  'translations.txt': TranslationsSchema,
  'feed_info.txt': FeedInfoSchema,
  'attributions.txt': AttributionsSchema,
} as const;

// File presence requirements
export enum GTFSFilePresence {
  Required = 'Required',
  Optional = 'Optional',
  ConditionallyRequired = 'Conditionally Required',
  ConditionallyForbidden = 'Conditionally Forbidden',
}

// GTFS file metadata
export interface GTFSFileInfo {
  filename: string;
  presence: GTFSFilePresence;
  description: string;
  schema: z.ZodSchema;
}

// Complete list of GTFS files
export const GTFS_FILES: GTFSFileInfo[] = [
  {
    filename: 'agency.txt',
    presence: GTFSFilePresence.Required,
    description: 'Transit agencies with service represented in this dataset.',
    schema: GTFSSchemas['agency.txt'],
  },
  {
    filename: 'stops.txt',
    presence: GTFSFilePresence.ConditionallyRequired,
    description:
      'Stops where vehicles pick up or drop off riders. Also defines stations and station entrances.\n\nConditionally Required:\n- Optional if demand-responsive zones are defined in locations.geojson.\n- Required otherwise.',
    schema: GTFSSchemas['stops.txt'],
  },
  {
    filename: 'routes.txt',
    presence: GTFSFilePresence.Required,
    description:
      'Transit routes. A route is a group of trips that are displayed to riders as a single service.',
    schema: GTFSSchemas['routes.txt'],
  },
  {
    filename: 'trips.txt',
    presence: GTFSFilePresence.Required,
    description:
      'Trips for each route. A trip is a sequence of two or more stops that occur during a specific time period.',
    schema: GTFSSchemas['trips.txt'],
  },
  {
    filename: 'stop_times.txt',
    presence: GTFSFilePresence.Required,
    description:
      'Times that a vehicle arrives at and departs from stops for each trip.',
    schema: GTFSSchemas['stop_times.txt'],
  },
  {
    filename: 'calendar.txt',
    presence: GTFSFilePresence.ConditionallyRequired,
    description:
      'Service dates specified using a weekly schedule with start and end dates.\n\nConditionally Required:\n- Required unless all dates of service are defined in calendar_dates.txt.\n- Optional otherwise.',
    schema: GTFSSchemas['calendar.txt'],
  },
  {
    filename: 'calendar_dates.txt',
    presence: GTFSFilePresence.ConditionallyRequired,
    description:
      'Exceptions for the services defined in the calendar.txt.\n\nConditionally Required:\n- Required if calendar.txt is omitted. In which case calendar_dates.txt must contain all dates of service.\n- Optional otherwise.',
    schema: GTFSSchemas['calendar_dates.txt'],
  },
  {
    filename: 'fare_attributes.txt',
    presence: GTFSFilePresence.Optional,
    description: "Fare information for a transit agency's routes.",
    schema: GTFSSchemas['fare_attributes.txt'],
  },
  {
    filename: 'fare_rules.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Rules to apply fares for itineraries.',
    schema: GTFSSchemas['fare_rules.txt'],
  },
  {
    filename: 'timeframes.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'Date and time periods to use in fare rules for fares that depend on date and time factors.',
    schema: GTFSSchemas['timeframes.txt'],
  },
  {
    filename: 'rider_categories.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Defines categories of riders (e.g. elderly, student).',
    schema: GTFSSchemas['rider_categories.txt'],
  },
  {
    filename: 'fare_media.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'To describe the fare media that can be employed to use fare products.\n\nFile fare_media.txt describes concepts that are not represented in fare_attributes.txt and fare_rules.txt. As such, the use of fare_media.txt is entirely separate from files fare_attributes.txt and fare_rules.txt.',
    schema: GTFSSchemas['fare_media.txt'],
  },
  {
    filename: 'fare_products.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'To describe the different types of tickets or fares that can be purchased by riders.\n\nFile fare_products.txt describes fare products that are not represented in fare_attributes.txt and fare_rules.txt. As such, the use of fare_products.txt is entirely separate from files fare_attributes.txt and fare_rules.txt.',
    schema: GTFSSchemas['fare_products.txt'],
  },
  {
    filename: 'fare_leg_rules.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'Fare rules for individual legs of travel.\n\nFile fare_leg_rules.txt provides a more detailed method for modeling fare structures. As such, the use of fare_leg_rules.txt is entirely separate from files fare_attributes.txt and fare_rules.txt.',
    schema: GTFSSchemas['fare_leg_rules.txt'],
  },
  {
    filename: 'fare_leg_join_rules.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'Rules for defining two or more legs should be considered as a single effective fare leg for the purposes of matching against rules in fare_leg_rules.txt',
    schema: GTFSSchemas['fare_leg_join_rules.txt'],
  },
  {
    filename: 'fare_transfer_rules.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'Fare rules for transfers between legs of travel.\n\nAlong with fare_leg_rules.txt, file fare_transfer_rules.txt provides a more detailed method for modeling fare structures. As such, the use of fare_transfer_rules.txt is entirely separate from files fare_attributes.txt and fare_rules.txt.',
    schema: GTFSSchemas['fare_transfer_rules.txt'],
  },
  {
    filename: 'areas.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Area grouping of locations.',
    schema: GTFSSchemas['areas.txt'],
  },
  {
    filename: 'stop_areas.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Rules to assign stops to areas.',
    schema: GTFSSchemas['stop_areas.txt'],
  },
  {
    filename: 'networks.txt',
    presence: GTFSFilePresence.ConditionallyForbidden,
    description:
      'Network grouping of routes.\n\nConditionally Forbidden:\n- Forbidden if network_id exists in routes.txt.\n- Optional otherwise.',
    schema: GTFSSchemas['networks.txt'],
  },
  {
    filename: 'route_networks.txt',
    presence: GTFSFilePresence.ConditionallyForbidden,
    description:
      'Rules to assign routes to networks.\n\nConditionally Forbidden:\n- Forbidden if network_id exists in routes.txt.\n- Optional otherwise.',
    schema: GTFSSchemas['route_networks.txt'],
  },
  {
    filename: 'shapes.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'Rules for mapping vehicle travel paths, sometimes referred to as route alignments.',
    schema: GTFSSchemas['shapes.txt'],
  },
  {
    filename: 'frequencies.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'Headway (time between trips) for headway-based service or a compressed representation of fixed-schedule service.',
    schema: GTFSSchemas['frequencies.txt'],
  },
  {
    filename: 'transfers.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'Rules for making connections at transfer points between routes.',
    schema: GTFSSchemas['transfers.txt'],
  },
  {
    filename: 'pathways.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Pathways linking together locations within stations.',
    schema: GTFSSchemas['pathways.txt'],
  },
  {
    filename: 'levels.txt',
    presence: GTFSFilePresence.ConditionallyRequired,
    description:
      'Levels within stations.\n\nConditionally Required:\n- Required when describing pathways with elevators (pathway_mode=5).\n- Optional otherwise.',
    schema: GTFSSchemas['levels.txt'],
  },
  {
    filename: 'location_groups.txt',
    presence: GTFSFilePresence.Optional,
    description:
      'A group of stops that together indicate locations where a rider may request pickup or drop off.',
    schema: GTFSSchemas['location_groups.txt'],
  },
  {
    filename: 'location_group_stops.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Rules to assign stops to location groups.',
    schema: GTFSSchemas['location_group_stops.txt'],
  },
  {
    filename: 'locations.geojson',
    presence: GTFSFilePresence.Optional,
    description:
      'Zones for rider pickup or drop-off requests by on-demand services, represented as GeoJSON polygons.',
    schema: z.any(),
  },
  {
    filename: 'booking_rules.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Booking information for rider-requested services.',
    schema: GTFSSchemas['booking_rules.txt'],
  },
  {
    filename: 'translations.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Translations of customer-facing dataset values.',
    schema: GTFSSchemas['translations.txt'],
  },
  {
    filename: 'feed_info.txt',
    presence: GTFSFilePresence.ConditionallyRequired,
    description:
      'Dataset metadata, including publisher, version, and expiration information.\n\nConditionally Required:\n- Required if translations.txt is provided.\n- Recommended otherwise.',
    schema: GTFSSchemas['feed_info.txt'],
  },
  {
    filename: 'attributions.txt',
    presence: GTFSFilePresence.Optional,
    description: 'Dataset attributions.',
    schema: GTFSSchemas['attributions.txt'],
  },
];

// GTFS table name constants for type-safe table references
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

// Union type for all GTFS table names
export type GTFSTableName = (typeof GTFS_TABLES)[keyof typeof GTFS_TABLES];

// Utility functions for accessing schema metadata
export function getFieldDescription(
  filename: string,
  fieldName: string
): string | undefined {
  const schema = GTFSSchemas[filename as keyof typeof GTFSSchemas];
  if (!schema) {
    return undefined;
  }

  // Get the shape of the schema
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  if (!shape || !shape[fieldName]) {
    return undefined;
  }

  // Extract description from the field schema
  return (shape[fieldName] as unknown as { description?: string })?.description;
}

export function getFileSchema(filename: string): z.ZodSchema | undefined {
  return GTFSSchemas[filename as keyof typeof GTFSSchemas];
}

export function getAllFieldDescriptions(
  filename: string
): Record<string, string> {
  const schema = GTFSSchemas[filename as keyof typeof GTFSSchemas];
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
