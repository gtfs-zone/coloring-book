/**
 * Spec-driven editable table.
 *
 * Renders any GTFS table straight from `src/gtfs-spec/`: columns, tooltips,
 * cell editors, validation and foreign-key pickers all come from the field
 * specs, so a new table is a few lines of configuration rather than a bespoke
 * renderer plus a bespoke add/edit modal.
 *
 * Editing follows the same contract as the timetable (see `utils/inline-edit`):
 * a display span is swapped for a live input, blur commits, Escape cancels,
 * and one editor is live at a time. Every mutation writes the database and
 * records a patch, so edits are undoable.
 *
 * Usage: build one config object per table instance, keep it, and re-assign
 * `config.rows` before each re-render. The delegated click handlers hold that
 * same object, so they always see the rows the user is looking at.
 */

import { showModal, renderTrashIcon } from './modal-utils.js';
import {
  showMultiOptionPickerModal,
  showOptionPickerModal,
  type OptionPickerItem,
} from './option-picker-modal.js';
import { notify } from './notification-system.js';
import { escapeHtml } from '../utils/escape-html.js';
import { openInlineEditor, openInlineMenu } from '../utils/inline-edit.js';
import {
  generateCompositeKeyFromRecord,
  getGTFSPrimaryKey,
} from '../utils/gtfs-primary-keys.js';
import { patchUpdate } from '../utils/patch-utils.js';
import {
  generateFieldConfigsFromSchema,
  renderFieldLabelContent,
  type FieldConfig,
} from '../utils/field-component.js';
import {
  buildForeignKeyOptions,
  coerceFieldValue,
  formatSpecValue,
  specFieldKind,
  specStoreName,
  validateFieldValue,
  type SpecFieldKind,
} from '../utils/spec-field-edit.js';
import { GTFSSchemas, GTFS_FIELD_SPECS } from '../types/gtfs.js';
import type { GTFSFieldSpec } from '../gtfs-spec/types.js';
import type { z } from 'zod';

export interface EditableTableDatabase {
  getAllRows(tableName: string): Promise<Record<string, unknown>[]>;
  insertRows(tableName: string, rows: Record<string, unknown>[]): Promise<void>;
  updateRow(
    tableName: string,
    key: string,
    data: Record<string, unknown>
  ): Promise<void>;
  deleteRow(tableName: string, key: string): Promise<void>;
}

export interface EditableTablePatchManager {
  recordInsert(
    table: string,
    id: string,
    record: Record<string, unknown>
  ): Promise<void>;
  recordUpdate(
    table: string,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): Promise<void>;
  recordDelete(
    table: string,
    id: string,
    record: Record<string, unknown>
  ): Promise<void>;
  recordBatchMixed(
    ops: Array<
      | {
          op: 'insert';
          table: string;
          id: string;
          record: Record<string, unknown>;
        }
      | {
          op: 'delete';
          table: string;
          id: string;
          record: Record<string, unknown>;
        }
      | {
          op: 'update';
          table: string;
          id: string;
          before: Record<string, unknown>;
          after: Record<string, unknown>;
        }
    >,
    label?: string
  ): Promise<void>;
}

export interface EditableTableDeps {
  gtfsDatabase: EditableTableDatabase;
  patchManager: EditableTablePatchManager;
}

export interface EditableTableColumnOverride {
  /** Column header text, replacing the spec-derived label. */
  label?: string;
  /** Cells render as plain text, with no editor. */
  readonly?: boolean;
  /** Plain-text cell display, replacing the spec-derived formatting. */
  format?: (value: unknown, row: Record<string, unknown>) => string;
  /** Picker options, replacing the ones derived from the field's foreignKey. */
  options?: () => Promise<OptionPickerItem[]>;
  /**
   * Autocomplete values for a free-text column, for ID fields that are not
   * foreign keys but where existing values are usually what is wanted.
   */
  suggestions?: () => Promise<string[]>;
  /**
   * Collapse rows that differ only in this column into one row, listing every
   * distinct value here newline-separated. For composite keys whose repeated
   * member is the only thing that varies (a fare product sold on three media),
   * so the table shows one product rather than three near-identical rows.
   *
   * A list cell opens a multi-select, and committing it reconciles the rows
   * behind the collapsed row to the selection: adding a value inserts the rows
   * it implies, removing one deletes them. The rest of a collapsed row stays
   * editable, and an edit or a delete there applies to every row behind it.
   */
  list?: boolean;
}

/**
 * A column of values that live in a join table rather than on the row.
 *
 * Row grouping cannot produce these: an area's stops are `stop_areas` rows, not
 * a column of `areas`. The table renders and picks; the host owns the write, so
 * nothing here needs to know the join table's shape.
 */
export interface EditableTableJoinColumn {
  label: string;
  /** The row's current members, already labelled for display. */
  values: (row: Record<string, unknown>) => { value: string; label: string }[];
  options: () => Promise<OptionPickerItem[]>;
  /** Persist the new membership. The host writes and re-renders. */
  apply: (row: Record<string, unknown>, values: string[]) => Promise<void>;
}

