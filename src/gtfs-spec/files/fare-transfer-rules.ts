import type { GTFSFileSpec } from '../types';

export const fareTransferRulesSpec: GTFSFileSpec = {
  filename: 'fare_transfer_rules.txt',
  presence: 'Optional',
  description:
    'Fare rules for transfers between legs of travel defined in [`fare_leg_rules.txt`](#fare_leg_rulestxt). A fare transfer rule defined from `from_leg_group_id` to `to_leg_group_id` does not apply in the reverse direction.\nTo process the cost of a multi-leg journey:\n1. The applicable fare leg groups defined in [fare_leg_rules.txt](#fare_leg_rulestxt) should be determined for all individual legs or effective fare legs of travel based on the rider’s journey.\n2. The file [fare_transfer_rules.txt](#fare_transfer_rulestxt) must be filtered by the fields that define the characteristics of the transfer, these fields are:\n- `fare_transfer_rules.from_leg_group_id`\n- `fare_transfer_rules.to_leg_group_id`<br/>\n<br/>\n3. If the transfer exactly matches a record in [fare_transfer_rules.txt](#fare_transfer_rulestxt) based on the characteristics of the transfer, then that record must be processed to determine the transfer cost.\n4. If no exact matches are found, then empty entries in `from_leg_group_id` or in `to_leg_group_id` must be checked to process the transfer cost:\n- An empty entry in `fare_transfer_rules.from_leg_group_id` corresponds to all leg groups defined under `fare_leg_rules.leg_group_id` excluding the ones listed under `fare_transfer_rules.from_leg_group_id`\n- An empty entry in `fare_transfer_rules.to_leg_group_id` corresponds to all leg groups defined under `fare_leg_rules.leg_group_id` excluding the ones listed under `fare_transfer_rules.to_leg_group_id`<br/>\n<br/>\n5. If the transfer does not match any of the rules described above, then there is no transfer arrangement and the legs are considered separate.\n<br/>',
  fields: [
    {
      name: 'from_leg_group_id',
      type: 'Foreign ID referencing `fare_leg_rules.leg_group_id`',
      presence: 'Optional',
      description:
        'Identifies a group of pre-transfer fare leg rules.<br><br>If there are no matching `fare_transfer_rules.from_leg_group_id` values to the `leg_group_id` being filtered, empty `fare_transfer_rules.from_leg_group_id` will be matched by default. <br><br>An empty entry in `fare_transfer_rules.from_leg_group_id` corresponds to all leg groups defined under `fare_leg_rules.leg_group_id` excluding the ones listed under `fare_transfer_rules.from_leg_group_id`',
      foreignKey: [{ file: 'fare_leg_rules.txt', field: 'leg_group_id' }],
    },
    {
      name: 'to_leg_group_id',
      type: 'Foreign ID referencing `fare_leg_rules.leg_group_id`',
      presence: 'Optional',
      description:
        'Identifies a group of post-transfer fare leg rules.<br><br>If there are no matching `fare_transfer_rules.to_leg_group_id` values to the `leg_group_id` being filtered, empty `fare_transfer_rules.to_leg_group_id` will be matched by default.<br><br>An empty entry in `fare_transfer_rules.to_leg_group_id` corresponds to all leg groups defined under `fare_leg_rules.leg_group_id` excluding the ones listed under `fare_transfer_rules.to_leg_group_id`',
      foreignKey: [{ file: 'fare_leg_rules.txt', field: 'leg_group_id' }],
    },
    {
      name: 'transfer_count',
      type: 'Non-zero integer',
      presence: 'Conditionally Forbidden',
      description:
        'Defines how many consecutive transfers the transfer rule may be applied to.<br><br>Valid options are:<br>`-1` - No limit.<br>`1` or more - Defines how many transfers the transfer rule may span.<br><br>If a sub-journey matches multiple records with different `transfer_count`s, then the rule with the minimum `transfer_count` that is greater than or equal to the current transfer count of the sub-journey is to be selected.<br><br>Conditionally Forbidden:<br>- **Forbidden** if `fare_transfer_rules.from_leg_group_id` does not equal `fare_transfer_rules.to_leg_group_id`.<br>- **Required** if `fare_transfer_rules.from_leg_group_id` equals `fare_transfer_rules.to_leg_group_id`.',
    },
    {
      name: 'duration_limit',
      type: 'Positive integer',
      presence: 'Optional',
      presenceCondition:
        'Required if duration_limit_type is defined. Forbidden otherwise.',
      description:
        'Defines the duration limit of the transfer.<br><br>Must be expressed in integer increments of seconds.<br><br>If there is no duration limit, `fare_transfer_rules.duration_limit` must be empty.',
    },
    {
      name: 'duration_limit_type',
      type: 'Enum',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if duration_limit is defined. Forbidden otherwise.',
      description:
        'Defines the relative start and end of `fare_transfer_rules.duration_limit`.<br><br>Valid options are:<br>`0` - Between the departure fare validation of the first leg in transfer sub-journey and the arrival fare validation of the last leg in transfer sub-journey.<br>`1` - Between the departure fare validation of the first leg in transfer sub-journey and the departure fare validation of the last leg in transfer sub-journey.<br>`2` - Between the arrival fare validation of the first leg in transfer sub-journey and the departure fare validation of the last leg in transfer sub-journey.<br>`3` - Between the arrival fare validation of the first leg in transfer sub-journey and the arrival fare validation of the last leg in transfer sub-journey.<br><br>When a transfer rule with the same `from_leg_group_id` and `to_leg_group_id` is matched multiple times consecutively within a multi-leg journey, the `duration_limit` specified by the rule should be measured starting from the first matched leg.<br><br>Conditionally Required:<br>- **Required** if `fare_transfer_rules.duration_limit` is defined.<br>- **Forbidden** if `fare_transfer_rules.duration_limit` is empty.',
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
        'Indicates the cost processing method of transferring between legs in a journey: <br>![](examples/2-leg.svg) <br>Valid options are:<br>`0` - From-leg `fare_leg_rules.fare_product_id` plus `fare_transfer_rules.fare_product_id`; A + AB.<br>`1` - From-leg `fare_leg_rules.fare_product_id` plus `fare_transfer_rules.fare_product_id` plus to-leg `fare_leg_rules.fare_product_id`; A + AB + B.<br>`2` - `fare_transfer_rules.fare_product_id`; AB. <br><br>Cost processing interactions between multiple transfers in a journey:<br>![](examples/3-leg.svg)<br><table><thead><tr><th>`fare_transfer_type`</th><th>Processing A > B</th><th>Processing B > C</th></tr></thead><tbody><tr><td>`0`</td><td>A + AB</td><td>S + BC</td></tr><tr><td>`1`</td><td>A + AB +B</td><td>S + BC + C</td></tr><tr><td>`2`</td><td>AB</td><td>S + BC</td></tr></tbody></table>Where S indicates the total processed cost of the preceding leg(s) and transfer(s).',
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
      type: 'Foreign ID referencing `fare_products.fare_product_id`',
      presence: 'Optional',
      description:
        'The fare product required to transfer between two fare legs. If empty, the cost of the transfer rule is 0.',
      foreignKey: [{ file: 'fare_products.txt', field: 'fare_product_id' }],
    },
  ],
};
