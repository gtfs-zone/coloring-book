import type { GTFSFileSpec } from '../types';

export const fareAttributesSpec: GTFSFileSpec = {
  filename: 'fare_attributes.txt',
  presence: 'Optional',
  description:
    "Fare information for a transit agency's routes. Defines the legacy Fares v1 model.",
  fields: [
    {
      name: 'fare_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description: 'Identifies a fare class.',
    },
    {
      name: 'price',
      type: 'Non-negative float',
      presence: 'Required',
      description: 'Fare price, in the unit specified by currency_type.',
    },
    {
      name: 'currency_type',
      type: 'Currency code',
      presence: 'Required',
      description: 'Currency used to pay the fare.',
    },
    {
      name: 'payment_method',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates when the fare must be paid. Valid options are:\n\n0 - Fare is paid on board.\n1 - Fare must be paid before boarding.',
      enumValues: [
        {
          value: 0,
          label: 'On board',
          description: 'Fare is paid on board.',
        },
        {
          value: 1,
          label: 'Before boarding',
          description: 'Fare must be paid before boarding.',
        },
      ],
    },
    {
      name: 'transfers',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates the number of transfers permitted on this fare. The fact that this field can be left empty is an exception to the requirement that a Required field must not be empty. Valid options are:\n\n0 - No transfers permitted on this fare.\n1 - Riders may transfer once.\n2 - Riders may transfer twice.\nempty - Unlimited transfers are permitted.',
      enumValues: [
        {
          value: 0,
          label: 'No transfers',
          description: 'No transfers permitted on this fare.',
        },
        {
          value: 1,
          label: 'One transfer',
          description: 'Riders may transfer once.',
        },
        {
          value: 2,
          label: 'Two transfers',
          description: 'Riders may transfer twice.',
        },
        {
          value: '',
          label: 'Unlimited',
          description: 'Unlimited transfers are permitted.',
        },
      ],
    },
    {
      name: 'agency_id',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if multiple agencies are defined in agency.txt.',
      description:
        'Identifies the relevant agency for a fare. This field is required for datasets with multiple agencies defined in agency.txt, otherwise it is optional.',
      foreignKey: { file: 'agency.txt', field: 'agency_id' },
    },
    {
      name: 'transfer_duration',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Length of time in seconds before a transfer expires. When transfers=0 this field can be used to indicate how long a ticket is valid for or it can be left empty.',
    },
  ],
};
