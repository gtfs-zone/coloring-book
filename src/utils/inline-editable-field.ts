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
} from '../modules/option-picker-modal';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { isOutsideTopModal } from 'gtfs-zone-web-common/ui/modal-utils';
import {
  formatIssueValue,
  isDanglingReference,
  markReferenceResolved,
  renderEntityIssueNote,
} from '../modules/feed-issues';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { renderPickerTrigger, setPickerTriggerContent } from './picker-trigger';
import { renderRenameTrigger } from './rename-action';
import { openInlineEditor, openInlineMenu } from './inline-edit';
import type { InlineEditorInputType } from './inline-edit';
import {
  generateFieldConfigsFromSchema,
  renderFieldLabel,
  type FieldConfig,
} from './field-component';
import {
  buildForeignKeyOptions,
  coerceFieldValue,
  constrainedOptions,
  formatSpecValue,
  resolveForeignLabel,
  specFieldKind,
  specStoreName,
  validateFieldValue,
  type ForeignKeyRowSource,
} from './spec-field-edit';
import { convertValueToGTFS, formatValueForDisplay } from './field-formatters';
import { GTFSSchemas, GTFS_FIELD_SPECS } from '../types/gtfs';
import {
  GTFSFieldType,
  getInputTypeForFieldType,
} from '../types/gtfs-field-types';
import { getGTFSPrimaryKey, getNaturalKeyField } from './gtfs-primary-keys';
import {
  extensionFieldSpec,
  extensionFields,
  EXTENSION_FIELD_DESCRIPTION,
} from './extension-fields';
import { renderTimeHtml } from './time-formatter';
import type { GTFSFieldSpec } from '../gtfs-spec/types';
import type { z } from 'zod';
import { t } from '../i18n/messages';

/** Marks a span this module's delegated listeners are responsible for. */
const FIELD_CLASS = 'inline-editable-field';

/** The box every activatable field renders as, editor or rename trigger. */
const FIELD_BOX_CLASS =
  'w-full cursor-pointer rounded-field border border-base-300 px-3 py-1.5 text-sm hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

export interface InlineEditableFieldDeps {
  /** Reads used to label and pick foreign-ID values, plus the first-row write. */
  gtfsDatabase: ForeignKeyRowSource & {
    insertRows(
      tableName: string,
      rows: Record<string, unknown>[]
    ): Promise<void>;
  };
  /**
   * Where committed edits go. `recordUpdate` applies the write itself, so
   * there is no separate database write here. `recordInsert` does not, so the
   * caller writes the row first.
   */
  patchManager: {
    recordUpdate(
      table: string,
      id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ): Promise<void>;
    recordInsert(
      table: string,
      id: string,
      record: Record<string, unknown>
    ): Promise<void>;
  } | null;
}

let deps: InlineEditableFieldDeps | null = null;
let listenerInstalled = false;

/** An in-memory record that draft fields commit into, plus their rejections. */
export interface Draft {
  values: Record<string, unknown>;
  /** The last rejected value's message, per field, until a valid commit. */
  errors: Record<string, string>;
}

const drafts = new Map<string, Draft>();

/** Start a draft record for fields rendered with this `draftId`. */
export function openDraft(id: string, initial: Record<string, unknown>): void {
  if (drafts.has(id)) {
    throw new Error(`[InlineField] draft ${id} is already open`);
  }
  drafts.set(id, { values: { ...initial }, errors: {} });
  console.log(`[InlineField] draft ${id} opened`);
}

export function readDraft(id: string): Draft {
  const draft = drafts.get(id);
  if (!draft) {
    throw new Error(`[InlineField] draft ${id} is not open`);
  }
  return { values: { ...draft.values }, errors: { ...draft.errors } };
}

/** Set a draft key that no field renders, such as a toggle's. */
export function setDraftValue(id: string, key: string, value: unknown): void {
  const draft = drafts.get(id);
  if (!draft) {
    throw new Error(`[InlineField] draft ${id} is not open`);
  }
  draft.values[key] = value;
}

export function closeDraft(id: string): void {
  drafts.delete(id);
  console.log(`[InlineField] draft ${id} closed`);
}

