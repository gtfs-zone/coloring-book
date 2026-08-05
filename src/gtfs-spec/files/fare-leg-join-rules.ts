import type { GTFSFileSpec } from '../types';

export const fareLegJoinRulesSpec: GTFSFileSpec = {
  filename: 'fare_leg_join_rules.txt',
  presence: 'Optional',
  description:
    'For a sub-journey of two consecutive legs with a transfer, if the transfer matches all matching predicates specified by a particular record in the file, then those two legs should be considered as a single **effective fare leg** for the purposes of matching against rules in [fare_leg_rules.txt](#fare_leg_rulestxt).\n- Unless overridden explicitly by `from_stop_id` and `to_stop_id`, the last station of the pre-transfer leg and the first station of the post-transfer leg must be the same for the record.\n- If a matching predicate field value is blank or unspecified for a particular record in the file, then that field should be ignored for the purposes of matching.\n- When a sub-journey contains consecutive transfers that each match a join rule, then the entire sub-journey should be considered as a single **effective fare leg**.',
  fields: [
    {
      name: 'from_network_id',
      type: 'Foreign ID referencing `routes.network_id` or `networks.network_id`',
      presence: 'Required',
      description:
        'Matches a pre-transfer leg that uses the specified route network.  If specified, the same `to_network_id` must also be specified.',
      foreignKey: [
        { file: 'routes.txt', field: 'network_id' },
        { file: 'networks.txt', field: 'network_id' },
      ],
    },
    {
      name: 'to_network_id',
      type: 'Foreign ID referencing `routes.network_id` or `networks.network_id`',
      presence: 'Required',
      description:
        'Matches a post-transfer leg that uses the specified route network.  If specified, the same `from_network_id` must also be specified.',
      foreignKey: [
        { file: 'routes.txt', field: 'network_id' },
        { file: 'networks.txt', field: 'network_id' },
      ],
    },
    {
      name: 'from_stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Conditionally Required',
      description:
        'Matches a pre-transfer leg that ends at the specified stop (`location_type=0` or empty) or station (`location_type=1`).<br><br>Conditionally Required:<br> - **Required** if `to_stop_id` is defined.<br> - Optional otherwise.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
    {
      name: 'to_stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Conditionally Required',
      description:
        'Matches a post-transfer leg that starts at the specified stop (`location_type=0` or empty) or station (`location_type=1`).<br><br>Conditionally Required:<br> - **Required** if `from_stop_id` is defined.<br> - Optional otherwise.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
  ],
};
