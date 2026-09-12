/**
 * Utility functions for extracting Zod schema descriptions and creating tooltips
 */

import {
  AgencySchema,
  RoutesSchema,
  CalendarSchema,
  GTFS_FIELD_SPECS,
} from '../types/gtfs';

/**
 * Extract description from a Zod schema field
 * Handles wrapped types like ZodOptional, ZodNullable, etc.
 */
function getFieldDescription(schema: unknown, fieldName: string): string {
  try {
    if (!schema) {
      return '';
    }

    const s = schema as Record<string, unknown>;
    // Access the schema shape - try multiple ways to be compatible
    const shape = ((s._def as Record<string, unknown>)?.shape || s.shape) as
      | Record<string, unknown>
      | undefined;

    if (!shape) {
      return '';
    }

    if (!shape[fieldName]) {
      return '';
    }

    let field = shape[fieldName] as Record<string, unknown>;

    // Unwrap optional, nullable, and other wrapper types to get to the inner type
    // In Zod v4, optional fields are wrapped in ZodOptional with innerType containing the actual field
    while ((field._def as Record<string, unknown> | undefined)?.innerType) {
      field = (field._def as Record<string, unknown>).innerType as Record<
        string,
        unknown
      >;
    }

    // Try multiple ways to access the description based on Zod's structure
    const description =
      (field.description as string | undefined) || // Direct access
      ((field._def as Record<string, unknown> | undefined)?.description as
        | string
        | undefined) || // Internal _def access
      '';

    return description;
  } catch (e) {
    console.error('Error in getFieldDescription:', e);
    return '';
  }
}

/**
 * Get agency field descriptions
 */
export function getAgencyFieldDescription(fieldName: string): string {
  return getFieldDescription(AgencySchema, fieldName);
}

/**
 * Get route field descriptions
 */
export function getRouteFieldDescription(fieldName: string): string {
  return getFieldDescription(RoutesSchema, fieldName);
}

/**
 * Get calendar field descriptions
 */
export function getCalendarFieldDescription(fieldName: string): string {
  return getFieldDescription(CalendarSchema, fieldName);
}

/**
 * Get field description for any GTFS file type.
 *
 * Reads the spec layer directly rather than the Zod schemas: descriptions are
 * verbatim on `GTFS_FIELD_SPECS` for every file, while the derived Zod schemas
 * attach `.describe()` to the inner type and hide it behind the `.optional()`
 * wrapper on optional fields.
 *
 * @param filename - The GTFS filename (e.g., agency.txt, fare_products.txt)
 * @param fieldName - The field name to get description for
 * @returns Field description string
 */
export function getGTFSFieldDescription(
  filename: string,
  fieldName: string
): string {
  return (
    GTFS_FIELD_SPECS[filename]?.[getSchemaFieldName(fieldName)]?.description ??
    ''
  );
}

/**
 * Create a tooltip wrapper with DaisyUI classes
 */
export function createTooltip(content: string, tooltip: string): string {
  if (!tooltip) {
    return content;
  }

  // Escape HTML in tooltip content
  const escapedTooltip = tooltip
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return `<div class="tooltip tooltip-info" data-tip="${escapedTooltip}">${content}</div>`;
}

/**
 * Keep snake_case field names to match GTFS specification.
 * This ensures consistency with the GTFS type generation.
 */
function formatFieldName(fieldName: string): string {
  // Keep snake_case field names to match GTFS specification
  return fieldName;
}

/**
 * Convert GTFS field name to schema field name
 */
export function getSchemaFieldName(gtfsFieldName: string): string {
  return formatFieldName(gtfsFieldName);
}
