import type { GTFSFileSpec } from '../types';

export const stopAreasSpec: GTFSFileSpec = {
  filename: 'stop_areas.txt',
  presence: 'Optional',
  description:
    'Rules to assign stops to areas. Assigns one or more stops to an area defined in areas.txt for use in fare leg rules.',
  fields: [
    {
      name: 'area_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        "Identifies an area to which one or multiple stop_id's belong. The same stop_id may appear in multiple area_id entries.",
      foreignKey: { file: 'areas.txt', field: 'area_id' },
    },
    {
      name: 'stop_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a stop. If a station (i.e. a stop with location_type=1) is specified, it is assumed that all of its platforms (i.e. all stops with location_type=0 that have this stop defined as parent_station) are part of the area. Stops of location_type other than 0 and 1 may not be assigned to areas.',
      foreignKey: { file: 'stops.txt', field: 'stop_id' },
    },
  ],
};
