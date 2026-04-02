import type { GTFSFileSpec } from '../types';

export const areasSpec: GTFSFileSpec = {
  filename: 'areas.txt',
  presence: 'Optional',
  description:
    'Area grouping of locations. Areas are used in fare leg rules (fare_leg_rules.txt) to define geographic zones for fare calculation. Stops are assigned to areas via stop_areas.txt.',
  fields: [
    {
      name: 'area_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description: 'Identifies an area. Must be unique in areas.txt.',
    },
    {
      name: 'area_name',
      type: 'Text',
      presence: 'Optional',
      description: 'The name of the area as displayed to the rider.',
    },
  ],
};
