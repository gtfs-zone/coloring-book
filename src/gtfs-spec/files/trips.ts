import type { GTFSFileSpec } from '../types';

export const tripsSpec: GTFSFileSpec = {
  filename: 'trips.txt',
  presence: 'Required',
  description:
    'Trips for each route. A trip is a sequence of two or more stops that occur during a specific time period.',
  fields: [
    {
      name: 'route_id',
      type: 'Foreign ID referencing `routes.route_id`',
      presence: 'Required',
      description: 'Identifies a route.',
      foreignKey: [{ file: 'routes.txt', field: 'route_id' }],
    },
    {
      name: 'service_id',
      type: 'Foreign ID referencing `calendar.service_id` or `calendar_dates.service_id`',
      presence: 'Required',
      description:
        'Identifies a set of dates when service is available for one or more routes.',
      foreignKey: [
        { file: 'calendar.txt', field: 'service_id' },
        { file: 'calendar_dates.txt', field: 'service_id' },
      ],
    },
    {
      name: 'trip_id',
      type: 'Unique ID',
      presence: 'Required',
      description: 'Identifies a trip.',
      isPrimaryKey: true,
    },
    {
      name: 'trip_headsign',
      type: 'Text',
      presence: 'Optional',
      description:
        "Text that appears on signage identifying the trip's destination to riders. This field is recommended for all services with headsign text displayed on the vehicle which may be used to distinguish amongst trips in a route.<br><br> If the headsign changes during a trip, values for `trip_headsign` may be overridden by defining values in `stop_times.stop_headsign` for specific `stop_time`s along the trip.",
    },
    {
      name: 'trip_short_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'Public facing text used to identify the trip to riders, for instance, to identify train numbers for commuter rail trips. If riders do not commonly rely on trip names, `trip_short_name` should be empty. A `trip_short_name` value, if provided, should uniquely identify a trip within a service day; it should not be used for destination names or limited/express designations.',
    },
    {
      name: 'direction_id',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates the direction of travel for a trip. This field should not be used in routing; it provides a way to separate trips by direction when publishing time tables. Valid options are: <br><br>`0` - Travel in one direction (e.g. outbound travel).<br>`1` - Travel in the opposite direction (e.g. inbound travel).<hr>*Example: The `trip_headsign` and `direction_id` fields may be used together to assign a name to travel in each direction for a set of trips. A [trips.txt](#tripstxt) file could contain these records for use in time tables:* <br> `trip_id,...,trip_headsign,direction_id` <br> `1234,...,Airport,0` <br> `1505,...,Downtown,1`',
      enumValues: [
        {
          value: 0,
          label: 'Outbound',
          description: 'Travel in one direction (e.g. outbound travel).',
        },
        {
          value: 1,
          label: 'Inbound',
          description:
            'Travel in the opposite direction (e.g. inbound travel).',
        },
      ],
    },
    {
      name: 'block_id',
      type: 'ID',
      presence: 'Optional',
      description:
        'Identifies the block to which the trip belongs. A block consists of a single trip or many sequential trips made using the same vehicle, defined by shared service days and `block_id`. A `block_id` may have trips with different service days, making distinct blocks. See the [example below](#example-blocks-and-service-day). To provide in-seat transfers information, [transfers](#transferstxt) of `transfer_type` `4` should be provided instead.',
    },
    {
      name: 'shape_id',
      type: 'Foreign ID referencing `shapes.shape_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if the trip has a continuous pickup or drop off behavior defined, either in routes.txt or in stop_times.txt. Otherwise optional.',
      description:
        'Identifies a geospatial shape describing the vehicle travel path for a trip. <br><br>Conditionally Required: <br>- **Required** if the trip has a continuous pickup or drop-off behavior defined either in [routes.txt](#routestxt) or in [stop_times.txt](#stop_timestxt). <br>- Optional otherwise.',
      foreignKey: [{ file: 'shapes.txt', field: 'shape_id' }],
    },
    {
      name: 'wheelchair_accessible',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates wheelchair accessibility. Valid options are:<br><br>`0` or empty - No accessibility information for the trip.<br>`1` - Vehicle being used on this particular trip can accommodate at least one rider in a wheelchair.<br>`2` - No riders in wheelchairs can be accommodated on this trip.',
      enumValues: [
        {
          value: 0,
          label: 'No information',
          description:
            'No accessibility information for the trip. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Accessible',
          description:
            'Vehicle being used on this particular trip can accommodate at least one rider in a wheelchair.',
        },
        {
          value: 2,
          label: 'Not accessible',
          description:
            'No riders in wheelchairs can be accommodated on this trip.',
        },
      ],
    },
    {
      name: 'bikes_allowed',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates whether bikes are allowed. Valid options are:<br><br>`0` or empty - No bike information for the trip.<br>`1` - Vehicle being used on this particular trip can accommodate at least one bicycle.<br>`2` - No bicycles are allowed on this trip.',
      enumValues: [
        {
          value: 0,
          label: 'No information',
          description:
            'No bike information for the trip. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Bikes allowed',
          description:
            'Vehicle being used on this particular trip can accommodate at least one bicycle.',
        },
        {
          value: 2,
          label: 'Bikes not allowed',
          description: 'No bicycles are allowed on this trip.',
        },
      ],
    },
    {
      name: 'cars_allowed',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates whether cars are allowed. Valid options are:<br><br>`0` or empty - No car information for the trip.<br>`1` - Vehicle being used on this particular trip can accommodate at least one car.<br>`2` - No cars are allowed on this trip.',
      enumValues: [
        {
          value: 0,
          label: 'No information',
          description:
            'No car information for the trip. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Cars allowed',
          description:
            'Vehicle being used on this particular trip can accommodate at least one car.',
        },
        {
          value: 2,
          label: 'Cars not allowed',
          description: 'No cars are allowed on this trip.',
        },
      ],
    },
    {
      name: 'safe_duration_factor',
      type: 'Float',
      presence: 'Optional',
      description:
        'Multiplier applied to travel time estimates calculated for on-demand trips.<br><br>See "Calculating on-demand trip time estimates with safe duration fields" section below for guidance on how to use this and the `safe_duration_offset` fields.',
    },
    {
      name: 'safe_duration_offset',
      type: 'Float',
      presence: 'Optional',
      description:
        'Fixed offset value in seconds applied to travel time estimates calculated for on-demand trips.<br><br>See "Calculating on-demand trip time estimates with safe duration fields" section below for guidance on how to use this and the `safe_duration_factor` fields.',
    },
  ],
};
