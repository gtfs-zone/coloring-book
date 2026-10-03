/**
 * The shared "New X" creation form.
 *
 * A field with a spec table renders through `renderInlineEditableField` in
 * draft mode, so its label, editor, display and validation are the entity
 * page's own. Its commits land in an in-memory draft, and nothing is written
 * until Create. Fields the spec has no entry for are plain inputs, labelled
 * through `renderFieldLabel`. Callers keep their own persistence and only
 * supply the field list, the validation and the commit.
 */

import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import {
  generateFieldConfigsFromSchema,
  renderFieldLabel,
  type FieldConfig,
} from '../utils/field-component';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { GTFSSchemas } from '../types/gtfs';
import type { GTFSPresence } from '../gtfs-spec/types';
import { getEnumOptions, isEnumField } from '../types/gtfs-enums';
import {
  closeDraft,
  inlineFieldDatabase,
  openDraft,
  openFieldForEdit,
  readDraft,
  renderInlineEditableField,
} from '../utils/inline-editable-field';
import { flushInlineEdits } from '../utils/inline-edit';
import { getNaturalKeyField } from '../utils/gtfs-primary-keys';
import { validateIdText, validateNewId } from '../utils/rename-entity';
import type { z } from 'zod';
import { t } from '../i18n/messages';

export interface EntityFormField {
  /** Field name. Also the value key and the basis of the input's id. */
  field: string;
  /** Defaults to `field`. */
  label?: string;
  /**
   * Spec file (`*.txt`) the field belongs to. Set, the field is a draft field
   * and `type`, `options` and `mono` do not apply.
   */
  tableName?: string;
  /** Presence for a field the spec layer has no entry for. */
  presence?: GTFSPresence;
  /** Defaults to `select` for enum fields, `text` otherwise. */
  type?: 'text' | 'select' | 'checkbox';
  /** Select options. Derived from the enum registry when omitted. */
  options?: Array<{ value: string; label: string }>;
  /** Initial value, in stored form (`YYYYMMDD` for a GTFS date). */
  value?: string;
  placeholder?: string;
  /** Renders the input in the monospace face, for id fields. */
  mono?: boolean;
  /** A line of explanation under the input. */
  note?: string;
}

/** The new row's ID, rendered first and opened for editing on mount. */
export interface EntityFormId {
  /** Store name of the table whose natural key the ID is (`calendar`). */
  table: string;
  /**
   * The ID column, for a table without a single-field natural key
   * (`shapes`). The same-table clash check is then left to `taken`.
   */
  keyField?: string;
  suggested: string;
  /**
   * Extra check on top of the empty, whitespace and same-table clash rules.
   * Returns an error message, or null if the ID is free.
   */
  taken?: (id: string) => Promise<string | null>;
}

export interface EntityFormOptions {
  title: string;
  /** Defaults to 'Create'. */
  createLabel?: string;
  /** HTML shown above the fields. */
  intro?: string;
  /** The ID field. Its value is keyed by the table's key field name. */
  id?: EntityFormId;
  fields: EntityFormField[];
  /** HTML shown after the fields, for anything a plain field cannot express. */
  extraBody?: string;
  /** Extra classes for the modal box, for a form that wants a narrower one. */
  boxClassName?: string;
  /**
   * Draft keys no field renders, seeded before the fields' own values. Set
   * them through `setDraftValue` with the draft id `onMount` receives.
   */
  draft?: Record<string, unknown>;
  /** Runs once the form is in the DOM, after the first input is focused. */
  onMount?: (close: () => void, draftId: string) => void;
  /**
   * Returns an error message to show inline, or null to accept the values.
   *
   * An empty string keeps the form open without showing a message, for a
   * validator that has already reported the failure in its own slot.
   */
  validate: (
    values: Record<string, string>
  ) => string | null | Promise<string | null>;
  /**
   * Writes the entity. Throwing here leaves the form open with the message.
   * `draft` is the whole draft record, `draft` keys included.
   *
   * Omitted by callers that only want the collected values back.
   */
  onCreate?: (
    values: Record<string, string>,
    draft: Record<string, unknown>
  ) => Promise<void>;
}

