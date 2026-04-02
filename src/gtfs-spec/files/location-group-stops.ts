import type { GTFSFileSpec } from '../types';

export const locationGroupStopsSpec: GTFSFileSpec = {
  filename: 'location_group_stops.txt',
  presence: 'Optional',
  description:
    'Assigns individual stops (location_type=0) to location groups defined in location_groups.txt.',
  fields: [
    {
      name: 'location_group_id',
      type: 'Foreign ID',
      presence: 'Required',
      description: 'Identifies the location group to which the stop belongs.',
      foreignKey: { file: 'location_groups.txt', field: 'location_group_id' },
    },
    {
      name: 'stop_id',
      type: 'Foreign ID',
      presence: 'Required',
      description: 'Identifies a stop assigned to the location group.',
      foreignKey: { file: 'stops.txt', field: 'stop_id' },
    },
  ],
};
