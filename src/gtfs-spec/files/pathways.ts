import type { GTFSFileSpec } from '../types';

export const pathwaysSpec: GTFSFileSpec = {
  filename: 'pathways.txt',
  presence: 'Optional',
  description:
    "Files [pathways.txt](#pathwaystxt) and [levels.txt](levelstxt) use a graph representation to describe subway or train stations, with nodes representing locations and edges representing pathways.\nTo navigate from the station entrance/exit (a node represented as a location with `location_type=2`) to a platform (a node represented as a location with `location_type=0` or empty), the rider will move through walkways, fare gates, stairs, and other edges represented as pathways. Generic nodes (nodes represented with `location_type=3`) can be used to connect pathways throughout a station.\nPathways are intended to exhaustively define the internal access graph of a station. If any pathways are defined within a station, data consumers should assume that all relevant connections within that station are described. However, the optional `stop_access` field in `stops.txt` may be used to explicitly define whether a stop is accessible directly from the street network or through the station's defined pathways. Therefore, the following guidelines apply:\n- No dangling locations: If any location within a station has a pathway, then all locations within that station should have pathways, except\n-  Platforms that have boarding areas (`location_type=4`, see guideline below)\n-  Stops (`location_type=0` or empty) with `stops.stop_access=1`\n- No pathways for a platform with boarding areas: A platform (`location_type=0` or empty) that has boarding areas (`location_type=4`) is treated as a parent object, not a point. In such cases, the platform must not have pathways assigned. All pathways should be assigned for each of the platform's boarding areas.\n- No locked platforms: If any location within a station has a pathway, each platform (`location_type=0` or empty) or boarding area (`location_type=4`) must be connected to at least one entrance/exit (`location_type=2`) via some chain of pathways — unless:\n- The stop (`location_type=0` or empty) is explicitly marked with `stops.stop_access=1`, in which case it is assumed to be directly accessible from the street network.",
  fields: [
    {
      name: 'pathway_id',
      type: 'Unique ID',
      presence: 'Required',
      description:
        'Identifies a pathway. Used by systems as an internal identifier for the record. Must be unique in the dataset. <br><br> Different pathways may have the same values for `from_stop_id` and `to_stop_id`.<hr>_Example: When two escalators are side-by-side in opposite directions, or when a stair set and elevator go from the same place to the same place, different `pathway_id` may have the same `from_stop_id` and `to_stop_id` values._',
      isPrimaryKey: true,
    },
    {
      name: 'from_stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Required',
      description:
        'Location at which the pathway begins.<br><br>Must contain a `stop_id` that identifies a platform (`location_type=0` or empty), entrance/exit (`location_type=2`), generic node (`location_type=3`) or boarding area (`location_type=4`).<br><br> Values for `stop_id` that identify stations (`location_type=1`), or stops (`location_type=0` or empty) with `stop_access=1`, are forbidden.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
    {
      name: 'to_stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Required',
      description:
        'Location at which the pathway ends.<br><br>Must contain a `stop_id` that identifies a platform (`location_type=0` or empty), entrance/exit (`location_type=2`), generic node (`location_type=3`) or boarding area (`location_type=4`).<br><br> Values for `stop_id` that identify stations (`location_type=1`), or stops (`location_type=0` or empty) with `stop_access=1`, are forbidden.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
    {
      name: 'pathway_mode',
      type: 'Enum',
      presence: 'Required',
      description:
        'Type of pathway between the specified (`from_stop_id`, `to_stop_id`) pair. Valid options are: <br><br>`1` - Walkway. <br>`2` - Stairs. <br>`3` - Moving sidewalk/travelator. <br>`4` - Escalator. <br>`5` - Elevator. <br>`6` - Fare gate (or payment gate): A pathway that crosses into an area of the station where proof of payment is required to cross. Fare gates may separate paid areas of the station from unpaid ones, or separate different payment areas within the same station from each other. This information can be used to avoid routing passengers through stations using shortcuts that would require passengers to make unnecessary payments, like directing a passenger to walk through a subway platform to reach a busway. <br>`7`-  Exit gate: A pathway exiting a paid area into an unpaid area where proof of payment is not required to cross.',
      enumValues: [
        {
          value: 1,
          label: 'Walkway',
          description: 'Walkway.',
        },
        {
          value: 2,
          label: 'Stairs',
          description: 'Stairs.',
        },
        {
          value: 3,
          label: 'Moving sidewalk/travelator',
          description: 'Moving sidewalk/travelator.',
        },
        {
          value: 4,
          label: 'Escalator',
          description: 'Escalator.',
        },
        {
          value: 5,
          label: 'Elevator',
          description: 'Elevator.',
        },
        {
          value: 6,
          label: 'Fare gate',
          description:
            'Fare gate (or payment gate): A pathway that crosses into an area of the station where a proof of payment is required (usually via a physical payment gate). Fare gates may separate paid areas of the station from unpaid ones, or separate different payment areas within the same station from each other.',
        },
        {
          value: 7,
          label: 'Exit gate',
          description:
            'Exit gate: Passageway leading out of a paid area into an unpaid area where proof of payment is not required to cross.',
        },
      ],
    },
    {
      name: 'is_bidirectional',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates the direction that the pathway can be taken:<br><br>`0` - Unidirectional pathway that can only be used from `from_stop_id` to `to_stop_id`.<br>`1` - Bidirectional pathway that can be used in both directions.<br><br>Exit gates (`pathway_mode=7`) must not be bidirectional.',
      enumValues: [
        {
          value: 0,
          label: 'Unidirectional',
          description:
            'Unidirectional pathway that can only be used from from_stop_id to to_stop_id.',
        },
        {
          value: 1,
          label: 'Bidirectional',
          description:
            'Bidirectional pathway that can be used in both directions. Exit gates (pathway_mode=7) must not be bidirectional.',
        },
      ],
    },
    {
      name: 'length',
      type: 'Non-negative float',
      presence: 'Optional',
      description:
        'Horizontal length in meters of the pathway from the origin location (defined in `from_stop_id`) to the destination location (defined in `to_stop_id`).<br><br>This field is recommended for walkways (`pathway_mode=1`), fare gates (`pathway_mode=6`) and exit gates (`pathway_mode=7`).',
    },
    {
      name: 'traversal_time',
      type: 'Positive integer',
      presence: 'Optional',
      description:
        'Average time in seconds needed to walk through the pathway from the origin location (defined in `from_stop_id`) to the destination location (defined in `to_stop_id`).<br><br>This field is recommended for moving sidewalks (`pathway_mode=3`), escalators (`pathway_mode=4`) and elevator (`pathway_mode=5`).',
    },
    {
      name: 'stair_count',
      type: 'Non-null integer',
      presence: 'Optional',
      description:
        'Number of stairs of the pathway.<br><br>A positive `stair_count` implies that the rider walk up from `from_stop_id` to `to_stop_id`. And a negative `stair_count` implies that the rider walk down from `from_stop_id` to `to_stop_id`.<br><br>This field is recommended for stairs (`pathway_mode=2`).<br><br>If only an estimated stair count can be provided, it is recommended to approximate 15 stairs for 1 floor.',
    },
    {
      name: 'max_slope',
      type: 'Float',
      presence: 'Optional',
      description:
        'Maximum slope ratio of the pathway. Valid options are:<br><br>`0` or empty - No slope.<br>`Float` - Slope ratio of the pathway, positive for upwards, negative for downwards.<br><br>This field should only be used with walkways (`pathway_mode=1`) and moving sidewalks (`pathway_mode=3`).<hr>_Example: In the US, 0.083 (also written 8.3%) is the maximum slope ratio for hand-propelled wheelchair, which mean an increase of 0.083m (so 8.3cm) for each 1m._',
    },
    {
      name: 'min_width',
      type: 'Positive float',
      presence: 'Optional',
      description:
        'Minimum width of the pathway in meters.<br><br>This field is recommended if the minimum width is less than 1 meter.',
    },
    {
      name: 'signposted_as',
      type: 'Text',
      presence: 'Optional',
      description:
        "Public facing text from physical signage that is visible to riders.<br><br> May be used to provide text directions to riders, such as 'follow signs to '. The text in `singposted_as` should appear exactly how it is printed on the signs.<br><br>When the physical signage is multilingual, this field may be populated and translated following the example of `stops.stop_name` in the field definition of `feed_info.feed_lang`.",
    },
    {
      name: 'reversed_signposted_as',
      type: 'Text',
      presence: 'Optional',
      presenceCondition: 'Required if is_bidirectional=1. Optional otherwise.',
      description:
        'Same as `signposted_as`, but when the pathway is used from the `to_stop_id` to the `from_stop_id`.',
    },
  ],
};
