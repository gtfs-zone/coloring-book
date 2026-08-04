import { escapeHtml } from './escape-html.js';

export interface EntityDisplayInfo {
  primary: string; // shown prominently (name, short name, or ID as fallback)
  secondary?: string; // shown as subtext/parens — only set if different from primary
}

// Rule: secondary is only set when there is a meaningful human-readable primary
// that is distinct from the PK. If the primary IS the PK, leave secondary undefined.

export function getAgencyDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  const name = record['agency_name'];
  const id = record['agency_id'];
  if (name) {
    return { primary: name, secondary: id };
  }
  return { primary: id || 'Not specified' };
}

export function getStopDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  const name = record['stop_name'];
  const id = record['stop_id'];
  const parent = record['parent_station'];
  if (name) {
    return parent ? { primary: name, secondary: id } : { primary: name };
  }
  return { primary: id ?? '' };
}

export function getRouteDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  const shortName = record['route_short_name'];
  const longName = record['route_long_name'];
  const id = record['route_id'];
  const name = shortName || longName;
  if (name) {
    return { primary: name, secondary: id };
  }
  return { primary: id ?? '' };
}

export function getServiceDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  return { primary: record['service_id'] ?? '' };
}

export function getTripDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  const name = record['trip_short_name'] || record['trip_headsign'];
  const id = record['trip_id'];
  if (name) {
    return { primary: name, secondary: id };
  }
  return { primary: id ?? '' };
}

/**
 * Generic dispatcher — resolves the display info for any GTFS table row.
 * Falls back to a best-effort `<table>_id` (or `<table>_name`) field, then
 * an empty primary, for tables without a dedicated helper. Callers that only
 * need a single string should read `.primary` (the human name, or the id when
 * no name is present).
 */
export function getEntityDisplay(
  table: string,
  record: Record<string, string>
): EntityDisplayInfo {
  switch (table) {
    case 'agency':
      return getAgencyDisplay(record);
    case 'stops':
      return getStopDisplay(record);
    case 'routes':
      return getRouteDisplay(record);
    case 'calendar':
      return getServiceDisplay(record);
    case 'trips':
      return getTripDisplay(record);
    default: {
      const singular = table.replace(/s$/, '');
      const name = record[`${singular}_name`];
      const id = record[`${singular}_id`] ?? record['id'];
      if (name) {
        return { primary: name, secondary: id };
      }
      return { primary: id ?? '' };
    }
  }
}

/**
 * For cards, list items, and detail headers — secondary on its own line, muted.
 *
 * Returns markup, so it escapes its own values: callers cannot escape the
 * result without also escaping the tags this adds.
 */
export function renderCardLabel(info: EntityDisplayInfo): string {
  if (info.secondary) {
    return `<span>${escapeHtml(info.primary)}<br><span class="text-xs opacity-60">${escapeHtml(info.secondary)}</span></span>`;
  }
  return `<span>${escapeHtml(info.primary)}</span>`;
}

/**
 * For dropdowns and inline text — secondary in parens on the same line.
 *
 * Returns plain text, not markup. Callers are responsible for escaping it.
 */
export function renderOptionLabel(info: EntityDisplayInfo): string {
  if (info.secondary) {
    return `${info.primary} (${info.secondary})`;
  }
  return info.primary;
}
