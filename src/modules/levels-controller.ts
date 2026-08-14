import {
  showModal,
  renderScrollableTable,
  renderTrashIcon,
} from './modal-utils.js';
import type { GTFSDatabase } from './gtfs-database.js';
import type { PatchManager } from './patch-manager.js';
import { escapeHtml } from '../utils/escape-html.js';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display.js';
import { renderEntityChip } from '../utils/entity-references.js';
import { navigateToStop } from './navigation-actions.js';

/** What the levels table shows for one level_id. */
interface LevelUsage {
  level: Record<string, unknown>;
  stops: Record<string, unknown>[];
}

function renderStopChip(stop: Record<string, unknown>): string {
  return renderEntityChip({
    action: 'stop',
    id: String(stop.stop_id ?? ''),
    label: renderOptionLabel(getStopDisplay(stop as Record<string, string>)),
  });
}

function renderBody(levels: Map<string, LevelUsage>): string {
  const addBtn = `<button class="btn btn-sm btn-primary" data-action="add">Add Level</button>`;

  if (levels.size === 0) {
    return `
      <p class="text-base-content/60 text-sm mb-4">No levels defined yet.</p>
      ${addBtn}
    `;
  }

  const rows = Array.from(levels.values())
    .map(
      ({ level, stops }) => `
        <tr>
          <td class="font-mono text-sm break-all">${escapeHtml(level.level_id)}</td>
          <td>${escapeHtml(level.level_index ?? '')}</td>
          <td>${escapeHtml(level.level_name ?? '')}</td>
          <td>${stops.length}</td>
          <td>
            <div class="flex flex-wrap gap-x-2 gap-y-1">${stops.map(renderStopChip).join('')}</div>
          </td>
          <td>
            <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-level-id="${escapeHtml(level.level_id)}" title="Delete level">${renderTrashIcon('h-3 w-3')}</button>
          </td>
        </tr>`
    )
    .join('');

  // The add button sits below the scroll container so it stays reachable with
  // a long level list.
  return `
    ${renderScrollableTable(['ID', 'Index', 'Name', 'Stops', 'Used by', 'Actions'], rows)}
    <div class="mt-4">
      ${addBtn}
    </div>
  `;
}

export class LevelsController {
  private db: GTFSDatabase;
  private patchManager: PatchManager | null = null;

  constructor(db: GTFSDatabase) {
    this.db = db;
  }

  setPatchManager(pm: PatchManager): void {
    this.patchManager = pm;
  }

  /**
   * Levels in level_index order, each with the stops that reference it.
   *
   * Recomputed on every panel refresh, so an add/delete updates the usage
   * columns without reopening the modal.
   */
  private async getLevels(): Promise<Map<string, LevelUsage>> {
    const levels = (await this.db.getAllRows('levels')) as Record<
      string,
      unknown
    >[];
    const sorted = levels.slice().sort((a, b) => {
      const ai = Number(a.level_index ?? 0);
      const bi = Number(b.level_index ?? 0);
      if (!Number.isFinite(ai) && !Number.isFinite(bi)) {
        return 0;
      }
      if (!Number.isFinite(ai)) {
        return 1;
      }
      if (!Number.isFinite(bi)) {
        return -1;
      }
      return ai - bi;
    });

    const map = new Map<string, LevelUsage>();
    for (const level of sorted) {
      map.set(String(level.level_id), { level, stops: [] });
    }

    // A stop pointing at a level_id no levels.txt row defines is skipped: it is
    // a spec-declared foreign key, so the referential integrity sweep already
    // reports it as a dangling reference.
    const stops = (await this.db.getAllRows('stops')) as Record<
      string,
      unknown
    >[];
    for (const stop of stops) {
      const usage = map.get(String(stop.level_id ?? ''));
      if (usage) {
        usage.stops.push(stop);
      }
    }

    return map;
  }

