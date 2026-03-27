/**
 * GTFS Enumeration Definitions
 *
 * Generated from https://gtfs.org/documentation/schedule/reference
 * Scraped at: 2025-10-06T07:31:38.143Z
 *
 * Defines all valid enum values for GTFS fields based on the official specification.
 */

export interface GTFSEnumOption {
  value: number | string;
  label: string;
  description?: string;
}

/**
 * Registry of all GTFS enum fields and their valid values
 */
export const GTFS_ENUMS: Record<string, GTFSEnumOption[]> = {
  bikes_allowed: [
    {
      value: 1,
      label:
        'Vehicle being used on this particular trip can accommodate at least one bicycle',
    },
    {
      value: 2,
      label: 'No bicycles are allowed on this trip',
    },
  ],

  booking_type: [
    {
      value: 0,
      label: 'Real time booking',
    },
    {
      value: 1,
      label: 'Up to same-day booking with advance notice',
    },
    {
      value: 2,
      label: 'Up to prior day(s) booking',
    },
  ],

  cars_allowed: [
    {
      value: 1,
      label:
        'Vehicle being used on this particular trip can accommodate at least one car',
    },
    {
      value: 2,
      label: 'No cars are allowed on this trip',
    },
  ],

  continuous_drop_off: [
    {
      value: 0,
      label: 'Continuous stopping drop off',
      description: '1 or empty - No continuous stopping drop off.',
    },
    {
      value: 2,
      label: 'Must phone agency to arrange continuous stopping drop off',
    },
    {
      value: 3,
      label:
        'Must coordinate with driver to arrange continuous stopping drop off',
      description:
        'If this field is populated, it overrides any continuous drop-off behavior defined in routes.txt. If this field is empty, the stop_time inherits any continuous drop-off behavior defined in routes.txt.\nConditionally Forbidden:\n- Any value other than 1 or empty is Forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.',
    },
  ],

  continuous_pickup: [
    {
      value: 0,
      label: 'Continuous stopping pickup',
      description: '1 or empty - No continuous stopping pickup.',
    },
    {
      value: 2,
      label: 'Must phone agency to arrange continuous stopping pickup',
    },
    {
      value: 3,
      label:
        'Must coordinate with driver to arrange continuous stopping pickup',
      description:
        'If this field is populated, it overrides any continuous pickup behavior defined in routes.txt. If this field is empty, the stop_time inherits any continuous pickup behavior defined in routes.txt.\nConditionally Forbidden:\n- Any value other than 1 or empty is Forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.',
    },
  ],

  direction_id: [
    {
      value: 0,
      label: 'Travel in one direction (e.g. outbound travel)',
    },
    {
      value: 1,
      label: 'Travel in the opposite direction (e.g. inbound travel)',
      description:
        'Example: The trip_headsign and direction_id fields may be used together to assign a name to travel in each direction for a set of trips. A trips.txt file could contain these records for use in time tables:\ntrip_id,...,trip_headsign,direction_id\n1234,...,Airport,0\n1505,...,Downtown,1',
    },
  ],

  drop_off_type: [
    {
      value: 1,
      label: 'No drop off available',
    },
    {
      value: 2,
      label: 'Must phone agency to arrange drop off',
    },
    {
      value: 3,
      label: 'Must coordinate with driver to arrange drop off',
      description:
        'Conditionally Forbidden:\n- drop_off_type=0 forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.',
    },
  ],

  duration_limit_type: [
    {
      value: 0,
      label:
        'Between the departure fare validation of the current leg and the arrival fare validation of the next leg',
    },
    {
      value: 1,
      label:
        'Between the departure fare validation of the current leg and the departure fare validation of the next leg',
    },
    {
      value: 2,
      label:
        'Between the arrival fare validation of the current leg and the departure fare validation of the next leg',
    },
    {
      value: 3,
      label:
        'Between the arrival fare validation of the current leg and the arrival fare validation of the next leg',
      description:
        'Conditionally Required:\n- Required if fare_transfer_rules.duration_limit is defined.\n- Forbidden if fare_transfer_rules.duration_limit is empty.',
    },
  ],

  exact_times: [
    {
      value: 1,
      label:
        'Schedule-based trips with the exact same headway throughout the day',
      description:
        'In this case the end_time value must be greater than the last desired trip start_time but less than the last desired trip start_time + headway_secs.',
    },
  ],

  exception_type: [
    {
      value: 1,
      label: 'Service has been added for the specified date',
    },
    {
      value: 2,
      label: 'Service has been removed for the specified date',
      description:
        'Example: Suppose a route has one set of trips available on holidays and another set of trips available on all other days. One service_id could correspond to the regular service schedule and another service_id could correspond to the holiday schedule. For a particular holiday, the calendar_dates.txt file could be used to add the holiday to the holiday service_id and to remove the holiday from the regular service_id schedule.',
    },
  ],

  fare_media_type: [
    {
      value: 0,
      label: 'None',
      description:
        'Used when there is no fare media involved in purchasing or validating a fare product, such as paying cash to a driver or conductor with no physical ticket provided.',
    },
    {
      value: 1,
      label:
        'Physical paper ticket that allows a passenger to take either a certain number of pre-purchased trips or unlimited trips within a fixed period of time',
    },
    {
      value: 2,
      label:
        'Physical transit card that has stored tickets, passes or monetary value',
    },
    {
      value: 3,
      label:
        'cEMV (contactless Europay, Mastercard and Visa) as an open-loop token container for account-based ticketing',
    },
    {
      value: 4,
      label:
        'Mobile app that have stored virtual transit cards, tickets, passes, or monetary value',
    },
  ],

  fare_transfer_type: [
    {
      value: 0,
      label:
        'From-leg fare_leg_rules.fare_product_id plus fare_transfer_rules.fare_product_id; A + AB',
    },
    {
      value: 1,
      label:
        'From-leg fare_leg_rules.fare_product_id plus fare_transfer_rules.fare_product_id plus to-leg fare_leg_rules.fare_product_id; A + AB + B',
    },
    {
      value: 2,
      label: 'fare_transfer_rules.fare_product_id; AB',
      description:
        'Cost processing interactions between multiple transfers in a journey:\nfare_transfer_typeProcessing A > BProcessing B > C0A + ABS + BC1A + AB +BS + BC + C2ABS + BCWhere S indicates the total processed cost of the preceding leg(s) and transfer(s).',
    },
  ],

  is_bidirectional: [
    {
      value: 0,
      label:
        'Unidirectional pathway that can only be used from from_stop_id to to_stop_id',
    },
    {
      value: 1,
      label: 'Bidirectional pathway that can be used in both directions',
      description: 'Exit gates (pathway_mode=7) must not be bidirectional.',
    },
  ],

  is_default_fare_category: [
    {
      value: 1,
      label: 'Category is considered the default one',
      description:
        'When multiple rider categories are eligible for a single fare product specified by a fare_product_id, there must be exactly one of these eligible rider categories indicated as the default rider category (is_default_fare_category = 1).',
    },
  ],

  is_producer: [
    {
      value: 1,
      label: 'Organization does have this role',
      description:
        'At least one of the fields is_producer, is_operator, or is_authority should be set at 1.',
    },
  ],

  location_type: [
    {
      value: 1,
      label: 'Station',
      description:
        'A physical structure or area that contains one or more platform.',
    },
    {
      value: 2,
      label: 'Entrance/Exit',
      description:
        'A location where passengers can enter or exit a station from the street. If an entrance/exit belongs to multiple stations, it may be linked by pathways to both, but the data provider must pick one of them as parent.',
    },
    {
      value: 3,
      label: 'Generic Node',
      description:
        'A location within a station, not matching any other location_type, that may be used to link together pathways define in pathways.txt.',
    },
    {
      value: 4,
      label: 'Boarding Area',
      description:
        'A specific location on a platform, where passengers can board and/or alight vehicles.',
    },
  ],

  monday: [
    {
      value: 1,
      label: 'Service is available for all Mondays in the date range',
    },
    {
      value: 0,
      label: 'Service is not available for Mondays in the date range',
    },
  ],

  pathway_mode: [
    {
      value: 1,
      label: 'Walkway',
    },
    {
      value: 2,
      label: 'Stairs',
    },
    {
      value: 3,
      label: 'Moving sidewalk/travelator',
    },
    {
      value: 4,
      label: 'Escalator',
    },
    {
      value: 5,
      label: 'Elevator',
    },
    {
      value: 6,
      label:
        'Fare gate (or payment gate): A pathway that crosses into an area of the station where proof of payment is required to cross',
      description:
        'Fare gates may separate paid areas of the station from unpaid ones, or separate different payment areas within the same station from each other. This information can be used to avoid routing passengers through stations using shortcuts that would require passengers to make unnecessary payments, like directing a passenger to walk through a subway platform to reach a busway.',
    },
    {
      value: 7,
      label:
        'Exit gate: A pathway exiting a paid area into an unpaid area where proof of payment is not required to cross',
    },
  ],

  payment_method: [
    {
      value: 0,
      label: 'Fare is paid on board',
    },
    {
      value: 1,
      label: 'Fare must be paid before boarding',
    },
  ],

  pickup_type: [
    {
      value: 1,
      label: 'No pickup available',
    },
    {
      value: 2,
      label: 'Must phone agency to arrange pickup',
    },
    {
      value: 3,
      label: 'Must coordinate with driver to arrange pickup',
      description:
        'Conditionally Forbidden:\n- pickup_type=0 forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- pickup_type=3 forbidden if start_pickup_drop_off_window or end_pickup_drop_off_window are defined.\n- Optional otherwise.',
    },
  ],

  route_type: [
    {
      value: 0,
      label: 'Tram, Streetcar, Light rail',
      description:
        'Any light rail or street level system within a metropolitan area.',
    },
    {
      value: 1,
      label: 'Subway, Metro',
      description: 'Any underground rail system within a metropolitan area.',
    },
    {
      value: 2,
      label: 'Rail',
      description: 'Used for intercity or long-distance travel.',
    },
    {
      value: 3,
      label: 'Bus',
      description: 'Used for short- and long-distance bus routes.',
    },
    {
      value: 4,
      label: 'Ferry',
      description: 'Used for short- and long-distance boat service.',
    },
    {
      value: 5,
      label: 'Cable tram',
      description:
        'Used for street-level rail cars where the cable runs beneath the vehicle (e.g., cable car in San Francisco).',
    },
    {
      value: 6,
      label:
        'Aerial lift, suspended cable car (e.g., gondola lift, aerial tramway)',
      description:
        'Cable transport where cabins, cars, gondolas or open chairs are suspended by means of one or more cables.',
    },
    {
      value: 7,
      label: 'Funicular',
      description: 'Any rail system designed for steep inclines.',
    },
    {
      value: 11,
      label: 'Trolleybus',
      description:
        'Electric buses that draw power from overhead wires using poles.',
    },
    {
      value: 12,
      label: 'Monorail',
      description:
        'Railway in which the track consists of a single rail or a beam.',
    },
  ],

  timepoint: [
    {
      value: 0,
      label: 'Times are considered approximate',
    },
    {
      value: 1,
      label: 'Times are considered exact',
      description:
        'All records of stop_times.txt with defined arrival or departure times should have timepoint values populated. If no timepoint values are provided, all times are considered exact.',
    },
  ],

  transfer_type: [
    {
      value: 1,
      label: 'Timed transfer point between two routes',
      description:
        'The departing vehicle is expected to wait for the arriving one and leave sufficient time for a rider to transfer between routes.',
    },
    {
      value: 2,
      label:
        'Transfer requires a minimum amount of time between arrival and departure to ensure a connection',
      description:
        'The time required to transfer is specified by min_transfer_time.',
    },
    {
      value: 3,
      label: 'Transfers are not possible between routes at the location',
    },
    {
      value: 4,
      label:
        'Passengers can transfer from one trip to another by staying onboard the same vehicle (an "in-seat transfer")',
      description: 'More details about this type of transfer below.',
    },
    {
      value: 5,
      label: 'In-seat transfers are not allowed between sequential trips',
      description:
        'The passenger must alight from the vehicle and re-board. More details about this type of transfer below.',
    },
  ],

  transfers: [
    {
      value: 0,
      label: 'No transfers permitted on this fare',
    },
    {
      value: 1,
      label: 'Riders may transfer once',
    },
    {
      value: 2,
      label: 'Riders may transfer twice',
      description: 'empty - Unlimited transfers are permitted.',
    },
  ],

  wheelchair_accessible: [
    {
      value: 1,
      label:
        'Vehicle being used on this particular trip can accommodate at least one rider in a wheelchair',
    },
    {
      value: 2,
      label: 'No riders in wheelchairs can be accommodated on this trip',
    },
  ],

  wheelchair_boarding: [
    {
      value: 1,
      label:
        'Some vehicles at this stop can be boarded by a rider in a wheelchair',
    },
    {
      value: 2,
      label: 'Wheelchair boarding is not possible at this stop',
      description:
        'For child stops:\n0 or empty - Stop will inherit its wheelchair_boarding behavior from the parent station, if specified in the parent.',
    },
    {
      value: 1,
      label:
        'There exists some accessible path from outside the station to the specific stop/platform',
    },
    {
      value: 2,
      label:
        'There exists no accessible path from outside the station to the specific stop/platform',
      description:
        'For station entrances/exits:\n0 or empty - Station entrance will inherit its wheelchair_boarding behavior from the parent station, if specified for the parent.',
    },
    {
      value: 1,
      label: 'Station entrance is wheelchair accessible',
    },
    {
      value: 2,
      label: 'No accessible path from station entrance to stops/platforms',
    },
  ],
};

/**
 * Get enum options for a specific field
 */
export function getEnumOptions(
  fieldName: string
): GTFSEnumOption[] | undefined {
  return GTFS_ENUMS[fieldName];
}

/**
 * Check if a field is an enum field
 */
export function isEnumField(fieldName: string): boolean {
  return fieldName in GTFS_ENUMS;
}
