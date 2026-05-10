export const UNSPECIFIED_AGENCY_ID = '' as const;

export function normalizeAgencyId(
  id: string | number | boolean | undefined | null
): string {
  if (id === undefined || id === null || id === '') {
    return UNSPECIFIED_AGENCY_ID;
  }
  return String(id);
}

/**
 * Returns the set of agency_id values that "belong" to an agency when filtering routes.
 * In multi-agency feeds, only exact matches count. In single-agency feeds, routes that
 * omit agency_id (stored as "") are also owned by the one agency.
 */
export function agencyRouteFilter(
  agencyId: string,
  agencyCount: number
): string[] {
  const normalized = normalizeAgencyId(agencyId);
  if (agencyCount <= 1) {
    // Single-agency: "" routes belong to this agency too
    return normalized === UNSPECIFIED_AGENCY_ID
      ? ['']
      : [normalized, UNSPECIFIED_AGENCY_ID];
  }
  return [normalized];
}
