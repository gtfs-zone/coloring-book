import type { GTFSFileSpec } from '../types';

export const fareProductsSpec: GTFSFileSpec = {
  filename: 'fare_products.txt',
  presence: 'Optional',
  description:
    'Used to describe the range of fares available for purchase by riders or taken into account when computing the total fare for journeys with multiple legs, such as transfer costs.',
  fields: [
    {
      name: 'fare_product_id',
      type: 'ID',
      presence: 'Required',
      description:
        'Identifies a fare product or set of fare products.<br><br>Multiple records sharing the same `fare_product_id` are permitted as long as they contain different `fare_media_id`s or `rider_category_id`s. Differing `fare_media_id`s would indicate various methods are available for employing the fare product, potentially at different prices. Differing `rider_category_id`s would indicate multiple rider categories are eligible for the fare product, potentially at different prices.',
      isPrimaryKey: true,
    },
    {
      name: 'fare_product_name',
      type: 'Text',
      presence: 'Optional',
      description: 'The name of the fare product as displayed to riders.',
    },
    {
      name: 'rider_category_id',
      type: 'Foreign ID referencing `rider_categories.rider_category_id`',
      presence: 'Optional',
      description:
        'Identifies a rider category eligible for the fare product.<br><br>If `fare_products.rider_category_id` is empty, the fare product is eligible for any `rider_category_id`.<br><br>When multiple rider categories are eligible for a single fare product specified by a `fare_product_id`, there must be only one of these rider categories indicated as the default rider category (`is_default_fare_category = 1`).',
      foreignKey: [
        { file: 'rider_categories.txt', field: 'rider_category_id' },
      ],
    },
    {
      name: 'fare_media_id',
      type: 'Foreign ID referencing `fare_media.fare_media_id`',
      presence: 'Optional',
      description:
        'Identifies a fare media that can be employed to use the fare product during the trip. When `fare_media_id` is empty, it is considered that the fare media is unknown.',
      foreignKey: [{ file: 'fare_media.txt', field: 'fare_media_id' }],
    },
    {
      name: 'amount',
      type: 'Currency amount',
      presence: 'Required',
      description:
        'The cost of the fare product. May be negative to represent transfer discounts. May be zero to represent a fare product that is free. The currency amount must contain the number of decimal places specified by the norm ISO 4217 for the accompanying Currency code.<hr>*Example: If the fare is 2 US Dollars, the amount is 2.00 instead of 2.*',
    },
    {
      name: 'currency',
      type: 'Currency code',
      presence: 'Required',
      description: 'The currency of the cost of the fare product.',
    },
  ],
};