export interface EditableTableConfig {
  /** Distinguishes this table's cells from any other instance on the page. */
  instanceId: string;
  /** GTFS table name including extension, e.g. `fare_products.txt`. */
  tableName: string;
  /** Columns to show, in order. Defaults to every field, in spec order. */
  fields?: string[];
  /** Rows as last rendered. Re-assign before each re-render. */
  rows: Record<string, unknown>[];
  /** Row key, defaulting to the table's spec primary key. */
  primaryKey?: (row: Record<string, unknown>) => string;
  columnOverrides?: Record<string, EditableTableColumnOverride>;
  /**
   * Columns appended after the spec columns, for members named by a join table
   * (an area's stops) rather than stored on the row.
   */
  joinColumns?: EditableTableJoinColumn[];
  deps: EditableTableDeps;
  /**
   * Shown in place of the rows when the table is empty. Trusted markup: it is
   * either literal copy or a rendered spec description, never user input.
   */
  emptyMessage?: string;
  /**
   * Cross-field check on the whole record, run once the row is complete and
   * just before it is written. Per-field validation comes from the spec; this
   * is for the conditional rules that span fields, such as a timeframe needing
   * both of its times or neither. Returns an error message, or null to allow.
   */
  validateRow?: (row: Record<string, unknown>) => string | null;
  /**
   * Post-write hooks. The write and its patch have already landed by the time
   * these run; they exist so the host can re-render and refresh row counts.
   */
  onInsert?: (key: string, record: Record<string, unknown>) => void;
  onUpdate?: (key: string, record: Record<string, unknown>) => void;
  onDelete?: (key: string) => void;
  /**
   * A list or join column changed which rows exist. Cell displays are patched
   * in place elsewhere, but this cannot be: the host has to re-render.
   */
  onRowsChanged?: () => void;
}

interface EditableTableInstance {
  config: EditableTableConfig;
  /** Values typed into the trailing blank row, not yet written. */
  pending: Record<string, string>;
}

const instances = new Map<string, EditableTableInstance>();
let listenerInstalled = false;

// ─── Spec lookups ─────────────────────────────────────────────────────────────

function fieldSpecs(tableName: string): Record<string, GTFSFieldSpec> {
  const specs = GTFS_FIELD_SPECS[tableName];
  if (!specs) {
    throw new Error(`[EditableTable] no spec for table ${tableName}`);
  }
  return specs;
}

function columnFields(config: EditableTableConfig): string[] {
  return config.fields ?? Object.keys(fieldSpecs(config.tableName));
}

function rowKey(
  config: EditableTableConfig,
  row: Record<string, unknown>
): string {
  if (config.primaryKey) {
    return config.primaryKey(row);
  }
  return generateCompositeKeyFromRecord(specStoreName(config.tableName), row);
}

/**
 * Whether editing this field re-keys the row.
 *
 * `all_fields` tables key on their whole content, so every field re-keys.
 */
function isKeyField(tableName: string, field: string): boolean {
  const pk = getGTFSPrimaryKey(specStoreName(tableName));
  if (!pk) {
    return false;
  }
  return pk.type === 'all_fields' || pk.fields.includes(field);
}

// ─── Row grouping ─────────────────────────────────────────────────────────────

/**
 * One visual row: a single record, or several that a list column collapsed.
 *
 * Groups are recomputed from `config.rows` wherever they are needed rather
 * than being cached, so they always describe the rows the user is looking at.
 */
interface RowGroup {
  /** Key of the first row, standing in for the group in the DOM. */
  key: string;
  keys: string[];
  rows: Record<string, unknown>[];
}

function listFields(config: EditableTableConfig): string[] {
  return columnFields(config).filter(
    (field) => config.columnOverrides?.[field]?.list
  );
}

/** Every combination of one value from each set, in set order. */
function combinations(sets: string[][]): string[][] {
  return sets.reduce<string[][]>(
    (acc, values) => acc.flatMap((prefix) => values.map((v) => [...prefix, v])),
    [[]]
  );
}

/**
 * Split rows that share their non-list columns into blocks whose list values
 * form a complete set of combinations.
 *
 * With one list column that is always the whole set of rows. With two or more,
 * a block only collapses when every pairing of its listed values is actually
 * present, so a reader can take any value from one list column together with
 * any value from another and know that row exists. Rows that do not complete a
 * combination stay in a block of their own.
 */
function crossProductBlocks(
  rows: Record<string, unknown>[],
  lists: string[]
): Record<string, unknown>[][] {
  if (lists.length < 2) {
    return [rows];
  }

  // Keyed by list values only: rows the rendered columns cannot tell apart
  // share an entry, and stay together in whichever block that entry lands in.
  const comboKey = (values: string[]) => JSON.stringify(values);
  const remaining = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = comboKey(lists.map((field) => String(row[field] ?? '')));
    const existing = remaining.get(key);
    if (existing) {
      existing.push(row);
      continue;
    }
    remaining.set(key, [row]);
  }

  const blocks: Record<string, unknown>[][] = [];
  while (remaining.size > 0) {
    const seed = remaining.keys().next().value as string;
    const sets = (JSON.parse(seed) as string[]).map((value) => [value]);
    // Grow one value at a time, keeping every combination present.
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < lists.length; i++) {
        const candidates = new Set<string>();
        for (const key of remaining.keys()) {
          const values = JSON.parse(key) as string[];
          if (!sets[i].includes(values[i])) {
            candidates.add(values[i]);
          }
        }
        for (const candidate of candidates) {
          const trial = sets.map((set, j) => (j === i ? [candidate] : set));
          if (combinations(trial).every((c) => remaining.has(comboKey(c)))) {
            sets[i].push(candidate);
            grew = true;
          }
        }
      }
    }
    const keys = combinations(sets).map(comboKey);
    blocks.push(keys.flatMap((key) => remaining.get(key)!));
    for (const key of keys) {
      remaining.delete(key);
    }
  }
  return blocks;
}

