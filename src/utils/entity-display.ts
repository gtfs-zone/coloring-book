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

export function getTripDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  const headsign = record['trip_headsign'];
  const shortName = record['trip_short_name'];
  const id = record['trip_id'];
  const name = headsign || shortName;
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

export function getShapeDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  return { primary: record['shape_id'] ?? '' };
}

export function getLevelDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  const name = record['level_name'];
  const id = record['level_id'];
  if (name) {
    return { primary: name, secondary: id };
  }
  return { primary: id ?? '' };
}

export function getPathwayDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  return { primary: record['pathway_id'] ?? '' };
}

export function getFareAttributeDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  return { primary: record['fare_id'] ?? '' };
}

export function getNetworkDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  return { primary: record['network_id'] ?? '' };
}

export function getAreaDisplay(
  record: Record<string, string>
): EntityDisplayInfo {
  return { primary: record['area_id'] ?? '' };
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
