import type { GTFSFileSpec } from '../types';

export const locationGroupsSpec: GTFSFileSpec = {
  filename: 'location_groups.txt',
  presence: 'Optional',
  description:
    'Defines groups of stops where riders may request on-demand pickup or drop off.',
  fields: [
    {
      name: 'location_group_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description:
        'Identifies a group of stops indicating locations where riders may request pickup or drop off.',
    },
    {
      name: 'location_group_name',
      type: 'Text',
      presence: 'Optional',
      description: 'Name of the location group as displayed to riders.',
    },
  ],
};
