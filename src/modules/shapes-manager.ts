import {
  showModal,
  renderScrollableTable,
  renderTrashIcon,
  renderUploadIcon,
  renderSimplifyIcon,
} from './modal-utils.js';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { showOptionPickerModal } from './option-picker-modal.js';
import type { GTFSParser } from './gtfs-parser.js';
import type { PatchManager } from './patch-manager.js';
import type { Shapes } from '../types/gtfs-entities.js';
import { parseGPX } from '../utils/gpx-parser.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';
import { escapeHtml } from '../utils/escape-html.js';
import { getRouteDisplay, renderOptionLabel } from '../utils/entity-display.js';
import { renderEntityChip } from '../utils/entity-references.js';
import { routeColor } from '../utils/route-colors.js';
import { openTimetable } from './navigation-actions.js';
import { simplifyIndices } from '../utils/simplify-path.js';

/**
 * The three stops of the simplify slider, in metres of allowed deviation.
 * "Balanced" is the middle default: it strips the dense sampling a routing
 * engine emits without visibly moving the line.
 */
const SIMPLIFY_LEVELS = [
  { label: 'Fewest points removed', toleranceMetres: 1 },
  { label: 'Balanced', toleranceMetres: 5 },
  { label: 'Most points removed', toleranceMetres: 25 },
];
const DEFAULT_SIMPLIFY_LEVEL = 1;

/** One route/service/direction combination that uses a shape. */
interface TimetableUsage {
  route: Record<string, unknown>;
  service_id: string;
  direction_id: string;
}

/** What the shapes table shows for one shape_id. */
interface ShapeUsage {
  pointCount: number;
  tripCount: number;
  timetables: TimetableUsage[];
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
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

function pickGPXFile(): Promise<File | null> {
  return pickFile('.gpx');
}

function pickShapeSourceFile(): Promise<File | null> {
  return pickFile('.gpx,.zip');
}

/** One shape found in an uploaded GTFS feed, with the trips that reference it. */
interface ZipShapeCandidate {
  shapeId: string;
  points: Shapes[];
  /** Distinct route/headsign/direction descriptions, one per referencing trip group. */
  usages: string[];
}

/**
 * Read one CSV out of an uploaded feed. Matches on the base name so a feed
 * zipped with a wrapping folder still resolves.
 */
async function readZipCsv(
  zip: JSZip,
  fileName: string
): Promise<Record<string, string>[]> {
  const entryName = Object.keys(zip.files).find((name) => {
    const base = name.split('/').pop() ?? name;
    return base.toLowerCase() === fileName && !zip.files[name].dir;
  });
  if (!entryName) {
    return [];
  }
  const text = await zip.files[entryName].async('string');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    console.warn(
      `[ShapesManager] ${parsed.errors.length} CSV error(s) in ${fileName} of the uploaded feed`,
      parsed.errors[0]
    );
  }
  return parsed.data;
}

function toNumber(value: unknown): number {
  return parseFloat(String(value ?? ''));
}

/**
 * Parse shapes out of an uploaded GTFS zip without touching the current feed.
 *
 * `GTFSParser.parseFile` clears the database, so this reads the three files it
 * needs directly. `trips.txt` and `routes.txt` are only read to label the
 * shapes; nothing from them is inserted.
 */
