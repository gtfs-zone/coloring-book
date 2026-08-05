import type { GTFSFileSpec } from '../types';

export const bookingRulesSpec: GTFSFileSpec = {
  filename: 'booking_rules.txt',
  presence: 'Optional',
  description: 'Defines the booking rules for rider-requested services',
  fields: [
    {
      name: 'booking_rule_id',
      type: 'Unique ID',
      presence: 'Required',
      description: 'Identifies a rule.',
      isPrimaryKey: true,
    },
    {
      name: 'booking_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates how far in advance booking can be made. Valid options are:<br><br>`0` - Real time booking.<br>`1` - Up to same-day booking with advance notice.<br>`2` - Up to prior day(s) booking.',
      enumValues: [
        {
          value: 0,
          label: 'Real time',
          description: 'Real time booking.',
        },
        {
          value: 1,
          label: 'Same-day advance',
          description: 'Up to same-day booking with advance notice.',
        },
        {
          value: 2,
          label: 'Prior day(s)',
          description: 'Up to prior day(s) booking.',
        },
      ],
    },
    {
      name: 'prior_notice_duration_min',
      type: 'Integer',
      presence: 'Conditionally Required',
      presenceCondition: 'Required for booking_type=1. Forbidden otherwise.',
      description:
        'Minimum number of minutes before travel to make the request.<br><br>**Conditionally Required**:<br>- **Required** for `booking_type=1`.<br>- **Forbidden** otherwise.',
    },
    {
      name: 'prior_notice_duration_max',
      type: 'Integer',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden for booking_type=0 and booking_type=2. Optional for booking_type=1.',
      description:
        'Maximum number of minutes before travel to make the booking request.<br><br>**Conditionally Forbidden**:<br>- **Forbidden** for `booking_type=0` and `booking_type=2`.<br>- Optional for `booking_type=1`.',
    },
    {
      name: 'prior_notice_last_day',
      type: 'Integer',
      presence: 'Conditionally Required',
      presenceCondition: 'Required for booking_type=2. Forbidden otherwise.',
      description:
        'Last day before travel to make the booking request. <br><br>Example: “Ride must be booked 1 day in advance before 5PM” will be encoded as `prior_notice_last_day=1`.<br><br>**Conditionally Required**:<br>- **Required** for `booking_type=2`.<br>- **Forbidden** otherwise.',
    },
    {
      name: 'prior_notice_last_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if prior_notice_last_day is defined. Forbidden otherwise.',
      description:
        'Last time on the last day before travel to make the booking request.<br><br>Example: “Ride must be booked 1 day in advance before 5PM” will be encoded as `prior_notice_last_time=17:00:00`.<br><br>**Conditionally Required**:<br>- **Required** if `prior_notice_last_day` is defined.<br>- **Forbidden** otherwise.',
    },
    {
      name: 'prior_notice_start_day',
      type: 'Integer',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden for booking_type=0. Forbidden for booking_type=1 if prior_notice_duration_max is defined. Optional otherwise.',
      description:
        'Earliest day before travel to make the booking request.<br><br>Example: “Ride can be booked at the earliest one week in advance at midnight” will be encoded as `prior_notice_start_day=7`.<br><br>**Conditionally Forbidden**:<br>- **Forbidden** for `booking_type=0`.<br> - **Forbidden** for `booking_type=1` if `prior_notice_duration_max` is defined.<br> - Optional otherwise.',
    },
    {
      name: 'prior_notice_start_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if prior_notice_start_day is defined. Forbidden otherwise.',
      description:
        'Earliest time on the earliest day before travel to make the booking request.<br><br>Example: “Ride can be booked at the earliest one week in advance at midnight” will be encoded as `prior_notice_start_time=00:00:00`.<br><br>**Conditionally Required**:<br>- **Required** if `prior_notice_start_day` is defined.<br>- **Forbidden** otherwise.',
    },
    {
      name: 'prior_notice_service_id',
      type: 'Foreign ID referencing `calendar.service_id`',
      presence: 'Conditionally Forbidden',
      presenceCondition: 'Optional if booking_type=2. Forbidden otherwise.',
      description:
        'Indicates the service days on which `prior_notice_last_day` or `prior_notice_start_day` are counted. <br><br>Example: If empty, `prior_notice_start_day=2` will be two calendar days in advance. If defined as a `service_id` containing only business days (weekdays without holidays), `prior_notice_start_day=2` will be two business days in advance.<br><br>**Conditionally Forbidden**:<br> - Optional if `booking_type=2`. <br> - **Forbidden** otherwise.',
      foreignKey: [{ file: 'calendar.txt', field: 'service_id' }],
    },
    {
      name: 'message',
      type: 'Text',
      presence: 'Optional',
      description:
        'Message to riders utilizing service at a `stop_time` when booking on-demand pickup and drop off. Meant to provide minimal information to be transmitted within a user interface about the action a rider must take in order to utilize the service.',
    },
    {
      name: 'pickup_message',
      type: 'Text',
      presence: 'Optional',
      description:
        'Functions in the same way as `message` but used when riders have on-demand pickup only.',
    },
    {
      name: 'drop_off_message',
      type: 'Text',
      presence: 'Optional',
      description:
        'Functions in the same way as `message` but used when riders have on-demand drop off only.',
    },
    {
      name: 'phone_number',
      type: 'Phone number',
      presence: 'Optional',
      description: 'Phone number to call to make the booking request.',
    },
    {
      name: 'info_url',
      type: 'URL',
      presence: 'Optional',
      description: 'URL providing information about the booking rule.',
    },
    {
      name: 'booking_url',
      type: 'URL',
      presence: 'Optional',
      description:
        'URL to an online interface or app where the booking request can be made.',
    },
  ],
};
