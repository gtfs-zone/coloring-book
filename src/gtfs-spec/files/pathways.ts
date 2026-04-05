import type { GTFSFileSpec } from '../types';

export const pathwaysSpec: GTFSFileSpec = {
  filename: 'pathways.txt',
  presence: 'Optional',
  description:
    'Pathway connections between locations within stations. Pathways allow trip planners to generate walking directions for getting through stations.',
  fields: [
    {
      name: 'pathway_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description:
        'Identifies a pathway. Used by systems as an internal identifier for the record. Must be unique in the dataset.',
    },
    {
      name: 'from_stop_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Location at which the pathway begins. Must contain a stop_id that identifies a platform (location_type=0 or empty), entrance/exit (location_type=2), generic node (location_type=3), or boarding area (location_type=4). Values for location_type=1 (stations) are forbidden.',
      foreignKey: { file: 'stops.txt', field: 'stop_id' },
    },
    {
      name: 'to_stop_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Location at which the pathway ends. Must contain a stop_id that identifies a platform (location_type=0 or empty), entrance/exit (location_type=2), generic node (location_type=3), or boarding area (location_type=4). Values for location_type=1 (stations) are forbidden.',
      foreignKey: { file: 'stops.txt', field: 'stop_id' },
    },
    {
      name: 'pathway_mode',
      type: 'Enum',
      presence: 'Required',
      description:
        'Type of pathway between the specified (from_stop_id, to_stop_id) pair. Valid options are:\n\n1 - Walkway\n2 - Stairs\n3 - Moving sidewalk/travelator\n4 - Escalator\n5 - Elevator\n6 - Fare gate (or payment gate): A pathway that crosses into an area of the station where a proof of payment is required (usually via a physical payment gate). Fare gates may separate paid areas of the station from unpaid ones, or separate different payment areas within the same station from each other.\n7 - Exit gate: Passageway leading out of a paid area into an unpaid area where proof of payment is not required to cross.',
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
        'Indicates the direction that the pathway can be taken. Valid options are:\n\n0 - Unidirectional pathway that can only be used from from_stop_id to to_stop_id.\n1 - Bidirectional pathway that can be used in both directions.\n\nExit gates (pathway_mode=7) must not be bidirectional.',
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
        'Horizontal length in meters of the pathway from the origin location (defined in from_stop_id) to the destination location (defined in to_stop_id). This field is recommended for walkways (pathway_mode=1), fare gates (pathway_mode=6) and exit gates (pathway_mode=7).',
    },
    {
      name: 'traversal_time',
      type: 'Positive integer',
      presence: 'Optional',
      description:
        'Average time in seconds needed to walk through the pathway from the origin location (defined in from_stop_id) to the destination location (defined in to_stop_id). This field is recommended for moving sidewalks (pathway_mode=3), escalators (pathway_mode=4) and elevator (pathway_mode=5).',
    },
    {
      name: 'stair_count',
      type: 'Non-null integer',
      presence: 'Optional',
      description:
        'Number of stairs of the pathway. A positive stair_count implies that the rider walks up from from_stop_id to to_stop_id, and a negative stair_count implies that the rider walks down from from_stop_id to to_stop_id. This field is recommended for stairs (pathway_mode=2). If only an estimated stair count can be provided, it is recommended to approximate 15 stairs for 1 floor.',
    },
    {
      name: 'max_slope',
      type: 'Float',
      presence: 'Optional',
      description:
        'Maximum slope ratio of the pathway. Valid options are:\n\n0 or empty - No slope.\nPositive number - Upward slope, from the from_stop_id to the to_stop_id.\nNegative number - Downward slope, from the from_stop_id to the to_stop_id.\n\nThis field is only used for walkways (pathway_mode=1) and moving sidewalks (pathway_mode=3).',
    },
    {
      name: 'min_width',
      type: 'Positive float',
      presence: 'Optional',
      description:
        'Minimum width of the pathway in meters. This field is recommended if the minimum width is less than 1 meter.',
    },
    {
      name: 'signposted_as',
      type: 'Text',
      presence: 'Optional',
      description:
        "Public facing text from physical signage that is visible to riders. May be used to provide text directions to riders, such as 'Follow signs to'. The language text should appear in this field exactly as it is printed on the signs.",
    },
    {
      name: 'reversed_signposted_as',
      type: 'Text',
      presence: 'Conditionally Required',
      presenceCondition: 'Required if is_bidirectional=1. Optional otherwise.',
      description:
        'Same as signposted_as, but when the pathway is used in the reverse direction, i.e., from to_stop_id to from_stop_id.',
    },
  ],
};