async function parseShapesFromZip(file: File): Promise<ZipShapeCandidate[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const shapeRows = await readZipCsv(zip, 'shapes.txt');
  if (shapeRows.length === 0) {
    throw new Error('No shapes.txt in this feed, or it has no rows.');
  }

  const byShape = new Map<string, Shapes[]>();
  let skipped = 0;
  for (const row of shapeRows) {
    const shapeId = String(row.shape_id ?? '');
    const lat = toNumber(row.shape_pt_lat);
    const lon = toNumber(row.shape_pt_lon);
    if (shapeId === '' || isNaN(lat) || isNaN(lon)) {
      skipped++;
      continue;
    }
    const point: Shapes = {
      shape_id: shapeId,
      shape_pt_lat: lat,
      shape_pt_lon: lon,
      shape_pt_sequence: toNumber(row.shape_pt_sequence),
    };
    const dist = toNumber(row.shape_dist_traveled);
    if (!isNaN(dist)) {
      point.shape_dist_traveled = dist;
    }
    const points = byShape.get(shapeId);
    if (points) {
      points.push(point);
    } else {
      byShape.set(shapeId, [point]);
    }
  }
  if (skipped > 0) {
    console.warn(
      `[ShapesManager] skipped ${skipped} unusable shape point(s) in the uploaded feed`
    );
  }
  if (byShape.size === 0) {
    throw new Error('No usable shape points found in this feed.');
  }

  const routeById = new Map<string, Record<string, string>>();
  for (const route of await readZipCsv(zip, 'routes.txt')) {
    routeById.set(String(route.route_id ?? ''), route);
  }

  const usagesByShape = new Map<string, Set<string>>();
  for (const trip of await readZipCsv(zip, 'trips.txt')) {
    const shapeId = String(trip.shape_id ?? '');
    if (!byShape.has(shapeId)) {
      continue;
    }
    const routeId = String(trip.route_id ?? '');
    const route = routeById.get(routeId);
    const routeLabel = route
      ? renderOptionLabel(getRouteDisplay(route))
      : routeId;
    const headsign = String(trip.trip_headsign ?? '').trim();
    const direction = String(trip.direction_id ?? '').trim();
    const label = [
      routeLabel,
      headsign,
      direction === '' ? '' : `Direction ${direction}`,
    ]
      .filter(Boolean)
      .join(' - ');
    let usages = usagesByShape.get(shapeId);
    if (!usages) {
      usages = new Set<string>();
      usagesByShape.set(shapeId, usages);
    }
    if (label !== '') {
      usages.add(label);
    }
  }

  return [...byShape.entries()]
    .map(([shapeId, points]) => ({
      shapeId,
      points: points.sort(
        (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
      ),
      usages: [...(usagesByShape.get(shapeId) ?? [])],
    }))
    .sort((a, b) => a.shapeId.localeCompare(b.shapeId));
}

/**
 * Pick one shape out of an uploaded feed, labeled by the trips that use it.
 *
 * Opaque source ids (`34521`, `p_1_shp`) are unpickable on their own, so the
 * route/headsign context is the primary label and the id is the detail line.
 * The point count separates two candidates that share a route and headsign,
 * such as an express and a local variant.
 */
async function pickShapeFromCandidates(
  candidates: ZipShapeCandidate[]
): Promise<ZipShapeCandidate | null> {
  const picked = await showOptionPickerModal({
    title: 'Import a shape from this feed',
    placeholder: 'Search shapes...',
    options: candidates.map((c) => ({
      value: c.shapeId,
      primary: c.usages.length > 0 ? c.usages.join('; ') : c.shapeId,
      secondary: `${c.points.length} pts`,
      detail: c.usages.length > 0 ? c.shapeId : undefined,
    })),
  });
  if (!picked) {
    return null;
  }
  return candidates.find((c) => c.shapeId === picked) ?? null;
}

/** Renumber an imported shape's points onto a new shape_id, 1..n. */
function renumberPoints(points: Shapes[], shapeId: string): Shapes[] {
  return points.map((p, i) => ({
    ...p,
    shape_id: shapeId,
    shape_pt_sequence: i + 1,
  }));
}

/**
 * Drop the points a Douglas-Peucker pass at `toleranceMetres` finds redundant.
 *
 * `rows` must already be in `shape_pt_sequence` order. Endpoints are always
 * kept, survivors are renumbered 1..n, and `shape_dist_traveled` is dropped:
 * the cumulative distances no longer describe the shortened line.
 */
function simplifyShapeRows(rows: Shapes[], toleranceMetres: number): Shapes[] {
  const kept = simplifyIndices(
    rows.map(
      (r) =>
        [Number(r.shape_pt_lon), Number(r.shape_pt_lat)] as [number, number]
    ),
    toleranceMetres
  );
  return kept.map((index, i) => {
    const row: Shapes = { ...rows[index], shape_pt_sequence: i + 1 };
    delete row.shape_dist_traveled;
    return row;
  });
}

/**
 * Show the shared simplify tolerance slider and return the chosen level index,
 * or null if the user cancelled.
 *
 * No live map preview by design; `describe` supplies the point counts each
 * setting would leave behind, which is enough to choose between them.
 */
async function pickSimplifyLevel(
  title: string,
  introHtml: string,
  describe: (index: number) => string
): Promise<number | null> {
  let levelIndex = DEFAULT_SIMPLIFY_LEVEL;
  let confirmed = false;

  await showModal({
    title,
    body: `
      <div class="space-y-4">
        ${introHtml}
        <fieldset class="fieldset">
          <input id="simplify-level" class="range range-primary w-full" type="range" min="0" max="${SIMPLIFY_LEVELS.length - 1}" step="1" value="${DEFAULT_SIMPLIFY_LEVEL}" />
          <div class="flex justify-between text-xs text-base-content/60 px-1">
            ${SIMPLIFY_LEVELS.map((level) => `<span>${escapeHtml(level.label)}</span>`).join('')}
          </div>
        </fieldset>
        <p id="simplify-result" class="text-sm">${escapeHtml(describe(DEFAULT_SIMPLIFY_LEVEL))}</p>
      </div>
    `,
    escapeAction: 1,
    enterAction: 0,
    onMount: () => {
      const slider = document.getElementById(
        'simplify-level'
      ) as HTMLInputElement | null;
      const result = document.getElementById('simplify-result');
      slider?.addEventListener('input', () => {
        levelIndex = Number(slider.value);
        if (result) {
          result.textContent = describe(levelIndex);
        }
      });
    },
    actions: [
      {
        label: 'Simplify',
        className: 'btn-primary',
        onClick: () => {
          confirmed = true;
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
  });

  return confirmed ? levelIndex : null;
}

function renderTimetableChip(usage: TimetableUsage): string {
  const route_id = String(usage.route.route_id ?? '');
  const routeLabel = renderOptionLabel(
    getRouteDisplay(usage.route as Record<string, string>)
  );
  const directionLabel = usage.direction_id
    ? `Direction ${usage.direction_id}`
    : '';
  const label = [routeLabel, usage.service_id, directionLabel]
    .filter(Boolean)
    .join(' - ');
  return renderEntityChip({
    action: 'timetable',
    id: route_id,
    label,
    color: routeColor(route_id, usage.route.route_color as string | undefined),
    data: {
      'route-id': route_id,
      'service-id': usage.service_id,
      'direction-id': usage.direction_id,
    },
  });
}

function renderBody(shapes: Map<string, ShapeUsage>): string {
  const uploadBtn = `<button class="btn btn-sm btn-primary" data-action="new">${renderUploadIcon()} Upload shape</button>`;
  const helpText = `
    <p class="text-base-content/60 text-sm mb-4">
      A shape is generated by opening a timetable and selecting a trip, not
      created here directly.
    </p>
  `;

  if (shapes.size === 0) {
    return `
      ${helpText}
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
            <div class="flex flex-wrap gap-x-2 gap-y-1">${usage.timetables.map(renderTimetableChip).join('')}</div>
          </td>
          <td>
            <div class="flex gap-1">
              <button class="btn btn-xs btn-ghost" data-action="replace" data-shape-id="${escapeHtml(shapeId)}" title="Replace with GPX">${renderUploadIcon()}</button>
              <button class="btn btn-xs btn-ghost" data-action="simplify" data-shape-id="${escapeHtml(shapeId)}" title="Simplify shape">${renderSimplifyIcon()}</button>
              <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-shape-id="${escapeHtml(shapeId)}" title="Delete shape">${renderTrashIcon()}</button>
            </div>
          </td>
        </tr>`
    )
    .join('');

  // The upload button sits below the scroll container so it stays reachable
  // with hundreds of shapes.
  const simplifyAllBtn = `<button class="btn btn-sm" data-action="simplify-all">${renderSimplifyIcon()} Simplify all</button>`;

  return `
    ${helpText}
    ${renderScrollableTable(['Shape ID', 'Points', 'Trips', 'Timetables', 'Actions'], rows)}
    <div class="mt-4 flex gap-2">
      ${uploadBtn}
      ${simplifyAllBtn}
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
   * Point counts, trip counts and the distinct (route, service, direction)
   * timetables using each shape.
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
        map.set(id, { pointCount: 1, tripCount: 0, timetables: [] });
      }
    }

    const routeById = new Map<string, Record<string, unknown>>();
    for (const route of this.gtfsParser.getFileDataSync('routes.txt')) {
      routeById.set(String(route.route_id), route as Record<string, unknown>);
    }

    const timetablesByShape = new Map<string, Map<string, TimetableUsage>>();
    for (const trip of this.gtfsParser.getFileDataSync('trips.txt')) {
      const shapeId = String(trip.shape_id ?? '');
      const usage = map.get(shapeId);
      if (!usage) {
        continue;
      }
      usage.tripCount++;

      const route_id = String(trip.route_id ?? '');
      const service_id = String(trip.service_id ?? '');
      const direction_id = String(trip.direction_id ?? '');
      let timetables = timetablesByShape.get(shapeId);
      if (!timetables) {
        timetables = new Map<string, TimetableUsage>();
        timetablesByShape.set(shapeId, timetables);
      }
      const key = `${route_id}\u0000${service_id}\u0000${direction_id}`;
      if (!timetables.has(key)) {
        timetables.set(key, {
          route: routeById.get(route_id) ?? { route_id },
          service_id,
          direction_id,
        });
      }
    }

    for (const [shapeId, timetables] of timetablesByShape) {
      const usage = map.get(shapeId)!;
      usage.timetables = [...timetables.values()];
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
          } else if (action === 'simplify' && shapeId) {
            void this.simplifyShape(shapeId).then(refreshPanel);
          } else if (action === 'simplify-all') {
            void this.simplifyAllShapes().then(refreshPanel);
          } else if (action === 'new') {
            void this.newShape(currentShapes).then(refreshPanel);
          } else if (action === 'timetable') {
            // Navigating behind an open modal would leave the timetable
            // hidden, so the modal goes first.
            close();
            void openTimetable(
              btn.dataset.routeId ?? '',
              btn.dataset.serviceId ?? '',
              btn.dataset.directionId || undefined
            );
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

    await this.gtfsParser.deleteShapeRows(keys);
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
      await this.gtfsParser.deleteShapeRows(deleteKeys);
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
    await this.gtfsParser.insertShapeRows(newRows);
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

  /**
   * Simplify one shape: pick a tolerance, then replace the shape's points with
   * the Douglas-Peucker survivors.
   *
   * The slider has no live map preview by design; the point count that each
   * setting would leave behind is enough to choose between them. Applying is
   * the same delete-old + insert-new dance as `replaceShape()`, but recorded as
   * one mixed batch (deletes first) so a single undo restores the shape.
   */
  private async simplifyShape(shapeId: string): Promise<void> {
    const allRows = (await this.gtfsParser.gtfsDatabase.getAllRows(
      'shapes'
    )) as Shapes[];
    const rows = allRows
      .filter((r) => String(r.shape_id) === shapeId)
      .sort(
        (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
      );

    if (rows.length <= 2) {
      await showModal({
        title: 'Simplify shape',
        body: `<p>Shape <strong class="font-mono">${escapeHtml(shapeId)}</strong> has only ${rows.length} point${rows.length !== 1 ? 's' : ''}; there is nothing to simplify.</p>`,
        escapeAction: 0,
        actions: [{ label: 'OK', onClick: () => {} }],
      });
      return;
    }

    // Three runs up front, so moving the slider only swaps the displayed count.
    const previews = SIMPLIFY_LEVELS.map((level) =>
      simplifyShapeRows(rows, level.toleranceMetres)
    );

    const describe = (index: number) => {
      const kept = previews[index].length;
      const removed = rows.length - kept;
      return `${SIMPLIFY_LEVELS[index].label}: keeps ${kept} of ${rows.length} points (${removed} removed).`;
    };

    const levelIndex = await pickSimplifyLevel(
      'Simplify shape',
      `<p class="text-base-content/60 text-sm">
         Shape <span class="font-mono">${escapeHtml(shapeId)}</span> has ${rows.length} points.
       </p>`,
      describe
    );
    if (levelIndex === null) {
      return;
    }

    const newRows = previews[levelIndex];
    if (newRows.length === rows.length) {
      console.log(
        `[ShapesManager] Simplify left shape ${shapeId} unchanged (${rows.length} points)`
      );
      return;
    }

    const deleteKeys = rows.map((r) =>
      generateCompositeKeyFromRecord('shapes', r)
    );
    const insertKeys = newRows.map((r) =>
      generateCompositeKeyFromRecord('shapes', r)
    );

    await this.gtfsParser.deleteShapeRows(deleteKeys);
    await this.gtfsParser.insertShapeRows(newRows);

    // Deletes first: the renumbered points reuse the old keys, so neither
    // replay direction may hold two rows on one key.
    await this.patchManager.recordBatchMixed(
      [
        ...rows.map((r, i) => ({
          op: 'delete' as const,
          table: 'shapes',
          id: deleteKeys[i],
          record: r,
        })),
        ...newRows.map((r, i) => ({
          op: 'insert' as const,
          table: 'shapes',
          id: insertKeys[i],
          record: r,
        })),
      ],
      `Simplify shape ${shapeId} (${rows.length} -> ${newRows.length} pts)`
    );
    console.log(
      `[ShapesManager] Simplified shape ${shapeId} from ${rows.length} to ${newRows.length} points at ${SIMPLIFY_LEVELS[levelIndex].toleranceMetres}m`
    );
  }

  /**
   * Simplify every shape in the feed at one tolerance, recorded as a single
   * mixed batch so one undo restores all of them.
   *
   * Shapes with two points or fewer, and shapes the pass leaves unchanged, are
   * skipped rather than rewritten.
   */
  private async simplifyAllShapes(): Promise<void> {
    const allRows = (await this.gtfsParser.gtfsDatabase.getAllRows(
      'shapes'
    )) as Shapes[];

    const byShape = new Map<string, Shapes[]>();
    for (const row of allRows) {
      const id = String(row.shape_id);
      const rows = byShape.get(id);
      if (rows) {
        rows.push(row);
      } else {
        byShape.set(id, [row]);
      }
    }

    const targets = [...byShape.entries()]
      .map(([shapeId, rows]) => ({
        shapeId,
        rows: rows.sort(
          (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
        ),
      }))
      .filter((t) => t.rows.length > 2)
      .sort((a, b) => a.shapeId.localeCompare(b.shapeId));

    if (targets.length === 0) {
      await showModal({
        title: 'Simplify all shapes',
        body: `<p>No shape in this feed has more than two points; there is nothing to simplify.</p>`,
        escapeAction: 0,
        actions: [{ label: 'OK', onClick: () => {} }],
      });
      return;
    }

    const totalPoints = targets.reduce((sum, t) => sum + t.rows.length, 0);

    // One run per level up front, so moving the slider only swaps the counts.
    const previews = SIMPLIFY_LEVELS.map((level) =>
      targets.map((t) => simplifyShapeRows(t.rows, level.toleranceMetres))
    );

    const describe = (index: number) => {
      const kept = previews[index].reduce((sum, rows) => sum + rows.length, 0);
      const removed = totalPoints - kept;
      return `${SIMPLIFY_LEVELS[index].label}: keeps ${kept} of ${totalPoints} points (${removed} removed).`;
    };

    const levelIndex = await pickSimplifyLevel(
      'Simplify all shapes',
      `<p class="text-base-content/60 text-sm">
         ${targets.length} shape${targets.length !== 1 ? 's' : ''} with ${totalPoints} points in total.
       </p>`,
      describe
    );
    if (levelIndex === null) {
      return;
    }

    const deleteOps: {
      op: 'delete';
      table: string;
      id: string;
      record: Shapes;
    }[] = [];
    const insertOps: {
      op: 'insert';
      table: string;
      id: string;
      record: Shapes;
    }[] = [];
    const deleteKeys: string[] = [];
    const insertRows: Shapes[] = [];
    let changedShapes = 0;

    targets.forEach((target, i) => {
      const newRows = previews[levelIndex][i];
      if (newRows.length === target.rows.length) {
        return;
      }
      changedShapes++;
      for (const row of target.rows) {
        const id = generateCompositeKeyFromRecord('shapes', row);
        deleteKeys.push(id);
        deleteOps.push({ op: 'delete', table: 'shapes', id, record: row });
      }
      for (const row of newRows) {
        const id = generateCompositeKeyFromRecord('shapes', row);
        insertRows.push(row);
        insertOps.push({ op: 'insert', table: 'shapes', id, record: row });
      }
    });

    if (changedShapes === 0) {
      console.log('[ShapesManager] Simplify all left every shape unchanged');
      return;
    }

    await this.gtfsParser.deleteShapeRows(deleteKeys);
    await this.gtfsParser.insertShapeRows(insertRows);

    // Deletes first: the renumbered points reuse the old keys, so neither
    // replay direction may hold two rows on one key.
    await this.patchManager.recordBatchMixed(
      [...deleteOps, ...insertOps],
      `Simplify ${changedShapes} shape${changedShapes !== 1 ? 's' : ''} (${deleteKeys.length} -> ${insertRows.length} pts)`
    );
    console.log(
      `[ShapesManager] Simplified ${changedShapes} shapes from ${deleteKeys.length} to ${insertRows.length} points at ${SIMPLIFY_LEVELS[levelIndex].toleranceMetres}m`
    );
  }

  private async newShape(
    existingShapes: Map<string, ShapeUsage>
  ): Promise<void> {
    const file = await pickShapeSourceFile();
    if (!file) {
      return;
    }

    // A zip is a GTFS feed to import one shape out of; anything else is a GPX
    // track. Both rejoin the same id-name modal below.
    const isZip = /\.zip$/i.test(file.name);
    let source: ZipShapeCandidate | null = null;
    if (isZip) {
      try {
        source = await pickShapeFromCandidates(await parseShapesFromZip(file));
      } catch (e) {
        await showModal({
          title: 'GTFS Error',
          body: `<p>${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`,
          escapeAction: 0,
          actions: [{ label: 'OK', onClick: () => {} }],
        });
        return;
      }
      if (!source) {
        return;
      }
    }

    const buildRows = (shapeId: string): Promise<Shapes[]> =>
      source
        ? Promise.resolve(renumberPoints(source.points, shapeId))
        : parseGPX(file, shapeId);

    // Default the id to the source shape's id, or the filename without its
    // .gpx extension.
    const defaultId = source
      ? source.shapeId
      : file.name.replace(/\.gpx$/i, '');
    const sourceLabel = source
      ? `${file.name} - shape ${source.shapeId} (${source.points.length} pts)`
      : file.name;

    await showModal({
      title: source ? 'Import shape from GTFS feed' : 'New shape from GPX',
      body: `
        <div class="space-y-3">
          <p class="text-base-content/60 text-sm">${escapeHtml(sourceLabel)}</p>
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
              newRows = await buildRows(shapeId);
            } catch (e) {
              return showError(e instanceof Error ? e.message : String(e));
            }

            const insertKeys = newRows.map((r) =>
              generateCompositeKeyFromRecord('shapes', r)
            );
            await this.gtfsParser.insertShapeRows(newRows);
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

  /**
   * The timetable's "Upload shape" button: pick a GPX file, name a new shape,
   * and assign it to one trip in the same step.
   *
   * Mirrors `newShape()` but also points the trip's `shape_id` at the result,
   * so the shape insert and the trip update are recorded together as one
   * `recordBatchMixed` - one click, one undo step.
   *
   * @returns the new shape_id, or null if the user cancelled at any point.
   */
  async uploadShapeForTrip(
    tripId: string,
    currentShapeId: string
  ): Promise<string | null> {
    const file = await pickGPXFile();
    if (!file) {
      return null;
    }

    const existingShapes = await this.getShapes();
    const defaultId = file.name.replace(/\.gpx$/i, '');
    let createdShapeId: string | null = null;

    await showModal({
      title: 'Upload shape for this trip',
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
            await this.gtfsParser.insertShapeRows(newRows);

            const trips = this.gtfsParser.getFileDataSync(
              'trips.txt'
            ) as unknown as Record<string, unknown>[];
            const tripRow = trips.find((t) => t.trip_id === tripId);

            const ops: Parameters<PatchManager['recordBatchMixed']>[0] =
              newRows.map((r, i) => ({
                op: 'insert' as const,
                table: 'shapes',
                id: insertKeys[i],
                record: r,
              }));

            if (tripRow) {
              await this.gtfsParser.gtfsDatabase.updateRow('trips', tripId, {
                shape_id: shapeId,
              });
              ops.push({
                op: 'update' as const,
                table: 'trips',
                id: tripId,
                before: { shape_id: tripRow.shape_id ?? currentShapeId },
                after: { shape_id: shapeId },
              });
            } else {
              console.warn(
                `[ShapesManager] trip ${tripId} not found; inserted shape ${shapeId} without assigning it`
              );
            }

            await this.patchManager.recordBatchMixed(
              ops,
              `Upload shape ${shapeId} for trip ${tripId} (${newRows.length} pts)`
            );
            console.log(
              `[ShapesManager] Inserted shape ${shapeId} (${newRows.length} points) and assigned it to trip ${tripId}`
            );
            createdShapeId = shapeId;
            return;
          },
        },
        { label: 'Cancel', onClick: () => {} },
      ],
    });

    return createdShapeId;
  }
}
