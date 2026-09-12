/**
 * GTFS Field Formatters and Parsers
 *
 * Provides conversion between user-friendly display formats and GTFS specification formats.
 * Each field type has dedicated formatters for:
 * - toDisplay: Convert GTFS format to user-friendly display format
 * - toGTFS: Convert user input to GTFS format
 * - validate: Validate that a value matches the expected format
 */

import { GTFSFieldType, validateFieldType } from '../types/gtfs-field-types';
import { fromInputValue, toInputValue } from './gtfs-date';
import { TimeFormatter } from './time-formatter';

export interface FieldFormatter {
  /**
   * Convert GTFS format to display format for UI
   */
  toDisplay(value: string | number): string;

  /**
   * Convert user input to GTFS format for storage
   */
  toGTFS(value: string): string;

  /**
   * Validate that a value is in the correct format
   */
  validate(value: string | number): { valid: boolean; error?: string };
}

/**
 * Color field formatter
 * GTFS: 6-digit hex without # (e.g., "FFFFFF")
 * Display: Can show with # for color inputs
 */
const colorFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    const str = String(value).trim().toUpperCase();
    // If already has #, return as-is for color input
    if (str.startsWith('#')) {
      return str;
    }
    // For color input type, add #
    return `#${str}`;
  },

  toGTFS(value: string): string {
    // Remove # if present
    return value.trim().replace(/^#/, '').toUpperCase();
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    const str = String(value).trim().replace(/^#/, '');
    return validateFieldType(str, GTFSFieldType.Color);
  },
};

/**
 * Date field formatter
 * GTFS: YYYYMMDD (e.g., "20180913")
 * Display: YYYY-MM-DD for HTML5 date input
 */
const dateFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    return toInputValue(String(value));
  },

  toGTFS(value: string): string {
    return fromInputValue(value);
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    const str = String(value).trim().replace(/-/g, '');
    const result = validateFieldType(str, GTFSFieldType.Date);
    if (!result.valid) {
      return result;
    }

    // Additional date validation
    if (str.length === 8) {
      const year = parseInt(str.substring(0, 4), 10);
      const month = parseInt(str.substring(4, 6), 10);
      const day = parseInt(str.substring(6, 8), 10);

      if (month < 1 || month > 12) {
        return { valid: false, error: 'Month must be between 01 and 12' };
      }
      if (day < 1 || day > 31) {
        return { valid: false, error: 'Day must be between 01 and 31' };
      }
      if (year < 1900 || year > 2200) {
        return { valid: false, error: 'Year must be between 1900 and 2200' };
      }
    }

    return { valid: true };
  },
};

const COLON = 58;
const ZERO = 48;
const NINE = 57;
/** Digit positions in `HH:MM:SS`, hoisted so the check allocates nothing. */
const TIME_DIGIT_POSITIONS = [0, 1, 3, 4, 6, 7];

/**
 * Whether the value is `HH:MM:SS` with two-digit hours and in-range minutes
 * and seconds, tested without allocating.
 *
 * A hot-path shortcut for `timeFormatter.validate`, which is called twice per
 * stop_times row by the feed validator: trimming, a regex and a `split` cost
 * about 13 times what reading eight character codes does (measured 665ms
 * against 52ms over 1.5M rows, two calls each). Deliberately narrower than the
 * full rule - a valid `8:00:00`, or anything needing a trim, returns false and
 * falls through to it, so this can only skip work, never change a verdict.
 */
function isCanonicalTime(value: string): boolean {
  if (
    value.length !== 8 ||
    value.charCodeAt(2) !== COLON ||
    value.charCodeAt(5) !== COLON
  ) {
    return false;
  }
  for (const index of TIME_DIGIT_POSITIONS) {
    const code = value.charCodeAt(index);
    if (code < ZERO || code > NINE) {
      return false;
    }
  }
  const minutes =
    (value.charCodeAt(3) - ZERO) * 10 + (value.charCodeAt(4) - ZERO);
  const seconds =
    (value.charCodeAt(6) - ZERO) * 10 + (value.charCodeAt(7) - ZERO);
  return minutes <= 59 && seconds <= 59;
}

/**
 * Time field formatter
 * GTFS: HH:MM:SS or H:MM:SS, can exceed 24:00:00 (e.g., "25:35:00")
 * Display: Same format, but needs special handling for >24 hour times
 */
const timeFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    return TimeFormatter.formatTimeWithSeconds(String(value).trim());
  },

  toGTFS(value: string): string {
    // Accepts H:M, H:MM, HH:MM, HH:MM:SS and normalizes to HH:MM:SS.
    return TimeFormatter.castTimeToHHMMSS(value);
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    if (typeof value === 'string' && isCanonicalTime(value)) {
      return { valid: true };
    }

    const str = String(value).trim();
    const result = validateFieldType(str, GTFSFieldType.Time);
    if (!result.valid) {
      return result;
    }

    // Additional validation for time components
    const parts = str.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseInt(parts[2], 10);

      if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
        return { valid: false, error: 'Time must contain valid numbers' };
      }
      if (minutes < 0 || minutes > 59) {
        return { valid: false, error: 'Minutes must be between 00 and 59' };
      }
      if (seconds < 0 || seconds > 59) {
        return { valid: false, error: 'Seconds must be between 00 and 59' };
      }
      // Hours can exceed 24 for next-day times
      if (hours < 0) {
        return { valid: false, error: 'Hours cannot be negative' };
      }
    }

    return { valid: true };
  },
};