const ERROR_ID = 'entity-form-error';

/** Makes each form's draft id unique. */
let draftSeq = 0;

function inputId(field: string): string {
  return `entity-form-${field}`;
}

function isDraftField(field: EntityFormField): boolean {
  return field.tableName !== undefined;
}

/**
 * The spec file and key field an ID option points at.
 *
 * Only a single-field natural key has one value to suggest.
 */
function idField(id: EntityFormId): EntityFormField {
  const keyField = id.keyField ?? getNaturalKeyField(id.table);
  if (!keyField) {
    throw new Error(`[entity-form-modal] ${id.table} has no natural key`);
  }
  return { field: keyField, tableName: `${id.table}.txt`, value: id.suggested };
}

/** The config the entity page would render this field with. */
function draftFieldConfig(
  field: EntityFormField,
  draftId: string
): FieldConfig {
  const tableName = field.tableName ?? '';
  const schema = GTFSSchemas[tableName as keyof typeof GTFSSchemas] as
    z.ZodObject<z.ZodRawShape> | undefined;
  if (!schema) {
    throw new Error(`[entity-form-modal] no schema for ${tableName}`);
  }
  const config = generateFieldConfigsFromSchema(
    schema,
    { [field.field]: field.value },
    tableName
  ).find((c) => c.field === field.field);
  if (!config) {
    throw new Error(
      `[entity-form-modal] ${tableName} has no field ${field.field}`
    );
  }
  return {
    ...config,
    label: field.label ?? config.label,
    placeholder: field.placeholder ?? config.placeholder,
    draftId,
  };
}

/**
 * The `FieldConfig` a plain input's label needs. Presence comes from the
 * caller, since the spec has no entry for the field.
 */
function fieldConfig(field: EntityFormField): FieldConfig {
  return {
    field: field.field,
    label: field.label ?? field.field,
    // A checkbox has no FieldConfig type of its own; its label renders the same.
    type: field.type === 'checkbox' ? 'text' : (field.type ?? 'text'),
    presence: field.presence,
  };
}

