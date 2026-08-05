import type { GTFSFileSpec } from '../types';

export const locationGroupsSpec: GTFSFileSpec = {
  filename: 'location_groups.txt',
  presence: 'Optional',
  description:
    'Defines location groups, which are groups of stops where a rider may request pickup or drop off.',
  fields: [
    {
      name: 'location_group_id',
      type: 'Unique ID',
      presence: 'Required',
      description:
        'Identifies a location group. ID must be unique across all `stops.stop_id`, locations.geojson `id`, and `location_groups.location_group_id` values. <br><br>A location group is a group of stops that together indicate locations where a rider may request pickup or drop off.',
      isPrimaryKey: true,
    },
    {
      name: 'location_group_name',
      type: 'Text',
      presence: 'Optional',
      description: 'The name of the location group as displayed to the rider.',
    },
  ],
};
