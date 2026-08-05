import type { GTFSFileSpec } from '../types';

export const shapesSpec: GTFSFileSpec = {
  filename: 'shapes.txt',
  presence: 'Optional',
  description:
    'Shapes describe the path that a vehicle travels along a route alignment, and are defined in the file shapes.txt. Shapes are associated with Trips, and consist of a sequence of points through which the vehicle passes in order. Shapes do not need to intercept the location of Stops exactly, but all Stops on a trip should lie within a small distance of the shape for that trip, i.e. close to straight line segments connecting the shape points. The shapes.txt file should be included for all route-based services (not for zone-based demand-responsive services).',
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
      description:
        'Latitude of a shape point. Each record in [shapes.txt](#shapestxt) represents a shape point used to define the shape.',
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
        'Sequence in which the shape points connect to form the shape. Values must increase along the trip but do not need to be consecutive.<hr>*Example: If the shape "A_shp" has three points in its definition, the [shapes.txt](#shapestxt) file might contain these records to define the shape:* <br> `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence` <br> `A_shp,37.61956,-122.48161,0` <br> `A_shp,37.64430,-122.41070,6` <br> `A_shp,37.65863,-122.30839,11`',
    },
    {
      name: 'shape_dist_traveled',
      type: 'Non-negative float',
      presence: 'Optional',
      description:
        'Actual distance traveled along the shape from the first shape point to the point specified in this record. Used by trip planners to show the correct portion of the shape on a map. Values must increase along with `shape_pt_sequence`; they must not be used to show reverse travel along a route. Distance units must be consistent with those used in [stop_times.txt](#stop_timestxt).<br><br>Recommended for routes that have looping or inlining (the vehicle crosses or travels over the same portion of alignment in one trip).<br><img src="inlining.svg" width=200px style="display: block; margin-left: auto; margin-right: auto;"> <br>If a vehicle retraces or crosses the route alignment at points in the course of a trip, `shape_dist_traveled` is important to clarify how portions of the points in [shapes.txt](#shapestxt) line up correspond with records in [stop_times.txt](#stop_timestxt).<hr>*Example: If a bus travels along the three points defined above for A_shp, the additional `shape_dist_traveled` values (shown here in kilometers) would look like this:* <br> `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled`<br>`A_shp,37.61956,-122.48161,0,0`<br>`A_shp,37.64430,-122.41070,6,6.8310` <br> `A_shp,37.65863,-122.30839,11,15.8765`',
    },
  ],
};
