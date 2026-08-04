import type { GTFSFileSpec } from '../types';

export const fareProductsSpec: GTFSFileSpec = {
  filename: 'fare_products.txt',
  presence: 'Optional',
  description:
    'Describes the different types of tickets or fares that can be purchased by riders. Part of the Fares v2 model, separate from the legacy Fares v1 model (fare_attributes.txt, fare_rules.txt). The primary key is a composite of fare_product_id, rider_category_id, and fare_media_id.',
  fields: [
    {
      name: 'fare_product_id',
      type: 'ID',
      presence: 'Required',
      isPrimaryKey: true,
      description:
        'Identifies a fare product or a set of fare products. Multiple fare products may share the same fare_product_id but with different rider_category_id or fare_media_id values.',
    },
    {
      name: 'fare_product_name',
      type: 'Text',
      presence: 'Optional',
      description: 'Name of the fare product as displayed to riders.',
    },
    {
      name: 'rider_category_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a rider category eligible for this fare product. When empty, the fare product applies to all riders.',
      foreignKey: { file: 'rider_categories.txt', field: 'rider_category_id' },
    },
    {
      name: 'fare_media_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a fare media that can be employed to use the fare product during the trip. When fare_media_id is empty, it is considered that the fare media is unknown.',
      foreignKey: { file: 'fare_media.txt', field: 'fare_media_id' },
    },
    {
      name: 'amount',
      type: 'Currency amount',
      presence: 'Required',
      description:
        'The cost of the fare product. May be negative to represent transfer discounts. May be 0 to represent a fare product that is free.',
    },
    {
      name: 'currency',
      type: 'Currency code',
      presence: 'Required',
      description: 'The currency of the cost of the fare product.',
    },
  ],
};