/**
 * Collapse rows that are identical across every non-list column.
 *
 * With no list columns each row is its own group, which renders exactly as the
 * plain one-row-per-record table it was before.
 */
function groupRows(config: EditableTableConfig): RowGroup[] {
  const lists = listFields(config);
  if (lists.length === 0) {
    return config.rows.map((row) => ({
      key: rowKey(config, row),
      keys: [rowKey(config, row)],
      rows: [row],
    }));
  }

  const listSet = new Set(lists);
  const shared = columnFields(config).filter((field) => !listSet.has(field));
  const candidates: Record<string, unknown>[][] = [];
  const byValues = new Map<string, Record<string, unknown>[]>();
  for (const row of config.rows) {
    const groupKey = JSON.stringify(shared.map((field) => row[field] ?? ''));
    const existing = byValues.get(groupKey);
    if (existing) {
      existing.push(row);
      continue;
    }
    const candidate = [row];
    byValues.set(groupKey, candidate);
    candidates.push(candidate);
  }

  return candidates.flatMap((candidate) =>
    crossProductBlocks(candidate, lists).map((rows) => ({
      key: rowKey(config, rows[0]),
      keys: rows.map((row) => rowKey(config, row)),
      rows,
    }))
  );
}

/** The group a cell or delete button's key belongs to. */
function findGroup(
  config: EditableTableConfig,
  key: string
): RowGroup | undefined {
  return groupRows(config).find((group) => group.keys.includes(key));
}

// ─── Foreign key options ──────────────────────────────────────────────────────

/** The field's picker options, or the column's override where one is given. */
async function foreignOptions(
  config: EditableTableConfig,
  field: string,
  spec: GTFSFieldSpec
): Promise<OptionPickerItem[]> {
  const override = config.columnOverrides?.[field]?.options;
  if (override) {
    return override();
  }
  return buildForeignKeyOptions(config.deps.gtfsDatabase, spec);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Prefetch the id -> label map for every foreign-ID column, so cells can show
 * "Adult (adult)" instead of a bare id.
 */
async function foreignLabelMaps(
  config: EditableTableConfig
): Promise<Map<string, Map<string, string>>> {
  const specs = fieldSpecs(config.tableName);
  const maps = new Map<string, Map<string, string>>();
  for (const field of columnFields(config)) {
    const spec = specs[field];
    if (!spec || specFieldKind(spec) !== 'foreign') {
      continue;
    }
    const options = await foreignOptions(config, field, spec);
    maps.set(field, new Map(options.map((o) => [o.value, o.primary])));
  }
  return maps;
}

/** A cell's display text: the column's own formatter, or the spec's. */
function cellText(
  config: EditableTableConfig,
  field: string,
  spec: GTFSFieldSpec,
  row: Record<string, unknown>,
  foreignLabels: Map<string, string> | undefined
): string {
  const override = config.columnOverrides?.[field];
  return override?.format
    ? override.format(row[field], row)
    : formatSpecValue(spec, specFieldKind(spec), row[field], foreignLabels);
}

/** Labels shown in a list cell before it stops and counts the rest. */
const LIST_CELL_MAX = 8;

/**
 * A list of values, one per line, capped so a long list cannot take the row
 * over. The full set is always in the picker the cell opens.
 */
function renderListValues(labels: string[]): string {
  if (labels.length === 0) {
    return '-';
  }
  const shown = labels.slice(0, LIST_CELL_MAX);
  const hidden = labels.length - shown.length;
  const text = hidden > 0 ? [...shown, `+${hidden} more`] : shown;
  return escapeHtml(text.join('\n'));
}

/** The distinct raw values of a list column across a group, in row order. */
function listValues(group: RowGroup, field: string): string[] {
  const seen = new Set<string>();
  for (const row of group.rows) {
    seen.add(
      row[field] === undefined || row[field] === null ? '' : String(row[field])
    );
  }
  return [...seen];
}

/**
 * A list column's cell: every distinct value in the group, one per line.
 *
 * Not truncated the way a single-value cell is: a clipped list would hide
 * values with no sign that it had. Clicking it opens a multi-select over the
 * column's options.
 */
function renderListCell(
  config: EditableTableConfig,
  field: string,
  spec: GTFSFieldSpec,
  group: RowGroup,
  foreignLabels: Map<string, string> | undefined
): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of group.rows) {
    const text = cellText(config, field, spec, row, foreignLabels);
    if (text === '' || seen.has(text)) {
      continue;
    }
    seen.add(text);
    labels.push(text);
  }
  return `<td class="align-middle p-1">
    <span
      class="editable-cell inline-block min-w-8 max-w-full cursor-pointer whitespace-pre-line rounded px-1 hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      tabindex="0"
      data-et="${escapeHtml(config.instanceId)}"
      data-key="${escapeHtml(group.key)}"
      data-field="${escapeHtml(field)}"
      data-kind="${specFieldKind(spec)}"
      data-list="1"
      data-values="${escapeHtml(JSON.stringify(listValues(group, field)))}"
    >${renderListValues(labels)}</span>
  </td>`;
}

