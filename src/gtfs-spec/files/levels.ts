import type { GTFSFileSpec } from '../types';

export const levelsSpec: GTFSFileSpec = {
  filename: 'levels.txt',
  presence: 'Conditionally Required',
  presenceCondition: 'Required if any stop has a level_id defined.',
  description:
    'Levels within stations, used to link pathways and stops in multi-level stations.',
  fields: [
    {
      name: 'level_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description: 'Identifies a level in a station.',
    },
    {
      name: 'level_index',
      type: 'Float',
      presence: 'Required',
      description:
        'Numeric index of the level that indicates its relative position. Ground level should have index 0, with levels above ground indicated by positive indices and levels below ground by negative indices.',
    },
    {
      name: 'level_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'Name of the level as seen by the rider inside the building or station. E.g., "Mezzanine", "Platform" or "-1".',
    },
  ],
};
