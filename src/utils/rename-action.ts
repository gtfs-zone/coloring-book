/**
 * The single entry point for renaming an entity's ID.
 *
 * An ID field on an entity page and an ID cell in an editable table both render
 * a trigger carrying `data-rename-table` / `data-rename-id`, and both open the
 * impact modal through here. The listeners are bound to `document`, the way
 * `installInlineEditableFields` binds its own: the containers these triggers
 * live in have their `innerHTML` replaced wholesale, and a trigger can sit
 * inside a modal that no page container owns.
 */

import { notify } from 'interlocking/ui/notification-system';
import { isOutsideTopModal } from 'interlocking/ui/modal-utils';
import { escapeHtml } from 'interlocking/util/escape-html';
import { showRenameModal } from '../modules/rename-id-modal';
import type { RenameDatabase, RenamePatchManager } from './rename-entity';
import { getCurrentPageState } from '../modules/navigation-actions';

export interface RenameActionDeps {
  database: RenameDatabase;
  patchManager: RenamePatchManager | null;
  /** Re-render when the rename does not move the page. */
  onRenamed?: () => void;
}

let deps: RenameActionDeps | null = null;
let listenersInstalled = false;

/**
 * Per-owner re-renders, keyed by the scope a trigger names.
 *
 * A trigger inside a container the page-level `onRenamed` does not redraw - an
 * editable table, which can be sitting in a modal - registers its own redraw
 * here and names the scope on every trigger it renders.
 */
const afterByScope = new Map<string, () => void>();

export function setRenameAfter(scope: string, after: () => void): void {
  afterByScope.set(scope, after);
}

export function clearRenameAfter(scope: string): void {
  afterByScope.delete(scope);
}

/**
 * Register the writing handle renames commit through, and install the
 * delegated listeners. Calling this again only refreshes the dependencies.
 */
export function installRenameAction(newDeps: RenameActionDeps): void {
  deps = newDeps;
  if (listenersInstalled) {
    return;
  }
  listenersInstalled = true;

  document.addEventListener('click', (e) => {
    const trigger = findTrigger(e.target);
    if (trigger) {
      activate(trigger);
    }
  });

  // The trigger is focusable, so it opens on Enter and Space like every other
  // field.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') {
      return;
    }
    const trigger = findTrigger(e.target);
    if (trigger) {
      e.preventDefault();
      activate(trigger);
    }
  });
}

function findTrigger(target: EventTarget | null): HTMLElement | null {
  if (isOutsideTopModal(target)) {
    return null;
  }
  const el = (target as Element)?.closest?.('[data-rename-table]');
  return el instanceof HTMLElement ? el : null;
}

function activate(trigger: HTMLElement): void {
  const { renameTable, renameId, renameScope } = trigger.dataset;
  if (renameTable && renameId) {
    void requestRename(
      renameTable,
      renameId,
      renameScope ? afterByScope.get(renameScope) : undefined
    );
  }
}

/**
 * The markup an ID renders as: the same box an editable field gets, minus the
 * inline editor's own class so its listeners ignore it.
 */
export function renderRenameTrigger(
  store: string,
  id: string,
  boxClass: string,
  scope?: string
): string {
  return `<span
      class="${boxClass} block truncate"
      tabindex="0"
      role="button"
      title="Rename ${escapeHtml(id)}"
      data-rename-table="${escapeHtml(store)}"
      data-rename-id="${escapeHtml(id)}"
      ${scope ? `data-rename-scope="${escapeHtml(scope)}"` : ''}
    >${escapeHtml(id)}</span>`;
}

/**
 * Rename one entity's ID through the impact modal.
 *
 * The URL carries the ID, but a rename of the object the current page shows
 * takes the page with it from inside the commit, through the patch manager's
 * rename follower, so there is nothing to navigate to here. What is left is
 * the re-render for everything else, which is `after` when the caller has a
 * narrower one than the registered fallback.
 */
export async function requestRename(
  table: string,
  id: string,
  after?: () => void
): Promise<void> {
  if (!deps) {
    notify.error('Cannot rename: this page cannot write to the feed');
    console.warn('[RenameAction] no writable database handle');
    return;
  }

  const before = JSON.stringify(getCurrentPageState());
  const newId = await showRenameModal(
    { database: deps.database, patchManager: deps.patchManager },
    { table, id }
  );
  if (!newId) {
    return;
  }

  // The page state moved: the follower re-pointed it mid-commit and the patch
  // event queued the render that goes with it. A second one here would only
  // cost the scroll position.
  if (JSON.stringify(getCurrentPageState()) !== before) {
    return;
  }
  if (after) {
    after();
    return;
  }
  deps.onRenamed?.();
}
