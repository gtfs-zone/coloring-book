/**
 * Station hierarchy traversal.
 *
 * A GTFS station (location_type=1) never appears in stop_times: every stop_time
 * references a child platform. Anything asking "what serves this stop?" has to
 * expand the stop into its whole descendant subtree first, or a station looks
 * like it has no service at all.
 */
import type { Stops } from '../types/gtfs';
import type { QueryOnlyDatabase } from './field-component';

/** station -> platform -> boarding area is the deepest legal nesting. */
const MAX_DEPTH = 3;

/**
 * Collect `stop_id` together with every descendant reachable through
 * `parent_station`, breadth-first.
 *
 * Returns the rows, not just ids, so callers can label results with
 * `getStopDisplay` instead of raw ids. The root stop is always first; it is
 * included even when the stops table has no row for it, in which case only the
 * id is known and the array is empty.
 */
export async function collectDescendantStops(
  db: QueryOnlyDatabase,
  stop_id: string
): Promise<Stops[]> {
  const rootRows = (await db.queryRows('stops', { stop_id })) as Stops[];
  const collected: Stops[] = [...rootRows];
  const visited = new Set<string>([stop_id]);

  let frontier = [stop_id];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const parentId of frontier) {
      const children = (await db.queryRows('stops', {
        parent_station: parentId,
      })) as Stops[];
      for (const child of children) {
        const childId = String(child.stop_id);
        if (visited.has(childId)) {
          console.warn(
            `[StopHierarchy] Cycle in parent_station: ${childId} is already an ancestor of itself under ${stop_id}, skipping.`
          );
          continue;
        }
        visited.add(childId);
        collected.push(child);
        next.push(childId);
      }
    }
    frontier = next;
  }

  if (frontier.length > 0) {
    console.warn(
      `[StopHierarchy] parent_station nesting deeper than ${MAX_DEPTH} levels under ${stop_id}; ignoring ${frontier.length} deeper stop(s).`
    );
  }

  return collected;
}
