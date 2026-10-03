/**
 * The Rename action's impact modal.
 *
 * A rename is not an inline edit: it can rewrite thousands of rows in tables
 * the user is not looking at, so the counts are shown before anything is
 * written. The cascade itself lives in `utils/rename-entity`; this module only
 * asks for the new ID, shows what it would touch, and applies it.
 */

import {
  showModal,
  renderWarningIcon,
} from 'gtfs-zone-web-common/ui/modal-utils';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import {
  applyRename,
  renamePlan,
  validateRenameTarget,
  type RenameDatabase,
  type RenamePatchManager,
  type RenamePlan,
} from '../utils/rename-entity';
import { getNaturalKeyField } from '../utils/gtfs-primary-keys';
import { t } from '../i18n/messages';
import { formatNumber } from 'gtfs-zone-web-common/i18n/fmt';

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
    return `<p class="text-sm opacity-70">${t('renameModal.noRefs')}</p>`;
  }

  const rows = plan.cascades
    .map(
      (cascade) => `
        <tr>
          <td class="font-mono text-xs">${escapeHtml(`${cascade.table}.${cascade.field}`)}</td>
          <td class="text-right">${formatNumber(cascade.rows)}</td>
        </tr>`
    )
    .join('');

  return `
    <div class="space-y-1">
      <p class="text-sm opacity-70">${t('renameModal.rowsRewritten')}</p>
      <table class="table table-sm">
        <tbody>${rows}</tbody>
      </table>
      <p class="text-sm">${t('renameModal.total', { count: plan.total })}</p>
    </div>`;
}

function renderWarning(plan: RenamePlan): string {
  if (!plan.heavy) {
    return '';
  }
  return `
    <div class="alert alert-warning text-sm">
      ${renderWarningIcon()}
      <span>${t('renameModal.heavy', { count: plan.total })}</span>
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
    notify.error(t('renameModal.historyNotReady'));
    return null;
  }
  const patchManager = deps.patchManager;

  let preview: RenamePlan;
  try {
    preview = await renamePlan(deps.database, table, id, PREVIEW_ID);
  } catch (error) {
    console.error('[RenameIdModal] could not plan the rename', error);
    notify.error(
      error instanceof Error ? error.message : t('renameModal.couldNotPlan')
    );
    return null;
  }

  const body = `
    <div class="space-y-3">
      <fieldset class="fieldset">
        <label class="label" for="${INPUT_ID}">${t('renameModal.newLabel', { field: escapeHtml(keyField) })}</label>
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
    title:
      id === ''
        ? t('renameModal.setTitle', { field: keyField })
        : t('renameModal.renameTitle', { field: keyField, id }),
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
        label: t('renameModal.rename'),
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

          let rows: number;
          try {
            // Planned again rather than reusing the preview: the preview was
            // built for a different target, and the feed may have moved since.
            const plan = await renamePlan(deps.database, table, id, newId);
            await applyRename(deps.database, patchManager, plan);
            renamed = newId;
            rows = plan.total;
          } catch (error) {
            console.error('[RenameIdModal] rename failed', error);
            showError(
              error instanceof Error
                ? error.message
                : t('renameModal.couldNotRename')
            );
            return true;
          }

          // Outside the try: the write is done, so nothing that happens now
          // may report it as a failure.
          notify.success(
            t('renameModal.done', { field: keyField, id: newId, count: rows })
          );
          return false;
        },
      },
      { label: t('common.cancel'), className: 'btn-ghost', onClick: () => {} },
    ],
  });

  return renamed;
}
