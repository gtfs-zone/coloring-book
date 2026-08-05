import type { GTFSFileSpec } from '../types';

export const fareLegJoinRulesSpec: GTFSFileSpec = {
  filename: 'fare_leg_join_rules.txt',
  presence: 'Optional',
  description:
    'Defines rules for combining consecutive fare legs into a single effective fare leg for fare calculation purposes. When two consecutive legs match a join rule, they are treated as one leg, allowing the combined leg to match a different fare_leg_rules.txt entry than either individual leg would. Part of the Fares v2 model.',
  fields: [
    {
      name: 'from_leg_group_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a group of fare leg entries from fare_leg_rules.txt that are the starting leg in the sequence to be joined.',
      foreignKey: { file: 'fare_leg_rules.txt', field: 'leg_group_id' },
    },
    {
      name: 'to_leg_group_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a group of fare leg entries from fare_leg_rules.txt that are the ending leg in the sequence to be joined.',
      foreignKey: { file: 'fare_leg_rules.txt', field: 'leg_group_id' },
    },
    {
      name: 'duration_limit',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Defines the maximum duration in seconds between the from_leg and to_leg within which the join rule applies. If empty, no time limit is applied.',
    },
    {
      name: 'fare_transfer_rule_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies the fare transfer rule to apply when this leg join rule is triggered.',
      foreignKey: {
        file: 'fare_transfer_rules.txt',
        field: 'fare_transfer_rule_id',
      },
    },
  ],
};
