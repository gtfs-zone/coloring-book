/**
 * The stop page's area membership editor.
 *
 * Areas are many-to-many, so this is a set of chips rather than the single
 * picker the route page uses for networks, and a platform's chips may be
 * inherited from its station (see `utils/area-hierarchy`). Inherited chips are
 * shown greyed and are not removable here: they belong to the station's row.
 *
 * Like the click-to-edit fields, this lives outside the view controllers
 * because those hold a query-only database handle, and writes here have to go
 * through the patch log.
 */

import { showOptionPickerModal } from '../modules/option-picker-modal.js';
import { showModal } from '../modules/modal-utils.js';
import { notify } from '../modules/notification-system.js';
import { escapeHtml } from './escape-html.js';
import { generateCompositeKeyFromRecord } from './gtfs-primary-keys.js';
import { getEntityDisplay, renderOptionLabel } from './entity-display.js';
import {
  canStopHaveAreas,
  getEffectiveAreasForStop,
  stopLocationType,
} from './area-hierarchy.js';

/** Marks the container this module's delegated listeners refresh. */
const FIELD_CLASS = 'stop-areas-field';
const ADD_CLASS = 'stop-area-add';
const REMOVE_CLASS = 'stop-area-remove';

/** Sentinel option value for "create an area inline". */
const CREATE_AREA = '\0create-area';

const STORE = 'stop_areas';

export interface StopAreasFieldDeps {
  gtfsDatabase: {
    queryRows: (
      tableName: string,
      filter?: Record<string, unknown>
    ) => Promise<unknown[]>;
    getAllRows: (tableName: string) => Promise<unknown[]>;
    insertRows: (tableName: string, rows: unknown[]) => Promise<void>;
    deleteRow?: (tableName: string, key: string) => Promise<void>;
  };
  patchManager: {
    recordInsert: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
    recordDelete: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
  } | null;
}

let deps: StopAreasFieldDeps | null = null;
let listenerInstalled = false;

/**
 * Register the database and patch manager this field writes through, and
 * install its delegated listeners.
 *
 * Bound to `document` once, for the same reason the click-to-edit fields are:
 * the stop page's container has its `innerHTML` replaced on every navigation.
 */
