/**
 * GTFS Enumeration Definitions
 *
 * All enum values are derived at runtime from the hand-authored spec in src/gtfs-spec/.
 * The authoritative source is src/gtfs-spec/files/*.ts.
 */

import { gtfsSpec } from '../gtfs-spec/index';
import { deriveGTFSEnums } from '../gtfs-spec/adapter';

export interface GTFSEnumOption {
  value: number | string;
  label: string;
  description?: string;
}

/**
 * Registry of all GTFS enum fields and their valid values
 */
export const GTFS_ENUMS: Record<string, GTFSEnumOption[]> =
  deriveGTFSEnums(gtfsSpec);

/**
 * Get enum options for a specific field
 */
export function getEnumOptions(
  fieldName: string
): GTFSEnumOption[] | undefined {
  return GTFS_ENUMS[fieldName];
}

/**
 * Check if a field is an enum field
 */
export function isEnumField(fieldName: string): boolean {
  return fieldName in GTFS_ENUMS;
}