/** The database the fields read from, for checks made outside a commit. */
export function inlineFieldDatabase(): InlineEditableFieldDeps['gtfsDatabase'] {
  if (!deps) {
    throw new Error('[InlineField] not installed');
  }
  return deps.gtfsDatabase;
}

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
    if (isOutsideTopModal(e.target)) {
      return;
    }
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
    if (isOutsideTopModal(e.target)) {
      return;
    }
    const span = (e.target as Element)?.closest?.(`.${FIELD_CLASS}`);
    if (span instanceof HTMLElement) {
      // The key is spent on opening the field: a modal's Enter action, bound
      // to document after this listener, must not fire as well.
      e.preventDefault();
      e.stopImmediatePropagation();
      openFieldEditor(span);
    }
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * The field's spec, or the synthetic text spec a non-spec column gets.
 *
 * A table the spec does not describe at all still returns undefined: that is a
 * caller mistake, not an extension field.
 */
function fieldSpec(
  tableName: string | undefined,
  field: string
): GTFSFieldSpec | undefined {
  const specs = tableName ? GTFS_FIELD_SPECS[tableName] : undefined;
  if (!specs) {
    return undefined;
  }
  return specs[field] ?? extensionFieldSpec(field);
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

function displayHtml(
  text: string,
  placeholder: string,
  gtfsType?: string
): string {
  if (!text) {
    return `<span class="opacity-40">${escapeHtml(placeholder)}</span>`;
  }
  return gtfsType === GTFSFieldType.Time
    ? renderTimeHtml(text)
    : escapeHtml(text);
}

/**
 * The rename trigger a natural primary key renders as.
 *
 * Only a single-field natural key gets one: a composite key has no single
 * value to rename, and changing one of its parts is an edit of that field.
 * Renaming cascades to every row that references the ID, so it goes through
 * the impact modal rather than the inline editor.
 */
function renderIdTrigger(config: FieldConfig, raw: string): string {
  const store = config.tableName ? specStoreName(config.tableName) : '';
  if (!store || getNaturalKeyField(store) !== config.field) {
    return '';
  }
  // A single-agency feed may leave agency_id blank; setting one is a rename
  if (raw === '' && store !== 'agency') {
    return '';
  }
  return renderRenameTrigger(store, raw, FIELD_BOX_CLASS);
}

/**
 * Render one field as a label plus an editable display span.
 *
 * Primary keys, which `generateFieldConfigsFromSchema` marks readonly, render
 * as a rename trigger rather than an inline editor: changing one re-keys the
 * record and every row referencing it, which is a different operation from
 * editing a property.
 *
 * A draft field (`config.draftId`) has no row behind it: it commits into the
 * draft record, and its key edits like any other field since nothing
 * references it yet.
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
  const draft = config.draftId !== undefined;

  if (!spec || (!draft && (config.readonly || config.recordId === undefined))) {
    const trigger = renderIdTrigger(config, raw);
    const body =
      trigger ||
      `<span class="px-1 py-1.5 text-sm opacity-70">${displayHtml(raw, '-')}</span>`;
    return `<fieldset class="fieldset isolate">${label}${body}</fieldset>`;
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
  const dangling =
    !draft && isDanglingReference(config.tableName ?? '', config.field, raw);
  const danglingClass = dangling ? ' text-error border-error' : '';
  const danglingTitle = dangling
    ? ` title="${escapeHtml(`No record with ${config.field} ${formatIssueValue(raw)} exists`)}"`
    : '';

  const boxClass = `${FIELD_CLASS}${danglingClass} ${FIELD_BOX_CLASS}`;
  const attrs = `${danglingTitle}
        tabindex="0"
        role="button"
        data-table="${escapeHtml(config.tableName ?? '')}"
        data-record-id="${escapeHtml(config.recordId ?? '')}"
        ${draft ? `data-draft="${escapeHtml(config.draftId)}"` : ''}
        data-field="${escapeHtml(config.field)}"
        data-kind="${kind}"
        data-value="${escapeHtml(raw)}"
        data-placeholder="${escapeHtml(placeholder)}"
        ${config.gtfsFieldType ? `data-gtfs-type="${escapeHtml(config.gtfsFieldType)}"` : ''}`;
  const content = displayHtml(text, placeholder, config.gtfsFieldType);

  // A foreign ID and a standards code are picked from a modal; an enum drops an
  // inline menu and everything else swaps for an input, so only the modal kinds
  // wear the chevron.
  const span =
    kind === 'foreign' || kind === 'constrained'
      ? renderPickerTrigger({
          content,
          variant: 'bare',
          className: boxClass,
          attrs,
        })
      : `<span class="${boxClass} block truncate" ${attrs}>${content}</span>`;

  return `
    <fieldset class="fieldset isolate">
      ${label}
      ${span}
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
 *
 * `draftId` renders every field in draft mode, committing into that draft.
 */
export async function renderInlineEntityFields(
  tableName: string,
  record: Record<string, string | number | undefined>,
  recordId: string,
  exclude: string[] = [],
  draftId?: string
): Promise<string> {
  const schema = GTFSSchemas[tableName as keyof typeof GTFSSchemas] as
    z.ZodObject<z.ZodRawShape> | undefined;
  if (!schema) {
    console.warn(`[InlineField] no schema for ${tableName}`);
    return '';
  }

  const configs = generateFieldConfigsFromSchema(schema, record, tableName)
    .filter((c) => !exclude.includes(c.field))
    .map<FieldConfig>((c) => ({ ...c, recordId, draftId }));

  const fieldsHtml: string[] = [];
  for (const config of configs) {
    fieldsHtml.push(await renderInlineEditableField(config));
  }

  // Columns this record carries that the spec does not describe. They edit as
  // plain text: there is no spec to say anything else about them.
  const extras = extensionFields(tableName, [record]).filter(
    (field) => !exclude.includes(field)
  );
  if (extras.length > 0) {
    fieldsHtml.push(
      `<div class="divider text-xs opacity-60" title="${escapeHtml(EXTENSION_FIELD_DESCRIPTION)}">${t('field.additional')}</div>`
    );
    for (const field of extras) {
      fieldsHtml.push(
        await renderInlineEditableField({
          field,
          label: field,
          type: 'text',
          value: record[field],
          tableName,
          recordId,
          isExtension: true,
          tooltip: EXTENSION_FIELD_DESCRIPTION,
          draftId,
        })
      );
    }
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

/**
 * Open one rendered field's editor, with its text selected.
 *
 * Used to put the cursor in a form's first field on mount.
 */
export function openFieldForEdit(container: ParentNode, field: string): void {
  const span = container.querySelector<HTMLElement>(
    `.${FIELD_CLASS}[data-field="${CSS.escape(field)}"]`
  );
  if (!span) {
    console.warn(`[InlineField] no field ${field} to open`);
    return;
  }
  openFieldEditor(span);
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
          primary: t('field.dangling', { value: formatIssueValue(current) }),
        });
      }
      const picked = await showOptionPickerModal({
        title: t('field.selectTitle', { field }),
        options: [{ value: '', primary: t('common.noneOption') }, ...options],
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

  if (kind === 'constrained') {
    void openConstrainedPicker(span, spec, field, current, gtfsType);
    return;
  }

  openPlainEditor(span, spec, current, gtfsType);
}

/**
 * Pick a language, timezone or currency code from the standard's list.
 *
 * The list is long enough that it has to be searchable, and open enough that
 * the user has to be able to step outside it: the footer button hands the field
 * back to the plain text editor rather than choosing anything.
 */
async function openConstrainedPicker(
  span: HTMLElement,
  spec: GTFSFieldSpec,
  field: string,
  current: string,
  gtfsType: string | undefined
): Promise<void> {
  const options = constrainedOptions(spec) ?? [];
  // A value the standard's list does not carry is offered back, so the picker
  // cannot silently blank a code the user did not touch.
  const extra =
    current && !options.some((o) => o.value === current)
      ? [
          {
            value: current,
            primary: current,
            secondary: t('field.currentValue'),
          },
        ]
      : [];

  let custom = false;
  const picked = await showOptionPickerModal({
    title: t('field.selectTitle', { field }),
    options: [
      { value: '', primary: t('common.noneOption') },
      ...extra,
      ...options,
    ],
    selectedValue: current,
    searchable: true,
    footerAction: {
      label: t('field.customValue'),
      onClick: () => {
        custom = true;
      },
    },
  });

  if (custom) {
    openPlainEditor(span, spec, current, gtfsType);
    return;
  }
  if (picked !== null && picked !== current) {
    await commit(span, spec, picked);
  }
}

function openPlainEditor(
  span: HTMLElement,
  spec: GTFSFieldSpec,
  current: string,
  gtfsType: string | undefined
): void {
  const type = gtfsType as GTFSFieldType | undefined;
  const inputType = editorInputType(gtfsType);
  const display =
    current && type ? formatValueForDisplay(current, type) : current;
  openInlineEditor(span, {
    value: display,
    inputType,
    sizeClass: 'input-sm',
    className: 'w-full',
    placeholder: span.dataset.placeholder,
    onCommit: (value) => {
      const stored = type ? convertValueToGTFS(value, type) : value;
      return commit(span, spec, stored);
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

/** The open draft a span commits into, or undefined for a database field. */
function spanDraft(span: HTMLElement): Draft | undefined {
  const id = span.dataset.draft;
  if (id === undefined) {
    return undefined;
  }
  const draft = drafts.get(id);
  if (!draft) {
    throw new Error(`[InlineField] draft ${id} is not open`);
  }
  return draft;
}

/**
 * Show a rejected value. A draft also keeps the message, so the form that
 * owns it refuses to submit the last accepted value in its place.
 */
function markError(span: HTMLElement, message: string): void {
  span.classList.add('border-error', 'text-error');
  span.title = message;
  const field = span.dataset.field;
  const draft = spanDraft(span);
  if (draft && field) {
    draft.errors[field] = message;
  }
  notify.error(message, { duration: 4000 });
}

function clearError(span: HTMLElement): void {
  span.classList.remove('border-error', 'text-error');
  span.removeAttribute('title');
  const field = span.dataset.field;
  const draft = spanDraft(span);
  if (draft && field) {
    delete draft.errors[field];
  }
}

/**
 * Validate a committed value and record it as a patch, or write it into the
 * span's draft.
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

  // Numeric fields are stored as numbers, so their before value is coerced to
  // match. Everything else keeps the raw stored string: coercing it trims, and
  // an edit that only strips whitespace would then look like no change at all.
  const beforeRaw = span.dataset.value ?? '';
  const beforeCoerced = coerceFieldValue(spec, beforeRaw);
  const before =
    'error' in beforeCoerced || typeof beforeCoerced.value !== 'number'
      ? beforeRaw
      : beforeCoerced.value;
  if (String(before) === String(coerced.value)) {
    clearError(span);
    return;
  }

  clearError(span);
  setDisplay(span, spec, coerced.value, label);

  // Before any await: a form's Enter action reads the draft straight after the
  // editor commits.
  const draft = spanDraft(span);
  if (draft) {
    draft.values[field] = coerced.value;
    console.log(
      `[InlineField] draft ${span.dataset.draft}.${field}`,
      coerced.value
    );
    return;
  }

  // The old value was the broken one, so the row is no longer dangling on this
  // field. Drop the red now rather than waiting for the next validation pass.
  markReferenceResolved(table, field, String(before));
  span.classList.remove('text-error', 'border-error');
  span.removeAttribute('title');

  const store = specStoreName(table);
  console.log(`[InlineField] update ${store} ${recordId}.${field}`);
  if (!deps?.patchManager) {
    notify.error(t('field.historyNotReady'));
    console.warn('[InlineField] no patch manager, edit dropped');
    return;
  }

  // A single-row table the feed never carried (feed_info) is rendered as a
  // blank form with no row behind it, and an update patch against a row that
  // does not exist is a no-op. Insert it on the first committed field instead.
  if (!(await deps.gtfsDatabase.getRow(store, recordId))) {
    if (getGTFSPrimaryKey(store)?.type !== 'none') {
      notify.error(t('field.recordGone'));
      console.error(`[InlineField] no row ${recordId} in ${store}`);
      return;
    }
    const record = { [field]: coerced.value };
    console.log(`[InlineField] creating first ${store} row`);
    await deps.gtfsDatabase.insertRows(store, [record]);
    await deps.patchManager.recordInsert(store, recordId, record);
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

  setPickerTriggerContent(
    span,
    displayHtml(text, span.dataset.placeholder ?? '-', gtfsType)
  );
}
