/**
 * Field Component Utility
 *
 * Provides reusable functions for creating consistent form fields with DaisyUI styling,
 * tooltips, and Zod schema descriptions across the application.
 *
 * Uses proper DaisyUI fieldset structure as documented at:
 * https://daisyui.com/components/fieldset/
 */

import { getGTFSFieldDescription } from './zod-tooltip-helper.js';
import {
  GTFS_PRIMARY_KEYS,
  GTFS_FIELD_TYPES,
  GTFS_FIELD_SPECS,
  GTFSSchemas,
} from '../types/gtfs.js';
import type { GTFSPresence } from '../gtfs-spec/types.js';
import type { z } from 'zod';
import {
  GTFSFieldType,
  getInputTypeForFieldType,
  getInputAttributesForFieldType,
  mapGTFSTypeString,
} from '../types/gtfs-field-types.js';
import { formatValueForDisplay } from './field-formatters.js';
import {
  getEnumOptions,
  isEnumField,
  type GTFSEnumOption,
} from '../types/gtfs-enums.js';

export interface FieldConfig {
  /** Field name in the GTFS specification (e.g., 'stop_name', 'stop_lat') */
  field: string;
  /** Human-readable label for the field */
  label: string;
  /** Input type: text, number, select, textarea, email, url, tel, color, date, time */
  type:
    | 'text'
    | 'number'
    | 'select'
    | 'textarea'
    | 'email'
    | 'url'
    | 'tel'
    | 'color'
    | 'date'
    | 'time';
  /** Current value of the field */
  value?: string | number;
  /** Placeholder text for empty inputs */
  placeholder?: string;
  /** Additional HTML attributes for the input */
  attributes?: Record<string, string | number>;
  /** Options for select inputs */
  options?: Array<{ value: string | number; label: string }>;
  /** GTFS table name for fetching descriptions (e.g., 'stops.txt') */
  tableName?: string;
  /** Custom tooltip override (if not using Zod description) */
  tooltip?: string;
  /** Whether the field is required (hard Required only — drives HTML required attribute) */
  required?: boolean;
  /** Spec presence level for this field */
  presence?: GTFSPresence;
  /** Prose condition for Conditionally Required/Forbidden fields */
  presenceCondition?: string;
  /** When an enum field has an empty-equivalent value in spec, its implicit default */
  emptyEquivalentValue?: string | number;
  /** Custom CSS classes for the input element */
  inputClasses?: string;
  /** Whether the field is readonly (typically for primary keys) */
  readonly?: boolean;
  /** Record identifier used for patch tracking (e.g. agency_id value, or 'feed_info') */
  recordId?: string;
  /** GTFS field type for specialized handling */
  gtfsFieldType?: GTFSFieldType;
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string | number | undefined): string {
  if (text === undefined || text === null) {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Escape text for use inside HTML attribute values (double-quoted).
 * Wraps escapeHtml then also escapes single quotes and double quotes.
 */
function escapeAttr(text: unknown): string {
  return escapeHtml(text as string | number | undefined)
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;');
}

/**
 * Get tooltip description for a field
 */
function getFieldTooltip(config: FieldConfig): string {
  // Use custom tooltip if provided
  if (config.tooltip) {
    return config.tooltip;
  }

  // Get description from Zod schema if table name is provided
  if (config.tableName) {
    const description = getGTFSFieldDescription(config.tableName, config.field);
    return description;
  }

  return '';
}

/**
 * Build a GTFS reference URL for a given table name.
 * Returns empty string when tableName is undefined.
 */
export function getSpecUrl(tableName: string | undefined): string {
  if (!tableName) {
    return '';
  }
  return (
    'https://gtfs.org/documentation/schedule/reference/#' +
    tableName.replace('.', '')
  );
}

/**
 * Render presence indicator (*) with color coding
 */
function renderPresenceMark(config: FieldConfig): string {
  if (!config.presence || config.presence === 'Optional') {
    return '';
  }

  const presenceColors: Partial<Record<GTFSPresence, string>> = {
    Required: 'text-error',
    'Conditionally Required': 'text-warning',
    Recommended: 'text-success',
    'Conditionally Forbidden': 'text-base-content opacity-40',
  };
  const colorClass = presenceColors[config.presence] ?? '';

  return ` <span class="${colorClass}">*</span>`;
}

/**
 * Build structured tooltip content for a field.
 * Returns a multi-part string with labeled sections joined by double newlines.
 */
export function buildFieldTooltipContent(config: FieldConfig): string {
  const parts: string[] = [];
  const description = getFieldTooltip(config);
  if (description) {
    parts.push(`Description: ${description}`);
  }
  parts.push(`ID: ${config.field}`);
  if (config.presence && config.presence !== 'Optional') {
    parts.push(`Presence: ${config.presence}`);
    if (config.presenceCondition) {
      parts.push(`Condition: ${config.presenceCondition}`);
    }
  }
  return parts.join('\n\n');
}

/**
 * Render the shared label content pattern: label text (linked to spec) + presence mark,
 * wrapped in a tooltip container showing structured field info on hover.
 * Used by both form field labels and timetable trip property rows.
 */
export function renderFieldLabelContent(
  config: FieldConfig,
  tooltipDirection: 'top' | 'bottom' | 'left' | 'right' = 'right'
): string {
  const specUrl = getSpecUrl(config.tableName);
  const tipContent = buildFieldTooltipContent(config);
  const labelText = escapeHtml(config.label);
  const linkContent = specUrl
    ? `<a href="${specUrl}" target="_blank" rel="noopener noreferrer">${labelText}</a>`
    : labelText;
  const presenceMark = renderPresenceMark(config);

  if (tipContent) {
    return `<span class="tooltip tooltip-${tooltipDirection}" data-tip="${escapeAttr(tipContent)}">${linkContent}${presenceMark}</span>`;
  }
  return `${linkContent}${presenceMark}`;
}

/**
 * Render label using Pattern 4: Label with for attribute
 */
function renderLabel(config: FieldConfig, inputId: string): string {
  const labelContent = renderFieldLabelContent(config);

  let readonlyIcon = '';
  if (config.readonly) {
    const specUrl = getSpecUrl(config.tableName);
    const lockSvg = `<svg class="w-3 h-3 inline-block opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
       </svg>`;
    readonlyIcon = specUrl
      ? ` <a href="${specUrl}" target="_blank" rel="noopener noreferrer" title="Primary key (read-only)">${lockSvg}</a>`
      : ` ${lockSvg}`;
  }

  return `
    <label class="label" for="${inputId}">${labelContent}${readonlyIcon}</label>
  `;
}

/**
 * Render text or number input field
 */
function renderTextInput(config: FieldConfig, inputId: string): string {
  const attributes = config.attributes || {};
  const attrString = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(' ');

  // Format value for display based on field type
  let displayValue = config.value;
  if (
    config.gtfsFieldType &&
    config.value !== undefined &&
    config.value !== ''
  ) {
    displayValue = formatValueForDisplay(config.value, config.gtfsFieldType);
  }

  return `
    <input
      type="${config.type}"
      id="${inputId}"
      class="input"
      data-field="${config.field}"
      ${config.tableName ? `data-table="${config.tableName}"` : ''}
      ${config.recordId !== undefined ? `data-record-id="${escapeHtml(config.recordId)}"` : ''}
      ${config.gtfsFieldType ? `data-gtfs-type="${config.gtfsFieldType}"` : ''}
      value="${escapeHtml(displayValue)}"
      placeholder="${escapeHtml(config.placeholder || '')}"
      ${config.required ? 'required' : ''}
      ${config.readonly ? 'disabled' : ''}
      ${attrString}
    />
  `;
}

/**
 * Scan enum options for the "An empty value is equivalent to X" pattern in spec descriptions.
 * Returns the equivalent value (as number if parseable, else string), or undefined if absent.
 */
function findEmptyEquivalent(
  options: GTFSEnumOption[]
): string | number | undefined {
  const marker = 'An empty value is equivalent to ';
  for (const opt of options) {
    if (!opt.description) {
      continue;
    }
    const idx = opt.description.indexOf(marker);
    if (idx === -1) {
      continue;
    }
    const rest = opt.description.slice(idx + marker.length);
    // Take the first word and strip trailing period
    const token = rest.split(' ')[0].replace(/\.$/, '');
    const num = Number(token);
    return Number.isNaN(num) ? token : num;
  }
  return undefined;
}

/**
 * Render select dropdown field
 */
function renderSelectInput(config: FieldConfig, inputId: string): string {
  if (!config.options) {
    throw new Error('Select input requires options array');
  }

  const currentValue = String(config.value ?? '');
  const hasValue =
    config.value !== undefined && config.value !== null && config.value !== '';

  // Add empty option for optional fields
  const emptyLabel =
    config.emptyEquivalentValue !== undefined
      ? `-- (empty = ${config.emptyEquivalentValue}) --`
      : '-- Select --';
  const emptyOption = !config.required
    ? `<option value="" ${!hasValue ? 'selected' : ''}>${emptyLabel}</option>`
    : '';

  const optionsHtml = config.options
    .map((option) => {
      const optionValue = String(option.value);
      const selected = optionValue === currentValue ? 'selected' : '';
      return `<option value="${escapeHtml(optionValue)}" ${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join('');

  return `
    <select
      id="${inputId}"
      class="select"
      data-field="${config.field}"
      ${config.tableName ? `data-table="${config.tableName}"` : ''}
      ${config.recordId !== undefined ? `data-record-id="${escapeHtml(config.recordId)}"` : ''}
      ${config.required ? 'required' : ''}
      ${config.readonly ? 'disabled' : ''}
    >
      ${emptyOption}
      ${optionsHtml}
    </select>
  `;
}

/**
 * Render textarea field
 */
function renderTextareaInput(config: FieldConfig, inputId: string): string {
  const attributes = config.attributes || {};
  const attrString = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(' ');

  return `
    <textarea
      id="${inputId}"
      class="textarea"
      data-field="${config.field}"
      ${config.tableName ? `data-table="${config.tableName}"` : ''}
      ${config.recordId !== undefined ? `data-record-id="${escapeHtml(config.recordId)}"` : ''}
      placeholder="${escapeHtml(config.placeholder || '')}"
      ${config.required ? 'required' : ''}
      ${config.readonly ? 'disabled' : ''}
      ${attrString}
    >${escapeHtml(config.value)}</textarea>
  `;
}

/**
 * Render a complete form field using Pattern 4: Fieldset with label
 *
 * Structure follows DaisyUI v5 pattern:
 * <fieldset class="fieldset">
 *   <label class="label" for="id">Label Text</label>
 *   <input id="id" class="input" />
 *   <p class="label">Helper text (optional)</p>
 * </fieldset>
 *
 * @param config - Field configuration
 * @returns HTML string for the complete field
 *
 * @example
 * ```typescript
 * const html = renderFormField({
 *   field: 'stop_name',
 *   label: 'Stop Name',
 *   type: 'text',
 *   value: 'Main Street Station',
 *   placeholder: 'Enter stop name',
 *   tableName: 'stops.txt',
 *   required: true
 * });
 * ```
 */
export function renderFormField(config: FieldConfig): string {
  const inputId = `field-${config.field}`;
  const labelHtml = renderLabel(config, inputId);

  let inputHtml: string;
  switch (config.type) {
    case 'text':
    case 'number':
    case 'email':
    case 'url':
    case 'tel':
    case 'color':
    case 'date':
    case 'time':
      inputHtml = renderTextInput(config, inputId);
      break;
    case 'select':
      inputHtml = renderSelectInput(config, inputId);
      break;
    case 'textarea':
      inputHtml = renderTextareaInput(config, inputId);
      break;
    default:
      throw new Error(`Unsupported field type: ${config.type}`);
  }

  return `
    <fieldset class="fieldset">
      ${labelHtml}
      ${inputHtml}
    </fieldset>
  `;
}

/**
 * Render multiple form fields
 *
 * @param configs - Array of field configurations
 * @returns HTML string with all fieldsets wrapped in a container
 *
 * @example
 * ```typescript
 * const html = renderFormFields([
 *   { field: 'stop_name', label: 'Name', type: 'text', value: stop.stop_name },
 *   { field: 'stop_lat', label: 'Latitude', type: 'number', value: stop.stop_lat }
 * ]);
 * ```
 */
export function renderFormFields(configs: FieldConfig[]): string {
  const fieldsHtml = configs.map((config) => renderFormField(config)).join('');

  return `
    <div class="space-y-3">
      ${fieldsHtml}
    </div>
  `;
}

/**
 * Generate field configurations from a Zod schema
 *
 * @param schema - Zod schema (e.g., StopsSchema, RoutesSchema)
 * @param data - Current data object
 * @param tableName - GTFS table name (e.g., 'stops.txt')
 * @returns Array of field configurations with primary keys marked as readonly
 *
 * @example
 * ```typescript
 * import { StopsSchema, GTFS_TABLES } from '../types/gtfs.js';
 * const configs = generateFieldConfigsFromSchema(
 *   StopsSchema,
 *   stop,
 *   GTFS_TABLES.STOPS
 * );
 * ```
 */
/**
 * Detect GTFS field type from tableName and field name using generated field type mappings
 */
function detectGTFSFieldType(
  tableName: string,
  fieldName: string,
  _innerSchema: z.ZodTypeAny
): GTFSFieldType | undefined {
  // Look up the field type from the generated GTFS_FIELD_TYPES mapping
  const tableTypes =
    GTFS_FIELD_TYPES[tableName as keyof typeof GTFS_FIELD_TYPES];
  if (!tableTypes) {
    return undefined;
  }

  const gtfsTypeString = tableTypes[fieldName as keyof typeof tableTypes];
  if (!gtfsTypeString) {
    return undefined;
  }

  // Map the GTFS type string to the GTFSFieldType enum
  return mapGTFSTypeString(gtfsTypeString);
}

export function generateFieldConfigsFromSchema(
  schema: z.ZodObject<z.ZodRawShape>,
  data: Record<string, string | number | undefined>,
  tableName: string
): FieldConfig[] {
  const configs: FieldConfig[] = [];
  const shape = schema.shape;

  // Get primary key field for this table
  const primaryKeyField =
    GTFS_PRIMARY_KEYS[tableName as keyof typeof GTFS_PRIMARY_KEYS];

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    // Unwrap optional/nullable to get inner type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let innerSchema: any = fieldSchema;
    while (innerSchema._def?.innerType) {
      innerSchema = innerSchema._def.innerType;
    }

    // Determine field type and options
    const typeName = innerSchema._def?.typeName;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isOptional = (fieldSchema as any).isOptional?.() ?? false;

    // Detect GTFS field type for specialized handling
    const gtfsFieldType = detectGTFSFieldType(
      tableName,
      fieldName,
      innerSchema
    );

    let fieldType:
      | 'text'
      | 'number'
      | 'select'
      | 'textarea'
      | 'email'
      | 'url'
      | 'tel'
      | 'color'
      | 'date'
      | 'time' = 'text';
    let options: Array<{ value: string | number; label: string }> | undefined;
    const attributes: Record<string, string | number> = {};

    // Check if this is an enum field first
    let emptyEquivalentValue: string | number | undefined;
    if (isEnumField(fieldName)) {
      fieldType = 'select';
      const enumOptions = getEnumOptions(fieldName);
      if (enumOptions) {
        emptyEquivalentValue = findEmptyEquivalent(enumOptions);
        options = enumOptions.map((opt) => ({
          value: opt.value,
          label: opt.value !== '' ? `${opt.value} - ${opt.label}` : opt.label,
        }));
      }
    }
    // Use GTFS field type metadata if available
    else if (gtfsFieldType) {
      const inputType = getInputTypeForFieldType(gtfsFieldType);
      const typeAttributes = getInputAttributesForFieldType(gtfsFieldType);

      // Map input types
      if (inputType === 'email') {
        fieldType = 'email';
      } else if (inputType === 'url') {
        fieldType = 'url';
      } else if (inputType === 'tel') {
        fieldType = 'tel';
      } else if (inputType === 'color') {
        fieldType = 'color';
      } else if (inputType === 'date') {
        fieldType = 'date';
      } else if (inputType === 'time') {
        fieldType = 'time';
      } else if (inputType === 'number') {
        fieldType = 'number';
      } else {
        fieldType = 'text';
      }

      // Merge type-specific attributes
      Object.assign(attributes, typeAttributes);
    }
    // Fallback to Zod schema type detection
    else if (typeName === 'ZodNumber') {
      fieldType = 'number';

      // Check for min/max constraints
      const checks = innerSchema._def?.checks || [];
      for (const check of checks) {
        if (check.kind === 'min') {
          attributes.min = check.value;
        }
        if (check.kind === 'max') {
          attributes.max = check.value;
        }
      }

      // Special handling for latitude/longitude
      if (fieldName.includes('_lat')) {
        attributes.step = '0.000001';
      } else if (fieldName.includes('_lon')) {
        attributes.step = '0.000001';
      }
    } else if (typeName === 'ZodEnum') {
      fieldType = 'select';
      const enumValues = innerSchema._def?.values || [];
      options = enumValues.map((v: string | number) => ({
        value: v,
        label: String(v),
      }));
    } else if (
      fieldName.includes('_desc') ||
      fieldName.includes('description')
    ) {
      fieldType = 'textarea';
      attributes.rows = '3';
    }

    // Check if this field is a primary key
    const isPrimaryKey = fieldName === primaryKeyField;

    // Generate human-readable label from field name
    const label = generateLabel(fieldName);

    // Look up field spec for presence metadata
    const fieldSpec = GTFS_FIELD_SPECS[tableName]?.[fieldName];

    configs.push({
      field: fieldName,
      label: label,
      type: fieldType,
      value: data[fieldName],
      placeholder: isOptional
        ? `Optional ${label.toLowerCase()}`
        : `Enter ${label.toLowerCase()}`,
      tableName,
      required: fieldSpec ? fieldSpec.presence === 'Required' : !isOptional,
      presence: fieldSpec?.presence,
      presenceCondition: fieldSpec?.presenceCondition,
      emptyEquivalentValue,
      options,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      readonly: isPrimaryKey,
      gtfsFieldType,
    });
  }

  // Sort configs: primary keys first, then required fields, then optional fields
  configs.sort((a, b) => {
    if (a.readonly !== b.readonly) {
      return a.readonly ? -1 : 1;
    }
    if (a.required === b.required) {
      return 0;
    }
    return a.required ? -1 : 1;
  });

  return configs;
}

/**
 * Minimal database interface required by view controllers (read-only queries).
 * Using this type in view controller dependencies prevents accidentally wiring
 * up write operations (updateRow) that should go through patchManager instead.
 */
export interface QueryOnlyDatabase {
  queryRows: (
    tableName: string,
    filter?: Record<string, unknown>
  ) => Promise<unknown[]>;
}

/**
 * Render form fields for a GTFS entity from already-fetched row data.
 *
 * Always sets recordId so form-patch-bridge can record the edit — making it
 * impossible to forget the recordId when this helper is used.
 *
 * @param schema - Zod schema for the entity
 * @param entity - Raw row data (string or number values, as from the DB)
 * @param tableName - GTFS table name including extension (e.g. 'stops.txt')
 * @param recordId - Primary key value for patch recording
 * @returns HTML string with all form fields
 */
export function renderEntityFields(
  schema: z.ZodObject<z.ZodRawShape>,
  entity: Record<string, string | number | undefined>,
  tableName: string,
  recordId: string
): string {
  const fieldConfigs = generateFieldConfigsFromSchema(
    schema,
    entity,
    tableName
  ).map((c) => ({ ...c, recordId }));
  return renderFormFields(fieldConfigs);
}

/**
 * Render form fields for a GTFS entity, fetching raw row data from the database.
 *
 * Always uses raw snake_case row data (matching the schema), always sets recordId,
 * and always looks up the correct schema — making the correct pattern the only option.
 *
 * @param tableName - GTFS table name including extension (e.g. 'routes.txt')
 * @param id - Primary key value for the entity
 * @param database - GTFSDatabase instance (queryRows method)
 * @returns HTML string with all form fields, or empty string if schema/pk not found
 */
export async function renderEntityFormFields(
  tableName: string,
  id: string,
  database: {
    queryRows: (
      table: string,
      filter?: Record<string, unknown>
    ) => Promise<unknown[]>;
  }
): Promise<string> {
  const schema = GTFSSchemas[tableName as keyof typeof GTFSSchemas];
  const pkField =
    GTFS_PRIMARY_KEYS[tableName as keyof typeof GTFS_PRIMARY_KEYS];
  if (!schema || !pkField) {
    return '';
  }

  const table = tableName.replace(/\.txt$/, '');
  const rows = await database.queryRows(table, { [pkField]: id });
  const rowData = (rows[0] as Record<string, unknown>) ?? {};

  const fieldConfigs = generateFieldConfigsFromSchema(
    schema as z.ZodObject<z.ZodRawShape>,
    rowData as Record<string, string | number | undefined>,
    tableName
  ).map((c) => ({ ...c, recordId: id }));
  return renderFormFields(fieldConfigs);
}

/**
 * Generate human-readable label from snake_case field name
 */
function generateLabel(fieldName: string): string {
  return fieldName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
