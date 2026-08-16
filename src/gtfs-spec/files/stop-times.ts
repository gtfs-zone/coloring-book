import type { GTFSFileSpec } from '../types';

export const stopTimesSpec: GTFSFileSpec = {
  filename: 'stop_times.txt',
  presence: 'Required',
  description:
    'Times that a vehicle arrives at and departs from stops for each trip.',
  fields: [
    {
      name: 'trip_id',
      type: 'Foreign ID referencing `trips.trip_id`',
      presence: 'Required',
      description: 'Identifies a trip.',
      foreignKey: [{ file: 'trips.txt', field: 'trip_id' }],
    },
    {
      name: 'arrival_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for the first and last stop in a trip (defined by the stops with the smallest and largest stop_times.stop_sequence for a given trip_id). Required if stop_times.timepoint = 1. Recommended if known; may be left empty for intermediate stops where times are not known.',
      description:
        'Arrival time at the stop (defined by `stop_times.stop_id`) for a specific trip (defined by `stop_times.trip_id`) in the time zone specified by `agency.agency_timezone`, not `stops.stop_timezone`. <br><br>If there are not separate times for arrival and departure at a stop, `arrival_time` and `departure_time` should be the same. <br><br>For times occurring after midnight on the service day, enter the time as a value greater than 24:00:00 in HH:MM:SS.<br><br> If exact arrival and departure times (`timepoint=1`) are not available, estimated or interpolated arrival and departure times (`timepoint=0`) should be provided.<br><br>Conditionally Required:<br>- **Required** for the first and last stop in a trip (defined by `stop_times.stop_sequence`). <br>- **Required** for `timepoint=1`.<br>-&nbsp;**Forbidden** when `start_pickup_drop_off_window` or `end_pickup_drop_off_window` are defined.<br>- Optional otherwise.',
      allowEmpty: true,
    },
    {
      name: 'departure_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for the first and last stop in a trip (defined by the stops with the smallest and largest stop_times.stop_sequence for a given trip_id). Required if stop_times.timepoint = 1. Recommended if known; may be left empty for intermediate stops where times are not known.',
      description:
        'Departure time from the stop (defined by `stop_times.stop_id`) for a specific trip (defined by `stop_times.trip_id`) in the time zone specified by `agency.agency_timezone`, not `stops.stop_timezone`.<br><br>If there are not separate times for arrival and departure at a stop, `arrival_time` and `departure_time` should be the same. <br><br>For times occurring after midnight on the service day, enter the time as a value greater than 24:00:00 in HH:MM:SS.<br><br> If exact arrival and departure times (`timepoint=1`) are not available, estimated or interpolated arrival and departure times (`timepoint=0`) should be provided.<br><br>Conditionally Required:<br>- **Required** for `timepoint=1`.<br>-&nbsp;**Forbidden** when `start_pickup_drop_off_window` or `end_pickup_drop_off_window` are defined.<br>- Optional otherwise.',
      allowEmpty: true,
    },
    {
      name: 'stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if stop_times.location_group_id AND stop_times.location_id are not defined. Forbidden if stop_times.location_group_id or stop_times.location_id is defined.',
      description:
        'Identifies the serviced stop. All stops serviced during a trip must have a record in [stop_times.txt](#stop_timestxt). Referenced locations must be stops/platforms, i.e. their `stops.location_type` value must be `0` or empty. A stop may be serviced multiple times in the same trip, and multiple trips and routes may service the same stop.<br><br>On-demand service using stops should be referenced in the sequence in which service is available at those stops. A data consumer should assume that travel is possible from one stop or location to any stop or location later in the trip, provided that the `pickup/drop_off_type` of each stop_time and the time constraints of each `start/end_pickup_drop_off_window` do not forbid it.<br><br>Conditionally Required:<br>- **Required** if `stop_times.location_group_id` AND `stop_times.location_id` are NOT defined.<br>- **Forbidden** if `stop_times.location_group_id` or `stop_times.location_id` are defined.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
    {
      name: 'location_group_id',
      type: 'Foreign ID referencing `location_groups.location_group_id`',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden if stop_times.stop_id or stop_times.location_id is defined. stop_id, location_group_id, and location_id are mutually exclusive. Exactly one must be defined.',
      description:
        'Identifies the serviced location group that indicates groups of stops where riders may request pickup or drop off. All location groups serviced during a trip must have a record in [stop_times.txt](#stop_timestxt). Multiple trips and routes may service the same location group.<br><br>On-demand service using location groups should be referenced in the sequence in which service is available at those location groups. A data consumer should assume that travel is possible from one stop or location to any stop or location later in the trip, provided that the `pickup/drop_off_type` of each stop_time and the time constraints of each `start/end_pickup_drop_off_window` do not forbid it.<br><br>**Conditionally Forbidden**:<br>- **Forbidden** if `stop_times.stop_id` or `stop_times.location_id` are defined.',
      foreignKey: [{ file: 'location_groups.txt', field: 'location_group_id' }],
    },
    {
      name: 'location_id',
      type: 'Foreign ID referencing `id` from `locations.geojson`',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden if stop_times.stop_id or stop_times.location_group_id is defined. stop_id, location_group_id, and location_id are mutually exclusive. Exactly one must be defined.',
      description:
        'Identifies the GeoJSON location that corresponds to serviced zone where riders may request pickup or drop off. All GeoJSON locations serviced during a trip must have a record in [stop_times.txt](#stop_timestxt). Multiple trips and routes may service the same GeoJSON location.<br><br>On-demand service within locations should be referenced in the sequence in which service is available in those locations. A data consumer should assume that travel is possible from one stop or location to any stop or location later in the trip, provided that the `pickup/drop_off_type` of each stop_time and the time constraints of each `start/end_pickup_drop_off_window` do not forbid it.<br><br>**Conditionally Forbidden**:<br>- **Forbidden** if `stop_times.stop_id` or `stop_times.location_group_id` are defined.',
      foreignKey: [{ file: 'locations.geojson', field: 'id' }],
    },
    {
      name: 'stop_sequence',
      type: 'Non-negative integer',
      presence: 'Required',
      description:
        'Order of stops, location groups, or GeoJSON locations for a particular trip. The values must increase along the trip but do not need to be consecutive.<hr>*Example: The first location on the trip could have a `stop_sequence`=`1`, the second location on the trip could have a `stop_sequence`=`23`, the third location could have a `stop_sequence`=`40`, and so on.* <br><br> Travel within the same location group or GeoJSON location requires two records in [stop_times.txt](#stop_timestxt) with the same `location_group_id` or `location_id`.',
    },
    {
      name: 'stop_headsign',
      type: 'Text',
      presence: 'Optional',
      description:
        "Text that appears on signage identifying the trip's destination to riders. This field overrides the default `trips.trip_headsign` when the headsign changes between stops. If the headsign is displayed for an entire trip, `trips.trip_headsign` should be used instead. <br><br>  A `stop_headsign` value specified for one `stop_time` does not apply to subsequent `stop_time`s in the same trip. If you want to override the `trip_headsign` for multiple `stop_time`s in the same trip, the `stop_headsign` value must be repeated in each `stop_time` row.",
    },
    {
      name: 'start_pickup_drop_off_window',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if stop_times.location_group_id or stop_times.location_id is defined. Forbidden if stop_times.stop_id is defined.',
      description:
        'Time that on-demand service becomes available in a GeoJSON location, location group, or stop.<br><br>**Conditionally Required**:<br>- **Required** if `stop_times.location_group_id` or `stop_times.location_id` is defined.<br>- **Required** if `end_pickup_drop_off_window` is defined.<br>- **Forbidden** if `arrival_time` or `departure_time` is defined.<br>- Optional otherwise.',
    },
    {
      name: 'end_pickup_drop_off_window',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if stop_times.location_group_id or stop_times.location_id is defined. Forbidden if stop_times.stop_id is defined.',
      description:
        'Time that on-demand service ends in a GeoJSON location, location group, or stop.<br><br>**Conditionally Required**:<br>- **Required** if `stop_times.location_group_id` or `stop_times.location_id` is defined.<br>- **Required** if `start_pickup_drop_off_window` is defined.<br>- **Forbidden** if `arrival_time` or `departure_time` is defined.<br>- Optional otherwise.',
    },
    {
      name: 'pickup_type',
      type: 'Enum',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'pickup_type=1 or pickup_type=2 is required if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined. pickup_type=0 and pickup_type=3 are forbidden.',
      description:
        'Indicates pickup method. Valid options are:<br><br>`0` or empty - Regularly scheduled pickup. <br>`1` - No pickup available.<br>`2` - Must phone agency to arrange pickup.<br>`3` - Must coordinate with driver to arrange pickup.<br><br> **Conditionally Forbidden**: <br>- `pickup_type=0` **forbidden** if `start_pickup_drop_off_window` or `end_pickup_drop_off_window` are defined.<br> - `pickup_type=3` **forbidden** if `start_pickup_drop_off_window` or `end_pickup_drop_off_window` are defined.<br> - Optional otherwise.',
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
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'drop_off_type=1, 2 or 3 is required if stop_times.start_pickup_drop_off_window or stop_times.end_pickup_drop_off_window is defined. drop_off_type=0 is forbidden.',
      description:
        'Indicates drop off method. Valid options are:<br><br>`0` or empty - Regularly scheduled drop off.<br>`1` - No drop off available.<br>`2` - Must phone agency to arrange drop off.<br>`3` - Must coordinate with driver to arrange drop off.<br><br> **Conditionally Forbidden**:<br> - `drop_off_type=0` **forbidden** if `start_pickup_drop_off_window` or `end_pickup_drop_off_window` are defined.<br> - Optional otherwise.',
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
        'Indicates that the rider can board the transit vehicle at any point along the vehicle’s travel path as described by [shapes.txt](#shapestxt), from this `stop_time` to the next `stop_time` in the trip’s `stop_sequence`. Valid options are: <br><br>`0` - Continuous stopping pickup. <br>`1` or empty - No continuous stopping pickup. <br>`2` - Must phone agency to arrange continuous stopping pickup. <br>`3` - Must coordinate with driver to arrange continuous stopping pickup.  <br><br>If this field is populated, it overrides any continuous pickup behavior defined in [routes.txt](#routestxt). If this field is empty, the `stop_time` inherits any continuous pickup behavior defined in [routes.txt](#routestxt).<br><br>**Conditionally Forbidden**:<br>- Any value other than `1` or empty is **Forbidden** if `start_pickup_drop_off_window` or `end_pickup_drop_off_window` are defined.<br> - Optional otherwise.',
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
        'Indicates that the rider can alight from the transit vehicle at any point along the vehicle’s travel path as described by [shapes.txt](#shapestxt), from this `stop_time` to the next `stop_time` in the trip’s `stop_sequence`. Valid options are: <br><br>`0` - Continuous stopping drop off. <br>`1` or empty - No continuous stopping drop off. <br>`2` - Must phone agency to arrange continuous stopping drop off. <br>`3` - Must coordinate with driver to arrange continuous stopping drop off. <br><br>If this field is populated, it overrides any continuous drop-off behavior defined in [routes.txt](#routestxt). If this field is empty, the `stop_time` inherits any continuous drop-off behavior defined in [routes.txt](#routestxt).<br><br>**Conditionally Forbidden**:<br>- Any value other than `1` or empty is **Forbidden** if `start_pickup_drop_off_window` or `end_pickup_drop_off_window` are defined.<br> - Optional otherwise.',
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
      type: 'Non-negative float',
      presence: 'Optional',
      description:
        'Actual distance traveled along the associated shape, from the first stop to the stop specified in this record. This field specifies how much of the shape to draw between any two stops during a trip. Must be in the same units used in [shapes.txt](#shapestxt). Values used for `shape_dist_traveled` must increase along with `stop_sequence`; they must not be used to show reverse travel along a route.<br><br>Recommended for routes that have looping or inlining (the vehicle crosses or travels over the same portion of alignment in one trip). See [`shapes.shape_dist_traveled`](#shapestxt). <hr>*Example: If a bus travels a distance of 5.25 kilometers from the start of the shape to the stop,`shape_dist_traveled`=`5.25`.*',
    },
    {
      name: 'timepoint',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates if arrival and departure times for a stop are strictly adhered to by the vehicle or if they are instead approximate and/or interpolated times. This field allows a GTFS producer to provide interpolated stop-times, while indicating that the times are approximate. Valid options are:<br><br>`0` - Times are considered approximate. <br>`1` - Times are considered exact. <br><br> All records of [stop_times.txt](#stop_timestxt) with defined arrival or departure times should have timepoint values populated. If no timepoint values are provided, all times are considered exact.',
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
      type: 'Foreign ID referencing `booking_rules.booking_rule_id`',
      presence: 'Optional',
      description:
        'Identifies the boarding booking rule at this stop time.<br><br>Recommended when `pickup_type=2`.',
      foreignKey: [{ file: 'booking_rules.txt', field: 'booking_rule_id' }],
    },
    {
      name: 'drop_off_booking_rule_id',
      type: 'Foreign ID referencing `booking_rules.booking_rule_id`',
      presence: 'Optional',
      description:
        'Identifies the alighting booking rule at this stop time.<br><br>Recommended when `drop_off_type=2`.',
      foreignKey: [{ file: 'booking_rules.txt', field: 'booking_rule_id' }],
    },
  ],
};
