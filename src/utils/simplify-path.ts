/**
 * Douglas-Peucker line simplification for GTFS shapes.
 *
 * Hand-rolled rather than pulled in as a dependency: the algorithm is short,
 * and the only non-obvious part is the projection. Points are `[lon, lat]` in
 * degrees, so they are projected to a local metric plane (lon scaled by the
 * cosine of the path's mean latitude) before distances are measured, which
 * makes the tolerance a real distance in metres anywhere on earth.
 */

const METRES_PER_DEGREE_LAT = 111320;

/** Perpendicular distance from `p` to the segment `a`-`b`, in projected units. */
function segmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  // Clamped projection parameter, so a point beyond an endpoint measures to
  // that endpoint rather than to the infinite line.
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Indices of the points to keep, ascending, always including the first and
 * last. A path of two points or fewer is returned unchanged.
 *
 * @param points `[lon, lat]` pairs in degrees
 * @param toleranceMetres maximum distance a dropped point may sit from the
 *   simplified line
 */
export function simplifyIndices(
  points: Array<[number, number]>,
  toleranceMetres: number
): number[] {
  if (points.length <= 2 || toleranceMetres <= 0) {
    return points.map((_, i) => i);
  }

  const meanLat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const projected: Array<[number, number]> = points.map(([lon, lat]) => [
    lon * lonScale * METRES_PER_DEGREE_LAT,
    lat * METRES_PER_DEGREE_LAT,
  ]);

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Explicit stack rather than recursion: a shape can carry thousands of
  // points and blowing the call stack here would be a real failure.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDistance = 0;
    let maxIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = segmentDistance(
        projected[i],
        projected[first],
        projected[last]
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }
    if (maxIndex !== -1 && maxDistance > toleranceMetres) {
      keep[maxIndex] = true;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }

  const kept: number[] = [];
  for (let i = 0; i < keep.length; i++) {
    if (keep[i]) {
      kept.push(i);
    }
  }
  return kept;
}
