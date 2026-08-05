import type { GTFSFileSpec } from '../types';

export const fareMediaSpec: GTFSFileSpec = {
  filename: 'fare_media.txt',
  presence: 'Optional',
  description:
    'Describes different fare media that can be employed to use fare products. Fare media are physical or virtual holders used for the representation and validation of a fare product. Part of the Fares v2 model, separate from the legacy Fares v1 model (fare_attributes.txt, fare_rules.txt).',
  fields: [
    {
      name: 'fare_media_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description: 'Identifies a fare media.',
    },
    {
      name: 'fare_media_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'Name of the fare media. For transit cards and mobile apps, the fare_media_name should be added and should match the rider-facing name used by the organizations delivering the fare product.',
    },
    {
      name: 'fare_media_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'The type of fare media. Valid options are:\n\n0 - None. Used when there is no fare media involved in purchasing or validating a fare product, such as paying cash to a driver or conductor with no physical ticket provided.\n1 - Physical paper ticket that allows a passenger to take either a certain number of pre-purchased trips or unlimited trips within a fixed period of time.\n2 - Physical transit card that has stored tickets, passes or monetary value.\n3 - cEMV (Contactless Europay, Mastercard and Visa) as an open-loop token container for account-based ticketing.\n4 - Mobile app that have stored virtual transit cards, tickets, passes, or monetary value.',
      enumValues: [
        {
          value: 0,
          label: 'None',
          description:
            'Used when there is no fare media involved in purchasing or validating a fare product, such as paying cash to a driver or conductor with no physical ticket provided.',
        },
        {
          value: 1,
          label: 'Physical paper ticket',
          description:
            'A physical paper ticket that allows a passenger to take either a certain number of pre-purchased trips or unlimited trips within a fixed period of time.',
        },
        {
          value: 2,
          label: 'Physical transit card',
          description:
            'A physical transit card that has stored tickets, passes or monetary value.',
        },
        {
          value: 3,
          label: 'cEMV',
          description:
            'cEMV (Contactless Europay, Mastercard and Visa) as an open-loop token container for account-based ticketing.',
        },
        {
          value: 4,
          label: 'Mobile app',
          description:
            'A mobile app that has stored virtual transit cards, tickets, passes, or monetary value.',
        },
      ],
    },
  ],
};