/**
 * Currency amount formatter
 * GTFS: Decimal string (e.g., "10.50", "100.0000")
 * Display: Formatted with appropriate decimal places
 */
const currencyAmountFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) {
      return String(value);
    }
    // Format with up to 4 decimal places, removing trailing zeros
    return num.toFixed(4).replace(/\.?0+$/, '');
  },

  toGTFS(value: string): string {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return value.trim();
    }
    // Store as string with appropriate precision
    return num.toFixed(4).replace(/\.?0+$/, '');
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    return validateFieldType(String(value), GTFSFieldType.CurrencyAmount);
  },
};

/**
 * Latitude formatter
 * GTFS: Decimal degrees with up to 6 decimal places
 * Display: Formatted to 6 decimal places
 */
const latitudeFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) {
      return String(value);
    }
    return num.toFixed(6);
  },

  toGTFS(value: string): string {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return value.trim();
    }
    return num.toFixed(6);
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(num)) {
      return { valid: false, error: 'Must be a valid number' };
    }
    return validateFieldType(num, GTFSFieldType.Latitude);
  },
};

/**
 * Longitude formatter
 * GTFS: Decimal degrees with up to 6 decimal places
 * Display: Formatted to 6 decimal places
 */
const longitudeFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) {
      return String(value);
    }
    return num.toFixed(6);
  },

  toGTFS(value: string): string {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return value.trim();
    }
    return num.toFixed(6);
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(num)) {
      return { valid: false, error: 'Must be a valid number' };
    }
    return validateFieldType(num, GTFSFieldType.Longitude);
  },
};

/**
 * Default formatter for simple string/number fields
 */
const defaultFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    return String(value);
  },

  toGTFS(value: string): string {
    return value.trim();
  },

  validate(_value: string | number): { valid: boolean; error?: string } {
    return { valid: true };
  },
};

/**
 * Integer formatter
 */
const integerFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    return String(value);
  },

  toGTFS(value: string): string {
    const num = parseInt(value, 10);
    return isNaN(num) ? value.trim() : String(num);
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    const num = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(num)) {
      return { valid: false, error: 'Must be a valid integer' };
    }
    if (!Number.isInteger(num)) {
      return { valid: false, error: 'Must be an integer (no decimal places)' };
    }
    return { valid: true };
  },
};

/**
 * Float formatter
 */
const floatFormatter: FieldFormatter = {
  toDisplay(value: string | number): string {
    return String(value);
  },

  toGTFS(value: string): string {
    const num = parseFloat(value);
    return isNaN(num) ? value.trim() : String(num);
  },

  validate(value: string | number): { valid: boolean; error?: string } {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(num)) {
      return { valid: false, error: 'Must be a valid number' };
    }
    return { valid: true };
  },
};

/**
 * Registry of formatters for each GTFS field type
 */
export const FIELD_FORMATTERS: Record<GTFSFieldType, FieldFormatter> = {
  [GTFSFieldType.Text]: defaultFormatter,
  [GTFSFieldType.URL]: defaultFormatter,
  [GTFSFieldType.Email]: defaultFormatter,
  [GTFSFieldType.PhoneNumber]: defaultFormatter,
  [GTFSFieldType.LanguageCode]: defaultFormatter,
  [GTFSFieldType.CurrencyCode]: defaultFormatter,
  [GTFSFieldType.CurrencyAmount]: currencyAmountFormatter,
  [GTFSFieldType.Timezone]: defaultFormatter,
  [GTFSFieldType.Color]: colorFormatter,
  [GTFSFieldType.Date]: dateFormatter,
  [GTFSFieldType.Time]: timeFormatter,
  [GTFSFieldType.LocalTime]: timeFormatter,
  [GTFSFieldType.ID]: defaultFormatter,
  [GTFSFieldType.UniqueID]: defaultFormatter,
  [GTFSFieldType.ForeignID]: defaultFormatter,
  [GTFSFieldType.Integer]: integerFormatter,
  [GTFSFieldType.NonNegativeInteger]: integerFormatter,
  [GTFSFieldType.NonZeroInteger]: integerFormatter,
  [GTFSFieldType.PositiveInteger]: integerFormatter,
  [GTFSFieldType.Float]: floatFormatter,
  [GTFSFieldType.NonNegativeFloat]: floatFormatter,
  [GTFSFieldType.PositiveFloat]: floatFormatter,
  [GTFSFieldType.Latitude]: latitudeFormatter,
  [GTFSFieldType.Longitude]: longitudeFormatter,
  [GTFSFieldType.Enum]: defaultFormatter,
};

/**
 * Get the formatter for a specific field type
 */
export function getFormatterForFieldType(
  fieldType: GTFSFieldType
): FieldFormatter {
  return FIELD_FORMATTERS[fieldType] || defaultFormatter;
}

/**
 * Format a value for display based on field type
 */
export function formatValueForDisplay(
  value: string | number,
  fieldType: GTFSFieldType
): string {
  const formatter = getFormatterForFieldType(fieldType);
  return formatter.toDisplay(value);
}

/**
 * Convert a value to GTFS format based on field type
 */
export function convertValueToGTFS(
  value: string,
  fieldType: GTFSFieldType
): string {
  const formatter = getFormatterForFieldType(fieldType);
  return formatter.toGTFS(value);
}

/**
 * Validate a value based on field type
 */
export function validateValue(
  value: string | number,
  fieldType: GTFSFieldType
): { valid: boolean; error?: string } {
  const formatter = getFormatterForFieldType(fieldType);
  return formatter.validate(value);
}
