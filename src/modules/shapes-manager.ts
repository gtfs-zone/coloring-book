import { showModal, renderTrashIcon, renderUploadIcon } from './modal-utils.js';
import type { GTFSParser } from './gtfs-parser.js';
import type { PatchManager } from './patch-manager.js';
import type { Shapes } from '../types/gtfs-entities.js';
import { parseGPX } from '../utils/gpx-parser.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { escapeHtml } from '../utils/escape-html.js';
import { getRouteDisplay, renderOptionLabel } from '../utils/entity-display.js';
import { routeColor } from '../utils/route-colors.js';
import { navigateToRoute } from './navigation-actions.js';

/** What the shapes table shows for one shape_id. */
interface ShapeUsage {
  pointCount: number;
  tripCount: number;
  routes: Record<string, unknown>[];
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
    input.click();
  });
}

// Compact enough to sit several to a table cell, unlike renderRouteReference's
// full card row.
function renderRouteChip(route: Record<string, unknown>): string {
  const route_id = String(route.route_id ?? '');
  const color = routeColor(route_id, route.route_color as string | undefined);
  const label = renderOptionLabel(
    getRouteDisplay(route as Record<string, string>)
  );
  return `
    <button class="inline-flex items-center gap-1 max-w-full text-xs cursor-pointer hover:underline" data-action="route" data-route-id="${escapeHtml(route_id)}" title="${escapeHtml(label)}">
      <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: ${color}"></span>
      <span class="truncate">${escapeHtml(label)}</span>
    </button>`;
}

