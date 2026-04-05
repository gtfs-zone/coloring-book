import type { GTFSFileSpec } from '../types';

export const shapesSpec: GTFSFileSpec = {
  filename: 'shapes.txt',
  presence: 'Optional',
  description:
    'Rules for mapping vehicle travel paths, sometimes referred to as route alignments.',
  fields: [
    {
      name: 'shape_id',
      type: 'ID',
      presence: 'Required',
      description: 'Identifies a shape.',
      isPrimaryKey: true,
    },
    {
      name: 'shape_pt_lat',
      type: 'Latitude',
      presence: 'Required',
      description: 'Latitude of a shape point.',
    },
    {
      name: 'shape_pt_lon',
      type: 'Longitude',
      presence: 'Required',
      description: 'Longitude of a shape point.',
    },
    {
      name: 'shape_pt_sequence',
      type: 'Non-negative integer',
      presence: 'Required',
      description:
        'Sequence in which the shape points connect to form the shape. Values must increase along the trip but do not need to be consecutive.',
    },
    {
      name: 'shape_dist_traveled',
      type: 'Non-negative float',
      presence: 'Optional',
      description:
        'Actual distance traveled along the shape from the first shape point to the point specified in this record. Used by trip planners to show the correct portion of the shape on a map. Values must increase along with shape_pt_sequence; they cannot be used to show reverse travel along a route. Distance units must be consistent with those used in stop_times.txt.',
    },
  ],
};