/** A join column's cell: the row's members, picked from the join's options. */
function renderJoinCell(
  config: EditableTableConfig,
  column: EditableTableJoinColumn,
  index: number,
  row: Record<string, unknown>,
  key: string
): string {
  const members = column.values(row);
  return `<td class="align-middle p-1">
    <span
      class="editable-cell inline-block min-w-8 max-w-full cursor-pointer whitespace-pre-line rounded px-1 hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      tabindex="0"
      data-et="${escapeHtml(config.instanceId)}"
      data-key="${escapeHtml(key)}"
      data-join="${index}"
      data-values="${escapeHtml(JSON.stringify(members.map((m) => m.value)))}"
    >${renderListValues(members.map((m) => m.label))}</span>
  </td>`;
}

function renderCell(
  config: EditableTableConfig,
  field: string,
  spec: GTFSFieldSpec,
  row: Record<string, unknown>,
  key: string,
  foreignLabels: Map<string, string> | undefined
): string {
  const override = config.columnOverrides?.[field];
  const kind = specFieldKind(spec);
  const raw =
    row[field] === undefined || row[field] === null ? '' : String(row[field]);
  const text = cellText(config, field, spec, row, foreignLabels);

  if (override?.readonly) {
    return `<td class="align-middle">${escapeHtml(text) || '-'}</td>`;
  }

  return `<td class="align-middle p-1">
    <span
      class="editable-cell inline-block min-w-8 max-w-full truncate cursor-pointer rounded px-1 hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      tabindex="0"
      data-et="${escapeHtml(config.instanceId)}"
      data-key="${escapeHtml(key)}"
      data-field="${escapeHtml(field)}"
      data-kind="${kind}"
      data-value="${escapeHtml(raw)}"
    >${escapeHtml(text) || '-'}</span>
  </td>`;
}

/**
 * Render the table's HTML.
 *
 * Async because foreign-ID columns are shown by label, which means reading the
 * referenced tables.
 */
export async function renderEditableTable(
  config: EditableTableConfig
): Promise<string> {
  const specs = fieldSpecs(config.tableName);
  const fields = columnFields(config);
  const labels = await foreignLabelMaps(config);

  const schema = GTFSSchemas[
    config.tableName as keyof typeof GTFSSchemas
  ] as z.ZodObject<z.ZodRawShape>;
  const configsByField = new Map<string, FieldConfig>(
    generateFieldConfigsFromSchema(schema, {}, config.tableName).map((c) => [
      c.field,
      c,
    ])
  );

  const headerHtml = fields
    .map((field) => {
      const override = config.columnOverrides?.[field];
      const fieldConfig = configsByField.get(field);
      if (!fieldConfig) {
        return `<th>${escapeHtml(override?.label ?? field)}</th>`;
      }
      return `<th class="align-bottom">${renderFieldLabelContent(
        override?.label
          ? { ...fieldConfig, label: override.label }
          : fieldConfig
      )}</th>`;
    })
    .join('');

  const joinColumns = config.joinColumns ?? [];
  const joinHeaderHtml = joinColumns
    .map(
      (column) => `<th class="align-bottom">${escapeHtml(column.label)}</th>`
    )
    .join('');

  const groups = groupRows(config);
  const bodyHtml = groups
    .map((group) => {
      const { key } = group;
      const row = group.rows[0];
      const cells = fields
        .map((field) => {
          const spec = specs[field];
          if (!spec) {
            throw new Error(
              `[EditableTable] ${config.tableName} has no field ${field}`
            );
          }
          if (config.columnOverrides?.[field]?.list) {
            return renderListCell(
              config,
              field,
              spec,
              group,
              labels.get(field)
            );
          }
          return renderCell(config, field, spec, row, key, labels.get(field));
        })
        .join('');
      const joinCells = joinColumns
        .map((column, i) => renderJoinCell(config, column, i, row, key))
        .join('');
      const deleteTitle =
        group.rows.length > 1
          ? `Delete ${group.rows.length} rows`
          : 'Delete row';
      return `<tr data-et-row="${escapeHtml(key)}">${cells}${joinCells}<td class="align-middle w-8">
        <button class="editable-table-delete btn btn-xs btn-ghost text-error" data-et="${escapeHtml(config.instanceId)}" data-key="${escapeHtml(key)}" title="${escapeHtml(deleteTitle)}">${renderTrashIcon('h-3.5 w-3.5')}</button>
      </td></tr>`;
    })
    .join('');

  const emptyHtml =
    config.rows.length === 0 && config.emptyMessage
      ? `<tr><td colspan="${fields.length + joinColumns.length + 1}" class="text-base-content/60 py-4">${config.emptyMessage}</td></tr>`
      : '';

  // The trailing blank row is how rows are added: typing into any of its cells
  // starts a record, and it is written as soon as every required field is set.
  const newRowCells = fields
    .map(
      (field) =>
        `<td class="align-middle p-1">
          <span
            class="editable-cell inline-block min-w-8 max-w-full truncate cursor-pointer rounded px-1 text-base-content/40 hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            tabindex="0"
            data-et="${escapeHtml(config.instanceId)}"
            data-key=""
            data-field="${escapeHtml(field)}"
            data-kind="${specFieldKind(specs[field])}"
            data-value=""
          >+</span>
        </td>`
    )
    .join('');

  return `
    <div class="overflow-x-auto">
      <table class="table table-xs">
        <thead><tr>${headerHtml}${joinHeaderHtml}<th></th></tr></thead>
        <tbody>${emptyHtml}${bodyHtml}<tr class="editable-table-new-row">${newRowCells}${joinColumns.map(() => '<td></td>').join('')}<td></td></tr></tbody>
      </table>
    </div>
  `;
}