function renderBody(shapes: Map<string, ShapeUsage>): string {
  const uploadBtn = `<button class="btn btn-sm btn-primary" data-action="new">${renderUploadIcon()} Upload GPX</button>`;

  if (shapes.size === 0) {
    return `
      <p class="text-base-content/60 text-sm mb-4">No shapes in this feed.</p>
      ${uploadBtn}
    `;
  }

  const rows = Array.from(shapes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([shapeId, usage]) => `
        <tr>
          <td class="font-mono text-sm break-all">${escapeHtml(shapeId)}</td>
          <td>${usage.pointCount}</td>
          <td>${usage.tripCount}</td>
          <td>
            <div class="flex flex-wrap gap-x-2 gap-y-1">${usage.routes.map(renderRouteChip).join('')}</div>
          </td>
          <td>
            <div class="flex gap-1">
              <button class="btn btn-xs btn-ghost" data-action="replace" data-shape-id="${escapeHtml(shapeId)}" title="Replace with GPX">${renderUploadIcon()}</button>
              <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-shape-id="${escapeHtml(shapeId)}" title="Delete shape">${renderTrashIcon()}</button>
            </div>
          </td>
        </tr>`
    )
    .join('');

  // The table body scrolls under a pinned header, and the upload button sits
  // below the scroll container so it stays reachable with hundreds of shapes.
  return `
    <div class="max-h-[55vh] overflow-y-auto">
      <table class="table table-sm table-pin-rows">
        <thead>
          <tr>
            <th>Shape ID</th>
            <th>Points</th>
            <th>Trips</th>
            <th>Routes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="mt-4">
      ${uploadBtn}
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

  /**
   * Point counts, trip counts and the distinct routes using each shape.
   *
   * Recomputed on every panel refresh, so a new/replace/delete updates all
   * three columns without reopening the modal.
   */
  private async getShapes(): Promise<Map<string, ShapeUsage>> {
    const rows = (await this.gtfsParser.gtfsDatabase.getAllRows(
      'shapes'
    )) as Shapes[];
    const map = new Map<string, ShapeUsage>();
    for (const row of rows) {
      const id = String(row.shape_id);
      const usage = map.get(id);
      if (usage) {
        usage.pointCount++;
      } else {
        map.set(id, { pointCount: 1, tripCount: 0, routes: [] });
      }
    }

    const routeById = new Map<string, Record<string, unknown>>();
    for (const route of this.gtfsParser.getFileDataSync('routes.txt')) {
      routeById.set(String(route.route_id), route as Record<string, unknown>);
    }

    const routeIdsByShape = new Map<string, Set<string>>();
    for (const trip of this.gtfsParser.getFileDataSync('trips.txt')) {
      const shapeId = String(trip.shape_id ?? '');
      const usage = map.get(shapeId);
      if (!usage) {
        continue;
      }
      usage.tripCount++;
      let routeIds = routeIdsByShape.get(shapeId);
      if (!routeIds) {
        routeIds = new Set<string>();
        routeIdsByShape.set(shapeId, routeIds);
      }
      routeIds.add(String(trip.route_id ?? ''));
    }

    for (const [shapeId, routeIds] of routeIdsByShape) {
      const usage = map.get(shapeId)!;
      usage.routes = [...routeIds].map(
        (route_id) => routeById.get(route_id) ?? { route_id }
      );
    }

    return map;
  }

  async open(): Promise<void> {
    let currentShapes = await this.getShapes();

    await showModal({
      title: 'Shapes',
      body: `<div id="shapes-panel">${renderBody(currentShapes)}</div>`,
      escapeAction: 0,
      boxClassName: 'max-w-6xl w-11/12',
      actions: [{ label: 'Close', onClick: () => {} }],
      onMount: (close) => {
        const panel = document.getElementById('shapes-panel');
        if (!panel) {
          return;
        }

        const refreshPanel = async () => {
          currentShapes = await this.getShapes();
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
              currentShapes.get(shapeId)?.pointCount ?? 0
            ).then(refreshPanel);
          } else if (action === 'replace' && shapeId) {
            void this.replaceShape(shapeId).then(refreshPanel);
          } else if (action === 'new') {
            void this.newShape(currentShapes).then(refreshPanel);
          } else if (action === 'route') {
            // Navigating behind an open modal would leave the route page
            // hidden, so the modal goes first.
            close();
            void navigateToRoute(btn.dataset.routeId ?? '');
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
      body: `<p>Delete shape <strong class="font-mono">${escapeHtml(shapeId)}</strong> and all ${pointCount} point${pointCount !== 1 ? 's' : ''}?</p>`,
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
    )) as Shapes[];
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

    let newRows: Shapes[];
    try {
      newRows = await parseGPX(file, shapeId);
    } catch (e) {
      await showModal({
        title: 'GPX Error',
        body: `<p>${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`,
        escapeAction: 0,
        actions: [{ label: 'OK', onClick: () => {} }],
      });
      return;
    }

    // Delete old rows
    const existing = (await this.gtfsParser.gtfsDatabase.getAllRows(
      'shapes'
    )) as Shapes[];
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

  private async newShape(
    existingShapes: Map<string, ShapeUsage>
  ): Promise<void> {
    const file = await pickGPXFile();
    if (!file) {
      return;
    }

    // Default the id to the filename without its .gpx extension.
    const defaultId = file.name.replace(/\.gpx$/i, '');

    await showModal({
      title: 'New shape from GPX',
      body: `
        <div class="space-y-3">
          <p class="text-base-content/60 text-sm">${escapeHtml(file.name)}</p>
          <fieldset class="fieldset">
            <label class="label" for="new-shape-id">Shape ID</label>
            <input id="new-shape-id" class="input w-full" type="text" placeholder="e.g. shape_1" value="${escapeHtml(defaultId)}" />
            <p id="new-shape-error" class="text-error text-sm hidden"></p>
          </fieldset>
        </div>
      `,
      escapeAction: 1,
      enterAction: 0,
      onMount: () => {
        const inputEl = document.getElementById(
          'new-shape-id'
        ) as HTMLInputElement | null;
        inputEl?.focus();
        inputEl?.select();
      },
      actions: [
        {
          label: 'Create',
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

            let newRows: Shapes[];
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
