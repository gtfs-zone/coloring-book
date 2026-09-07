/**
 * Coercion of raw CSV strings into the value types the app stores.
 *
 * Shared by the main-thread parser and the import worker so the two cannot
 * drift: a field coerced to a number in one and left a string in the other
 * makes an imported row and a re-parsed row compare unequal.
 */

type FieldValue = string | number;

/** Coerce one CSV cell based on its field name. */
export function parseFieldValue(fieldName: string, value: string): FieldValue {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const stringValue = String(value);

  let shouldBeNumeric = false;
  if (
    fieldName.includes('_lat') ||
    fieldName.includes('_lon') ||
    fieldName === 'stop_lat' ||
    fieldName === 'stop_lon' ||
    fieldName === 'shape_pt_lat' ||
    fieldName === 'shape_pt_lon' ||
    fieldName === 'shape_dist_traveled' ||
    fieldName.includes('_sequence') ||
    fieldName === 'direction_id' ||
    fieldName === 'location_type' ||
    fieldName === 'wheelchair_boarding' ||
    fieldName === 'wheelchair_accessible' ||
    fieldName === 'bikes_allowed' ||
    fieldName === 'pickup_type' ||
    fieldName === 'drop_off_type' ||
    fieldName === 'payment_method' ||
    fieldName === 'transfers' ||
    fieldName === 'transfer_duration' ||
    fieldName === 'route_type' ||
    fieldName === 'route_sort_order' ||
    fieldName === 'continuous_pickup' ||
    fieldName === 'continuous_drop_off' ||
    fieldName === 'exception_type' ||
    fieldName.includes('_type')
  ) {
    shouldBeNumeric = true;
  }

  if (shouldBeNumeric && stringValue !== '') {
    const num = parseFloat(stringValue);
    if (!isNaN(num)) {
      if (Number.isInteger(num)) {
        return parseInt(stringValue, 10);
      }
      return num;
    }
  }

  return stringValue;
}

/** Apply `parseFieldValue` to every cell of every parsed CSV row. */
export function processParsedData<T = Record<string, FieldValue>>(
  data: Record<string, unknown>[]
): T[] {
  return data.map((row) => {
    const processedRow: Record<string, FieldValue> = {};
    for (const [fieldName, value] of Object.entries(row)) {
      processedRow[fieldName] = parseFieldValue(fieldName, value as string);
    }
    return processedRow as T;
  });
}
