import type { GTFSFileSpec } from '../types';

export const tripsSpec: GTFSFileSpec = {
  filename: 'trips.txt',
  presence: 'Required',
  description:
    'Trips for each route. A trip is a sequence of two or more stops that occur during a specific time period.',
  fields: [
    {
      name: 'route_id',
      type: 'Foreign ID',
      presence: 'Required',
      description: 'Identifies a route.',
      foreignKey: { file: 'routes.txt', field: 'route_id' },
    },
    {
      name: 'service_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a set of dates when service is available for one or more routes. The referenced service_id must be defined in calendar.txt or calendar_dates.txt.',
      foreignKey: { file: 'calendar.txt', field: 'service_id' },
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
        "Text that appears on signage identifying the trip's destination to riders. Use this field to distinguish between different patterns of service on the same route. If the headsign changes during a trip, trip_headsign may be overridden by specifying values for stop_times.stop_headsign.",
    },
    {
      name: 'trip_short_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'Public facing text used to identify the trip to riders, for instance, to identify train numbers for commuter rail trips. If riders do not commonly rely on trip names, leave this field empty. A trip_short_name value, if provided, should uniquely identify a trip within a service day; it should not be used for destination names or limited/express designations.',
    },
    {
      name: 'direction_id',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates the direction of travel for a trip. This field is not used in routing; it provides a way to separate trips by direction when publishing time tables. Valid options are:\n\n0 - Travel in one direction (e.g. outbound travel).\n1 - Travel in the opposite direction (e.g. inbound travel).',
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
        'Identifies the block to which the trip belongs. A block consists of a single trip or many sequential trips made using the same vehicle, defined by shared service days and block_id. A block_id may have trips with different service days, making distinct blocks.',
    },
    {
      name: 'shape_id',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if the trip has a continuous pickup or drop off behavior defined, either in routes.txt or in stop_times.txt. Otherwise optional.',
      description:
        'Identifies a geospatial shape describing the vehicle travel path for a trip.',
      foreignKey: { file: 'shapes.txt', field: 'shape_id' },
    },
    {
      name: 'wheelchair_accessible',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates wheelchair accessibility. Valid options are:\n\n0 (or empty) - No accessibility information for the trip.\n1 - Vehicle being used on this particular trip can accommodate at least one rider in a wheelchair.\n2 - No riders in wheelchairs can be accommodated on this trip.',
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
        'Indicates whether bikes are allowed. Valid options are:\n\n0 (or empty) - No bike information for the trip.\n1 - Vehicle being used on this particular trip can accommodate at least one bicycle.\n2 - No bicycles are allowed on this trip.',
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
  ],
};
