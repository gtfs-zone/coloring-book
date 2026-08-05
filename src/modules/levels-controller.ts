import { showModal } from './modal-utils.js';
import type { GTFSDatabase } from './gtfs-database.js';
import type { PatchManager } from './patch-manager.js';

function escapeHtml(text: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function escapeAttr(text: unknown): string {
  return escapeHtml(text).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

export interface LevelOption {
  value: string;
  label: string;
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

  async getLevelOptions(): Promise<LevelOption[]> {
    const levels = await this.db.getAllRows('levels');
    return levels
      .slice()
      .sort((a, b) => {
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
      })
      .map((l) => ({
        value: String(l.level_id),
        label: l.level_name
          ? `${l.level_name} (${l.level_index})`
          : String(l.level_id),
      }));
  }

  async showLevelsModal(): Promise<void> {
    const renderBody = async (): Promise<string> => {
      const levels = await this.db.getAllRows('levels');
      if (levels.length === 0) {
        return `<p class="text-center opacity-60 py-4">No levels defined yet.</p>
          <button id="levels-add-btn" class="btn btn-sm btn-primary w-full">Add Level</button>`;
      }
      const rows = levels
        .slice()
        .sort((a, b) => {
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
        })
        .map(
          (l) => `
          <tr>
            <td class="font-mono text-sm">${escapeHtml(l.level_id)}</td>
            <td>${escapeHtml(l.level_index ?? '')}</td>
            <td>${escapeHtml(l.level_name ?? '')}</td>
            <td>
              <button class="btn btn-xs btn-ghost text-error levels-delete-btn" data-level-id="${escapeAttr(l.level_id)}">×</button>
            </td>
          </tr>`
        )
        .join('');
      return `
        <div class="overflow-x-auto">
          <table class="table table-sm w-full">
            <thead><tr><th>ID</th><th>Index</th><th>Name</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <button id="levels-add-btn" class="btn btn-sm btn-primary mt-3 w-full">Add Level</button>`;
    };

    await showModal({
      title: 'Levels',
      body: await renderBody(),
      escapeAction: 0,
      actions: [{ label: 'Close', onClick: () => {} }],
      onMount: (close) => {
        document
          .getElementById('levels-add-btn')
          ?.addEventListener('click', () => {
            close();
            void this.showAddLevelModal().then(() => this.showLevelsModal());
          });

        document.querySelectorAll('.levels-delete-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const levelId = btn.getAttribute('data-level-id');
            if (levelId) {
              close();
              void this.deleteLevel(levelId).then(() => this.showLevelsModal());
            }
          });
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
