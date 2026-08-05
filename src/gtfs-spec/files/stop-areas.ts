import type { GTFSFileSpec } from '../types';

export const stopAreasSpec: GTFSFileSpec = {
  filename: 'stop_areas.txt',
  presence: 'Optional',
  description: 'Assigns stops from [stops.txt](#stopstxt) to areas.',
  fields: [
    {
      name: 'area_id',
      type: 'Foreign ID referencing `areas.area_id`',
      presence: 'Required',
      description:
        'Identifies an area to which one or multiple `stop_id`s belong. The same `stop_id` may be defined in many `area_id`s.',
      foreignKey: [{ file: 'areas.txt', field: 'area_id' }],
    },
    {
      name: 'stop_id',
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Required',
      description:
        'Identifies a stop. If a station (i.e. a stop with `stops.location_type=1`) is defined in this field, it is assumed that all of its platforms (i.e. all stops with `stops.location_type=0` that have this station defined as `stops.parent_station`) are part of the same area. This behavior can be overridden by assigning platforms to other areas.',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
  ],
};