// ─── Editing ──────────────────────────────────────────────────────────────────

/**
 * Register a table's config and make sure the delegated listeners exist.
 *
 * The listeners are bound to `document` once for all instances: the containers
 * these tables live in have their `innerHTML` replaced wholesale on every
 * refresh, which would silently drop a container-bound listener.
 */
export function installEditableTableHandlers(
  config: EditableTableConfig
): void {
  instances.set(config.instanceId, { config, pending: {} });

  if (listenerInstalled) {
    return;
  }
  listenerInstalled = true;

  document.addEventListener('click', (e) => {
    const cell = (e.target as Element)?.closest?.('.editable-cell');
    if (cell instanceof HTMLElement) {
      openCellEditor(cell);
      return;
    }
    const deleteBtn = (e.target as Element)?.closest?.(
      '.editable-table-delete'
    );
    if (deleteBtn instanceof HTMLElement) {
      void deleteRow(deleteBtn);
    }
  });

  // Cells are focusable, so they must open on Enter and Space too, not only
  // on a click.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') {
      return;
    }
    const cell = (e.target as Element)?.closest?.('.editable-cell');
    if (cell instanceof HTMLElement) {
      e.preventDefault();
      openCellEditor(cell);
    }
  });
}

/** Drop an instance's state, e.g. when its modal closes. */
export function uninstallEditableTableHandlers(instanceId: string): void {
  instances.delete(instanceId);
}

function resolve(
  span: HTMLElement
): { state: EditableTableInstance; spec: GTFSFieldSpec; field: string } | null {
  const { et, field } = span.dataset;
  if (!et || !field) {
    return null;
  }
  const state = instances.get(et);
  if (!state) {
    console.warn(`[EditableTable] no registered instance ${et}`);
    return null;
  }
  const spec = fieldSpecs(state.config.tableName)[field];
  if (!spec) {
    return null;
  }
  return { state, spec, field };
}

/** The values a list or join cell carries, as written by its renderer. */
function cellValues(span: HTMLElement): string[] {
  const raw = span.dataset.values;
  if (!raw) {
    return [];
  }
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
}

function openCellEditor(span: HTMLElement): void {
  if (span.dataset.join !== undefined) {
    void openJoinEditor(span);
    return;
  }

  const resolved = resolve(span);
  if (!resolved) {
    return;
  }
  const { state, spec, field } = resolved;
  const current = span.dataset.value ?? '';

  // A list cell stands for every row behind it, so it picks a set rather than
  // a value, and committing reconciles those rows to what was picked.
  if (span.dataset.list === '1') {
    void (async () => {
      const selected = cellValues(span).filter((value) => value !== '');
      const options = await foreignOptions(state.config, field, spec);
      for (const value of selected) {
        if (!options.some((o) => o.value === value)) {
          options.push({ value, primary: `${value} (dangling reference)` });
        }
      }
      const picked = await showMultiOptionPickerModal({
        title: `Select ${field}`,
        options,
        selectedValues: selected,
        searchable: true,
        emptyOption: {
          label: 'Leave blank',
          hint: 'matches everything',
        },
      });
      if (picked !== null) {
        await commitListCell(state, span, field, spec, picked);
      }
    })();
    return;
  }

  if (span.dataset.kind === 'enum') {
    openInlineMenu(span, {
      currentValue: current,
      options: [
        { value: '', label: '-' },
        ...(spec.enumValues ?? []).map((v) => ({
          value: String(v.value),
          label: `${v.value} - ${v.label}`,
        })),
      ],
      onPick: (value) => void commitCell(state, span, field, spec, value),
    });
    return;
  }

  if (span.dataset.kind === 'foreign') {
    void (async () => {
      const options = await foreignOptions(state.config, field, spec);
      // A value that no longer resolves is offered back, so the picker cannot
      // silently blank a dangling reference the user did not touch.
      if (current && !options.some((o) => o.value === current)) {
        options.push({
          value: current,
          primary: `${current} (dangling reference)`,
        });
      }
      const picked = await showOptionPickerModal({
        title: `Select ${field}`,
        options: [{ value: '', primary: '- none -' }, ...options],
        selectedValue: current,
        searchable: true,
      });
      if (picked !== null && picked !== current) {
        await commitCell(state, span, field, spec, picked);
      }
    })();
    return;
  }

  const suggest = state.config.columnOverrides?.[field]?.suggestions;
  if (suggest) {
    void (async () => {
      const suggestions = await suggest();
      openInlineEditor(span, {
        value: current,
        className: 'w-full',
        suggestions,
        onCommit: (value) => void commitCell(state, span, field, spec, value),
      });
    })();
    return;
  }

  openInlineEditor(span, {
    value: current,
    inputType: span.dataset.kind === 'number' ? 'number' : 'text',
    className: 'w-full',
    onCommit: (value) => void commitCell(state, span, field, spec, value),
  });
}

