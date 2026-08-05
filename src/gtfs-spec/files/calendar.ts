import type { GTFSFileSpec } from '../types';

export const calendarSpec: GTFSFileSpec = {
  filename: 'calendar.txt',
  presence: 'Conditionally Required',
  presenceCondition:
    'Required unless all dates of service are defined in calendar_dates.txt.',
  description:
    'Service dates specified using a weekly schedule with start and end dates. <br><br>Conditionally Required:<br> - **Required** unless all dates of service are defined in [calendar_dates.txt](#calendar_datestxt).<br> - Optional otherwise.',
  fields: [
    {
      name: 'service_id',
      type: 'Unique ID',
      presence: 'Required',
      description:
        'Identifies a set of dates when service is available for one or more routes.',
      isPrimaryKey: true,
    },
    {
      name: 'monday',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates whether the service operates on all Mondays in the date range specified by the `start_date` and `end_date` fields. Note that exceptions for particular dates may be listed in [calendar_dates.txt](#calendar_datestxt). Valid options are:<br><br>`1` - Service is available for all Mondays in the date range.<br>`0` - Service is not available for Mondays in the date range.',
      enumValues: [
        {
          value: 1,
          label: 'Service available',
          description:
            'Service is available for all Mondays in the date range.',
        },
        {
          value: 0,
          label: 'Service not available',
          description:
            'Service is not available for Mondays in the date range.',
        },
      ],
    },
    {
      name: 'tuesday',
      type: 'Enum',
      presence: 'Required',
      description:
        'Functions in the same way as `monday` except applies to Tuesdays',
      enumValues: [
        {
          value: 1,
          label: 'Service available',
          description:
            'Service is available for all Tuesdays in the date range.',
        },
        {
          value: 0,
          label: 'Service not available',
          description:
            'Service is not available for Tuesdays in the date range.',
        },
      ],
    },
    {
      name: 'wednesday',
      type: 'Enum',
      presence: 'Required',
      description:
        'Functions in the same way as `monday` except applies to Wednesdays',
      enumValues: [
        {
          value: 1,
          label: 'Service available',
          description:
            'Service is available for all Wednesdays in the date range.',
        },
        {
          value: 0,
          label: 'Service not available',
          description:
            'Service is not available for Wednesdays in the date range.',
        },
      ],
    },
    {
      name: 'thursday',
      type: 'Enum',
      presence: 'Required',
      description:
        'Functions in the same way as `monday` except applies to Thursdays',
      enumValues: [
        {
          value: 1,
          label: 'Service available',
          description:
            'Service is available for all Thursdays in the date range.',
        },
        {
          value: 0,
          label: 'Service not available',
          description:
            'Service is not available for Thursdays in the date range.',
        },
      ],
    },
    {
      name: 'friday',
      type: 'Enum',
      presence: 'Required',
      description:
        'Functions in the same way as `monday` except applies to Fridays',
      enumValues: [
        {
          value: 1,
          label: 'Service available',
          description:
            'Service is available for all Fridays in the date range.',
        },
        {
          value: 0,
          label: 'Service not available',
          description:
            'Service is not available for Fridays in the date range.',
        },
      ],
    },
    {
      name: 'saturday',
      type: 'Enum',
      presence: 'Required',
      description:
        'Functions in the same way as `monday` except applies to Saturdays.',
      enumValues: [
        {
          value: 1,
          label: 'Service available',
          description:
            'Service is available for all Saturdays in the date range.',
        },
        {
          value: 0,
          label: 'Service not available',
          description:
            'Service is not available for Saturdays in the date range.',
        },
      ],
    },
    {
      name: 'sunday',
      type: 'Enum',
      presence: 'Required',
      description:
        'Functions in the same way as `monday` except applies to Sundays.',
      enumValues: [
        {
          value: 1,
          label: 'Service available',
          description:
            'Service is available for all Sundays in the date range.',
        },
        {
          value: 0,
          label: 'Service not available',
          description:
            'Service is not available for Sundays in the date range.',
        },
      ],
    },
    {
      name: 'start_date',
      type: 'Date',
      presence: 'Required',
      description: 'Start service day for the service interval.',
    },
    {
      name: 'end_date',
      type: 'Date',
      presence: 'Required',
      description:
        'End service day for the service interval. This service day is included in the interval.',
    },
  ],
};
