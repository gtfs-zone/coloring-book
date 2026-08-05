import type { GTFSFileSpec } from '../types';

export const levelsSpec: GTFSFileSpec = {
  filename: 'levels.txt',
  presence: 'Conditionally Required',
  presenceCondition: 'Required if any stop has a level_id defined.',
  description:
    'Describes levels in a station. Useful in conjunction with [pathways.txt](#pathwaystxt).',
  fields: [
    {
      name: 'level_id',
      type: 'Unique ID',
      presence: 'Required',
      description: 'Identifies a level in a station.',
      isPrimaryKey: true,
    },
    {
      name: 'level_index',
      type: 'Float',
      presence: 'Required',
      description:
        'Numeric index of the level that indicates its relative position. <br><br>Ground level should have index `0`, with levels above ground indicated by positive indices and levels below ground by negative indices.',
    },
    {
      name: 'level_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'Name of the level as seen by the rider inside the building or station.<hr>_Example: Take the elevator to "Mezzanine" or "Platform" or "-1"._',
    },
  ],
};