/**
 * A join column's cell: pick the row's members, then hand them to the host.
 *
 * No write happens here. The join table's shape belongs to whoever configured
 * the column, and their `apply` is expected to re-render the table.
 */
async function openJoinEditor(span: HTMLElement): Promise<void> {
  const { et, join, key } = span.dataset;
  if (!et || join === undefined) {
    return;
  }
  const state = instances.get(et);
  if (!state) {
    console.warn(`[EditableTable] no registered instance ${et}`);
    return;
  }
  const column = state.config.joinColumns?.[Number(join)];
  if (!column) {
    console.warn(`[EditableTable] no join column ${join}`);
    return;
  }
  const row = state.config.rows.find(
    (r) => rowKey(state.config, r) === (key ?? '')
  );
  if (!row) {
    console.warn(`[EditableTable] row ${key} is gone`);
    return;
  }

  const selected = cellValues(span);
  const options = await column.options();
  for (const value of selected) {
    if (!options.some((o) => o.value === value)) {
      options.push({ value, primary: `${value} (dangling reference)` });
    }
  }
  const picked = await showMultiOptionPickerModal({
    title: `Select ${column.label}`,
    options,
    selectedValues: selected,
    searchable: true,
  });
  if (picked === null) {
    return;
  }
  await column.apply(row, picked);
  // The members live outside this table's rows, so the host re-reads them.
  state.config.onRowsChanged?.();
}

function markCellError(span: HTMLElement, message: string): void {
  span.classList.add('text-error', 'underline', 'decoration-error');
  span.title = message;
  notify.error(message, { duration: 4000 });
}

function clearCellError(span: HTMLElement): void {
  span.classList.remove('text-error', 'underline', 'decoration-error');
  span.removeAttribute('title');
}

/**
 * Validate a committed cell value and route it to an insert or an update.
 *
 * On a validation failure the cell keeps its pre-edit value: nothing is
 * written, so reverting the display is the honest thing to show.
 */
async function commitCell(
  state: EditableTableInstance,
  span: HTMLElement,
  field: string,
  spec: GTFSFieldSpec,
  raw: string
): Promise<void> {
  const coerced = coerceFieldValue(spec, raw);
  if ('error' in coerced) {
    markCellError(span, coerced.error);
    return;
  }

  // Requiredness on the blank row is checked once the whole record is
  // assembled, so a half-filled row is not an error yet.
  const isNewRow = (span.dataset.key ?? '') === '';
  const error =
    isNewRow && coerced.value === ''
      ? null
      : validateFieldValue(state.config.tableName, field, spec, coerced.value);

  if (error) {
    markCellError(span, error);
    return;
  }

  // An existing row is complete by definition, so its cross-field rules are
  // checked here, before the display moves on to the new value. The blank row
  // is checked in `commitNewRow`, once it has everything it needs.
  if (!isNewRow) {
    const key = span.dataset.key ?? '';
    const before = state.config.rows.find(
      (r) => rowKey(state.config, r) === key
    );
    const rowError = before
      ? state.config.validateRow?.({ ...before, [field]: coerced.value })
      : null;
    if (rowError) {
      markCellError(span, rowError);
      return;
    }
  }

  clearCellError(span);
  setCellDisplay(span, spec, coerced.value);

  if (isNewRow) {
    await commitNewRow(state, span, field, coerced.value);
  } else {
    await commitUpdate(state, span, field, coerced.value);
  }
}

/** Reflect a committed value in the span, without waiting for a re-render. */
function setCellDisplay(
  span: HTMLElement,
  spec: GTFSFieldSpec,
  value: string | number
): void {
  span.dataset.value = value === '' ? '' : String(value);
  const kind = (span.dataset.kind ?? 'text') as SpecFieldKind;
  const label = formatSpecValue(spec, kind, value, undefined);
  span.textContent = label || (span.dataset.key === '' ? '+' : '-');
  if (label) {
    span.classList.remove('text-base-content/40');
  }
}

