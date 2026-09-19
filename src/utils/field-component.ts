/**
 * Field Component Utility
 *
 * Provides reusable functions for creating consistent form fields with DaisyUI styling,
 * tooltips, and Zod schema descriptions across the application.
 *
 * Uses proper DaisyUI fieldset structure as documented at:
 * https://daisyui.com/components/fieldset/
 */

import { getGTFSFieldDescription } from './zod-tooltip-helper';
import { renderSpecDescription } from 'interlocking/gtfs/spec-markup';
import {
  renderPresenceBadge,
  renderTooltipTrigger,
  type FieldLabelOptions,
} from 'interlocking/ui/field-label';
import {
  GTFS_PRIMARY_KEYS,
  GTFS_FIELD_TYPES,
  GTFS_FIELD_SPECS,
} from '../types/gtfs';
import type { GTFSPresence } from '../gtfs-spec/types';
import type { z } from 'zod';
import {
  GTFSFieldType,
  getInputTypeForFieldType,
  getInputAttributesForFieldType,
  mapGTFSTypeString,
} from '../types/gtfs-field-types';
import {
  getEnumOptions,
  isEnumField,
  type GTFSEnumOption,
} from '../types/gtfs-enums';

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
  /** Whether the field is required (hard Required only, drives HTML required attribute) */
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
  /**
   * A non-spec column carried by the feed. Rendered without a spec link, and
   * marked so it is not mistaken for a field the reference defines.
   */
  isExtension?: boolean;
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
 * Build structured tooltip content for a field, as HTML.
 *
 * Spec descriptions are stored verbatim from the GTFS reference and carry its
 * markup, so they go through `renderSpecDescription` rather than being shown as
 * literal text.
 */
export function buildFieldTooltipContent(config: FieldConfig): string {
  const parts: string[] = [];
  const description = getFieldTooltip(config);
  if (description) {
    parts.push(renderSpecDescription(description));
  }
  parts.push(
    `<div class="opacity-70">ID: <code class="text-xs">${escapeHtml(config.field)}</code></div>`
  );
  if (config.presence && config.presence !== 'Optional') {
    parts.push(
      `<div class="opacity-70">Presence: ${escapeHtml(config.presence)}</div>`
    );
    if (config.presenceCondition) {
      parts.push(
        `<div class="opacity-70">Condition: ${renderSpecDescription(config.presenceCondition)}</div>`
      );
    }
  }
  return parts.join('');
}

/**
 * Render the shared label content pattern: label text (linked to spec) + presence badge,
 * wrapped in a tooltip trigger showing structured field info on hover.
 * Used by both form field labels and timetable trip property rows.
 *
 * The tooltip itself is portaled to `document.body` and positioned in the
 * viewport by `src/utils/tooltip-position.ts` (see that file for why: DaisyUI's
 * CSS tooltip gets clipped by the scrollable ancestors these labels render
 * inside). There is no direction parameter here since the portal picks a
 * position from the trigger's on-screen location, not a fixed CSS side.
 */
export function renderFieldLabelContent(
  config: FieldConfig,
  options?: FieldLabelOptions
): string {
  // A non-spec field has nothing to link to, and says so instead.
  const specUrl = config.isExtension ? '' : getSpecUrl(config.tableName);
  const tipContent = buildFieldTooltipContent(config);
  const labelText = config.isExtension
    ? `<span class="italic">${escapeHtml(config.label)}</span> <span class="badge badge-ghost badge-xs align-middle">non-spec</span>`
    : escapeHtml(config.label);
  const linkContent = specUrl
    ? `<a href="${specUrl}" target="_blank" rel="noopener noreferrer">${labelText}</a>`
    : labelText;
  const badge = renderPresenceBadge(config.presence, options);
  const presenceMark = badge ? ` ${badge}` : '';

  if (tipContent) {
    return renderTooltipTrigger(tipContent, `${linkContent}${presenceMark}`);
  }
  return `${linkContent}${presenceMark}`;
}

/**
 * Render label content for a spec field without a full `FieldConfig` in hand.
 *
 * For labels naming a field of some other table than the one being rendered,
 * such as an editable-table join column ("Stops" editing `stop_areas.stop_id`),
 * where building the whole config from the schema would be wasted work.
 *
 * Presence is deliberately left off: the field is required of a join row, not
 * of the row being rendered, so a required badge here would be a lie.
 */
export function renderSpecFieldLabelContent(
  tableName: string,
  field: string,
  label: string
): string {
  return renderFieldLabelContent({ field, label, type: 'text', tableName });
}

/**
 * Render a field's label: the spec-linked name, its presence badge, and a lock
 * icon for primary keys.
 *
 * `inputId` is omitted for click-to-edit fields, which have no input to point
 * a `for` attribute at until one is opened.
 */
export function renderFieldLabel(
  config: FieldConfig,
  inputId?: string,
  options?: FieldLabelOptions
): string {
  const labelContent = renderFieldLabelContent(config, options);

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
    <label class="label"${inputId ? ` for="${inputId}"` : ''}>${labelContent}${readonlyIcon}</label>
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
 * Generate field configurations from a Zod schema
 *
 * @param schema - Zod schema (e.g., StopsSchema, RoutesSchema)
 * @param data - Current data object
 * @param tableName - GTFS table name (e.g., 'stops.txt')
 * @returns Array of field configurations with primary keys marked as readonly
 *
 * @example
 * ```typescript
 * import { StopsSchema, GTFS_TABLES } from '../types/gtfs';
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
 * Generate human-readable label from snake_case field name
 */
function generateLabel(fieldName: string): string {
  return fieldName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
