/**
 * Click-to-edit entity property fields.
 *
 * The entity pages used to render always-live `<input>` and `<select>`
 * elements whose `change` events were wired to patches by a separate bridge.
 * They now use the same idiom as the timetable and the spec-driven tables: a
 * display span that swaps for an editor when it is clicked or activated from
 * the keyboard. One editing idiom across the app, and every field is reachable
 * by Tab and openable with Enter or Space.
 *
 * Which editor a field gets, and how its value is coerced, validated and
 * displayed, come from `utils/spec-field-edit`, so this module only decides
 * layout and where a committed value goes.
 */

import {
  showOptionPickerModal,
  type OptionPickerItem,
} from '../modules/option-picker-modal.js';
import { notify } from '../modules/notification-system.js';
import {
  formatIssueValue,
  isDanglingReference,
  markReferenceResolved,
  renderEntityIssueNote,
} from '../modules/feed-issues.js';
import { escapeHtml } from './escape-html.js';
import { openInlineEditor, openInlineMenu } from './inline-edit.js';
import type { InlineEditorInputType } from './inline-edit.js';
import {
  generateFieldConfigsFromSchema,
  renderFieldLabel,
  type FieldConfig,
} from './field-component.js';
import {
  buildForeignKeyOptions,
  coerceFieldValue,
  formatSpecValue,
  resolveForeignLabel,
  specFieldKind,
  specStoreName,
  validateFieldValue,
  type ForeignKeyRowSource,
} from './spec-field-edit.js';
import {
  convertValueToGTFS,
  formatValueForDisplay,
} from './field-formatters.js';
import { GTFSSchemas, GTFS_FIELD_SPECS } from '../types/gtfs.js';
import {
  GTFSFieldType,
  getInputTypeForFieldType,
} from '../types/gtfs-field-types.js';
import type { GTFSFieldSpec } from '../gtfs-spec/types.js';
import type { z } from 'zod';

/** Marks a span this module's delegated listeners are responsible for. */
const FIELD_CLASS = 'inline-editable-field';

export interface InlineEditableFieldDeps {
  /** Reads used to label and pick foreign-ID values. */
  gtfsDatabase: ForeignKeyRowSource;
  /**
   * Where committed edits go. `recordUpdate` applies the write itself, so
   * there is no separate database write here.
   */
  patchManager: {
    recordUpdate(
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ): Promise<void>;
  } | null;
}

let deps: InlineEditableFieldDeps | null = null;
let listenerInstalled = false;

/**
 * Register the database and patch manager the editors commit through, and
 * install the delegated listeners.
 *
 * The listeners are bound to `document` once: the containers these fields live
 * in have their `innerHTML` replaced wholesale on every navigation, which
 * would silently drop a container-bound listener. Calling this again only
 * refreshes the dependencies.
 */
export function installInlineEditableFields(
  newDeps: InlineEditableFieldDeps
): void {
  deps = newDeps;
  if (listenerInstalled) {
    return;
  }
  listenerInstalled = true;

  document.addEventListener('click', (e) => {
    const span = (e.target as Element)?.closest?.(`.${FIELD_CLASS}`);
    if (span instanceof HTMLElement) {
      openFieldEditor(span);
    }
  });

  // Fields are focusable, so they must open on Enter and Space too. While an
  // editor is live the event target is the input, not the span, so this cannot
  // re-open the field the user is already typing in.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') {
      return;
    }
    const span = (e.target as Element)?.closest?.(`.${FIELD_CLASS}`);
    if (span instanceof HTMLElement) {
      e.preventDefault();
      openFieldEditor(span);
    }
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function fieldSpec(
  tableName: string | undefined,
  field: string
): GTFSFieldSpec | undefined {
  return tableName ? GTFS_FIELD_SPECS[tableName]?.[field] : undefined;
}

/** The stored value as the user should read it, before escaping. */
function displayText(
  config: FieldConfig,
  spec: GTFSFieldSpec,
  foreignLabel: string | undefined
): string {
  const kind = specFieldKind(spec);
  if (kind === 'foreign') {
    return foreignLabel ?? '';
  }
  if (kind === 'enum') {
    return formatSpecValue(spec, kind, config.value);
  }
  const raw =
    config.value === undefined || config.value === null
      ? ''
      : String(config.value);
  if (raw === '' || !config.gtfsFieldType) {
    return raw;
  }
  return formatValueForDisplay(raw, config.gtfsFieldType);
}

function displayHtml(text: string, placeholder: string): string {
  return text
    ? escapeHtml(text)
    : `<span class="opacity-40">${escapeHtml(placeholder)}</span>`;
}