async function commitUpdate(
  state: EditableTableInstance,
  span: HTMLElement,
  field: string,
  value: string | number
): Promise<void> {
  const { config } = state;
  const key = span.dataset.key ?? '';
  const table = specStoreName(config.tableName);
  // A collapsed row is edited as one row: the write covers every record behind
  // it, in a single patch, so it undoes as one step too.
  const group = findGroup(config, key);
  if (!group) {
    console.warn(`[EditableTable] row ${key} is gone from ${table}`);
    return;
  }

  const edits = group.rows.map((before, i) => ({
    key: group.keys[i],
    before,
    after: { ...before, [field]: value },
  }));

  if (!isKeyField(config.tableName, field)) {
    console.log(
      `[EditableTable] update ${table} ${key}.${field} (${edits.length} row(s))`
    );
    if (edits.length === 1) {
      await patchUpdate(
        config.deps.gtfsDatabase,
        config.deps.patchManager,
        table,
        key,
        { [field]: edits[0].before[field] ?? '' },
        { [field]: value }
      );
    } else {
      for (const edit of edits) {
        await config.deps.gtfsDatabase.updateRow(table, edit.key, {
          [field]: value,
        });
      }
      await config.deps.patchManager.recordBatchMixed(
        edits.map((edit) => ({
          op: 'update' as const,
          table,
          id: edit.key,
          before: { [field]: edit.before[field] ?? '' },
          after: { [field]: value },
        })),
        `Edit ${field} on ${table}`
      );
    }
    edits.forEach((edit) => replaceRow(config, edit.key, edit.after));
    config.onUpdate?.(key, edits[0].after);
    return;
  }

  // The edit changed the rows' identity, so it is a delete plus an insert
  // rather than an in-place write.
  const newKeys = edits.map((edit) => rowKey(config, edit.after));
  const groupKeys = new Set(group.keys);
  const taken = new Set(
    config.rows.map((r) => rowKey(config, r)).filter((k) => !groupKeys.has(k))
  );
  if (newKeys.some((newKey) => taken.has(newKey))) {
    markCellError(span, 'Another row already uses these key values');
    return;
  }

  console.log(
    `[EditableTable] rekey ${table} ${key} -> ${newKeys[0]} (${edits.length} row(s))`
  );
  // Every delete lands before any insert, so a key moving onto one that is
  // still occupied by another row of the same group cannot collide.
  for (const edit of edits) {
    await config.deps.gtfsDatabase.deleteRow(table, edit.key);
  }
  await config.deps.gtfsDatabase.insertRows(
    table,
    edits.map((edit) => edit.after)
  );
  await config.deps.patchManager.recordBatchMixed(
    [
      ...edits.map((edit) => ({
        op: 'delete' as const,
        table,
        id: edit.key,
        record: edit.before,
      })),
      ...edits.map((edit, i) => ({
        op: 'insert' as const,
        table,
        id: newKeys[i],
        record: edit.after,
      })),
    ],
    `Edit ${field} on ${table}`
  );
  edits.forEach((edit) => replaceRow(config, edit.key, edit.after));
  rekeyRowElement(span, newKeys[0]);
  config.onUpdate?.(newKeys[0], edits[0].after);
}

/**
 * Reconcile the rows behind a collapsed row to a list column's new selection.
 *
 * The displayed block is a complete cross product of its list columns (see
 * `crossProductBlocks`), so replacing one column's values means the block
 * becomes the cross product of the other columns with the new set. Rows that
 * survive keep their existing record, so fields the table does not render are
 * not lost; the rest are deleted and the new combinations inserted, all in one
 * patch so the edit undoes as one step.
 *
 * An empty selection means one blank value, which in the fare rules is the
 * "matches everything" row rather than no row at all.
 */
async function commitListCell(
  state: EditableTableInstance,
  span: HTMLElement,
  field: string,
  spec: GTFSFieldSpec,
  picked: string[]
): Promise<void> {
  const { config } = state;
  const table = specStoreName(config.tableName);
  const group = findGroup(config, span.dataset.key ?? '');
  if (!group) {
    console.warn(
      `[EditableTable] row ${span.dataset.key} is gone from ${table}`
    );
    return;
  }

  const values: (string | number)[] = [];
  for (const raw of picked.length === 0 ? [''] : picked) {
    const coerced = coerceFieldValue(spec, raw);
    if ('error' in coerced) {
      markCellError(span, coerced.error);
      return;
    }
    const error = validateFieldValue(
      config.tableName,
      field,
      spec,
      coerced.value
    );
    if (error) {
      markCellError(span, error);
      return;
    }
    values.push(coerced.value);
  }

  // The block's value sets, with this column's replaced by the selection.
  const lists = listFields(config);
  const sets = lists.map((listField) =>
    listField === field
      ? values.map((v) => String(v))
      : listValues(group, listField)
  );

  const byCombo = new Map<string, Record<string, unknown>>();
  for (const row of group.rows) {
    byCombo.set(JSON.stringify(lists.map((f) => String(row[f] ?? ''))), row);
  }

  // A displayed value is a string, but the stored one may be a number, so a
  // value carried over from another row is written back as that row stored it.
  const storedAs = new Map<string, unknown>();
  for (const row of group.rows) {
    for (const listField of lists) {
      storedAs.set(
        `${listField}\0${String(row[listField] ?? '')}`,
        row[listField]
      );
    }
  }
  for (const value of values) {
    storedAs.set(`${field}\0${String(value)}`, value);
  }

  const records = combinations(sets).map((combo) => {
    const record = { ...(byCombo.get(JSON.stringify(combo)) ?? group.rows[0]) };
    lists.forEach((listField, i) => {
      const stored = storedAs.get(`${listField}\0${combo[i]}`);
      record[listField] = stored === undefined ? combo[i] : stored;
    });
    return record;
  });

  for (const record of records) {
    const rowError = config.validateRow?.(record);
    if (rowError) {
      markCellError(span, rowError);
      return;
    }
  }

  const newKeys = records.map((record) => rowKey(config, record));
  const groupKeys = new Set(group.keys);
  const kept = new Set(newKeys.filter((key) => groupKeys.has(key)));
  const deletes = group.keys
    .map((key, i) => ({ key, record: group.rows[i] }))
    .filter((entry) => !kept.has(entry.key));
  const inserts = records
    .map((record, i) => ({ key: newKeys[i], record }))
    .filter((entry) => !groupKeys.has(entry.key));

  if (deletes.length === 0 && inserts.length === 0) {
    return;
  }

  const taken = new Set(
    config.rows.map((r) => rowKey(config, r)).filter((k) => !groupKeys.has(k))
  );
  if (inserts.some((entry) => taken.has(entry.key))) {
    markCellError(span, 'Another row already uses these key values');
    return;
  }

  clearCellError(span);
  console.log(
    `[EditableTable] list edit ${table} ${group.key}.${field} (-${deletes.length} +${inserts.length})`
  );
  for (const entry of deletes) {
    await config.deps.gtfsDatabase.deleteRow(table, entry.key);
  }
  if (inserts.length > 0) {
    await config.deps.gtfsDatabase.insertRows(
      table,
      inserts.map((entry) => entry.record)
    );
  }
  await config.deps.patchManager.recordBatchMixed(
    [
      ...deletes.map((entry) => ({
        op: 'delete' as const,
        table,
        id: entry.key,
        record: entry.record,
      })),
      ...inserts.map((entry) => ({
        op: 'insert' as const,
        table,
        id: entry.key,
        record: entry.record,
      })),
    ],
    `Edit ${field} on ${table}`
  );

  // The group gained or lost rows, so the display cannot be patched in place.
  config.onRowsChanged?.();
}

