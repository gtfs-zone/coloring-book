const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LNG_EQUATOR = 111320;

type Coord = [number, number];

/**
 * Andrew's monotone chain. Returns the hull in counter-clockwise order,
 * unclosed.
 */
function convexHull(points: Coord[]): Coord[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Coord, a: Coord, b: Coord) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const chain = (src: Coord[]): Coord[] => {
    const out: Coord[] = [];
    for (const p of src) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= 0
      ) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...chain(sorted), ...chain([...sorted].reverse())];
}

/**
 * Convex hull of the given coords, with every vertex pushed `meters` outward
 * from the centroid so the resulting polygon clears the node circles drawn at
 * those coords. Returns a closed ring, or null when the points are collinear
 * or too few to form a polygon.
 */
export function bufferedHull(points: Coord[], meters: number): Coord[] | null {
  if (points.length < 3) {
    return null;
  }
  const hull = convexHull(points);
  if (hull.length < 3) {
    return null;
  }

  const cx = hull.reduce((sum, p) => sum + p[0], 0) / hull.length;
  const cy = hull.reduce((sum, p) => sum + p[1], 0) / hull.length;
  const mPerDegLng =
    METERS_PER_DEG_LNG_EQUATOR * Math.cos((cy * Math.PI) / 180);

  const ring: Coord[] = hull.map(([lng, lat]) => {
    const dx = (lng - cx) * mPerDegLng;
    const dy = (lat - cy) * METERS_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    // A vertex sitting exactly on the centroid has no outward direction.
    if (len < 1e-6) {
      return [lng, lat];
    }
    const scale = (len + meters) / len;
    return [
      cx + (dx * scale) / mPerDegLng,
      cy + (dy * scale) / METERS_PER_DEG_LAT,
    ];
  });

  ring.push(ring[0]);
  return ring;
}
