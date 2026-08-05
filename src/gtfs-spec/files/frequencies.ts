import type { GTFSFileSpec } from '../types';

export const frequenciesSpec: GTFSFileSpec = {
  filename: 'frequencies.txt',
  presence: 'Optional',
  description:
    '[Frequencies.txt](#frequenciestxt) represents trips that operate on regular headways (time between trips). This file may be used to represent two different types of service.\n* Frequency-based service (`exact_times`=`0`) in which service does not follow a fixed schedule throughout the day. Instead, operators attempt to strictly maintain predetermined headways for trips.\n* A compressed representation of schedule-based service (`exact_times`=`1`) that has the exact same headway for trips over specified time period(s). In schedule-based service operators try to strictly adhere to a schedule.',
  fields: [
    {
      name: 'trip_id',
      type: 'Foreign ID referencing `trips.trip_id`',
      presence: 'Required',
      description:
        'Identifies a trip to which the specified headway of service applies.',
      foreignKey: [{ file: 'trips.txt', field: 'trip_id' }],
    },
    {
      name: 'start_time',
      type: 'Time',
      presence: 'Required',
      description:
        'Time at which the first vehicle departs from the first stop of the trip with the specified headway.',
    },
    {
      name: 'end_time',
      type: 'Time',
      presence: 'Required',
      description:
        'Time at which service changes to a different headway (or ceases) at the first stop in the trip.',
    },
    {
      name: 'headway_secs',
      type: 'Positive integer',
      presence: 'Required',
      description:
        'Time, in seconds, between departures from the same stop (headway) for the trip, during the time interval specified by `start_time` and `end_time`. Multiple headways may be defined for the same trip, but must not overlap. New headways may start at the exact time the previous headway ends.',
    },
    {
      name: 'exact_times',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates the type of service for a trip. See the file description for more information. Valid options are:<br><br>`0` or empty - Frequency-based trips.<br>`1` - Schedule-based trips with the exact same headway throughout the day. In this case the `end_time` value must be greater than the last desired trip `start_time` but less than the last desired trip start_time + `headway_secs`.',
      enumValues: [
        {
          value: 0,
          label: 'Frequency-based',
          description:
            'Frequency-based trips. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Schedule-based',
          description:
            'Schedule-based trips with the exact same headway throughout the day. In this case the end_time value must be greater than the last desired trip start_time but less than the last desired trip start_time + headway_secs.',
        },
      ],
    },
  ],
};