  async showLevelsModal(): Promise<void> {
    let currentLevels = await this.getLevels();

    await showModal({
      title: 'Levels',
      body: `<div id="levels-panel">${renderBody(currentLevels)}</div>`,
      escapeAction: 0,
      boxClassName: 'max-w-4xl w-11/12',
      actions: [{ label: 'Close', onClick: () => {} }],
      onMount: (close) => {
        const panel = document.getElementById('levels-panel');
        if (!panel) {
          return;
        }

        const refreshPanel = async () => {
          currentLevels = await this.getLevels();
          panel.innerHTML = renderBody(currentLevels);
        };

        panel.addEventListener('click', (e: Event) => {
          const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
            '[data-action]'
          );
          if (!btn) {
            return;
          }

          const action = btn.dataset.action;

          if (action === 'add') {
            void this.showAddLevelModal().then(refreshPanel);
          } else if (action === 'delete' && btn.dataset.levelId) {
            void this.deleteLevel(btn.dataset.levelId).then(refreshPanel);
          } else if (action === 'stop') {
            // Navigating behind an open modal would leave the stop page
            // hidden, so the modal goes first.
            close();
            void navigateToStop(btn.dataset.entityId ?? '');
          }
        });
      },
    });
  }

  private async showAddLevelModal(): Promise<void> {
    let savedLevelId = '';
    let savedLevelIndex = '';
    let savedLevelName = '';

    await showModal({
      title: 'Add Level',
      enterAction: 0,
      escapeAction: 1,
      body: `
        <div class="space-y-3">
          <label class="form-control w-full">
            <div class="label"><span class="label-text">Level ID <span class="text-error">*</span></span></div>
            <input id="add-level-id" type="text" class="input input-bordered input-sm w-full" placeholder="e.g. L0" />
          </label>
          <label class="form-control w-full">
            <div class="label"><span class="label-text">Level Index <span class="text-error">*</span></span></div>
            <input id="add-level-index" type="number" step="any" class="input input-bordered input-sm w-full" placeholder="e.g. 0" />
          </label>
          <label class="form-control w-full">
            <div class="label"><span class="label-text">Level Name</span></div>
            <input id="add-level-name" type="text" class="input input-bordered input-sm w-full" placeholder="e.g. Ground Floor" />
          </label>
          <div id="add-level-error" class="text-error text-sm hidden"></div>
        </div>`,
      actions: [
        {
          label: 'Add',
          className: 'btn-primary',
          onClick: async () => {
            const idEl = document.getElementById(
              'add-level-id'
            ) as HTMLInputElement;
            const indexEl = document.getElementById(
              'add-level-index'
            ) as HTMLInputElement;
            const nameEl = document.getElementById(
              'add-level-name'
            ) as HTMLInputElement;
            const errEl = document.getElementById('add-level-error');

            const levelId = idEl.value.trim();
            const levelIndex = indexEl.value.trim();
            const levelName = nameEl.value.trim();

            savedLevelId = levelId;
            savedLevelIndex = levelIndex;
            savedLevelName = levelName;

            if (
              !levelId ||
              levelIndex === '' ||
              Number.isNaN(Number(levelIndex))
            ) {
              if (errEl) {
                errEl.textContent =
                  'Level ID and Level Index are required and must be a number.';
                errEl.classList.remove('hidden');
              }
              return true;
            }

            const existing = await this.db.queryRows('levels', {
              level_id: levelId,
            });
            if (existing.length > 0) {
              if (errEl) {
                errEl.textContent = `Level ID "${levelId}" already exists.`;
                errEl.classList.remove('hidden');
              }
              return true;
            }

            await this.addLevel(levelId, Number(levelIndex), levelName);
            return;
          },
        },
        { label: 'Cancel', onClick: () => {} },
      ],
      onMount: () => {
        if (savedLevelId) {
          (document.getElementById('add-level-id') as HTMLInputElement).value =
            savedLevelId;
        }
        if (savedLevelIndex) {
          (
            document.getElementById('add-level-index') as HTMLInputElement
          ).value = savedLevelIndex;
        }
        if (savedLevelName) {
          (
            document.getElementById('add-level-name') as HTMLInputElement
          ).value = savedLevelName;
        }
        document.getElementById('add-level-id')?.focus();
      },
    });
  }

  async addLevel(
    level_id: string,
    level_index: number,
    level_name: string
  ): Promise<void> {
    const record: Record<string, unknown> = { level_id, level_index };
    if (level_name) {
      record.level_name = level_name;
    }
    await this.db.insertRows('levels', [record as never]);
    await this.patchManager?.recordInsert('levels', level_id, record);
    console.log(`[LevelsController] Added level ${level_id}`);
  }

  async deleteLevel(level_id: string): Promise<void> {
    const rows = await this.db.queryRows('levels', { level_id });
    if (rows.length === 0) {
      return;
    }
    const record = rows[0] as Record<string, unknown>;
    await this.db.deleteRow('levels', level_id);
    await this.patchManager?.recordDelete('levels', level_id, record);
    console.log(`[LevelsController] Deleted level ${level_id}`);
  }
}
