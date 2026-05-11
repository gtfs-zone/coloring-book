import { showModal, renderTrashIcon } from './modal-utils.js';
import type { GTFSParser } from './gtfs-parser.js';
import type { PatchManager } from './patch-manager.js';
import { parseGPX } from '../utils/gpx-parser.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';

type ShapeRow = Record<string, string | number>;

function esc(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function pickGPXFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gpx';
    let resolved = false;
    const done = (file: File | null) => {
      if (!resolved) {
        resolved = true;
        resolve(file);
      }
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    const onWindowFocus = () => {
      setTimeout(() => done(null), 300);
      window.removeEventListener('focus', onWindowFocus);
    };
    window.addEventListener('focus', onWindowFocus);
    input.click();
  });
}

function renderBody(shapes: Map<string, number>): string {
  if (shapes.size === 0) {
    return `
      <p class="text-base-content/60 text-sm mb-4">No shapes in this feed.</p>
      <button class="btn btn-sm btn-primary" data-action="new">+ New shape from GPX</button>
    `;
  }

  const rows = Array.from(shapes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([shapeId, count]) => `
        <tr>
          <td class="font-mono text-sm">${esc(shapeId)}</td>
          <td>${count}</td>
          <td>
            <div class="flex gap-1">
              <button class="btn btn-xs btn-ghost" data-action="replace" data-shape-id="${esc(shapeId)}" title="Replace with GPX">↑ Replace</button>
              <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-shape-id="${esc(shapeId)}" title="Delete shape">${renderTrashIcon()}</button>
            </div>
          </td>
        </tr>`
    )
    .join('');

  return `
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Shape ID</th>
            <th>Points</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="mt-4">
      <button class="btn btn-sm btn-primary" data-action="new">+ New shape from GPX</button>
    </div>
  `;
}

export class ShapesManager {
  private gtfsParser: GTFSParser;
  private patchManager: PatchManager;

  constructor(gtfsParser: GTFSParser, patchManager: PatchManager) {
    this.gtfsParser = gtfsParser;
    this.patchManager = patchManager;
  }

