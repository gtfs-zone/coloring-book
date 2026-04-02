import type { GTFSFileSpec } from '../types';

export const fareLegRulesSpec: GTFSFileSpec = {
  filename: 'fare_leg_rules.txt',
  presence: 'Optional',
  description:
    'Fare rules for individual legs of travel. Specifies the fare products that apply to legs of travel, based on route network, departure area, arrival area, and timeframe. Part of the Fares v2 model — separate from the legacy Fares v1 model (fare_attributes.txt, fare_rules.txt).',
  fields: [
    {
      name: 'leg_group_id',
      type: 'ID',
      presence: 'Optional',
      description:
        'Identifies a group of entries in fare_leg_rules.txt. Used to reference groups of fare leg entries from fare_transfer_rules.txt and fare_leg_join_rules.txt.',
    },
    {
      name: 'network_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a route network that applies for the fare leg rule. If empty and there are no other fare_leg_rules.txt entries with a network_id, the fare leg rule applies to all route networks. If empty and there are other entries with a network_id, the fare leg rule applies to travel not covered by any network.',
      foreignKey: { file: 'networks.txt', field: 'network_id' },
    },
    {
      name: 'from_area_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a departure area. If empty and there are no other fare_leg_rules.txt entries with a from_area_id, the fare leg rule applies to all departure areas. If empty and there are other entries with a from_area_id, the fare leg rule applies to departures not covered by any area.',
      foreignKey: { file: 'areas.txt', field: 'area_id' },
    },
    {
      name: 'to_area_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies an arrival area. If empty and there are no other fare_leg_rules.txt entries with a to_area_id, the fare leg rule applies to all arrival areas. If empty and there are other entries with a to_area_id, the fare leg rule applies to arrivals not covered by any area.',
      foreignKey: { file: 'areas.txt', field: 'area_id' },
    },
    {
      name: 'from_timeframe_group_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a timeframe for the fare validation event at the start of the fare leg. The "start" of a fare leg is the departure time and location. If empty, the rule applies to any timeframe.',
      foreignKey: { file: 'timeframes.txt', field: 'timeframe_group_id' },
    },
    {
      name: 'to_timeframe_group_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a timeframe for the fare validation event at the end of the fare leg. The "end" of a fare leg is the arrival time and location. If empty, the rule applies to any timeframe.',
      foreignKey: { file: 'timeframes.txt', field: 'timeframe_group_id' },
    },
    {
      name: 'fare_product_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'The fare product required to travel the fare leg defined by this rule.',
      foreignKey: { file: 'fare_products.txt', field: 'fare_product_id' },
    },
    {
      name: 'rule_priority',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Defines the priority of applying the fare leg rule over other rules that may also apply. A lower value indicates higher priority. When multiple rules match, the rule with the lowest rule_priority is applied. When empty, rule_priority defaults to 0.',
    },
  ],
};
