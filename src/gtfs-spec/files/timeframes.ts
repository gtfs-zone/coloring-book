import type { GTFSFileSpec } from '../types';

export const timeframesSpec: GTFSFileSpec = {
  filename: 'timeframes.txt',
  presence: 'Optional',
  description:
    'Date and time periods to use in fare rules for fares that depend on date and time factors. Part of the Fares v2 model.',
  fields: [
    {
      name: 'timeframe_group_id',
      type: 'ID',
      presence: 'Required',
      isPrimaryKey: true,
      description:
        'Identifies a timeframe or set of timeframes. Multiple records may share the same timeframe_group_id to represent different time windows when the same fare applies.',
    },
    {
      name: 'start_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if end_time is defined. An omitted value indicates that the timeframe is active from the beginning of the service day.',
      description:
        'Defines the beginning of a timeframe. The interval includes the start time. Values greater than 24:00:00 are not permitted. An empty value in start_time is considered equivalent to 00:00:00.',
    },
    {
      name: 'end_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if start_time is defined. An omitted value indicates that the timeframe is active until the end of the service day.',
      description:
        'Defines the end of a timeframe. The interval does not include the end moment. Values greater than 24:00:00 are not permitted. An empty value in end_time is considered equivalent to 24:00:00.',
    },
    {
      name: 'service_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies the set of dates when this timeframe is active. The matching service must be defined in calendar.txt or calendar_dates.txt.',
      foreignKey: { file: 'calendar.txt', field: 'service_id' },
    },
  ],
};