/**
 * Render one field as a label plus an editable display span.
 *
 * Primary keys, which `generateFieldConfigsFromSchema` marks readonly, render
 * as static text: changing them re-keys the record, which is a different
 * operation from editing a property.
 */
export async function renderInlineEditableField(
  config: FieldConfig
): Promise<string> {
  const spec = fieldSpec(config.tableName, config.field);
  const raw =
    config.value === undefined || config.value === null
      ? ''
      : String(config.value);
  const label = renderFieldLabel(config);

  if (!spec || config.readonly || config.recordId === undefined) {
    return `<fieldset class="fieldset isolate">${label}<span class="px-1 py-1.5 text-sm opacity-70">${displayHtml(raw, '-')}</span></fieldset>`;
  }

  const kind = specFieldKind(spec);
  const foreignLabel =
    kind === 'foreign' && deps
      ? await resolveForeignLabel(deps.gtfsDatabase, spec, raw)
      : raw;
  const text = displayText(config, spec, foreignLabel);
  const placeholder = config.placeholder ?? '-';

  // A reference the last validation pass could not resolve reads as an error,
  // but stays editable: clicking it opens the picker that repoints it.
  const dangling = isDanglingReference(
    config.tableName ?? '',
    config.field,
    raw
  );
  const danglingClass = dangling ? ' text-error border-error' : '';
  const danglingTitle = dangling
    ? ` title="${escapeHtml(`No record with ${config.field} ${formatIssueValue(raw)} exists`)}"`
    : '';

  return `
    <fieldset class="fieldset isolate">
      ${label}
      <span${danglingTitle}
        class="${FIELD_CLASS}${danglingClass} block w-full cursor-pointer truncate rounded-field border border-base-300 px-3 py-1.5 text-sm hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        tabindex="0"
        role="button"
        data-table="${escapeHtml(config.tableName ?? '')}"
        data-record-id="${escapeHtml(config.recordId)}"
        data-field="${escapeHtml(config.field)}"
        data-kind="${kind}"
        data-value="${escapeHtml(raw)}"
        data-placeholder="${escapeHtml(placeholder)}"
        ${config.gtfsFieldType ? `data-gtfs-type="${escapeHtml(config.gtfsFieldType)}"` : ''}
      >${displayHtml(text, placeholder)}</span>
    </fieldset>
  `;
}

/**
 * Render every field of one GTFS record as click-to-edit rows, in spec order.
 *
 * `recordId` is the record's primary key, as `patchManager` keys patches by it.
 * Single-row tables without a key (`feed_info`) use their table name, which is
 * how `generateCompositeKeyFromRecord` keys them too.
 *
 * `exclude` drops fields the page edits some other way, such as
 * `routes.network_id`, which is written from the canonical networks tables.
 */
export async function renderInlineEntityFields(
  tableName: string,
  record: Record<string, string | number | undefined>,
  recordId: string,
  exclude: string[] = []
): Promise<string> {
  const schema = GTFSSchemas[tableName as keyof typeof GTFSSchemas] as
    | z.ZodObject<z.ZodRawShape>
    | undefined;
  if (!schema) {
    console.warn(`[InlineField] no schema for ${tableName}`);
    return '';
  }

  const configs = generateFieldConfigsFromSchema(schema, record, tableName)
    .filter((c) => !exclude.includes(c.field))
    .map<FieldConfig>((c) => ({ ...c, recordId }));

  const fieldsHtml: string[] = [];
  for (const config of configs) {
    fieldsHtml.push(await renderInlineEditableField(config));
  }

  const note = renderEntityIssueNote(tableName, recordId);
  return `<div class="space-y-3">${note}${fieldsHtml.join('')}</div>`;
}

// ─── Editing ──────────────────────────────────────────────────────────────────

/** Native input types the spec's field types ask for, minus the unusable ones. */
function editorInputType(
  gtfsFieldType: string | undefined
): InlineEditorInputType {
  if (!gtfsFieldType) {
    return 'text';
  }
  // GTFS times run past 24:00:00, which a native time input cannot hold.
  if (
    gtfsFieldType === GTFSFieldType.Time ||
    gtfsFieldType === GTFSFieldType.LocalTime
  ) {
    return 'text';
  }
  // The metadata's `inputType` is exactly this union, but the getter widens it.
  return getInputTypeForFieldType(
    gtfsFieldType as GTFSFieldType
  ) as InlineEditorInputType;
}

