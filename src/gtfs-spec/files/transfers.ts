import type { GTFSFileSpec } from '../types';

export const transfersSpec: GTFSFileSpec = {
  filename: 'transfers.txt',
  presence: 'Optional',
  description:
    'When calculating an itinerary, GTFS-consuming applications interpolate transfers based on allowable time and stop proximity. [Transfers.txt](#transferstxt) specifies additional rules and overrides for selected transfers.\nFields `from_trip_id`, `to_trip_id`, `from_route_id` and `to_route_id` allow higher orders of specificity for transfer rules. Along with `from_stop_id` and `to_stop_id`, the ranking of specificity is as follows:\n1. Both `trip_id`s defined: `from_trip_id` and `to_trip_id`.\n2. One `trip_id` and `route_id` set defined: (`from_trip_id` and `to_route_id`) or (`from_route_id` and `to_trip_id`).\n3. One `trip_id` defined: `from_trip_id` or `to_trip_id`.\n4. Both `route_id`s defined: `from_route_id` and `to_route_id`.\n5. One `route_id` defined: `from_route_id` or `to_route_id`.\n6. Only `from_stop_id` and `to_stop_id` defined: no route or trip related fields set.\nFor a given ordered pair of arriving trip and departing trip, the transfer with the greatest specificity that applies between these two trips is chosen. For any pair of trips, there should not be two transfers with equally maximal specificity that could apply.',
  fields: [
    {
      name: 'from_stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if from_route_id and from_trip_id are not defined. Optional if from_route_id or from_trip_id are defined.',
      description:
        'Identifies a stop (`location_type=0`) or a station (`location_type=1`) where a connection between routes begins. If this field refers to a station, the transfer rule applies to all its child stops. It must refer to a stop (`location_type=0`) if `transfer_type` is `4` or `5`.<br><br>Conditionally Required:<br>- **Required** if `transfer_type` is empty, `0`, `1`, `2`, or `3`.<br>- Optional if `transfer_type` is `4` or `5`.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
    {
      name: 'to_stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if to_route_id and to_trip_id are not defined. Optional if to_route_id or to_trip_id are defined.',
      description:
        'Identifies a stop (`location_type=0`) or a station (`location_type=1`) where a connection between routes ends. If this field refers to a station, the transfer rule applies to all child stops. It must refer to a stop (`location_type=0`) if `transfer_type` is 4 or 5.<br><br>Conditionally Required:<br>- **Required** if `transfer_type` is empty, `0`, `1`, `2`, or `3`.<br>- Optional if `transfer_type` is `4` or `5`.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
    {
      name: 'from_route_id',
      type: 'Foreign ID referencing `routes.route_id`',
      presence: 'Optional',
      description:
        'Identifies a route where a connection begins.<br><br>If `from_route_id` is defined, the transfer will apply to the arriving trip on the route for the given `from_stop_id`.<br><br>If both `from_trip_id` and `from_route_id` are defined, the `trip_id` must belong to the `route_id`, and `from_trip_id` will take precedence.',
      foreignKey: [{ file: 'routes.txt', field: 'route_id' }],
    },
    {
      name: 'to_route_id',
      type: 'Foreign ID referencing `routes.route_id`',
      presence: 'Optional',
      description:
        'Identifies a route where a connection ends.<br><br>If `to_route_id` is defined, the transfer will apply to the departing trip on the route for the given `to_stop_id`.<br><br>If both `to_trip_id` and `to_route_id` are defined, the `trip_id` must belong to the `route_id`, and `to_trip_id` will take precedence.',
      foreignKey: [{ file: 'routes.txt', field: 'route_id' }],
    },
    {
      name: 'from_trip_id',
      type: 'Foreign ID referencing `trips.trip_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if transfer_type is 4 or 5. Optional otherwise.',
      description:
        'Identifies a trip where a connection between routes begins.<br><br>If `from_trip_id` is defined, the transfer will apply to the arriving trip for the given `from_stop_id`.<br><br>If both `from_trip_id` and `from_route_id` are defined, the `trip_id` must belong to the `route_id`, and `from_trip_id` will take precedence.<br><br>Conditionally Required:<br>- **Required** if `transfer_type` is `4` or `5`. <br>- Optional otherwise.',
      foreignKey: [{ file: 'trips.txt', field: 'trip_id' }],
    },
    {
      name: 'to_trip_id',
      type: 'Foreign ID referencing `trips.trip_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if transfer_type is 4 or 5. Optional otherwise.',
      description:
        'Identifies a trip where a connection between routes ends.<br><br>If `to_trip_id` is defined, the transfer will apply to the departing trip for the given `to_stop_id`.<br><br>If both `to_trip_id` and `to_route_id` are defined, the `trip_id` must belong to the `route_id`, and `to_trip_id` will take precedence. <br><br>Conditionally Required:<br>- **Required** if `transfer_type` is `4` or `5`. <br>- Optional otherwise.',
      foreignKey: [{ file: 'trips.txt', field: 'trip_id' }],
    },
    {
      name: 'transfer_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates the type of connection for the specified (`from_stop_id`, `to_stop_id`) pair. Valid options are:<br><br> `0` or empty - Recommended transfer point between routes.<br>`1` - Timed transfer point between two routes. The departing vehicle is expected to wait for the arriving one and leave sufficient time for a rider to transfer between routes.<br>`2` - Transfer requires a minimum amount of time between arrival and departure to ensure a connection. The time required to transfer is specified by `min_transfer_time`.<br>`3` - Transfers are not possible between routes at the location.<br>`4` - Passengers can transfer from one trip to another by staying onboard the same vehicle (an "in-seat transfer"). More details about this type of transfer [below](#linked-trips).  <br>`5` - In-seat transfers are not allowed between sequential trips. The passenger must alight from the vehicle and re-board. More details about this type of transfer [below](#linked-trips).',
      enumValues: [
        {
          value: 0,
          label: 'Recommended transfer',
          description:
            'Recommended transfer point between routes. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Timed transfer',
          description:
            'Timed transfer point between two routes. The departing vehicle is expected to wait for the arriving one and leave sufficient time for a rider to transfer between routes.',
        },
        {
          value: 2,
          label: 'Requires minimum time',
          description:
            'Transfer requires a minimum amount of time between arrival and departure to ensure a connection. The time required to transfer is specified by min_transfer_time.',
        },
        {
          value: 3,
          label: 'Not possible',
          description:
            'Transfers are not possible between routes at the location.',
        },
        {
          value: 4,
          label: 'In-seat transfer',
          description:
            'Passengers can transfer from one trip to another by staying onboard the same vehicle (an in-seat transfer). This transfer type indicates a trip-to-trip transfer; from_trip_id and to_trip_id must be defined.',
        },
        {
          value: 5,
          label: 'In-seat transfer not allowed',
          description:
            'In-seat transfers are not allowed between sequential trips. The passenger must alight from the vehicle and re-board. This transfer type indicates a trip-to-trip transfer; from_trip_id and to_trip_id must be defined.',
        },
      ],
    },
    {
      name: 'min_transfer_time',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Amount of time, in seconds, that must be available to permit a transfer between routes at the specified stops. The `min_transfer_time` should be sufficient to permit a typical rider to move between the two stops, including buffer time to allow for schedule variance on each route.',
    },
  ],
};
