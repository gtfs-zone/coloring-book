import type { GTFSFileSpec } from '../types';

export const locationsGeojsonSpec: GTFSFileSpec = {
  filename: 'locations.geojson',
  format: 'geojson',
  presence: 'Optional',
  description:
    'Zones for rider pickup or drop-off requests by on-demand services, represented as GeoJSON polygons.',
};
