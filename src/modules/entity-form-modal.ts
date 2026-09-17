/**
 * The shared "New X" creation form.
 *
 * Every label goes through `renderFieldLabel`, so presence badges, spec links
 * and hover tooltips are rendered the one standard way and an Optional field
 * carries no badge at all. Callers keep their own persistence and only supply
 * the field list, the validation and the commit.
 */

import { showModal } from 'interlocking/ui/modal-utils';
import { renderFieldLabel, type FieldConfig } from '../utils/field-component';
import { escapeHtml } from 'interlocking/util/escape-html';
import { GTFS_FIELD_SPECS } from '../types/gtfs';
import type { GTFSPresence } from '../gtfs-spec/types';
import { getEnumOptions, isEnumField } from '../types/gtfs-enums';
import {
  attachCalendarInput,
  ISO_DATE_CODEC,
  type DateCodec,
} from '../utils/calendar-input';
import { CONFIG } from '../config';

export interface EntityFormField {
  /** Field name. Also the value key and the basis of the input's id. */
  field: string;
  /** Defaults to `field`. */
  label?: string;
  /** Spec table to read presence, condition, description and the link from. */
  tableName?: string;
  /** Presence for a field the spec layer has no entry for. */
  presence?: GTFSPresence;
  /** Defaults to `select` for enum fields, `text` otherwise. */
  type?: 'text' | 'date' | 'select' | 'checkbox';
  /** Select options. Derived from the enum registry when omitted. */
  options?: Array<{ value: string; label: string }>;
  value?: string;
  placeholder?: string;
  /** Renders the input in the monospace face, for id fields. */
  mono?: boolean;
  /** A line of explanation under the input. */
  note?: string;
  /**
   * For `date`. How the field's stored string becomes a day and back.
   *
   * Defaults to `YYYY-MM-DD`. A caller storing GTFS `YYYYMMDD` passes its own
   * rather than converting on the way in and out.
   */
  dateCodec?: DateCodec;
}

export interface EntityFormOptions {
  title: string;
  /** Defaults to 'Create'. */
  createLabel?: string;
  /** HTML shown above the fields. */
  intro?: string;
  fields: EntityFormField[];
  /** HTML shown after the fields, for anything a plain field cannot express. */
  extraBody?: string;
  /** Extra classes for the modal box, for a form that wants a narrower one. */
  boxClassName?: string;
  /** Runs once the form is in the DOM, after the first input is focused. */
  onMount?: (close: () => void) => void;
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
   *
   * Omitted by callers that only want the collected values back.
   */
  onCreate?: (values: Record<string, string>) => Promise<void>;
}

const ERROR_ID = 'entity-form-error';

function inputId(field: string): string {
  return `entity-form-${field}`;
}

/**
 * The `FieldConfig` a label needs.
 *
 * Presence comes from the spec when the field has an entry there, and from the
 * caller otherwise; `locations.geojson` is the case that needs the second path,
 * since it is a GeoJSON file the reference defines no field table for.
 */
function fieldConfig(field: EntityFormField): FieldConfig {
  const spec = field.tableName
    ? GTFS_FIELD_SPECS[field.tableName]?.[field.field]
    : undefined;

  return {
    field: field.field,
    label: field.label ?? field.field,
    // A checkbox has no FieldConfig type of its own; its label renders the same.
    type: field.type === 'checkbox' ? 'text' : (field.type ?? 'text'),
    tableName: field.tableName,
    presence: spec?.presence ?? field.presence,
    presenceCondition: spec?.presenceCondition,
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
      class="checkbox"
      ${field.value ? 'checked' : ''}
    />`;
  }

  const mono = field.mono ? ' font-mono' : '';
  // A date is a text box: the month grid behind it is ours, not the browser's,
  // and it is wired up on mount. See `calendar-input.ts`.
  return `<input
    id="${id}"
    type="${type === 'date' ? 'text' : type}"
    class="input input-bordered w-full${mono}"
    value="${escapeHtml(field.value ?? '')}"
    placeholder="${escapeHtml(field.placeholder ?? '')}"
    autocomplete="off"
  />`;
}

function renderField(field: EntityFormField): string {
  const note = field.note
    ? `<p class="text-xs opacity-60">${field.note}</p>`
    : '';
  return `<fieldset class="fieldset">
    ${renderFieldLabel(fieldConfig(field), inputId(field.field))}
    ${renderInput(field)}
    ${note}
  </fieldset>`;
}

function readValues(fields: EntityFormField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const el = document.getElementById(inputId(field.field)) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
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
  return values;
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
  // The calendar popovers are body children, so they outlive the modal box and
  // have to be closed when it goes.
  const closeCalendars: Array<() => void> = [];

  const body = `
    <div class="space-y-3">
      ${options.intro ?? ''}
      ${options.fields.map(renderField).join('')}
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
      const first = document.getElementById(inputId(options.fields[0].field));
      if (first instanceof HTMLInputElement) {
        first.focus();
        first.select();
      } else {
        first?.focus();
      }
      for (const field of options.fields) {
        if (field.type !== 'date') {
          continue;
        }
        const input = document.getElementById(inputId(field.field));
        if (input instanceof HTMLInputElement) {
          closeCalendars.push(
            attachCalendarInput(input, {
              codec: field.dateCodec ?? ISO_DATE_CODEC,
              weekStart: CONFIG.WEEK_START,
              allowEmpty: true,
            })
          );
        }
      }
      options.onMount?.(close);
    },
    actions: [
      {
        label: options.createLabel ?? 'Create',
        className: 'btn-primary',
        onClick: async () => {
          const values = readValues(options.fields);
          const message = await options.validate(values);
          if (message !== null) {
            if (message) {
              showError(message);
            }
            return true;
          }
          try {
            await options.onCreate?.(values);
          } catch (error) {
            console.error('[entity-form-modal] create failed', error);
            showError(
              error instanceof Error ? error.message : 'Could not create.'
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

  closeCalendars.forEach((close) => close());
  return created;
}