/**
 * Keep `config.rows` in step with a write, so the next edit of the same row
 * sees the value that was just committed.
 *
 * Cell displays are updated in place rather than by re-rendering the table:
 * a re-render on every commit would destroy the editor the user has already
 * moved on to opening.
 */
function replaceRow(
  config: EditableTableConfig,
  key: string,
  after: Record<string, unknown>
): void {
  const index = config.rows.findIndex((r) => rowKey(config, r) === key);
  if (index >= 0) {
    config.rows[index] = after;
  }
}

/** Point a re-keyed row's cells and delete button at its new key. */
function rekeyRowElement(span: HTMLElement, newKey: string): void {
  const row = span.closest('tr');
  row?.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    el.dataset.key = newKey;
  });
  if (row instanceof HTMLElement) {
    row.dataset.etRow = newKey;
  }
}

/**
 * Accumulate the blank row's values, and write the record once every required
 * field has one. Missing required fields are marked in place instead of
 * failing loudly: the user is still filling the row in.
 */
async function commitNewRow(
  state: EditableTableInstance,
  span: HTMLElement,
  field: string,
  value: string | number
): Promise<void> {
  const { config } = state;
  const table = specStoreName(config.tableName);

  if (value === '') {
    delete state.pending[field];
  } else {
    state.pending[field] = String(value);
  }

  if (Object.keys(state.pending).length === 0) {
    return;
  }

  const specs = fieldSpecs(config.tableName);
  const fields = columnFields(config);
  const missing = fields.filter(
    (f) => specs[f].presence === 'Required' && !state.pending[f]
  );

  const row = span.closest('tr');
  fields.forEach((f) => {
    const cell = row?.querySelector<HTMLElement>(`[data-field="${f}"]`);
    if (cell) {
      cell.classList.toggle('ring-1', missing.includes(f));
      cell.classList.toggle('ring-error', missing.includes(f));
    }
  });
  if (missing.length > 0) {
    return;
  }

  const record: Record<string, unknown> = {};
  for (const f of fields) {
    const pendingValue = state.pending[f];
    if (pendingValue === undefined) {
      continue;
    }
    const coerced = coerceFieldValue(specs[f], pendingValue);
    record[f] = 'error' in coerced ? pendingValue : coerced.value;
  }

  const rowError = config.validateRow?.(record);
  if (rowError) {
    markCellError(span, rowError);
    return;
  }

  const key = rowKey(config, record);
  if (config.rows.some((r) => rowKey(config, r) === key)) {
    markCellError(span, 'A row with these key values already exists');
    return;
  }

  console.log(`[EditableTable] insert ${table} ${key}`);
  await config.deps.gtfsDatabase.insertRows(table, [record]);
  await config.deps.patchManager.recordInsert(table, key, record);
  state.pending = {};
  config.onInsert?.(key, record);
}

async function deleteRow(button: HTMLElement): Promise<void> {
  const { et, key } = button.dataset;
  if (!et || !key) {
    return;
  }
  const state = instances.get(et);
  if (!state) {
    console.warn(`[EditableTable] no registered instance ${et}`);
    return;
  }
  const { config } = state;
  const table = specStoreName(config.tableName);
  // A collapsed row deletes as one row: every record behind it goes, in one
  // patch.
  const group = findGroup(config, key);
  if (!group) {
    console.warn(`[EditableTable] row ${key} is gone from ${table}`);
    return;
  }

  const count = group.rows.length;
  const question =
    count === 1
      ? 'Are you sure you want to delete this record?'
      : `Are you sure you want to delete these ${count} records?`;

  await showModal({
    title: 'Confirm Delete',
    body: `<p>${question} This can be undone via Edit -> Undo.</p>`,
    actions: [
      {
        label: 'Delete',
        className: 'btn-error',
        onClick: async () => {
          for (const groupKey of group.keys) {
            await config.deps.gtfsDatabase.deleteRow(table, groupKey);
          }
          if (count === 1) {
            await config.deps.patchManager.recordDelete(
              table,
              key,
              group.rows[0]
            );
          } else {
            await config.deps.patchManager.recordBatchMixed(
              group.rows.map((record, i) => ({
                op: 'delete' as const,
                table,
                id: group.keys[i],
                record,
              })),
              `Delete ${count} rows from ${table}`
            );
          }
          console.log(
            `[EditableTable] delete ${table} ${key} (${count} row(s))`
          );
          config.onDelete?.(key);
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    escapeAction: 1,
  });
}
