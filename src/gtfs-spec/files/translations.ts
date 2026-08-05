import type { GTFSFileSpec } from '../types';

export const translationsSpec: GTFSFileSpec = {
  filename: 'translations.txt',
  presence: 'Optional',
  description:
    'In regions that have multiple official languages, transit agencies/operators typically have language-specific names and web pages. In order to best serve riders in those regions, it is useful for the dataset to include these language-dependent values.\nIf both referencing methods (`record_id`, `record_sub_id`) and `field_value` are used to translate the same value in 2 different rows, the translation provided with (`record_id`, `record_sub_id`) takes precedence.',
  fields: [
    {
      name: 'table_name',
      type: 'Enum',
      presence: 'Required',
      description:
        'Defines the table that contains the field to be translated. Allowed values are:<br><br>- `agency`<br>- `stops`<br>- `routes`<br>- `trips`<br>- `stop_times`<br>- `pathways`<br>- `levels`<br>- `feed_info`<br>- `attributions`<br><br> Any file added to GTFS will have a `table_name` value equivalent to the file name, as listed above (i.e., not including the `.txt` file extension).',
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
        'Name of the field to be translated. Fields with type `Text` may be translated, fields with type `URL`, `Email` and `Phone number` may also be “translated” to provide resources in the correct language. Fields with other types should not be translated.',
    },
    {
      name: 'language',
      type: 'Language code',
      presence: 'Required',
      description:
        "Language of translation.<br><br>If the language is the same as in `feed_info.feed_lang`, the original value of the field will be assumed to be the default value to use in languages without specific translations (if `default_lang` doesn't specify otherwise).<hr>_Example: In Switzerland, a city in an officially bilingual canton is officially called “Biel/Bienne”, but would simply be called “Bienne” in French and “Biel” in German._",
    },
    {
      name: 'translation',
      type: 'Text or URL or Email or Phone number',
      presence: 'Required',
      description: 'Translated value.',
    },
    {
      name: 'record_id',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if field_value is empty. Optional if field_value is defined. Forbidden if table_name is feed_info.',
      description:
        "Defines the record that corresponds to the field to be translated. The value in `record_id` must be the first or only field of a table's primary key, as defined in the primary key attribute for each table and below:<br><br>- `agency_id` for [agency.txt](#agencytxt)<br>- `stop_id` for [stops.txt](#stopstxt);<br>- `route_id` for [routes.txt](#routestxt);<br>- `trip_id` for [trips.txt](#tripstxt);<br>- `trip_id` for [stop_times.txt](#stop_timestxt);<br>- `pathway_id` for [pathways.txt](#pathwaystxt);<br>- `level_id` for [levels.txt](#levelstxt);<br>- `attribution_id` for [attributions.txt](#attributionstxt).<br><br>Fields in tables not defined above should not be translated. However producers sometimes add extra fields that are outside the official specification and these unofficial fields may be translated. Below is the recommended way to use `record_id` for those tables:<br><br>- `service_id` for [calendar.txt](#calendartxt);<br>- `service_id` for [calendar_dates.txt](#calendar_datestxt);<br>- `fare_id` for [fare_attributes.txt](#fare_attributestxt);<br>- `fare_id` for [fare_rules.txt](#fare_rulestxt);<br>- `shape_id` for [shapes.txt](#shapestxt);<br>- `trip_id` for [frequencies.txt](#frequenciestxt);<br>- `from_stop_id` for `transfers.txt`.<br><br>Conditionally Required:<br>- **Forbidden** if `table_name` is `feed_info`.<br>- **Forbidden** if `field_value` is defined.<br>- **Required** if `field_value` is empty.",
    },
    {
      name: 'record_sub_id',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if the field being translated belongs to a record with a composite key, and record_id is defined. Forbidden otherwise.',
      description:
        'Helps the record that contains the field to be translated when the table doesn’t have a unique ID. Therefore, the value in `record_sub_id` is the secondary ID of the table, as defined by the table below:<br><br>- None for [agency.txt](#agencytxt);<br>- None for [stops.txt](#stopstxt);<br>- None for [routes.txt](#routestxt);<br>- None for [trips.txt](#tripstxt);<br>- `stop_sequence` for [stop_times.txt](#stop_timestxt);<br>- None for [pathways.txt](#pathwaystxt);<br>- None for [levels.txt](#levelstxt);<br>- None for [attributions.txt](#attributionstxt).<br><br>Fields in tables not defined above should not be translated. However producers sometimes add extra fields that are outside the official specification and these unofficial fields may be translated. Below is the recommended way to use `record_sub_id` for those tables:<br><br>- None for [calendar.txt](#calendartxt);<br>- `date` for [calendar_dates.txt](#calendar_datestxt);<br>- None for [fare_attributes.txt](#fare_attributestxt);<br>- `route_id` for [fare_rules.txt](#fare_rulestxt);<br>- None for [shapes.txt](#shapestxt);<br>- `start_time` for [frequencies.txt](#frequenciestxt);<br>- `to_stop_id` for [transfers.txt](#transferstxt).<br><br>Conditionally Required:<br>- **Forbidden** if `table_name` is `feed_info`.<br>- **Forbidden** if `field_value` is defined.<br>- **Required** if `table_name=stop_times` and `record_id` is defined.',
    },
    {
      name: 'field_value',
      type: 'Text or URL or Email or Phone number',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if record_id is empty. Optional if record_id is defined.',
      description:
        'Instead of defining which record should be translated by using `record_id` and `record_sub_id`, this field can be used to define the value which should be translated. When used, the translation will be applied when the fields identified by `table_name` and `field_name` contains the exact same value defined in field_value.<br><br>The field must have **exactly** the value defined in `field_value`. If only a subset of the value matches `field_value`, the translation won’t be applied.<br><br>If two translation rules match the same record (one with `field_value`, and the other one with `record_id`), the rule with `record_id` takes precedence.<br><br>Conditionally Required:<br>- **Forbidden** if `table_name` is `feed_info`.<br>- **Forbidden** if `record_id` is defined.<br>- **Required** if `record_id` is empty.',
    },
  ],
};
