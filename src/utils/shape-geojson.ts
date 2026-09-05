/**
 * A GTFS shape as a GeoJSON LineString, and back.
 *
 * Used by the shapes manager's geojson.io round trip: a shape is a line, so a
 * Polygon or Point coming back is a mistake worth naming rather than coercing.
 */

import type { Shapes } from '../types/gtfs-entities.js';

/** One shape's rows as a LineString feature, in shape_pt_sequence order. */
export function shapeRowsToFeature(
  shapeId: string,
  rows: Shapes[]
): GeoJSON.Feature<GeoJSON.LineString> {
  const ordered = [...rows].sort(
    (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
  );
  return {
    type: 'Feature',
    id: shapeId,
    properties: { shape_id: shapeId },
    geometry: {
      type: 'LineString',
      coordinates: ordered.map((r) => [
        Number(r.shape_pt_lon),
        Number(r.shape_pt_lat),
      ]),
    },
  };
}

/**
 * The `[lon, lat]` points of an incoming feature.
 *
 * A MultiLineString with one part is accepted because geojson.io emits one for
 * a track drawn in a single stroke; more than one part has no single ordering
 * onto shape_pt_sequence, so it throws.
 */
export function shapeFeatureToPoints(
  feature: GeoJSON.Feature
): Array<[number, number]> {
  const geometry = feature.geometry;
  if (!geometry) {
    throw new Error('That feature has no geometry.');
  }

  let coordinates: GeoJSON.Position[];
  if (geometry.type === 'LineString') {
    coordinates = geometry.coordinates;
  } else if (geometry.type === 'MultiLineString') {
    if (geometry.coordinates.length !== 1) {
      throw new Error(
        `A shape is one line, but this MultiLineString has ${geometry.coordinates.length} parts. Join them into a single LineString first.`
      );
    }
    coordinates = geometry.coordinates[0];
  } else {
    throw new Error(
      `A shape is a line, but this feature is a ${geometry.type}. Draw a LineString instead.`
    );
  }

  if (coordinates.length < 2) {
    throw new Error(
      `A shape needs at least two points, this line has ${coordinates.length}.`
    );
  }

  return coordinates.map(([lon, lat], i) => {
    if (!isFinite(lon) || !isFinite(lat)) {
      throw new Error(`Point ${i + 1} has a non-numeric coordinate.`);
    }
    return [lon, lat] as [number, number];
  });
}
