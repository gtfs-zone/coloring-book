import type { GTFSFileSpec } from '../types';

export const translationsSpec: GTFSFileSpec = {
  filename: 'translations.txt',
  presence: 'Optional',
  description:
    'Translations of customer-facing dataset values into one or more languages.',
  fields: [
    {
      name: 'table_name',
      type: 'Enum',
      presence: 'Required',
      description:
        'Defines the dataset table that contains the field to be translated.',
      enumValues: [
        {
          value: 'agency',
          label: 'agency.txt',
          description: 'Corresponds to agency.txt.',
        },
        {
          value: 'stops',
          label: 'stops.txt',
          description: 'Corresponds to stops.txt.',
        },
        {
          value: 'routes',
          label: 'routes.txt',
          description: 'Corresponds to routes.txt.',
        },
        {
          value: 'trips',
          label: 'trips.txt',
          description: 'Corresponds to trips.txt.',
        },
        {
          value: 'stop_times',
          label: 'stop_times.txt',
          description: 'Corresponds to stop_times.txt.',
        },
        {
          value: 'pathways',
          label: 'pathways.txt',
          description: 'Corresponds to pathways.txt.',
        },
        {
          value: 'levels',
          label: 'levels.txt',
          description: 'Corresponds to levels.txt.',
        },
        {
          value: 'feed_info',
          label: 'feed_info.txt',
          description: 'Corresponds to feed_info.txt.',
        },
        {
          value: 'attributions',
          label: 'attributions.txt',
          description: 'Corresponds to attributions.txt.',
        },
        {
          value: 'areas',
          label: 'areas.txt',
          description: 'Corresponds to areas.txt.',
        },
        {
          value: 'booking_rules',
          label: 'booking_rules.txt',
          description: 'Corresponds to booking_rules.txt.',
        },
        {
          value: 'rider_categories',
          label: 'rider_categories.txt',
          description: 'Corresponds to rider_categories.txt.',
        },
        {
          value: 'fare_media',
          label: 'fare_media.txt',
          description: 'Corresponds to fare_media.txt.',
        },
        {
          value: 'fare_products',
          label: 'fare_products.txt',
          description: 'Corresponds to fare_products.txt.',
        },
      ],
    },
    {
      name: 'field_name',
      type: 'Text',
      presence: 'Required',
      description:
        'Provides the name of the field to be translated. Fields with the type "Text" can be translated, fields with the type "URL", "Email", and "Phone number" can also be translated to provide resources in the correct language. Fields with other types should not be translated.',
    },
    {
      name: 'language',
      type: 'Language code',
      presence: 'Required',
      description:
        'Provides the language of the translation.\n\nIf this language is the same as the one specified in feed_info.feed_lang, the original value of the field will be used as the default value to use in languages without specific translations.',
    },
    {
      name: 'translation',
      type: 'Text or URL or Email',
      presence: 'Required',
      description: 'Provides the translated value.',
    },
    {
      name: 'record_id',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if field_value is empty. Optional if field_value is defined. Forbidden if table_name is feed_info.',
      description:
        'Defines the record that corresponds to the field to be translated. The value in record_id should be a main ID of the dataset table as described in the table below:\n- agency_id for agency.txt\n- stop_id for stops.txt\n- route_id for routes.txt\n- trip_id for trips.txt\n- trip_id for stop_times.txt\n- pathway_id for pathways.txt\n- level_id for levels.txt\n- attribution_id for attributions.txt',
    },
    {
      name: 'record_sub_id',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if the field being translated belongs to a record with a composite key, and record_id is defined. Forbidden otherwise.',
      description:
        'Helps the record that contains the field to be translated when the table has a composite key. The value in record_sub_id equals the secondary ID of the table, as described below:\n- None for agency.txt\n- None for stops.txt\n- None for routes.txt\n- None for trips.txt\n- stop_sequence for stop_times.txt\n- None for pathways.txt\n- None for levels.txt\n- None for attributions.txt',
    },
    {
      name: 'field_value',
      type: 'Text or URL or Email',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if record_id is empty. Optional if record_id is defined.',
      description:
        'Instead of using record_id and record_sub_id to define which record is translated, field_value can be used to define the value which should be translated. When used, the translation will be applied to all records that match field_value in field_name, even if no record_id is defined.\n\nIf both record_id and field_value are defined, record_id is used and the translation applies to the record with the matching record_id. field_value is ignored in this case.',
    },
  ],
};
