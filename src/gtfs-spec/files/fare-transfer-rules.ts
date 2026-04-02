import type { GTFSFileSpec } from '../types';

export const fareTransferRulesSpec: GTFSFileSpec = {
  filename: 'fare_transfer_rules.txt',
  presence: 'Optional',
  description:
    'Fare rules for transfers between fare legs. Defines how fares are combined and priced when a rider transfers between legs matching different fare leg rule groups. Part of the Fares v2 model — separate from the legacy Fares v1 model (fare_attributes.txt, fare_rules.txt).',
  fields: [
    {
      name: 'fare_transfer_rule_id',
      type: 'Unique ID',
      presence: 'Optional',
      description:
        'Identifies an individual transfer rule entry. Permits distinguishing separate transfer rules within the file, and allows referencing specific rules from fare_leg_join_rules.txt.',
    },
    {
      name: 'from_leg_group_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a group of pre-transfer fare leg entries from fare_leg_rules.txt.',
      foreignKey: { file: 'fare_leg_rules.txt', field: 'leg_group_id' },
    },
    {
      name: 'to_leg_group_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a group of post-transfer fare leg entries from fare_leg_rules.txt.',
      foreignKey: { file: 'fare_leg_rules.txt', field: 'leg_group_id' },
    },
    {
      name: 'transfer_count',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Constrains the number of transfers this rule may be applied to within the same journey. If empty, no transfer count limit is applied.',
    },
    {
      name: 'duration_limit',
      type: 'Non-negative integer',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if duration_limit_type is defined. Forbidden otherwise.',
      description:
        'Defines the duration limit in seconds of the transfer. If empty, there is no duration limit.',
    },
    {
      name: 'duration_limit_type',
      type: 'Enum',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if duration_limit is defined. Forbidden otherwise.',
      description:
        'Defines the relative event that corresponds to the start and end of the duration_limit. Valid options are:\n\n0 - Between the departure of the from fare leg and the departure of the to fare leg.\n1 - Between the departure of the from fare leg and the arrival of the to fare leg.\n2 - Between the arrival of the from fare leg and the departure of the to fare leg.\n3 - Between the arrival of the from fare leg and the arrival of the to fare leg.',
      enumValues: [
        {
          value: 0,
          label: 'Departure to departure',
          description:
            'Duration is measured between the departure of the current fare leg and the departure of the subsequent fare leg.',
        },
        {
          value: 1,
          label: 'Departure to arrival',
          description:
            'Duration is measured between the departure of the current fare leg and the arrival of the subsequent fare leg.',
        },
        {
          value: 2,
          label: 'Arrival to departure',
          description:
            'Duration is measured between the arrival of the current fare leg and the departure of the subsequent fare leg.',
        },
        {
          value: 3,
          label: 'Arrival to arrival',
          description:
            'Duration is measured between the arrival of the current fare leg and the arrival of the subsequent fare leg.',
        },
      ],
    },
    {
      name: 'fare_transfer_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates the cost processing method of transferring between fare legs in a journey. Valid options are:\n\n0 - From-leg fare price + transfer fare price; A + AB.\n1 - From-leg fare price + transfer fare price + to-leg fare price; A + AB + B.\n2 - Transfer fare price; AB.',
      enumValues: [
        {
          value: 0,
          label: 'A + AB',
          description:
            'The cost of the from-leg fare plus the transfer fare product is applied. The to-leg fare is not added separately.',
        },
        {
          value: 1,
          label: 'A + AB + B',
          description:
            'The cost of the from-leg fare, the transfer fare product, and the to-leg fare are all applied.',
        },
        {
          value: 2,
          label: 'AB',
          description:
            'The transfer fare product alone covers the entire transfer; no from-leg or to-leg fares are added.',
        },
      ],
    },
    {
      name: 'fare_product_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'The fare product required to transfer between the two fare legs. When empty, the cost of the transfer is 0.',
      foreignKey: { file: 'fare_products.txt', field: 'fare_product_id' },
    },
  ],
};
