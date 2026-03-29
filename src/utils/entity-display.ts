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
  return { primary: id ?? '' };
}

export function getStopDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  const name = record['stop_name'];
  const id = record['stop_id'];
  if (name) {
    return { primary: name, secondary: id };
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

/**
 * For cards, list items, and detail headers — secondary on its own line, muted.
 */
export function renderCardLabel(info: EntityDisplayInfo): string {
  if (info.secondary) {
    return `<span>${info.primary}<br><span class="text-xs opacity-60">${info.secondary}</span></span>`;
  }
  return `<span>${info.primary}</span>`;
}

/**
 * For dropdowns and inline text — secondary in parens on the same line.
 */
export function renderOptionLabel(info: EntityDisplayInfo): string {
  if (info.secondary) {
    return `${info.primary} (${info.secondary})`;
  }
  return info.primary;
}
