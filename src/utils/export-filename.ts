/**
 * Builds the filename used for GTFS zip downloads: a slug of the feed's
 * identity plus today's date, e.g. "bc-transit-2026-08-14.zip".
 */

/** Lowercase, non-alphanumerics collapsed to '-', trimmed and capped. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Local (not UTC) date as YYYY-MM-DD. */
function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * `feedName` is the agency name, falling back to the feed publisher name.
 * Anything empty or unslugifiable falls back to "gtfs".
 */
export function buildExportFilename(feedName?: string | null): string {
  const slug = feedName ? slugify(feedName) : '';
  return `${slug || 'gtfs'}-${todayISO()}.zip`;
}
