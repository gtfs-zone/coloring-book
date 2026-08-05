import type { GTFSFileSpec } from '../types';

export const areasSpec: GTFSFileSpec = {
  filename: 'areas.txt',
  presence: 'Optional',
  description: 'Defines area identifiers.',
  fields: [
    {
      name: 'area_id',
      type: 'Unique ID',
      presence: 'Required',
      description:
        'Identifies an area. Must be unique in [areas.txt](#areastxt).',
      isPrimaryKey: true,
    },
    {
      name: 'area_name',
      type: 'Text',
      presence: 'Optional',
      description: 'The name of the area as displayed to the rider.',
    },
  ],
};
