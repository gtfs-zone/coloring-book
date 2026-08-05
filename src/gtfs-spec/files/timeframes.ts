import type { GTFSFileSpec } from '../types';

export const timeframesSpec: GTFSFileSpec = {
  filename: 'timeframes.txt',
  presence: 'Optional',
  description:
    'Used to describe fares that can vary based on the time of day, the day of the week, or a particular day in the year. Timeframes can be associated with fare products in [fare_leg_rules.txt](#fare_leg_rulestxt). <br>\nThere must not be overlapping time intervals for the same `timeframe_group_id` and `service_id` values.',
  fields: [
    {
      name: 'timeframe_group_id',
      type: 'ID',
      presence: 'Required',
      description: 'Identifies a timeframe or set of timeframes.',
      isPrimaryKey: true,
    },
    {
      name: 'start_time',
      type: 'Local time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if end_time is defined. An omitted value indicates that the timeframe is active from the beginning of the service day.',
      description:
        'Defines the beginning of a timeframe. The interval includes the start time.<br> Values greater than `24:00:00` are forbidden. An empty value in `start_time` is considered `00:00:00`. <br><br> Conditionally Required:<br> - **Required** if `timeframes.end_time` is defined.<br> - **Forbidden** otherwise',
    },
    {
      name: 'end_time',
      type: 'Local time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if start_time is defined. An omitted value indicates that the timeframe is active until the end of the service day.',
      description:
        'Defines the end of a timeframe. The interval does not include the end time.<br> Values greater than `24:00:00` are forbidden. An empty value in `end_time` is considered `24:00:00`. <br><br> Conditionally Required:<br> - **Required** if `timeframes.start_time` is defined.<br> - **Forbidden** otherwise',
    },
    {
      name: 'service_id',
      type: 'Foreign ID referencing `calendar.service_id` or `calendar_dates.service_id`',
      presence: 'Required',
      description: 'Identifies a set of dates that a timeframe is in effect.',
      foreignKey: [
        { file: 'calendar.txt', field: 'service_id' },
        { file: 'calendar_dates.txt', field: 'service_id' },
      ],
    },
  ],
};