function renderInput(field: EntityFormField): string {
  const id = inputId(field.field);
  const type = field.type ?? (isEnumField(field.field) ? 'select' : 'text');

  if (type === 'select') {
    const options =
      field.options ??
      (getEnumOptions(field.field) ?? []).map((opt) => ({
        value: String(opt.value),
        label: opt.value !== '' ? `${opt.value} - ${opt.label}` : opt.label,
      }));
    const rendered = options
      .map(
        (opt) =>
          `<option value="${escapeHtml(opt.value)}"${opt.value === (field.value ?? '') ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
      )
      .join('');
    return `<select id="${id}" class="select select-bordered w-full">${rendered}</select>`;
  }

  if (type === 'checkbox') {
    return `<input
      id="${id}"
      type="checkbox"
      class="toggle"
      ${field.value ? 'checked' : ''}
    />`;
  }

  const mono = field.mono ? ' font-mono' : '';
  return `<input
    id="${id}"
    type="${type}"
    class="input input-bordered w-full${mono}"
    value="${escapeHtml(field.value ?? '')}"
    placeholder="${escapeHtml(field.placeholder ?? '')}"
    autocomplete="off"
  />`;
}

async function renderField(
  field: EntityFormField,
  draftId: string
): Promise<string> {
  const note = field.note
    ? `<p class="text-xs opacity-60">${field.note}</p>`
    : '';
  if (isDraftField(field)) {
    return `${await renderInlineEditableField(draftFieldConfig(field, draftId))}${note}`;
  }
  return `<fieldset class="fieldset">
    ${renderFieldLabel(fieldConfig(field), inputId(field.field))}
    ${renderInput(field)}
    ${note}
  </fieldset>`;
}

/**
 * Every field's value: draft fields from the draft, the rest from their
 * inputs. Returns an error message instead when a draft field holds a value
 * it rejected.
 */
function readValues(
  fields: EntityFormField[],
  draftId: string
): { values: Record<string, string> } | { error: string } {
  const draft = readDraft(draftId);
  const rejected = fields.find(
    (field) => isDraftField(field) && field.field in draft.errors
  );
  if (rejected) {
    return {
      error: t('form.fieldError', {
        field: rejected.label ?? rejected.field,
        error: draft.errors[rejected.field],
      }),
    };
  }

  const values: Record<string, string> = {};
  for (const field of fields) {
    if (isDraftField(field)) {
      const value = draft.values[field.field];
      values[field.field] =
        value === undefined || value === null ? '' : String(value);
      continue;
    }
    const el = document.getElementById(inputId(field.field)) as
      HTMLInputElement | HTMLSelectElement | null;
    if (!el) {
      throw new Error(
        `[entity-form-modal] input for "${field.field}" is missing from the form`
      );
    }
    values[field.field] =
      el instanceof HTMLInputElement && el.type === 'checkbox'
        ? el.checked
          ? 'true'
          : ''
        : el.value.trim();
  }
  return { values };
}

function showError(message: string): void {
  const el = document.getElementById(ERROR_ID);
  if (!el) {
    console.error('[entity-form-modal] error slot is missing from the form');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Ask for a new entity's fields and write it.
 *
 * Resolves with the collected values once `onCreate` has run, or null if the
 * form was cancelled.
 */
export async function promptNewEntity(
  options: EntityFormOptions
): Promise<Record<string, string> | null> {
  let created: Record<string, string> | null = null;
  const draftId = `entity-form-${++draftSeq}`;
  const fields = options.id
    ? [idField(options.id), ...options.fields]
    : options.fields;

  const rendered: string[] = [];
  for (const field of fields) {
    rendered.push(await renderField(field, draftId));
  }

  openDraft(draftId, {
    ...options.draft,
    ...Object.fromEntries(
      fields.filter(isDraftField).map((f) => [f.field, f.value ?? ''])
    ),
  });
  const body = `
    <div class="space-y-3" data-entity-form="${draftId}">
      ${options.intro ?? ''}
      ${rendered.join('')}
      ${options.extraBody ?? ''}
      <p id="${ERROR_ID}" class="text-error text-sm hidden"></p>
    </div>
  `;

  await showModal({
    title: options.title,
    body,
    escapeAction: 1,
    enterAction: 0,
    boxClassName: options.boxClassName,
    onMount: (close) => {
      const form = document.querySelector(`[data-entity-form="${draftId}"]`);
      const first = fields[0];
      if (options.id && form) {
        openFieldForEdit(form, first.field);
      } else if (isDraftField(first)) {
        form
          ?.querySelector<HTMLElement>(
            `[data-field="${CSS.escape(first.field)}"]`
          )
          ?.focus();
      } else {
        const input = document.getElementById(inputId(first.field));
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        } else {
          input?.focus();
        }
      }
      options.onMount?.(close, draftId);
    },
    actions: [
      {
        label: options.createLabel ?? t('form.create'),
        className: 'btn-primary',
        onClick: async () => {
          // A draft field still open (Enter, or a click straight on Create)
          // has to land in the draft before it is read.
          await flushInlineEdits();
          const read = readValues(fields, draftId);
          if ('error' in read) {
            showError(read.error);
            return true;
          }
          const values = read.values;
          if (options.id) {
            const id = values[fields[0].field];
            const idError =
              (options.id.keyField
                ? validateIdText(id)
                : await validateNewId(
                    inlineFieldDatabase(),
                    options.id.table,
                    id
                  )) ??
              (await options.id.taken?.(id)) ??
              null;
            if (idError) {
              showError(idError);
              return true;
            }
          }
          const message = await options.validate(values);
          if (message !== null) {
            if (message) {
              showError(message);
            }
            return true;
          }
          try {
            await options.onCreate?.(values, readDraft(draftId).values);
          } catch (error) {
            console.error('[entity-form-modal] create failed', error);
            showError(
              error instanceof Error ? error.message : t('form.couldNotCreate')
            );
            return true;
          }
          created = values;
          return false;
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
  });

  // Every close path (action, Escape, backdrop, a navigation tearing the
  // modal down) resolves showModal, so the draft cannot outlive the form.
  closeDraft(draftId);
  return created;
}
