import type { Shapes } from '../types/gtfs-entities';

export async function parseGPX(file: File, shapeId: string): Promise<Shapes[]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const trkpts = doc.querySelectorAll('trkpt');

  if (trkpts.length === 0) {
    throw new Error('No track points found in GPX file');
  }

  const result: Shapes[] = [];
  let sequence = 1;
  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat') ?? '');
    const lon = parseFloat(pt.getAttribute('lon') ?? '');
    if (isNaN(lat) || isNaN(lon)) {
      continue;
    }
    result.push({
      shape_id: shapeId,
      shape_pt_lat: lat,
      shape_pt_lon: lon,
      shape_pt_sequence: sequence++,
    });
  }

  if (result.length === 0) {
    throw new Error('No valid track points found in GPX file');
  }

  return result;
}
