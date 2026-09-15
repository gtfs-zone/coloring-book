import { showModal } from 'interlocking/modules/modal-utils';
import {
  renderEditableTable,
  installEditableTableHandlers,
  uninstallEditableTableHandlers,
  type EditableTableConfig,
  type EditableTableJoinColumn,
} from './editable-table';
import type { OptionPickerItem } from './option-picker-modal';
import type { GTFSDatabase } from './gtfs-database';
import type { PatchManager } from './patch-manager';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display';
import { specStoreName } from '../utils/spec-field-edit';
import { GTFS_TABLES } from '../types/gtfs';

const INSTANCE_ID = 'levels';
const STOPS_STORE = specStoreName(GTFS_TABLES.STOPS);

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
   * The stops sitting on each level, and the writer that reassigns them.
   *
   * `stops.level_id` is a plain foreign key rather than a join table, so this
   * is not `memberJoinColumn`'s shape: picking a stop writes the column on the
   * stop, and unpicking one clears it. Built per refresh, since it reads stops.
   */
  private async stopsColumn(): Promise<EditableTableJoinColumn> {
    const stops = (await this.db.getAllRows(STOPS_STORE)) as Record<
      string,
      unknown
    >[];

    const byLevel = new Map<string, { value: string; label: string }[]>();
    for (const stop of stops) {
      const level_id = String(stop.level_id ?? '');
      if (level_id === '') {
        continue;
      }
      const list = byLevel.get(level_id) ?? [];
      list.push({
        value: String(stop.stop_id ?? ''),
        label: renderOptionLabel(
          getStopDisplay(stop as Record<string, string>)
        ),
      });
      byLevel.set(level_id, list);
    }

    const options: OptionPickerItem[] = stops.map((stop) => ({
      value: String(stop.stop_id ?? ''),
      primary: renderOptionLabel(
        getStopDisplay(stop as Record<string, string>)
      ),
      secondary: String(stop.stop_id ?? ''),
    }));

    return {
      label: 'Used by',
      spec: { tableName: GTFS_TABLES.STOPS, field: 'level_id' },
      // A copy: the picker appends dangling values to what it is handed.
      options: async () => options.slice(),
      values: (row) => byLevel.get(String(row.level_id ?? '')) ?? [],
      apply: async (row, picked) => {
        const level_id = String(row.level_id ?? '');
        const current = new Set(
          (byLevel.get(level_id) ?? []).map((s) => s.value)
        );
        const wanted = new Set(picked.filter((value) => value !== ''));
        const removed = [...current].filter((value) => !wanted.has(value));
        const added = [...wanted].filter((value) => !current.has(value));
        if (removed.length === 0 && added.length === 0) {
          return;
        }

        const ops = [
          ...removed.map((stop_id) => ({
            op: 'update' as const,
            table: STOPS_STORE,
            id: stop_id,
            before: { level_id },
            after: { level_id: '' },
          })),
          ...added.map((stop_id) => ({
            op: 'update' as const,
            table: STOPS_STORE,
            id: stop_id,
            before: {
              level_id: String(
                stops.find((s) => String(s.stop_id) === stop_id)?.level_id ?? ''
              ),
            },
            after: { level_id },
          })),
        ];

        console.log(
          `[LevelsController] stops on ${level_id} (-${removed.length} +${added.length})`
        );
        for (const op of ops) {
          await this.db.updateRow(op.table, op.id, op.after);
        }
        await this.patchManager?.recordBatchMixed(
          ops,
          `Edit stops on level ${level_id}`
        );
      },
    };
  }

  async showLevelsModal(): Promise<void> {
    if (!this.patchManager) {
      throw new Error('[LevelsController] patch manager not set');
    }

    const config: EditableTableConfig = {
      instanceId: INSTANCE_ID,
      tableName: GTFS_TABLES.LEVELS,
      rows: [],
      deps: { gtfsDatabase: this.db, patchManager: this.patchManager },
      emptyMessage:
        'No levels yet. A level is a floor of a station, named by <code>stops.level_id</code> and used by pathways.',
      columnOverrides: {
        // Set once from the new row, then fixed: renaming a level would strand
        // every stops.level_id and pathway that names it. Delete and re-add to
        // change one.
        level_id: { readonly: true, widthClass: 'min-w-64' },
      },
      onInsert: () => void refresh(),
      onRowsChanged: () => void refresh(),
      onDelete: () => void refresh(),
    };

    const refresh = async (): Promise<void> => {
      const panel = document.getElementById('levels-panel');
      if (!panel) {
        return;
      }
      config.joinColumns = [await this.stopsColumn()];
      const rows = await this.db.getAllRows(specStoreName(GTFS_TABLES.LEVELS));
      // Floors read bottom-up; a level with no index sorts last.
      config.rows = rows.sort((a, b) => {
        const ai = Number(a.level_index ?? NaN);
        const bi = Number(b.level_index ?? NaN);
        if (!Number.isFinite(ai)) {
          return Number.isFinite(bi) ? 1 : 0;
        }
        if (!Number.isFinite(bi)) {
          return -1;
        }
        return ai - bi;
      });
      panel.innerHTML = await renderEditableTable(config);
    };

    installEditableTableHandlers(config);

    await showModal({
      title: 'Levels',
      body: `<div id="levels-panel"></div>`,
      escapeAction: 0,
      actions: [{ label: 'Close', onClick: () => {} }],
      onMount: () => void refresh(),
    });

    uninstallEditableTableHandlers(INSTANCE_ID);
  }
}