  async open(): Promise<void> {
    const getShapes = async (): Promise<Map<string, number>> => {
      const rows = (await this.gtfsParser.gtfsDatabase.getAllRows(
        'shapes'
      )) as ShapeRow[];
      const map = new Map<string, number>();
      for (const row of rows) {
        const id = String(row.shape_id);
        map.set(id, (map.get(id) ?? 0) + 1);
      }
      return map;
    };

    let currentShapes = await getShapes();

    await showModal({
      title: 'Shapes',
      body: `<div id="shapes-panel">${renderBody(currentShapes)}</div>`,
      escapeAction: 0,
      actions: [{ label: 'Close', onClick: () => {} }],
      onMount: (_close) => {
        const panel = document.getElementById('shapes-panel');
        if (!panel) {
          return;
        }

        const refreshPanel = async () => {
          currentShapes = await getShapes();
          panel.innerHTML = renderBody(currentShapes);
        };

        panel.addEventListener('click', (e: Event) => {
          const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
            '[data-action]'
          );
          if (!btn) {
            return;
          }

          const action = btn.dataset.action;
          const shapeId = btn.dataset.shapeId ?? '';

          if (action === 'delete' && shapeId) {
            void this.deleteShape(
              shapeId,
              currentShapes.get(shapeId) ?? 0
            ).then(refreshPanel);
          } else if (action === 'replace' && shapeId) {
            void this.replaceShape(shapeId).then(refreshPanel);
          } else if (action === 'new') {
            void this.newShape(currentShapes).then(refreshPanel);
          }
        });
      },
    });
  }

  private async deleteShape(
    shapeId: string,
    pointCount: number
  ): Promise<void> {
    let confirmed = false;
    await showModal({
      title: 'Delete shape',
      body: `<p>Delete shape <strong class="font-mono">${esc(shapeId)}</strong> and all ${pointCount} point${pointCount !== 1 ? 's' : ''}?</p>`,
      escapeAction: 1,
      actions: [
        {
          label: 'Delete',
          className: 'btn-error',
          onClick: () => {
            confirmed = true;
          },
        },
        { label: 'Cancel', onClick: () => {} },
      ],
    });
    if (!confirmed) {
      return;
    }

    const rows = (await this.gtfsParser.gtfsDatabase.getAllRows(
      'shapes'
    )) as ShapeRow[];
    const toDelete = rows.filter((r) => String(r.shape_id) === shapeId);
    const keys = toDelete.map((r) =>
      generateCompositeKeyFromRecord('shapes', r)
    );

    await this.gtfsParser.gtfsDatabase.deleteRows('shapes', keys);
    await this.patchManager.recordBatchDelete(
      toDelete.map((r, i) => ({ table: 'shapes', id: keys[i], record: r })),
      `Delete shape ${shapeId}`
    );
    console.log(
      `[ShapesManager] Deleted shape ${shapeId} (${keys.length} points)`
    );
  }

  private async replaceShape(shapeId: string): Promise<void> {
    const file = await pickGPXFile();
    if (!file) {
      return;
    }

    let newRows: ShapeRow[];
    try {
      newRows = await parseGPX(file, shapeId);
    } catch (e) {
      await showModal({
        title: 'GPX Error',
        body: `<p>${esc(e instanceof Error ? e.message : String(e))}</p>`,
        escapeAction: 0,
        actions: [{ label: 'OK', onClick: () => {} }],
      });
      return;
    }

    // Delete old rows
    const existing = (await this.gtfsParser.gtfsDatabase.getAllRows(
      'shapes'
    )) as ShapeRow[];
    const toDelete = existing.filter((r) => String(r.shape_id) === shapeId);
    const deleteKeys = toDelete.map((r) =>
      generateCompositeKeyFromRecord('shapes', r)
    );

    if (deleteKeys.length > 0) {
      await this.gtfsParser.gtfsDatabase.deleteRows('shapes', deleteKeys);
      await this.patchManager.recordBatchDelete(
        toDelete.map((r, i) => ({
          table: 'shapes',
          id: deleteKeys[i],
          record: r,
        })),
        `Replace shape ${shapeId} (delete old)`
      );
    }

    // Insert new rows
    const insertKeys = newRows.map((r) =>
      generateCompositeKeyFromRecord('shapes', r)
    );
    await this.gtfsParser.gtfsDatabase.insertRows('shapes', newRows);
    await this.patchManager.recordBatchInsert(
      newRows.map((r, i) => ({
        table: 'shapes',
        id: insertKeys[i],
        record: r,
      })),
      `Replace shape ${shapeId} (${newRows.length} pts)`
    );
    console.log(
      `[ShapesManager] Replaced shape ${shapeId} with ${newRows.length} points`
    );
  }

  private async newShape(existingShapes: Map<string, number>): Promise<void> {
    await showModal({
      title: 'New shape from GPX',
      body: `
        <div class="space-y-3">
          <fieldset class="fieldset">
            <label class="label" for="new-shape-id">Shape ID</label>
            <input id="new-shape-id" class="input w-full" type="text" placeholder="e.g. shape_1" />
            <p id="new-shape-error" class="text-error text-sm hidden"></p>
          </fieldset>
        </div>
      `,
      escapeAction: 1,
      enterAction: 0,
      actions: [
        {
          label: 'Choose GPX…',
          className: 'btn-primary',
          onClick: async () => {
            const inputEl = document.getElementById(
              'new-shape-id'
            ) as HTMLInputElement | null;
            const errorEl = document.getElementById('new-shape-error');
            const shapeId = inputEl?.value.trim() ?? '';

            const showError = (msg: string) => {
              if (errorEl) {
                errorEl.textContent = msg;
                errorEl.classList.remove('hidden');
              }
              return true as const;
            };

            if (!shapeId) {
              return showError('Shape ID is required.');
            }
            if (existingShapes.has(shapeId)) {
              return showError(`Shape "${shapeId}" already exists.`);
            }

            const file = await pickGPXFile();
            if (!file) {
              return true;
            }

            let newRows: ShapeRow[];
            try {
              newRows = await parseGPX(file, shapeId);
            } catch (e) {
              return showError(e instanceof Error ? e.message : String(e));
            }

            const insertKeys = newRows.map((r) =>
              generateCompositeKeyFromRecord('shapes', r)
            );
            await this.gtfsParser.gtfsDatabase.insertRows('shapes', newRows);
            await this.patchManager.recordBatchInsert(
              newRows.map((r, i) => ({
                table: 'shapes',
                id: insertKeys[i],
                record: r,
              })),
              `New shape ${shapeId} (${newRows.length} pts)`
            );
            console.log(
              `[ShapesManager] Inserted new shape ${shapeId} (${newRows.length} points)`
            );
            return;
          },
        },
        { label: 'Cancel', onClick: () => {} },
      ],
    });
  }
}
