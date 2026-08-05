import type { GTFSFileSpec } from '../types';

export const riderCategoriesSpec: GTFSFileSpec = {
  filename: 'rider_categories.txt',
  presence: 'Optional',
  description: 'Defines categories of riders (e.g. elderly, student).',
  fields: [
    {
      name: 'rider_category_id',
      type: 'Unique ID',
      presence: 'Required',
      description: 'Identifies a rider category.',
      isPrimaryKey: true,
    },
    {
      name: 'rider_category_name',
      type: 'Text',
      presence: 'Required',
      description: 'Rider category name as displayed to the rider.',
    },
    {
      name: 'is_default_fare_category',
      type: 'Enum',
      presence: 'Required',
      description:
        'Specifies if an entry in [rider_categories.txt](#rider_categoriestxt) should be considered the default category (i.e. the main category that should be displayed to riders). For example: Adult fare, Regular fare, etc. Valid options are:<br><br>`0` or empty - Category is not considered the default.<br>`1` - Category is considered the default one.<br><br>When multiple rider categories are eligible for a single fare product specified by a `fare_product_id`, there must be exactly one of these eligible rider categories indicated as the default rider category (`is_default_fare_category = 1`).',
      enumValues: [
        {
          value: 0,
          label: 'Not default',
          description:
            'Category is not considered the default. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Default',
          description: 'Category is considered the default one.',
        },
      ],
    },
    {
      name: 'eligibility_url',
      type: 'URL',
      presence: 'Optional',
      description:
        'URL of a web page, usually from the operating agency, that provides detailed information about a specific rider category and/or describes its eligibility criteria.',
    },
  ],
};
