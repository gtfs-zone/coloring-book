import { z } from 'zod';
import { GTFS_FILES } from '../types/gtfs';

// All 31 supported GTFS filenames, derived from the Zod schema registry.
// This is the authoritative list: never hardcode filenames elsewhere.
export const ALL_GTFS_FILES: readonly string[] = GTFS_FILES.map(
  (f) => f.filename
);

// Derive canonical column headers for a file from its Zod schema.
// Returns [] for non-CSV files (e.g. locations.geojson uses z.any()).
export function getFileHeaders(filename: string): string[] {
  const fileInfo = GTFS_FILES.find((f) => f.filename === filename);
  if (!fileInfo) {
    return [];
  }
  const schema = fileInfo.schema;
  if (!(schema instanceof z.ZodObject)) {
    return [];
  }
  return Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);
}

// Generate a headers-only CSV string for a given file
export function makeHeaderOnlyCSV(filename: string): string {
  return getFileHeaders(filename).join(',') + '\n';
}

// Whether a filename is supported (appears in GTFS_FILES)
export function isSupportedFile(filename: string): boolean {
  return GTFS_FILES.some((f) => f.filename === filename);
}
