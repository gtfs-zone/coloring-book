/**
 * Substitute a renamed ID into a page state.
 *
 * The page names its object by the object's own key field (`route_id`,
 * `stop_id`, ...), and the timetable modal names a route and a service on top
 * of that, so both halves are checked.
 */

import type { PageState } from '../types/page-state';

/**
 * The same page state with a renamed ID substituted, or null when the rename
 * does not touch it.
 */
export function followRenameInState(
  state: PageState,
  keyField: string,
  oldId: string,
  newId: string
): PageState | null {
  const next: Record<string, unknown> = { ...state };
  let changed = false;

  if (next[keyField] === oldId) {
    next[keyField] = newId;
    changed = true;
  }

  const modal = state.modal;
  if (
    modal?.type === 'timetable' &&
    (keyField === 'route_id' || keyField === 'service_id') &&
    modal[keyField] === oldId
  ) {
    next.modal = { ...modal, [keyField]: newId };
    changed = true;
  }

  return changed ? (next as PageState) : null;
}
