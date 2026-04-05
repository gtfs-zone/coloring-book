import type { GTFSFileSpec } from '../types';

export const bookingRulesSpec: GTFSFileSpec = {
  filename: 'booking_rules.txt',
  presence: 'Optional',
  description:
    'Defines the booking rules for rider-requested on-demand services.',
  fields: [
    {
      name: 'booking_rule_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description: 'Identifies a rule.',
    },
    {
      name: 'booking_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates how far in advance booking can be made.\n\n0 - Real time booking.\n1 - Up to same-day booking with advance notice.\n2 - Up to prior day(s) booking.',
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
        'Minimum number of minutes before travel to make the booking request.',
    },
    {
      name: 'prior_notice_duration_max',
      type: 'Integer',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden for booking_type=0 and booking_type=2. Optional for booking_type=1.',
      description:
        'Maximum number of minutes before travel to make the booking request.',
    },
    {
      name: 'prior_notice_last_day',
      type: 'Integer',
      presence: 'Conditionally Required',
      presenceCondition: 'Required for booking_type=2. Forbidden otherwise.',
      description:
        'Last day before travel to make the booking request. Example: "Ride must be booked 1 day in advance before 5PM" would be prior_notice_last_day=1.',
    },
    {
      name: 'prior_notice_last_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if prior_notice_last_day is defined. Forbidden otherwise.',
      description:
        'Last time on the last day before travel to make the booking request. Example: "Ride must be booked 1 day in advance before 5PM" would be prior_notice_last_time=17:00:00.',
    },
    {
      name: 'prior_notice_start_day',
      type: 'Integer',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden for booking_type=0. Forbidden for booking_type=1 if prior_notice_duration_max is defined. Optional otherwise.',
      description:
        'Earliest day before travel to make the booking request. Example: "Ride can be booked at the earliest one week in advance at midnight" would be prior_notice_start_day=7.',
    },
    {
      name: 'prior_notice_start_time',
      type: 'Time',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if prior_notice_start_day is defined. Forbidden otherwise.',
      description:
        'Earliest time on the earliest day before travel to make the booking request. Example: "Ride can be booked at the earliest one week in advance at midnight" would be prior_notice_start_time=00:00:00.',
    },
    {
      name: 'prior_notice_service_id',
      type: 'Foreign ID',
      presence: 'Conditionally Forbidden',
      presenceCondition: 'Optional if booking_type=2. Forbidden otherwise.',
      description:
        'Indicates the service days on which prior_notice_last_day or prior_notice_start_day are counted. If empty, prior_notice_start_day=2 means two calendar days. If a service_id covering business days only, prior_notice_start_day=2 means two business days.',
      foreignKey: { file: 'calendar.txt', field: 'service_id' },
    },
    {
      name: 'message',
      type: 'Text',
      presence: 'Optional',
      description:
        'Message to riders utilizing service at a stop_time when booking on-demand pickup and drop off. Meant to provide minimal information within a user interface about the action a rider must take to utilize the service.',
    },
    {
      name: 'pickup_message',
      type: 'Text',
      presence: 'Optional',
      description:
        'Functions in the same way as message but used when riders have on-demand pickup only.',
    },
    {
      name: 'drop_off_message',
      type: 'Text',
      presence: 'Optional',
      description:
        'Functions in the same way as message but used when riders have on-demand drop off only.',
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
