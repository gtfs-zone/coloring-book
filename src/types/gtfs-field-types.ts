/**
 * GTFS Field Type Definitions
 *
 * Hardcoded field type definitions based on the official GTFS specification.
 * Reference: https://gtfs.org/documentation/schedule/reference/#field-types
 */

/**
 * Enumeration of all GTFS field types
 */
export enum GTFSFieldType {
  Text = 'Text',
  URL = 'URL',
  Email = 'Email',
  PhoneNumber = 'Phone number',
  LanguageCode = 'Language code',
  CurrencyCode = 'Currency code',
  CurrencyAmount = 'Currency amount',
  Timezone = 'Timezone',
  Color = 'Color',
  Date = 'Date',
  Time = 'Time',
  LocalTime = 'Local time',
  ID = 'ID',
  UniqueID = 'Unique ID',
  ForeignID = 'Foreign ID',
  Integer = 'Integer',
  NonNegativeInteger = 'Non-negative integer',
  NonZeroInteger = 'Non-zero integer',
  PositiveInteger = 'Positive integer',
  Float = 'Float',
  NonNegativeFloat = 'Non-negative float',
  PositiveFloat = 'Positive float',
  Latitude = 'Latitude',
  Longitude = 'Longitude',
  Enum = 'Enum',
}

/**
 * Metadata for each GTFS field type including validation rules and UI hints
 */
export interface GTFSFieldTypeMetadata {
  type: GTFSFieldType;
  description: string;
  pattern?: RegExp;
  min?: number;
  max?: number;
  decimals?: number;
  inputType?:
    | 'text'
    | 'number'
    | 'email'
    | 'url'
    | 'tel'
    | 'color'
    | 'date'
    | 'time';
  step?: number | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zodValidator: (z: any) => any;
}

/**
 * Field type metadata registry
 * Contains validation rules, patterns, and constraints for each GTFS field type
 */
export const GTFS_FIELD_TYPE_METADATA: Record<
  GTFSFieldType,
  GTFSFieldTypeMetadata
