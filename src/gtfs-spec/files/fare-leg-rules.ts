import type { GTFSFileSpec } from '../types';

export const fareLegRulesSpec: GTFSFileSpec = {
  filename: 'fare_leg_rules.txt',
  presence: 'Optional',
  description:
    'Fare rules for individual legs of travel.\nFares in [fare_leg_rules.txt](#fare_leg_rulestxt) must be queried by filtering all the records in the file to find rules that match the leg to be traveled by the rider.\nTo process the cost of a leg:\n1. The file [fare_leg_rules.txt](#fare_leg_rulestxt) must be filtered by the fields that define the characteristics of travel, these fields are:\n- `fare_leg_rules.network_id`\n- `fare_leg_rules.from_area_id`\n- `fare_leg_rules.to_area_id`\n- `fare_leg_rules.from_timeframe_group_id`\n- `fare_leg_rules.to_timeframe_group_id`\n<br/>\n2. If the leg exactly matches a record in [fare_leg_rules.txt](#fare_leg_rulestxt) based on the characteristics of travel, that record must be processed to determine the cost of the leg. This file handles empty entries in two ways: empty semantics OR rule_priority.\n<br/>\n3. If no exact matches are found AND the `rule_priority` field does not exist, then empty entries in `fare_leg_rules.network_id`, `fare_leg_rules.from_area_id`, and `fare_leg_rules.to_area_id` must be checked to process the cost of the leg:\n- An empty entry in `fare_leg_rules.network_id` corresponds to all networks defined in [routes.txt](#routestxt) or [networks.txt](#networkstxt) excluding the ones listed under `fare_leg_rules.network_id`\n- An empty entry in `fare_leg_rules.from_area_id` corresponds to all areas defined in `areas.area_id` excluding the ones listed under `fare_leg_rules.from_area_id`\n- An empty entry in `fare_leg_rules.to_area_id` corresponds to all areas defined in `areas.area_id` excluding the ones listed under `fare_leg_rules.to_area_id`\n<br/>\n4. If the `rule_priority` field exists, then\n- An empty entry in `fare_leg_rules.network_id` indicates the network of the leg does not affect the matching of this rule.\n- An empty entry in `fare_leg_rules.from_area_id` indicates the departure area of the leg does not affect the matching of this rule.\n- An empty entry in `fare_leg_rules.to_area_id` indicates the arrival area of the leg does not affect the matching of this rule.\n<br/>\n5. If the leg does not match any of the rules described above, then the fare is unknown.\n<br/>',
  fields: [
    {
      name: 'leg_group_id',
      type: 'ID',
      presence: 'Optional',
      description:
        'Identifies a group of entries in [fare_leg_rules.txt](#fare_leg_rulestxt).<br><br> Used to describe fare transfer rules between `fare_transfer_rules.from_leg_group_id` and `fare_transfer_rules.to_leg_group_id`.<br><br>Multiple entries in [fare_leg_rules.txt](#fare_leg_rulestxt) may belong to the same `fare_leg_rules.leg_group_id`.<br><br>The same entry in [fare_leg_rules.txt](#fare_leg_rulestxt) (not including `fare_leg_rules.leg_group_id`) must not belong to multiple `fare_leg_rules.leg_group_id`.',
      isPrimaryKey: true,
    },
    {
      name: 'network_id',
      type: 'Foreign ID referencing `routes.network_id` or `networks.network_id`',
      presence: 'Optional',
      description:
        'Identifies a route network that applies for the fare leg rule.<br><br>If the `rule_priority` field does not exist AND there are no matching `fare_leg_rules.network_id` values to the `network_id` being filtered, empty `fare_leg_rules.network_id` will be matched by default.<br><br> An empty entry in `fare_leg_rules.network_id` corresponds to all networks defined in [routes.txt](#routestxt) or [networks.txt](#networkstxt) excluding the ones listed under `fare_leg_rules.network_id`<br><br> If the `rule_priority` field exists in the file, an empty `fare_leg_rules.network_id` indicates that the route network of the leg does not affect the matching of this rule.<br><br>When matching against an [effective fare leg of multiple legs](#fare_leg_join_rulestxt), each leg must have the same `network_id` which will be used for matching.',
      foreignKey: [
        { file: 'routes.txt', field: 'network_id' },
        { file: 'networks.txt', field: 'network_id' },
      ],
    },
    {
      name: 'from_area_id',
      type: 'Foreign ID referencing `areas.area_id`',
      presence: 'Optional',
      description:
        'Identifies a departure area.<br><br>If the `rule_priority` field does not exist AND there are no matching `fare_leg_rules.from_area_id` values to the `area_id` being filtered, empty `fare_leg_rules.from_area_id` will be matched by default. <br><br>An empty entry in `fare_leg_rules.from_area_id` corresponds to all areas defined in `areas.area_id` excluding the ones listed under `fare_leg_rules.from_area_id`<br><br> If the `rule_priority` field exists in the file, an empty `fare_leg_rules.from_area_id` indicates that the departure area of the leg does not affect the matching of this rule.<br><br>When matching against an [effective fare leg of multiple legs](#fare_leg_join_rulestxt), the first leg of the effective fare leg is used for determining the departure area.',
      foreignKey: [{ file: 'areas.txt', field: 'area_id' }],
    },
    {
      name: 'to_area_id',
      type: 'Foreign ID referencing `areas.area_id`',
      presence: 'Optional',
      description:
        'Identifies an arrival area.<br><br>If the `rule_priority` field does not exist AND there are no matching `fare_leg_rules.to_area_id` values to the `area_id` being filtered, empty `fare_leg_rules.to_area_id` will be matched by default.<br><br> An empty entry in `fare_leg_rules.to_area_id` corresponds to all areas defined in `areas.area_id` excluding the ones listed under `fare_leg_rules.to_area_id`<br><br>If the `rule_priority` field exists in the file, an empty `fare_leg_rules.to_area_id` indicates that the arrival area of the leg does not affect the matching of this rule.<br><br>When matching against an [effective fare leg of multiple legs](#fare_leg_join_rulestxt), the last leg of the effective fare leg is used for determining the arrival area.',
      foreignKey: [{ file: 'areas.txt', field: 'area_id' }],
    },
    {
      name: 'from_timeframe_group_id',
      type: 'Foreign ID referencing `timeframes.timeframe_group_id`',
      presence: 'Optional',
      description:
        "Defines the timeframe for the fare validation event at the start of the fare leg.<br><br>The “start time” of the fare leg is the time at which the event is scheduled to occur.  For example, the time could be the scheduled departure time of a bus at the start of a fare leg where the rider boards and validates their fare. For the rule matching semantics below, the start time is computed in local time, as determined by [Local Time Semantics](#localtimesemantics) of [timeframes.txt](#timeframestxt).  The stop or station of the fare leg’s departure event should be used for timezone resolution, where appropriate.<br><br>For a fare leg rule that specifies a `from_timeframe_group_id`, that rule will match a particular leg if there exists at least one record in [timeframes.txt](#timeframestxt) where all of the following conditions are true<br>- The value of `timeframe_group_id` is equal to the `from_timeframe_group_id` value.<br>- The set of days identified by the record’s `service_id` contains the “current day” of the fare leg’s start time.<br>- The “time-of-day” of the fare leg's start time is greater than or equal to the record’s `timeframes.start_time` value and less than the `timeframes.end_time` value.<br><br>An empty `fare_leg_rules.from_timeframe_group_id` indicates that the start time of the leg does not affect the matching of this rule.<br><br>When matching against an [effective fare leg of multiple legs](#fare_leg_join_rulestxt), the first leg of the effective fare leg is used for determining the starting fare validation event.",
      foreignKey: [{ file: 'timeframes.txt', field: 'timeframe_group_id' }],
    },
    {
      name: 'to_timeframe_group_id',
      type: 'Foreign ID referencing `timeframes.timeframe_group_id`',
      presence: 'Optional',
      description:
        "Defines the timeframe for the fare validation event at the end of the fare leg.<br><br>The “end time” of the fare leg is the time at which the event is scheduled to occur.  For example, the time could be the scheduled arrival time of a bus at the end of a fare leg where the rider gets off and validates their fare.  For the rule matching semantics below, the end time is computed in local time, as determined by [Local Time Semantics](#localtimesemantics) of [timeframes.txt](#timeframestxt).  The stop or station of the fare leg’s arrival event should be used for timezone resolution, where appropriate.<br><br>For a fare leg rule that specifies a `to_timeframe_group_id`, that rule will match a particular leg if there exists at least one record in [timeframes.txt](#timeframestxt) where all of the following conditions are true<br>- The value of `timeframe_group_id` is equal to the `to_timeframe_group_id` value.<br>- The set of days identified by the record’s `service_id` contains the “current day” of the fare leg’s end time.<br>- The “time-of-day” of the fare leg's end time is greater than or equal to the record’s `timeframes.start_time` value and less than the `timeframes.end_time` value.<br><br>An empty `fare_leg_rules.to_timeframe_group_id` indicates that the end time of the leg does not affect the matching of this rule.<br><br>When matching against an [effective fare leg of multiple legs](#fare_leg_join_rulestxt), the last leg of the effective fare leg is used for determining the ending fare validation event.",
      foreignKey: [{ file: 'timeframes.txt', field: 'timeframe_group_id' }],
    },
    {
      name: 'fare_product_id',
      type: 'Foreign ID referencing `fare_products.fare_product_id`',
      presence: 'Required',
      description: 'The fare product required to travel the leg.',
      foreignKey: [{ file: 'fare_products.txt', field: 'fare_product_id' }],
    },
    {
      name: 'rule_priority',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Defines the order of priority in which matching rules are applied to legs, allowing certain rules to take precedence over others. When multiple entries in [fare_leg_rules.txt](#fare_leg_rulestxt) match, the rule or set of rules with the highest value for `rule_priority` will be selected.<br><br>An empty value for `rule_priority` is treated as zero.',
    },
  ],
};