function openFieldEditor(span: HTMLElement): void {
  const { table, field, kind, gtfsType } = span.dataset;
  const spec = fieldSpec(table, field ?? '');
  if (!spec || !field) {
    return;
  }
  const current = span.dataset.value ?? '';

  if (kind === 'enum') {
    openInlineMenu(span, {
      currentValue: current,
      options: [
        { value: '', label: '-' },
        ...(spec.enumValues ?? []).map((v) => ({
          value: String(v.value),
          label: `${v.value} - ${v.label}`,
        })),
      ],
      onPick: (value, label) => void commit(span, spec, value, label),
    });
    return;
  }

  if (kind === 'foreign') {
    void (async () => {
      const options = await foreignOptions(spec);
      // A value that no longer resolves is offered back, so the picker cannot
      // silently blank a dangling reference the user did not touch.
      if (current && !options.some((o) => o.value === current)) {
        options.push({
          value: current,
          primary: `${formatIssueValue(current)} (dangling reference)`,
        });
      }
      const picked = await showOptionPickerModal({
        title: `Select ${field}`,
        options: [{ value: '', primary: '- none -' }, ...options],
        selectedValue: current,
        searchable: true,
      });
      if (picked !== null && picked !== current) {
        const label =
          options.find((o) => o.value === picked)?.primary ?? picked;
        await commit(span, spec, picked, label);
      }
    })();
    return;
  }

  const type = gtfsType as GTFSFieldType | undefined;
  openInlineEditor(span, {
    value: current && type ? formatValueForDisplay(current, type) : current,
    inputType: editorInputType(gtfsType),
    sizeClass: 'input-sm',
    className: 'w-full',
    placeholder: span.dataset.placeholder,
    onCommit: (value) => {
      const stored = type ? convertValueToGTFS(value, type) : value;
      void commit(span, spec, stored);
    },
  });
}

async function foreignOptions(
  spec: GTFSFieldSpec
): Promise<OptionPickerItem[]> {
  if (!deps) {
    return [];
  }
  return buildForeignKeyOptions(deps.gtfsDatabase, spec);
}

function markError(span: HTMLElement, message: string): void {
  span.classList.add('border-error', 'text-error');
  span.title = message;
  notify.error(message, { duration: 4000 });
}

function clearError(span: HTMLElement): void {
  span.classList.remove('border-error', 'text-error');
  span.removeAttribute('title');
}

/**
 * Validate a committed value and record it as a patch.
 *
 * On a validation failure nothing is written and the span keeps its pre-edit
 * value, which is the honest thing to show.
 */
async function commit(
  span: HTMLElement,
  spec: GTFSFieldSpec,
  raw: string,
  label?: string
): Promise<void> {
  const { table, field, recordId } = span.dataset;
  if (!table || !field || recordId === undefined) {
    return;
  }

  const coerced = coerceFieldValue(spec, raw);
  if ('error' in coerced) {
    markError(span, coerced.error);
    return;
  }
  const error = validateFieldValue(table, field, spec, coerced.value);
  if (error) {
    markError(span, error);
    return;
  }

  const beforeRaw = coerceFieldValue(spec, span.dataset.value ?? '');
  const before =
    'error' in beforeRaw ? (span.dataset.value ?? '') : beforeRaw.value;
  if (before === coerced.value) {
    clearError(span);
    return;
  }

  clearError(span);
  setDisplay(span, spec, coerced.value, label);

  // The old value was the broken one, so the row is no longer dangling on this
  // field. Drop the red now rather than waiting for the next validation pass.
  if (String(before) !== String(coerced.value)) {
    markReferenceResolved(table, field, String(before));
    span.classList.remove('text-error', 'border-error');
    span.removeAttribute('title');
  }

  const store = specStoreName(table);
  console.log(`[InlineField] update ${store} ${recordId}.${field}`);
  if (!deps?.patchManager) {
    notify.error('Cannot save: the edit history is not ready yet');
    console.warn('[InlineField] no patch manager, edit dropped');
    return;
  }
  await deps.patchManager.recordUpdate(
    store,
    recordId,
    { [field]: before },
    { [field]: coerced.value }
  );
}

/** Reflect a committed value in the span, without waiting for a re-render. */
function setDisplay(
  span: HTMLElement,
  spec: GTFSFieldSpec,
  value: string | number,
  label: string | undefined
): void {
  const raw = value === '' ? '' : String(value);
  span.dataset.value = raw;

  const kind = span.dataset.kind ?? 'text';
  const gtfsType = span.dataset.gtfsType as GTFSFieldType | undefined;
  let text: string;
  if (kind === 'foreign') {
    text = raw ? (label ?? raw) : '';
  } else if (kind === 'enum') {
    text = formatSpecValue(spec, 'enum', raw);
  } else {
    text = raw && gtfsType ? formatValueForDisplay(raw, gtfsType) : raw;
  }

  span.innerHTML = displayHtml(text, span.dataset.placeholder ?? '-');
}
