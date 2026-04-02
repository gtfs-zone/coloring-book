import type { GTFSFileSpec } from '../types';

export const fareRulesSpec: GTFSFileSpec = {
  filename: 'fare_rules.txt',
  presence: 'Optional',
  description:
    'Rules to apply fares in fare_attributes.txt to itineraries. Part of the legacy Fares v1 model.',
  fields: [
    {
      name: 'fare_id',
      type: 'Foreign ID',
      presence: 'Required',
      description: 'Identifies a fare class associated with the rule.',
      foreignKey: { file: 'fare_attributes.txt', field: 'fare_id' },
    },
    {
      name: 'route_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a route associated with the fare class. If several routes with the same fare attributes exist, create a record in fare_rules.txt for each route.',
      foreignKey: { file: 'routes.txt', field: 'route_id' },
    },
    {
      name: 'origin_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies an origin zone. If a fare class has multiple origin zones, create a record in fare_rules.txt for each origin_id.',
      foreignKey: { file: 'stops.txt', field: 'zone_id' },
    },
    {
      name: 'destination_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies a destination zone. If a fare class has multiple destination zones, create a record in fare_rules.txt for each destination_id.',
      foreignKey: { file: 'stops.txt', field: 'zone_id' },
    },
    {
      name: 'contains_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Identifies the zones that a rider will enter while using a given fare class. Used in some systems to calculate correct fare class. See https://code.google.com/p/googletransitdatafeed/wiki/FareExamples for examples of how contains_id is used in fare calculations.',
      foreignKey: { file: 'stops.txt', field: 'zone_id' },
    },
  ],
};
