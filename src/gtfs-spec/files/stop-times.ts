import type { GTFSFileSpec } from '../types';

export const stopTimesSpec: GTFSFileSpec = {
  filename: 'stop_times.txt',
  presence: 'Required',
  description:
    'Times that a vehicle arrives at and departs from stops for each trip.',
  fields: [
    {
      name: 'trip_id',
      type: 'Foreign ID',
      presence: 'Required',
      description: 'Identifies a trip.',
      foreignKey: { file: 'trips.txt', field: 'trip_id' },
    },
    {
      name: 'arrival_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for the first and last stop in a trip (defined by the stops with the smallest and largest stop_times.stop_sequence for a given trip_id). Required if stop_times.timepoint = 1. Recommended if known; may be left empty for intermediate stops where times are not known.',
      allowEmpty: true,
      description:
        'Arrival time at the stop (defined by stop_times.stop_id) for a specific trip (defined by stop_times.trip_id). If there are not separate arrival and departure times at a stop, arrival_time and departure_time values must be the same. For times occurring after midnight on the service day, enter the time as a value greater than 24:00:00 in HH:MM:SS format.',
    },
    {
      name: 'departure_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for the first and last stop in a trip (defined by the stops with the smallest and largest stop_times.stop_sequence for a given trip_id). Required if stop_times.timepoint = 1. Recommended if known; may be left empty for intermediate stops where times are not known.',
      allowEmpty: true,
      description:
        'Departure time from the stop (defined by stop_times.stop_id) for a specific trip (defined by stop_times.trip_id). If there are not separate arrival and departure times at a stop, arrival_time and departure_time values must be the same. For times occurring after midnight on the service day, enter the time as a value greater than 24:00:00 in HH:MM:SS format.',
    },
    {
      name: 'stop_id',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if stop_times.location_group_id AND stop_times.location_id are not defined. Forbidden if stop_times.location_group_id or stop_times.location_id is defined.',
      description:
        'Identifies the serviced stop. All stops serviced during a trip must have a record in stop_times.txt. Referenced locations must be stops (location_type=0 or blank in stops.txt). A stop may be serviced multiple times in the same trip, and multiple trips and routes may service the same stop.',
      foreignKey: { file: 'stops.txt', field: 'stop_id' },
    },
    {
      name: 'location_group_id',
      type: 'Foreign ID',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden if stop_times.stop_id or stop_times.location_id is defined. stop_id, location_group_id, and location_id are mutually exclusive. Exactly one must be defined.',
      description:
        'Identifies the serviced location group that indicates groups of stops where riders may request pickup or drop off. stop_id, location_group_id, and location_id are mutually exclusive.',
      foreignKey: { file: 'location_groups.txt', field: 'location_group_id' },
    },
    {
      name: 'location_id',
      type: 'Foreign ID',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden if stop_times.stop_id or stop_times.location_group_id is defined. stop_id, location_group_id, and location_id are mutually exclusive. Exactly one must be defined.',
      description:
        'Identifies the GeoJSON location that corresponds to a flexible service zone used on the trip. References an id from locations.geojson. stop_id, location_group_id, and location_id are mutually exclusive.',
      foreignKey: { file: 'locations.geojson', field: 'id' },
    },
    {
      name: 'stop_sequence',
      type: 'Non-negative integer',
      presence: 'Required',
      description:
        'Order of stops for a particular trip. The values must increase along the trip but do not need to be consecutive. For example, the first location on the trip could have a stop_sequence=1, the second location stop_sequence=23, the third location stop_sequence=40, and so on.',
    },
    {
      name: 'stop_headsign',
      type: 'Text',
      presence: 'Optional',
      description:
        "Text that appears on signage identifying the trip's destination to riders. This field overrides the default trips.trip_headsign when the headsign changes between stops. If the headsign is displayed for an entire trip, trips.trip_headsign should be used instead.",
    },
    {
      name: 'start_pickup_drop_off_window',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if stop_times.location_group_id or stop_times.location_id is defined. Forbidden if stop_times.stop_id is defined.',
      description:
        'Time that demand responsive service becomes available in a GeoJSON location, location group, or stop. If start_pickup_drop_off_window is defined, arrival_time and departure_time should not be defined in the same stop_time.',
    },
    {
      name: 'end_pickup_drop_off_window',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if stop_times.location_group_id or stop_times.location_id is defined. Forbidden if stop_times.stop_id is defined.',
      description:
        'Time that demand responsive service ends in a GeoJSON location, location group, or stop. If end_pickup_drop_off_window is defined, arrival_time and departure_time should not be defined in the same stop_time.',
    },
    {
      name: 'pickup_type',
      type: 'Enum',
      presence: 'Conditionally Required',
      presenceCondition:
        'pickup_type=2 or pickup_type=3 is required if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined. Forbidden if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined and the value is 0 or 1.',
      description:
        'Indicates pickup method. Valid options are:\n\n0 or empty - Regularly scheduled pickup.\n1 - No pickup available.\n2 - Must phone agency to arrange pickup.\n3 - Must coordinate with driver to arrange pickup.',
      enumValues: [
        {
          value: 0,
          label: 'Regularly scheduled pickup',
          description:
            'Regularly scheduled pickup. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'No pickup available',
          description: 'No pickup available.',
        },
        {
          value: 2,
          label: 'Phone agency',
          description: 'Must phone agency to arrange pickup.',
        },
        {
          value: 3,
          label: 'Coordinate with driver',
          description: 'Must coordinate with driver to arrange pickup.',
        },
      ],
    },
    {
      name: 'drop_off_type',
      type: 'Enum',
      presence: 'Conditionally Required',
      presenceCondition:
        'drop_off_type=2 or drop_off_type=3 is required if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined. Forbidden if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined and the value is 0 or 1.',
      description:
        'Indicates drop off method. Valid options are:\n\n0 or empty - Regularly scheduled drop off.\n1 - No drop off available.\n2 - Must phone agency to arrange drop off.\n3 - Must coordinate with driver to arrange drop off.',
      enumValues: [
        {
          value: 0,
          label: 'Regularly scheduled drop off',
          description:
            'Regularly scheduled drop off. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'No drop off available',
          description: 'No drop off available.',
        },
        {
          value: 2,
          label: 'Phone agency',
          description: 'Must phone agency to arrange drop off.',
        },
        {
          value: 3,
          label: 'Coordinate with driver',
          description: 'Must coordinate with driver to arrange drop off.',
        },
      ],
    },
    {
      name: 'continuous_pickup',
      type: 'Enum',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined.',
      description:
        "Indicates that the rider can board the transit vehicle at any point along the vehicle's travel path as described by shapes.txt, from this stop_time to the next stop_time in the trip's stop_sequence. Valid options are:\n\n0 - Continuous stopping pickup.\n1 (or empty) - No continuous stopping pickup.\n2 - Must phone agency to arrange continuous stopping pickup.\n3 - Must coordinate with driver to arrange continuous stopping pickup.\n\nValues defined in stop_times.continuous_pickup override any value defined in routes.continuous_pickup.",
      enumValues: [
        {
          value: 0,
          label: 'Continuous stopping pickup',
          description:
            "The rider can board the transit vehicle at any point along the vehicle's travel path.",
        },
        {
          value: 1,
          label: 'No continuous stopping pickup',
          description:
            'No continuous stopping pickup. An empty value is equivalent to 1.',
        },
        {
          value: 2,
          label: 'Phone agency',
          description:
            'Must phone agency to arrange continuous stopping pickup.',
        },
        {
          value: 3,
          label: 'Coordinate with driver',
          description:
            'Must coordinate with driver to arrange continuous stopping pickup.',
        },
      ],
    },
    {
      name: 'continuous_drop_off',
      type: 'Enum',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined.',
      description:
        "Indicates that the rider can alight from the transit vehicle at any point along the vehicle's travel path as described by shapes.txt, from this stop_time to the next stop_time in the trip's stop_sequence. Valid options are:\n\n0 - Continuous stopping drop off.\n1 (or empty) - No continuous stopping drop off.\n2 - Must phone agency to arrange continuous stopping drop off.\n3 - Must coordinate with driver to arrange continuous stopping drop off.\n\nValues defined in stop_times.continuous_drop_off override any value defined in routes.continuous_drop_off.",
      enumValues: [
        {
          value: 0,
          label: 'Continuous stopping drop off',
          description:
            "The rider can alight from the transit vehicle at any point along the vehicle's travel path.",
        },
        {
          value: 1,
          label: 'No continuous stopping drop off',
          description:
            'No continuous stopping drop off. An empty value is equivalent to 1.',
        },
        {
          value: 2,
          label: 'Phone agency',
          description:
            'Must phone agency to arrange continuous stopping drop off.',
        },
        {
          value: 3,
          label: 'Coordinate with driver',
          description:
            'Must coordinate with driver to arrange continuous stopping drop off.',
        },
      ],
    },
    {
      name: 'shape_dist_traveled',
      type: 'Float',
      presence: 'Optional',
      description:
        'Actual distance traveled along the associated shape, from the first stop to the stop specified in this record. This field specifies how much of the shape to draw between any two stops during a trip. Must be in the same units used in shapes.txt. Values used for shape_dist_traveled must increase along with stop_sequence; they cannot be used to show reverse travel along a route.',
    },
    {
      name: 'timepoint',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates if arrival and departure times for a stop are strictly adhered to by the vehicle or if they are instead approximate and/or interpolated times. Valid options are:\n\n0 - Times are considered approximate.\n1 or empty - Times are considered exact.',
      enumValues: [
        {
          value: 0,
          label: 'Approximate',
          description: 'Times are considered approximate.',
        },
        {
          value: 1,
          label: 'Exact',
          description:
            'Times are considered exact. An empty value is equivalent to 1.',
        },
      ],
    },
    {
      name: 'pickup_booking_rule_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies the boarding booking rule at this stop time. Recommended when pickup_type=2.',
      foreignKey: { file: 'booking_rules.txt', field: 'booking_rule_id' },
    },
    {
      name: 'drop_off_booking_rule_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies the alighting booking rule at this stop time. Recommended when drop_off_type=2.',
      foreignKey: { file: 'booking_rules.txt', field: 'booking_rule_id' },
    },
  ],
};