export function installStopAreasField(newDeps: StopAreasFieldDeps): void {
  deps = newDeps;
  if (listenerInstalled) {
    return;
  }
  listenerInstalled = true;

  document.addEventListener('click', (e) => {
    const add = (e.target as Element)?.closest?.(`.${ADD_CLASS}`);
    if (add instanceof HTMLElement) {
      void addArea(add.dataset.stopId ?? '');
      return;
    }
    const remove = (e.target as Element)?.closest?.(`.${REMOVE_CLASS}`);
    if (remove instanceof HTMLElement) {
      void removeArea(remove.dataset.stopId ?? '', remove.dataset.areaId ?? '');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') {
      return;
    }
    const add = (e.target as Element)?.closest?.(`.${ADD_CLASS}`);
    if (add instanceof HTMLElement) {
      e.preventDefault();
      void addArea(add.dataset.stopId ?? '');
    }
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/** Every area's display label, keyed by `area_id`. */
async function areaLabels(): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (!deps) {
    return labels;
  }
  const rows = (await deps.gtfsDatabase.getAllRows('areas')) as Record<
    string,
    string
  >[];
  for (const row of rows) {
    labels.set(
      String(row.area_id ?? ''),
      renderOptionLabel(getEntityDisplay('areas', row))
    );
  }
  return labels;
}

async function stopRow(
  stop_id: string
): Promise<Record<string, unknown> | undefined> {
  if (!deps) {
    return undefined;
  }
  const rows = (await deps.gtfsDatabase.queryRows('stops', {
    stop_id,
  })) as Record<string, unknown>[];
  return rows[0];
}

/** A station's label, for the "from ..." text on an inherited chip. */
async function stationLabel(stop_id: string): Promise<string> {
  const row = await stopRow(stop_id);
  return row
    ? renderOptionLabel(
        getEntityDisplay('stops', row as Record<string, string>)
      )
    : stop_id;
}

/** The chips, the add button and the inheritance note. */
async function renderContent(stop: Record<string, unknown>): Promise<string> {
  const stop_id = String(stop.stop_id ?? '');
  if (!canStopHaveAreas(stop)) {
    return `<p class="px-1 py-1.5 text-sm opacity-60">Only stops and stations can be assigned to areas (this one is location_type ${stopLocationType(stop)}).</p>`;
  }
  if (!deps) {
    return '';
  }

  const areas = await getEffectiveAreasForStop(deps.gtfsDatabase, stop_id);
  const labels = await areaLabels();
  const inheritedFrom = areas.find((a) => a.inheritedFrom)?.inheritedFrom;

  const chips = areas
    .map((area) => {
      const label = labels.get(area.area_id) ?? area.area_id;
      if (area.inheritedFrom) {
        return `<span class="badge badge-sm badge-ghost opacity-60">${escapeHtml(label)}</span>`;
      }
      return `<span class="badge badge-sm badge-outline gap-1">
        ${escapeHtml(label)}
        <button
          type="button"
          class="${REMOVE_CLASS} cursor-pointer leading-none opacity-60 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          data-stop-id="${escapeHtml(stop_id)}"
          data-area-id="${escapeHtml(area.area_id)}"
          title="Remove from this area"
        >x</button>
      </span>`;
    })
    .join('');

  const addButton = `<button
    type="button"
    class="${ADD_CLASS} btn btn-xs btn-ghost"
    data-stop-id="${escapeHtml(stop_id)}"
  >+ Add area</button>`;

  let note = '';
  if (inheritedFrom) {
    const station = await stationLabel(inheritedFrom);
    note = `Inherited from ${station}. Adding an area here assigns this platform directly and replaces the inherited ones.`;
  } else if (areas.length > 0 && stopLocationType(stop) === 0) {
    const parent_station = String(stop.parent_station ?? '').trim();
    if (parent_station !== '') {
      const station = await stationLabel(parent_station);
      note = `Assigned directly, which supersedes the areas of ${station}. Removing the last one returns this platform to inheriting them.`;
    }
  }

  return `
    <div class="flex flex-wrap items-center gap-1">${chips}${addButton}</div>
    ${note ? `<p class="text-xs opacity-60">${escapeHtml(note)}</p>` : ''}
  `;
}

/** The stop page's Areas fieldset. */
export async function renderStopAreasField(
  stop: Record<string, unknown>
): Promise<string> {
  const stop_id = String(stop.stop_id ?? '');
  return `
    <fieldset class="fieldset isolate">
      <legend class="fieldset-legend">Areas</legend>
      <div class="${FIELD_CLASS}" data-stop-id="${escapeHtml(stop_id)}">${await renderContent(stop)}</div>
    </fieldset>
  `;
}

/** Redraw the chips in place, without re-rendering the whole stop page. */
async function refresh(stop_id: string): Promise<void> {
  const container = document.querySelector<HTMLElement>(
    `.${FIELD_CLASS}[data-stop-id="${CSS.escape(stop_id)}"]`
  );
  const stop = await stopRow(stop_id);
  if (!container || !stop) {
    return;
  }
  container.innerHTML = await renderContent(stop);
}

// ─── Editing ──────────────────────────────────────────────────────────────────

/** Assign a stop to an area, creating the area first if the user asks for it. */
async function addArea(stop_id: string): Promise<void> {
  if (!deps || stop_id === '') {
    return;
  }
  const stop = await stopRow(stop_id);
  if (!stop || !canStopHaveAreas(stop)) {
    return;
  }

  const existing = (
    await getEffectiveAreasForStop(deps.gtfsDatabase, stop_id)
  ).filter((a) => !a.inheritedFrom);
  const wasInheriting = existing.length === 0;

  const areas = (await deps.gtfsDatabase.getAllRows('areas')) as Record<
    string,
    string
  >[];
  const assigned = new Set(existing.map((a) => a.area_id));
  const picked = await showOptionPickerModal({
    title: 'Add to area',
    options: [
      ...areas
        .filter((a) => !assigned.has(String(a.area_id ?? '')))
        .map((a) => ({
          value: String(a.area_id ?? ''),
          primary: renderOptionLabel(getEntityDisplay('areas', a)),
          secondary: String(a.area_id ?? ''),
        })),
      { value: CREATE_AREA, primary: '+ Create a new area...' },
    ],
    searchable: true,
  });
  if (picked === null) {
    return;
  }

  let area_id = picked;
  if (picked === CREATE_AREA) {
    const created = await createArea(areas.map((a) => String(a.area_id ?? '')));
    if (created === null) {
      return;
    }
    area_id = created;
  }
  if (area_id === '' || assigned.has(area_id)) {
    return;
  }

  const record = { area_id, stop_id };
  const key = generateCompositeKeyFromRecord(STORE, record);
  console.log(`[Areas] assign ${stop_id} to ${area_id}`);
  await deps.gtfsDatabase.insertRows(STORE, [record]);
  await deps.patchManager?.recordInsert(STORE, key, record);

  if (wasInheriting && stopLocationType(stop) === 0) {
    const inherited = await getEffectiveAreasForStop(
      deps.gtfsDatabase,
      String(stop.parent_station ?? '')
    );
    if (inherited.length > 0) {
      notify.info(
        "This platform now has its own areas, so it no longer inherits its station's."
      );
    }
  }

  await refresh(stop_id);
}

/** Remove one explicit assignment, which may return a platform to inheriting. */
async function removeArea(stop_id: string, area_id: string): Promise<void> {
  if (!deps || stop_id === '' || area_id === '') {
    return;
  }
  const rows = (await deps.gtfsDatabase.queryRows(STORE, {
    stop_id,
    area_id,
  })) as Record<string, unknown>[];
  const record = rows[0];
  if (!record) {
    console.warn(`[Areas] no stop_areas row for ${stop_id} in ${area_id}`);
    return;
  }

  if (!deps.gtfsDatabase.deleteRow) {
    console.warn('[Areas] database cannot delete rows, removal dropped');
    return;
  }

  const key = generateCompositeKeyFromRecord(STORE, record);
  console.log(`[Areas] remove ${stop_id} from ${area_id}`);
  await deps.gtfsDatabase.deleteRow(STORE, key);
  await deps.patchManager?.recordDelete(STORE, key, record);

  await refresh(stop_id);

  const remaining = await getEffectiveAreasForStop(deps.gtfsDatabase, stop_id);
  if (remaining.some((a) => a.inheritedFrom)) {
    notify.info(
      "That was this platform's last area, so it inherits its station's again."
    );
  }
}

/** Ask for a new area's id and name, and write it. Returns its id. */
async function createArea(existingIds: string[]): Promise<string | null> {
  let area_id: string | null = null;

  await showModal({
    title: 'New area',
    body: `
      <div class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">area_id</legend>
          <input id="new-area-id" type="text" class="input input-bordered w-full" autocomplete="off" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">area_name</legend>
          <input id="new-area-name" type="text" class="input input-bordered w-full" autocomplete="off" />
        </fieldset>
      </div>
    `,
    actions: [
      {
        label: 'Create',
        className: 'btn-primary',
        onClick: async () => {
          const id = (
            document.getElementById('new-area-id') as HTMLInputElement
          ).value.trim();
          const name = (
            document.getElementById('new-area-name') as HTMLInputElement
          ).value.trim();
          if (id === '') {
            notify.error('area_id cannot be empty');
            return true;
          }
          if (existingIds.includes(id)) {
            notify.error(`Area "${id}" already exists`);
            return true;
          }
          const record = { area_id: id, area_name: name };
          await deps?.gtfsDatabase.insertRows('areas', [record]);
          await deps?.patchManager?.recordInsert('areas', id, record);
          console.log(`[Areas] created ${id}`);
          area_id = id;
          return false;
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    enterAction: 0,
    escapeAction: 1,
    onMount: () => document.getElementById('new-area-id')?.focus(),
  });

  return area_id;
}
