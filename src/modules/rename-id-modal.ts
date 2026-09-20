/**
 * The Rename action's impact modal.
 *
 * A rename is not an inline edit: it can rewrite thousands of rows in tables
 * the user is not looking at, so the counts are shown before anything is
 * written. The cascade itself lives in `utils/rename-entity`; this module only
 * asks for the new ID, shows what it would touch, and applies it.
 */

import { showModal, renderWarningIcon } from 'interlocking/ui/modal-utils';
import { notify } from 'interlocking/ui/notification-system';
import { escapeHtml } from 'interlocking/util/escape-html';
import {
  applyRename,
  renamePlan,
  validateRenameTarget,
  type RenameDatabase,
  type RenamePatchManager,
  type RenamePlan,
} from '../utils/rename-entity';
import { getNaturalKeyField } from '../utils/gtfs-primary-keys';

export interface RenameModalDeps {
  database: RenameDatabase;
  patchManager: RenamePatchManager | null;
}

export interface RenameModalTarget {
  /** Store name, without the `.txt`. */
  table: string;
  /** The row's current ID. */
  id: string;
}

const INPUT_ID = 'rename-id-input';
const ERROR_ID = 'rename-id-error';

/**
 * The ID the counts are gathered under.
 *
 * `renamePlan` insists on a usable target, but the cascade it walks depends
 * only on the old ID, so the preview runs against a value no feed can hold and
 * the real plan is rebuilt from what the user typed.
 */
const PREVIEW_ID = '\u0000rename-preview';

function renderImpact(plan: RenamePlan): string {
  if (plan.cascades.length === 0) {
    return `<p class="text-sm opacity-70">Nothing else in the feed references this ID.</p>`;
  }

  const rows = plan.cascades
    .map(
      (cascade) => `
        <tr>
          <td class="font-mono text-xs">${escapeHtml(`${cascade.table}.${cascade.field}`)}</td>
          <td class="text-right">${cascade.rows.toLocaleString()}</td>
        </tr>`
    )
    .join('');

  return `
    <div class="space-y-1">
      <p class="text-sm opacity-70">Rows that will be rewritten:</p>
      <table class="table table-sm">
        <tbody>${rows}</tbody>
      </table>
      <p class="text-sm">${plan.total.toLocaleString()} row${plan.total === 1 ? '' : 's'} in total, recorded as one undoable change.</p>
    </div>`;
}

function renderWarning(plan: RenamePlan): string {
  if (!plan.heavy) {
    return '';
  }
  return `
    <div class="alert alert-warning text-sm">
      ${renderWarningIcon()}
      <span>This rename rewrites ${plan.total.toLocaleString()} rows. It will take a moment and the page will not respond while it runs.</span>
    </div>`;
}

function showError(message: string): void {
  const el = document.getElementById(ERROR_ID);
  if (!el) {
    console.error('[RenameIdModal] error slot is missing from the form');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Ask for a new ID and apply the rename.
 *
 * Resolves with the new ID once it is written, or null when the modal was
 * cancelled or could not run.
 */
export async function showRenameModal(
  deps: RenameModalDeps,
  target: RenameModalTarget
): Promise<string | null> {
  const { table, id } = target;
  const keyField = getNaturalKeyField(table);
  if (!keyField) {
    console.error(`[RenameIdModal] ${table} has no natural key to rename`);
    return null;
  }
  if (!deps.patchManager) {
    notify.error('Cannot rename: the edit history is not ready yet');
    return null;
  }
  const patchManager = deps.patchManager;

  let preview: RenamePlan;
  try {
    preview = await renamePlan(deps.database, table, id, PREVIEW_ID);
  } catch (error) {
    console.error('[RenameIdModal] could not plan the rename', error);
    notify.error(
      error instanceof Error ? error.message : 'Could not plan the rename.'
    );
    return null;
  }

  const body = `
    <div class="space-y-3">
      <fieldset class="fieldset">
        <label class="label" for="${INPUT_ID}">New ${escapeHtml(keyField)}</label>
        <input
          id="${INPUT_ID}"
          type="text"
          class="input input-bordered w-full font-mono"
          value="${escapeHtml(id)}"
          autocomplete="off"
        />
      </fieldset>
      ${renderImpact(preview)}
      ${renderWarning(preview)}
      <p id="${ERROR_ID}" class="text-error text-sm hidden"></p>
    </div>`;

  let renamed: string | null = null;

  await showModal({
    title: `Rename ${keyField} "${id}"`,
    body,
    boxClassName: 'max-w-lg',
    enterAction: 0,
    escapeAction: 1,
    onMount: () => {
      const input = document.getElementById(INPUT_ID);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    },
    actions: [
      {
        label: 'Rename',
        className: 'btn-primary',
        onClick: async () => {
          const input = document.getElementById(INPUT_ID);
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('[RenameIdModal] the ID input is missing');
          }
          const newId = input.value.trim();

          const invalid = await validateRenameTarget(
            deps.database,
            table,
            id,
            newId
          );
          if (invalid) {
            showError(invalid);
            return true;
          }

          try {
            // Planned again rather than reusing the preview: the preview was
            // built for a different target, and the feed may have moved since.
            const plan = await renamePlan(deps.database, table, id, newId);
            await applyRename(deps.database, patchManager, plan);
            notify.success(
              `Renamed ${keyField} to ${newId}: ${plan.total.toLocaleString()} row${plan.total === 1 ? '' : 's'} updated`
            );
            renamed = newId;
          } catch (error) {
            console.error('[RenameIdModal] rename failed', error);
            showError(
              error instanceof Error ? error.message : 'Could not rename.'
            );
            return true;
          }
          return false;
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
  });

  return renamed;
}
