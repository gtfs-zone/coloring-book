import type { GTFSFileSpec } from '../types';

export const calendarDatesSpec: GTFSFileSpec = {
  filename: 'calendar_dates.txt',
  presence: 'Conditionally Required',
  presenceCondition:
    'Required if calendar.txt is omitted. In that case calendar_dates.txt must contain all dates of service. May be used in conjunction with calendar.txt to define exceptions to the default service patterns.',
  description:
    'Exceptions for the services defined in the calendar.txt file. If calendar.txt is omitted, then calendar_dates.txt is required and must contain all dates of service.',
  fields: [
    {
      name: 'service_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a set of dates when a service exception occurs for one or more routes. Each (service_id, date) pair may only appear once in calendar_dates.txt if using calendar.txt and calendar_dates.txt in conjunction. If a service_id value appears in both calendar.txt and calendar_dates.txt, the information in calendar_dates.txt modifies the service information specified in calendar.txt.',
      foreignKey: { file: 'calendar.txt', field: 'service_id' },
    },
    {
      name: 'date',
      type: 'Date',
      presence: 'Required',
      description: 'Date when service exception occurs.',
    },
    {
      name: 'exception_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates whether service is available on the date specified in the date field.',
      enumValues: [
        {
          value: 1,
          label: 'Service added',
          description: 'Service has been added for the specified date.',
        },
        {
          value: 2,
          label: 'Service removed',
          description: 'Service has been removed for the specified date.',
        },
      ],
    },
  ],
};