> = {
  [GTFSFieldType.Text]: {
    type: GTFSFieldType.Text,
    description: 'UTF-8 string intended for display to users',
    inputType: 'text',
    zodValidator: (z) => z.string(),
  },

  [GTFSFieldType.URL]: {
    type: GTFSFieldType.URL,
    description: 'Fully qualified URL including http:// or https://',
    pattern: /^https?:\/\/.+/,
    inputType: 'url',
    zodValidator: (z) => z.string().url(),
  },

  [GTFSFieldType.Email]: {
    type: GTFSFieldType.Email,
    description: 'Email address',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    inputType: 'email',
    zodValidator: (z) => z.string().email(),
  },

  [GTFSFieldType.PhoneNumber]: {
    type: GTFSFieldType.PhoneNumber,
    description: 'Phone number',
    inputType: 'tel',
    zodValidator: (z) => z.string(),
  },

  [GTFSFieldType.LanguageCode]: {
    type: GTFSFieldType.LanguageCode,
    description: 'IETF BCP 47 language code (e.g., en, en-US, de)',
    pattern: /^[a-z]{2,3}(-[A-Z]{2})?$/,
    inputType: 'text',
    zodValidator: (z) =>
      z
        .string()
        .regex(
          /^[a-z]{2,3}(-[A-Z]{2})?$/,
          'Must be a valid IETF BCP 47 language code'
        ),
  },

  [GTFSFieldType.CurrencyCode]: {
    type: GTFSFieldType.CurrencyCode,
    description: 'ISO 4217 alphabetical currency code (e.g., CAD, EUR, JPY)',
    pattern: /^[A-Z]{3}$/,
    inputType: 'text',
    zodValidator: (z) =>
      z
        .string()
        .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code'),
  },

  [GTFSFieldType.CurrencyAmount]: {
    type: GTFSFieldType.CurrencyAmount,
    description:
      'Decimal currency amount; ISO 4217 fixes the number of decimal places for the accompanying currency code (never process as float)',
    inputType: 'number',
    step: 0.01,
    min: 0,
    zodValidator: (z) =>
      z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a valid decimal amount'),
  },

  [GTFSFieldType.Timezone]: {
    type: GTFSFieldType.Timezone,
    description: 'TZ timezone (e.g., Asia/Tokyo, America/Los_Angeles)',
    pattern: /^[A-Za-z_]+\/[A-Za-z_]+$/,
    inputType: 'text',
    zodValidator: (z) => z.string(),
  },

  [GTFSFieldType.Color]: {
    type: GTFSFieldType.Color,
    description:
      'Six-digit hexadecimal color WITHOUT # prefix (e.g., FFFFFF, 0039A6)',
    pattern: /^[0-9A-Fa-f]{6}$/,
    inputType: 'text',
    zodValidator: (z) =>
      z
        .string()
        .regex(/^[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hexadecimal color'),
  },

  [GTFSFieldType.Date]: {
    type: GTFSFieldType.Date,
    description: 'Service day in YYYYMMDD format (e.g., 20180913)',
    pattern: /^\d{8}$/,
    inputType: 'date',
    zodValidator: (z) =>
      z.string().regex(/^\d{8}$/, 'Must be in YYYYMMDD format'),
  },

  [GTFSFieldType.Time]: {
    type: GTFSFieldType.Time,
    description:
      'Time in HH:MM:SS format (can exceed 24:00:00 for next-day times)',
    pattern: /^\d{1,2}:\d{2}:\d{2}$/,
    inputType: 'text',
    zodValidator: (z) =>
      z.string().regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format'),
  },

  [GTFSFieldType.LocalTime]: {
    type: GTFSFieldType.LocalTime,
    description:
      'Wall-clock time in HH:MM:SS format, local to the specified location',
    pattern: /^\d{1,2}:\d{2}:\d{2}$/,
    inputType: 'text',
    zodValidator: (z) =>
      z.string().regex(/^\d{1,2}:\d{2}:\d{2}$/, 'Must be in HH:MM:SS format'),
  },

  [GTFSFieldType.ID]: {
    type: GTFSFieldType.ID,
    description:
      'Internal ID (any UTF-8 characters, printable ASCII recommended)',
    inputType: 'text',
    zodValidator: (z) => z.string(),
  },

  [GTFSFieldType.UniqueID]: {
    type: GTFSFieldType.UniqueID,
    description: 'Unique ID within the file',
    inputType: 'text',
    zodValidator: (z) => z.string(),
  },

  [GTFSFieldType.ForeignID]: {
    type: GTFSFieldType.ForeignID,
    description: 'Foreign ID referencing another table',
    inputType: 'text',
    zodValidator: (z) => z.string(),
  },

  [GTFSFieldType.Integer]: {
    type: GTFSFieldType.Integer,
    description: 'Integer value',
    inputType: 'number',
    step: 1,
    zodValidator: (z) => z.number().int(),
  },

  [GTFSFieldType.NonNegativeInteger]: {
    type: GTFSFieldType.NonNegativeInteger,
    description: 'Non-negative integer (>= 0)',
    inputType: 'number',
    step: 1,
    min: 0,
    zodValidator: (z) => z.number().int().nonnegative(),
  },

  [GTFSFieldType.NonZeroInteger]: {
    type: GTFSFieldType.NonZeroInteger,
    description: 'Integer other than 0',
    inputType: 'number',
    step: 1,
    zodValidator: (z) =>
      z
        .number()
        .int()
        .refine((n: number) => n !== 0, 'Must not be 0'),
  },

  [GTFSFieldType.PositiveInteger]: {
    type: GTFSFieldType.PositiveInteger,
    description: 'Positive integer (> 0)',
    inputType: 'number',
    step: 1,
    min: 1,
    zodValidator: (z) => z.number().int().positive(),
  },

  [GTFSFieldType.Float]: {
    type: GTFSFieldType.Float,
    description: 'Floating point number',
    inputType: 'number',
    step: 'any',
    zodValidator: (z) => z.number(),
  },

  [GTFSFieldType.NonNegativeFloat]: {
    type: GTFSFieldType.NonNegativeFloat,
    description: 'Non-negative float (>= 0)',
    inputType: 'number',
    step: 'any',
    min: 0,
    zodValidator: (z) => z.number().nonnegative(),
  },

  [GTFSFieldType.PositiveFloat]: {
    type: GTFSFieldType.PositiveFloat,
    description: 'Positive float (> 0)',
    inputType: 'number',
    step: 'any',
    min: 0,
    zodValidator: (z) => z.number().positive(),
  },

  [GTFSFieldType.Latitude]: {
    type: GTFSFieldType.Latitude,
    description: 'WGS84 latitude in decimal degrees (-90.0 to 90.0)',
    inputType: 'number',
    step: 0.000001,
    min: -90.0,
    max: 90.0,
    decimals: 6,
    zodValidator: (z) => z.number().min(-90.0).max(90.0),
  },

  [GTFSFieldType.Longitude]: {
    type: GTFSFieldType.Longitude,
    description: 'WGS84 longitude in decimal degrees (-180.0 to 180.0)',
    inputType: 'number',
    step: 0.000001,
    min: -180.0,
    max: 180.0,
    decimals: 6,
    zodValidator: (z) => z.number().min(-180.0).max(180.0),
  },

  [GTFSFieldType.Enum]: {
    type: GTFSFieldType.Enum,
    description: 'Predefined constant from a set',
    inputType: 'text',
    zodValidator: (z) => z.string(),
  },
};

/**
 * Validate a value against a GTFS field type
 */
export function validateFieldType(
  value: unknown,
  fieldType: GTFSFieldType
): {
  valid: boolean;
  error?: string;
} {
  const metadata = GTFS_FIELD_TYPE_METADATA[fieldType];

  if (!metadata) {
    return { valid: false, error: `Unknown field type: ${fieldType}` };
  }

  // Handle empty values
  if (value === null || value === undefined || value === '') {
    return { valid: true };
  }

  // Pattern validation
  if (metadata.pattern && typeof value === 'string') {
    if (!metadata.pattern.test(value)) {
      return {
        valid: false,
        error: `Invalid format for ${fieldType}. ${metadata.description}`,
      };
    }
  }

  // Range validation for numbers
  if (typeof value === 'number') {
    if (metadata.min !== undefined && value < metadata.min) {
      return {
        valid: false,
        error: `Value must be >= ${metadata.min}`,
      };
    }
    if (metadata.max !== undefined && value > metadata.max) {
      return {
        valid: false,
        error: `Value must be <= ${metadata.max}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get the appropriate HTML input type for a GTFS field type
 */
export function getInputTypeForFieldType(fieldType: GTFSFieldType): string {
  return GTFS_FIELD_TYPE_METADATA[fieldType]?.inputType || 'text';
}

/**
 * Get HTML input attributes for a GTFS field type
 */
export function getInputAttributesForFieldType(
  fieldType: GTFSFieldType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const metadata = GTFS_FIELD_TYPE_METADATA[fieldType];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attributes: Record<string, any> = {};

  if (metadata.min !== undefined) {
    attributes.min = metadata.min;
  }
  if (metadata.max !== undefined) {
    attributes.max = metadata.max;
  }
  if (metadata.step !== undefined) {
    attributes.step = metadata.step;
  }
  if (metadata.pattern) {
    attributes.pattern = metadata.pattern.source;
  }

  return attributes;
}

/**
 * Map GTFS type string to GTFSFieldType enum
 * Used when parsing scraped GTFS specification
 */
export function mapGTFSTypeString(typeString: string): GTFSFieldType {
  // Normalize the type string
  const normalized = typeString.trim();

  // Direct matches
  if (normalized in GTFSFieldType) {
    return normalized as GTFSFieldType;
  }

  // Handle special cases and variations
  if (normalized.startsWith('Foreign ID')) {
    return GTFSFieldType.ForeignID;
  }
  if (normalized === 'Unique ID') {
    return GTFSFieldType.UniqueID;
  }
  if (normalized === 'Language code') {
    return GTFSFieldType.LanguageCode;
  }
  if (normalized === 'Phone number') {
    return GTFSFieldType.PhoneNumber;
  }
  if (normalized === 'Currency code') {
    return GTFSFieldType.CurrencyCode;
  }
  if (normalized === 'Currency amount') {
    return GTFSFieldType.CurrencyAmount;
  }
  // translations.txt declares union types ("Text or URL or Email or Phone
  // number"); the widest member is Text, which accepts all of them.
  if (normalized.startsWith('Text or ')) {
    return GTFSFieldType.Text;
  }
  if (normalized.includes('Non-negative') && normalized.includes('integer')) {
    return GTFSFieldType.NonNegativeInteger;
  }
  if (normalized.includes('Positive') && normalized.includes('integer')) {
    return GTFSFieldType.PositiveInteger;
  }
  if (normalized.includes('Non-zero') && normalized.includes('integer')) {
    return GTFSFieldType.NonZeroInteger;
  }
  if (normalized.includes('Non-null') && normalized.includes('integer')) {
    return GTFSFieldType.Integer; // Non-null just means it can be negative
  }
  if (normalized.includes('Non-negative') && normalized.includes('float')) {
    return GTFSFieldType.NonNegativeFloat;
  }
  if (normalized.includes('Positive') && normalized.includes('float')) {
    return GTFSFieldType.PositiveFloat;
  }
  // Check for Enum type by looking for enum value patterns (e.g., "0 - ", "1 - ")
  if (
    normalized.includes('0 - ') ||
    normalized.includes('1 - ') ||
    normalized.match(/\d+\s*-\s*/)
  ) {
    return GTFSFieldType.Enum;
  }

  // Default to Text for unknown types
  console.warn(`Unknown GTFS type: ${typeString}, defaulting to Text`);
  return GTFSFieldType.Text;
}
