import type { GTFSFileSpec } from '../types';

export const locationGroupStopsSpec: GTFSFileSpec = {
  filename: 'location_group_stops.txt',
  presence: 'Optional',
  description: 'Assigns stops from stops.txt to location groups.',
  fields: [
    {
      name: 'location_group_id',
      type: 'Foreign ID referencing `location_groups.location_group_id`',
      presence: 'Required',
      description:
        'Identifies a location group to which one or multiple `stop_id`s belong. The same `stop_id` may be defined in many `location_group_id`s.',
      foreignKey: [{ file: 'location_groups.txt', field: 'location_group_id' }],
    },
    {
      name: 'stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Required',
      description: 'Identifies a stop belonging to the location group.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
  ],
};
