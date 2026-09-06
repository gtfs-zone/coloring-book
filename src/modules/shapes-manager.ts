import {
  showModal,
  renderScrollableTable,
  renderTrashIcon,
  renderUploadIcon,
  renderSimplifyIcon,
  renderRouteWaypointsIcon,
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
import {
  getRouteDisplay,
  getStopDisplay,
  renderOptionLabel,
} from '../utils/entity-display.js';
import { renderEntityChip } from '../utils/entity-references.js';
import { routeColor } from '../utils/route-colors.js';
import { openTimetable } from './navigation-actions.js';
import { deviationMetres, simplifyIndices } from '../utils/simplify-path.js';
import { encodeGeojsonIoUrl } from '../utils/geojson-io.js';
import {
  attachGeojsonExchangeHandlers,
  geojsonExchangeInput,
  pickFeatureById,
  pickLoneFeature,
  readIncomingFeature,
  renderGeojsonExchangeBlock,
  showGeojsonExchangeError,
} from './geojson-exchange.js';
import {
  shapeFeatureToPoints,
  shapeRowsToFeature,
} from '../utils/shape-geojson.js';
import { notify } from './notification-system.js';
import { promptNewEntity } from './entity-form-modal.js';
import { GTFS_TABLES } from '../types/gtfs.js';

/**
 * The stops of the simplify slider, in metres of allowed deviation. The
 * tolerance is a real distance: no dropped point ends up further than this
 * from the simplified line, so the stops are labelled with the distance
 * itself rather than with a vibe. 5 m is the default: it strips the dense
 * sampling a routing engine emits without visibly moving the line.
 */
const SIMPLIFY_LEVELS = [1, 2, 5, 10, 25];
const DEFAULT_SIMPLIFY_LEVEL = 2;

/** Metres as feet, which is how the distances here are read. */
function formatDistance(metres: number): string {
  return `${Math.round(metres * 3.28084).toLocaleString()} ft`;
}

/** "Within 16 ft (5 m) of the original line." for a slider stop. */
function toleranceSentence(toleranceMetres: number): string {
  return `Within ${formatDistance(toleranceMetres)} (${toleranceMetres} m) of the original line.`;
}

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
  /** First and last stop of a representative trip. Absent when none is resolvable. */
  origin?: string;
  destination?: string;
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

function pickShapeSourceFile(): Promise<File | null> {
  return pickFile('.gpx,.zip,.geojson,.json');
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

/** Turn `[lon, lat]` pairs into shape rows numbered 1..n. */
function pointsToShapeRows(
  shapeId: string,
  points: Array<[number, number]>
): Shapes[] {
  return points.map(([lon, lat], i) => ({
    shape_id: shapeId,
    shape_pt_lat: lat,
    shape_pt_lon: lon,
    shape_pt_sequence: i + 1,
  }));
}

/** A source the user picked, resolved down to "how do I get shape rows from it". */
interface ShapeSource {
  kind: 'gpx' | 'gtfs' | 'geojson';
  /** Subheading for the naming modal: the filename, plus the source shape for a zip. */
  label: string;
  /** Suggested id: the source shape_id, or the filename without its extension. */
  defaultId: string;
  buildRows(shapeId: string): Promise<Shapes[]>;
}

/** Naming-modal title for a new shape, by where its points came from. */
const NEW_SHAPE_TITLES: Record<ShapeSource['kind'], string> = {
  gtfs: 'Import shape from GTFS feed',
  gpx: 'New shape from GPX',
  geojson: 'New shape from GeoJSON',
};

/** Title for the error modal shown when a source cannot be read. */
function sourceErrorTitle(kind: ShapeSource['kind']): string {
  if (kind === 'gtfs') {
    return 'GTFS Error';
  }
  return kind === 'geojson' ? 'GeoJSON Error' : 'GPX Error';
}

async function showSourceError(title: string, error: unknown): Promise<void> {
  await showModal({
    title,
    body: `<p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`,
    escapeAction: 0,
    actions: [{ label: 'OK', onClick: () => {} }],
  });
}

/** Ask whether the shape is coming from disk or from a paste. */
async function pickShapeSourceKind(): Promise<'file' | 'paste' | null> {
  let choice: 'file' | 'paste' | null = null;
  await showModal({
    title: 'Add a shape',
    body: `
      <p class="text-base-content/60 text-sm">
        Load a GPX track, a GTFS feed or a GeoJSON file from disk, or paste a
        GeoJSON line (or a geojson.io share link).
      </p>
    `,
    escapeAction: 2,
    actions: [
      {
        label: 'Choose a file',
        className: 'btn-primary',
        onClick: () => {
          choice = 'file';
        },
      },
      {
        label: 'Paste GeoJSON or link',
        onClick: () => {
          choice = 'paste';
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
  });
  return choice;
}

/**
 * Ask whether an uploaded line replaces the trip's current shape or becomes a
 * new one.
 *
 * Only shown when the trip already has a resolvable shape: with no shape there
 * is nothing to replace, and the upload keeps its current click count. The
 * trip count is spelled out because replacing in place changes every trip
 * sharing the id, not just this one.
 */
async function pickShapeUploadTarget(
  shapeId: string,
  tripCount: number
): Promise<'replace' | 'new' | null> {
  let choice: 'replace' | 'new' | null = null;
  const usage =
    tripCount === 1
      ? '1 trip uses this shape and will change.'
      : `${tripCount} trips use this shape and will all change.`;

  await showModal({
    title: 'Replace or create',
    body: `
      <div class="space-y-2">
        <p class="text-sm">
          This trip already uses shape
          <strong class="font-mono">${escapeHtml(shapeId)}</strong>.
        </p>
        <p class="text-base-content/60 text-sm">${escapeHtml(usage)}</p>
        <p class="text-base-content/60 text-sm">
          Creating a new shape leaves the old one in the feed, unused by this
          trip.
        </p>
      </div>
    `,
    escapeAction: 2,
    actions: [
      {
        label: `Replace shape ${escapeHtml(shapeId)} in place`,
        className: 'btn-primary',
        onClick: () => {
          choice = 'replace';
        },
      },
      {
        label: 'Create a new shape',
        onClick: () => {
          choice = 'new';
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
  });
  return choice;
}

/**
 * Textarea and URL import for a pasted line, validated before the modal closes
 * so a bad paste can be fixed in place rather than re-opened.
 */
async function pickPastedShapePoints(): Promise<{
  points: Array<[number, number]>;
  defaultId: string;
} | null> {
  const instanceId = 'shape-paste';
  let result: { points: Array<[number, number]>; defaultId: string } | null =
    null;

  await showModal({
    title: 'Paste GeoJSON or link',
    body: renderGeojsonExchangeBlock({
      instanceId,
      featureJson: '',
      placeholder:
        '{ "type": "Feature", "geometry": { "type": "LineString", ... } }',
      hint: 'A LineString Feature, a FeatureCollection holding one line, or a geojson.io share link.',
      rows: 10,
    }),
    escapeAction: 1,
    actions: [
      {
        label: 'Use this line',
        className: 'btn-primary',
        onClick: async () => {
          const input = geojsonExchangeInput(document, instanceId);
          try {
            const feature = await readIncomingFeature(
              input?.value ?? '',
              pickLoneFeature
            );
            result = {
              points: shapeFeatureToPoints(feature),
              defaultId: String(feature.id ?? ''),
            };
          } catch (error) {
            showGeojsonExchangeError(
              document,
              instanceId,
              error instanceof Error ? error.message : String(error)
            );
            return true;
          }
          return;
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ],
    onMount: () => {
      attachGeojsonExchangeHandlers(document, {
        instanceId,
        logPrefix: '[ShapesManager] pasted shape',
        pick: pickLoneFeature,
      });
      geojsonExchangeInput(document, instanceId)?.focus();
    },
  });

  return result;
}

/**
 * Ask for a source and resolve it into a `ShapeSource`.
 *
 * A zip is a GTFS feed to import one shape out of, and needs a second pick to
 * say which one; a .geojson/.json file and a paste are read as a single line;
 * anything else is a GPX track. Every upload flow goes through here so all
 * three accept every kind. Returns null on any cancel, and shows its own error
 * modal when the source cannot be read.
 */
async function pickShapeSource(): Promise<ShapeSource | null> {
  const kind = await pickShapeSourceKind();
  if (!kind) {
    return null;
  }

  if (kind === 'paste') {
    const pasted = await pickPastedShapePoints();
    if (!pasted) {
      return null;
    }
    return {
      kind: 'geojson',
      label: `Pasted GeoJSON (${pasted.points.length} pts)`,
      defaultId: pasted.defaultId,
      buildRows: (shapeId) =>
        Promise.resolve(pointsToShapeRows(shapeId, pasted.points)),
    };
  }

  const file = await pickShapeSourceFile();
  if (!file) {
    return null;
  }

  if (/\.(geojson|json)$/i.test(file.name)) {
    let points: Array<[number, number]>;
    try {
      points = shapeFeatureToPoints(
        await readIncomingFeature(await file.text(), pickLoneFeature)
      );
    } catch (e) {
      await showSourceError('GeoJSON Error', e);
      return null;
    }
    return {
      kind: 'geojson',
      label: `${file.name} (${points.length} pts)`,
      defaultId: file.name.replace(/\.(geojson|json)$/i, ''),
      buildRows: (shapeId) =>
        Promise.resolve(pointsToShapeRows(shapeId, points)),
    };
  }

  if (!/\.zip$/i.test(file.name)) {
    return {
      kind: 'gpx',
      label: file.name,
      defaultId: file.name.replace(/\.gpx$/i, ''),
      buildRows: (shapeId) => parseGPX(file, shapeId),
    };
  }

  let picked: ZipShapeCandidate | null;
  try {
    picked = await pickShapeFromCandidates(await parseShapesFromZip(file));
  } catch (e) {
    await showSourceError('GTFS Error', e);
    return null;
  }
  if (!picked) {
    return null;
  }

  const source = picked;
  return {
    kind: 'gtfs',
    label: `${file.name} - shape ${source.shapeId} (${source.points.length} pts)`,
    defaultId: source.shapeId,
    buildRows: (shapeId) =>
      Promise.resolve(renumberPoints(source.points, shapeId)),
  };
}

/**
 * Name a new shape and commit it.
 *
 * Shared by the shapes manager's "Upload shape" and the timetable's per-trip
 * upload: both show the same id input with the same validation, and differ
 * only in the title and in what they write once the rows are built. `commit`
 * owns the writes so each caller keeps its own patch shape.
 *
 * @returns the id that was created, or null if the user cancelled.
 */
async function promptNewShapeId(opts: {
  title: string;
  source: ShapeSource;
  existing: Map<string, ShapeUsage>;
  commit: (shapeId: string, rows: Shapes[]) => Promise<void>;
}): Promise<string | null> {
  const values = await promptNewEntity({
    title: opts.title,
    intro: `<p class="text-base-content/60 text-sm">${escapeHtml(opts.source.label)}</p>`,
    fields: [
      {
        field: 'shape_id',
        tableName: GTFS_TABLES.SHAPES,
        mono: true,
        placeholder: 'e.g. shape_1',
        value: opts.source.defaultId,
      },
    ],
    validate: (v) => {
      if (!v.shape_id) {
        return 'Shape ID is required.';
      }
      if (opts.existing.has(v.shape_id)) {
        return `Shape "${v.shape_id}" already exists.`;
      }
      return null;
    },
    onCreate: async (v) => {
      // buildRows throws on a source the shape cannot be built from; the form
      // catches it and shows the message inline.
      const newRows = await opts.source.buildRows(v.shape_id);
      await opts.commit(v.shape_id, newRows);
    },
  });

  return values?.shape_id ?? null;
}

/**
 * Drop the points a Douglas-Peucker pass at `toleranceMetres` finds redundant.
 *
 * `rows` must already be in `shape_pt_sequence` order. Endpoints are always
 * kept, survivors are renumbered 1..n, and `shape_dist_traveled` is dropped:
 * the cumulative distances no longer describe the shortened line.
 */
function simplifyShapeRows(
  rows: Shapes[],
  toleranceMetres: number
): { rows: Shapes[]; deviation: { max: number; mean: number } } {
  const points = rows.map(
    (r) => [Number(r.shape_pt_lon), Number(r.shape_pt_lat)] as [number, number]
  );
  const kept = simplifyIndices(points, toleranceMetres);
  return {
    rows: kept.map((index, i) => {
      const row: Shapes = { ...rows[index], shape_pt_sequence: i + 1 };
      delete row.shape_dist_traveled;
      return row;
    }),
    deviation: deviationMetres(points, kept),
  };
}

/**
 * Show the shared simplify tolerance slider and return the chosen level index,
 * or null if the user cancelled.
 *
 * No live map preview by design; the headline states the guarantee for the
 * current stop and `describe` supplies the point counts and the measured
 * deviation, which is enough to choose between them.
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
            ${SIMPLIFY_LEVELS.map((toleranceMetres) => `<span>${escapeHtml(formatDistance(toleranceMetres))}</span>`).join('')}
          </div>
        </fieldset>
        <p id="simplify-headline" class="text-sm font-medium">${escapeHtml(toleranceSentence(SIMPLIFY_LEVELS[DEFAULT_SIMPLIFY_LEVEL]))}</p>
        <p id="simplify-result" class="text-sm whitespace-pre-line text-base-content/70">${escapeHtml(describe(DEFAULT_SIMPLIFY_LEVEL))}</p>
      </div>
    `,
    escapeAction: 1,
    enterAction: 0,
    onMount: () => {
      const slider = document.getElementById(
        'simplify-level'
      ) as HTMLInputElement | null;
      const headline = document.getElementById('simplify-headline');
      const result = document.getElementById('simplify-result');
      slider?.addEventListener('input', () => {
        levelIndex = Number(slider.value);
        if (headline) {
          headline.textContent = toleranceSentence(SIMPLIFY_LEVELS[levelIndex]);
        }
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

/** "Origin to Destination" for one shape, or a muted placeholder. */
function renderEndpoints(usage: ShapeUsage): string {
  if (!usage.origin || !usage.destination) {
    return '<span class="text-base-content/40">Unknown</span>';
  }
  return `${escapeHtml(usage.origin)} to ${escapeHtml(usage.destination)}`;
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
          <td class="text-sm">${renderEndpoints(usage)}</td>
          <td>
            <div class="flex flex-wrap gap-x-2 gap-y-1">${usage.timetables.map(renderTimetableChip).join('')}</div>
          </td>
          <td>
            <div class="flex gap-1">
              <button class="btn btn-xs btn-ghost" data-action="replace" data-shape-id="${escapeHtml(shapeId)}" title="Replace from a file or a paste">${renderUploadIcon()}</button>
              <button class="btn btn-xs btn-ghost" data-action="geojson-io" data-shape-id="${escapeHtml(shapeId)}" title="Edit in geojson.io">${renderRouteWaypointsIcon()}</button>
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
    ${renderScrollableTable(
      ['Shape ID', 'Points', 'Trips', 'Runs', 'Timetables', 'Actions'],
      rows
    )}
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
   * Point counts, trip counts, the distinct (route, service, direction)
   * timetables using each shape, and where it runs from and to.
   *
   * Recomputed on every panel refresh, so a new/replace/delete updates every
   * column without reopening the modal.
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
    // One trip per shape is enough to name where the shape runs from and to.
    const representativeTrip = new Map<string, string>();
    for (const trip of this.gtfsParser.getFileDataSync('trips.txt')) {
      const shapeId = String(trip.shape_id ?? '');
      const usage = map.get(shapeId);
      if (!usage) {
        continue;
      }
      usage.tripCount++;
      if (!representativeTrip.has(shapeId)) {
        representativeTrip.set(shapeId, String(trip.trip_id ?? ''));
      }

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

    const stopById = new Map<string, Record<string, string>>();
    for (const stop of this.gtfsParser.getFileDataSync('stops.txt')) {
      stopById.set(String(stop.stop_id), stop as Record<string, string>);
    }
    // One indexed stop_times lookup per distinct shape, not per trip.
    for (const [shapeId, tripId] of representativeTrip) {
      const stopTimes = [...this.gtfsParser.getStopTimesByTripId(tripId)].sort(
        (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)
      );
      if (stopTimes.length < 2) {
        console.warn(
          `[ShapesManager] shape ${shapeId}: trip ${tripId} has ${stopTimes.length} stop_times, cannot name an origin and destination`
        );
        continue;
      }
      const first = stopById.get(String(stopTimes[0].stop_id ?? ''));
      const last = stopById.get(
        String(stopTimes[stopTimes.length - 1].stop_id ?? '')
      );
      if (!first || !last) {
        console.warn(
          `[ShapesManager] shape ${shapeId}: trip ${tripId} references a stop that is not in stops.txt`
        );
        continue;
      }
      const usage = map.get(shapeId)!;
      usage.origin = renderOptionLabel(getStopDisplay(first));
      usage.destination = renderOptionLabel(getStopDisplay(last));
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
          } else if (action === 'geojson-io' && shapeId) {
            void this.editShapeGeojson(shapeId).then(refreshPanel);
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

  /** One shape's rows, in shape_pt_sequence order. */
  private async getShapeRows(shapeId: string): Promise<Shapes[]> {
    const allRows = (await this.gtfsParser.gtfsDatabase.getAllRows(
      'shapes'
    )) as Shapes[];
    return allRows
      .filter((r) => String(r.shape_id) === shapeId)
      .sort(
        (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
      );
  }

  /**
   * Swap every row of `shapeId` for `newRows`, as one undo step.
   *
   * Recorded as a single mixed batch with the deletes ordered first: the
   * renumbered points reuse the old composite keys, so neither replay
   * direction may hold two rows on one key.
   */
  private async replaceShapeRows(
    shapeId: string,
    newRows: Shapes[],
    label: string
  ): Promise<void> {
    const toDelete = await this.getShapeRows(shapeId);
    const deleteKeys = toDelete.map((r) =>
      generateCompositeKeyFromRecord('shapes', r)
    );
    const insertKeys = newRows.map((r) =>
      generateCompositeKeyFromRecord('shapes', r)
    );

    if (deleteKeys.length > 0) {
      await this.gtfsParser.deleteShapeRows(deleteKeys);
    }
    await this.gtfsParser.insertShapeRows(newRows);

    await this.patchManager.recordBatchMixed(
      [
        ...toDelete.map((r, i) => ({
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
      label
    );
    console.log(
      `[ShapesManager] Replaced shape ${shapeId}: ${deleteKeys.length} -> ${newRows.length} points`
    );
  }

  private async replaceShape(shapeId: string): Promise<void> {
    const source = await pickShapeSource();
    if (!source) {
      return;
    }

    // No naming modal: the id is fixed, and buildRows numbers the points onto
    // it 1..n, so the replacement is a drop-in for the existing rows.
    let newRows: Shapes[];
    try {
      newRows = await source.buildRows(shapeId);
    } catch (e) {
      await showSourceError(sourceErrorTitle(source.kind), e);
      return;
    }

    await this.replaceShapeRows(
      shapeId,
      newRows,
      `Replace shape ${shapeId} (${newRows.length} pts)`
    );
  }

  /**
   * Hand one shape to geojson.io as a LineString and take the edit back.
   *
   * The geojson.io link is built before the modal renders so the anchor is a
   * real user-initiated click: awaiting and then calling `window.open` would
   * trip the popup blocker.
   */
  private async editShapeGeojson(shapeId: string): Promise<void> {
    const rows = await this.getShapeRows(shapeId);
    if (rows.length === 0) {
      await showModal({
        title: 'Edit in geojson.io',
        body: `<p>Shape <strong class="font-mono">${escapeHtml(shapeId)}</strong> has no points.</p>`,
        escapeAction: 0,
        actions: [{ label: 'OK', onClick: () => {} }],
      });
      return;
    }

    const feature = shapeRowsToFeature(shapeId, rows);
    const editUrl = await encodeGeojsonIoUrl({
      type: 'FeatureCollection',
      features: [feature],
    });
    const instanceId = `shape-${shapeId}`;

    await showModal({
      title: `Edit shape ${escapeHtml(shapeId)}`,
      body: renderGeojsonExchangeBlock({
        instanceId,
        featureJson: JSON.stringify(feature, null, 2),
        editUrl,
        title: 'Geometry',
        saveLabel: 'Save geometry',
      }),
      escapeAction: 0,
      actions: [{ label: 'Close', onClick: () => {} }],
      onMount: (close) => {
        attachGeojsonExchangeHandlers(document, {
          instanceId,
          logPrefix: `[ShapesManager] shape ${shapeId}`,
          pick: (collection) => pickFeatureById(collection, shapeId),
          prepare: (f) => ({ ...f, id: shapeId }),
          onApply: async (edited) => {
            const points = shapeFeatureToPoints(edited);
            await this.replaceShapeRows(
              shapeId,
              pointsToShapeRows(shapeId, points),
              `Edit shape ${shapeId} (${rows.length} -> ${points.length} pts)`
            );
            notify.success(`Updated shape ${shapeId}`);
            close();
          },
        });
      },
    });
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

    // One run per level up front, so moving the slider only swaps the readout.
    const previews = SIMPLIFY_LEVELS.map((toleranceMetres) =>
      simplifyShapeRows(rows, toleranceMetres)
    );

    const describe = (index: number) => {
      const { rows: keptRows, deviation } = previews[index];
      const removed = rows.length - keptRows.length;
      return [
        `keeps ${keptRows.length.toLocaleString()} of ${rows.length.toLocaleString()} points (${removed.toLocaleString()} removed)`,
        `max deviation ${formatDistance(deviation.max)}, average ${formatDistance(deviation.mean)}`,
      ].join('\n');
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

    const newRows = previews[levelIndex].rows;
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
      `[ShapesManager] Simplified shape ${shapeId} from ${rows.length} to ${newRows.length} points at ${SIMPLIFY_LEVELS[levelIndex]}m`
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
    const previews = SIMPLIFY_LEVELS.map((toleranceMetres) =>
      targets.map((t) => simplifyShapeRows(t.rows, toleranceMetres))
    );

    const describe = (index: number) => {
      const kept = previews[index].reduce((sum, p) => sum + p.rows.length, 0);
      const worst = previews[index].reduce(
        (max, p) => Math.max(max, p.deviation.max),
        0
      );
      return `keeps ${kept.toLocaleString()} of ${totalPoints.toLocaleString()} points across ${targets.length} shape${targets.length !== 1 ? 's' : ''}; worst deviation ${formatDistance(worst)}.`;
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
      const newRows = previews[levelIndex][i].rows;
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
      `[ShapesManager] Simplified ${changedShapes} shapes from ${deleteKeys.length} to ${insertRows.length} points at ${SIMPLIFY_LEVELS[levelIndex]}m`
    );
  }

  private async newShape(
    existingShapes: Map<string, ShapeUsage>
  ): Promise<void> {
    const source = await pickShapeSource();
    if (!source) {
      return;
    }

    await promptNewShapeId({
      title: NEW_SHAPE_TITLES[source.kind],
      source,
      existing: existingShapes,
      commit: async (shapeId, newRows) => {
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
      },
    });
  }

  /**
   * The timetable's "Upload shape" button: pick a GPX file or a GTFS feed,
   * name a new shape, and assign it to one trip in the same step.
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
    const source = await pickShapeSource();
    if (!source) {
      return null;
    }

    const existing = await this.getShapes();
    const currentUsage = currentShapeId
      ? existing.get(currentShapeId)
      : undefined;

    if (currentUsage) {
      const target = await pickShapeUploadTarget(
        currentShapeId,
        currentUsage.tripCount
      );
      if (!target) {
        return null;
      }
      if (target === 'replace') {
        let newRows: Shapes[];
        try {
          newRows = await source.buildRows(currentShapeId);
        } catch (e) {
          await showSourceError(sourceErrorTitle(source.kind), e);
          return null;
        }
        // The id is unchanged, so no trips update: the delete-then-insert of
        // the points is the whole edit, and one undo takes it back.
        await this.replaceShapeRows(
          currentShapeId,
          newRows,
          `Replace shape ${currentShapeId} (${newRows.length} pts)`
        );
        return currentShapeId;
      }
    }

    return promptNewShapeId({
      title: 'Upload shape for this trip',
      source,
      existing,
      commit: async (shapeId, newRows) => {
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
      },
    });
  }
}
