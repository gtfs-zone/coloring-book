import type { GTFSFileSpec } from '../types';

export const riderCategoriesSpec: GTFSFileSpec = {
  filename: 'rider_categories.txt',
  presence: 'Optional',
  description:
    'Defines categories of riders (e.g. elderly, student). Rider categories can be associated with fare products in fare_products.txt to define category-specific pricing. Part of the Fares v2 model.',
  fields: [
    {
      name: 'rider_category_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description: 'Identifies a rider category.',
    },
    {
      name: 'rider_category_name',
      type: 'Text',
      presence: 'Required',
      description:
        'Name of the rider category as displayed to the rider. For example: "Adult", "Child", "Student", "Senior".',
    },
    {
      name: 'is_default_fare_container',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates whether this rider category is the default category. A single rider_category may be set as default if it applies to the widest range of riders, such as an adult category. If multiple fare products for the same fare media are available and no rider category is specified, the default rider category is used to determine which fare product applies.\n\n0 - Not the default rider category.\n1 - Default rider category.',
      enumValues: [
        {
          value: 0,
          label: 'Not default',
          description: 'Not the default rider category.',
        },
        {
          value: 1,
          label: 'Default',
          description: 'Default rider category.',
        },
      ],
    },
    {
      name: 'eligibility_url',
      type: 'URL',
      presence: 'Optional',
      description:
        'URL of a web page that describes the eligibility criteria for this rider category.',
    },
    {
      name: 'min_age',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Minimum age (inclusive) for a rider to be eligible for this rider category.',
    },
    {
      name: 'max_age',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Maximum age (inclusive) for a rider to be eligible for this rider category.',
    },
  ],
};
