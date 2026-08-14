/**
 * Feed issues.
 *
 * Turns the validator's per-row messages into the grouped label/count rows the
 * home panel renders, and holds the latest set so the panel can draw without
 * re-running validation on every render (a full pass walks stop_times).
 *
 * Only errors and warnings are grouped: the info level carries row counts
 * (ROUTE_COUNT, STOP_COUNT, ...), which are not problems.
 */

import type { ValidationResults } from './gtfs-validator.js';
import type { IssueRow } from '../utils/issue-card.js';

const CODE_LABELS: Record<string, string> = {
  MISSING_REQUIRED_FIELD: 'missing a required field',
  MISSING_REQUIRED_FILE: 'missing a required file',
  INVALID_REFERENCE: 'referencing a record that does not exist',
  EMPTY_FILE: 'empty',
  DUPLICATE_ID: 'duplicate id',
  INVALID_COORDINATE: 'invalid coordinate',
  INVALID_DATE_FORMAT: 'invalid date',
  INVALID_TIME_FORMAT: 'invalid time',
  INVALID_NUMBER: 'invalid number',
  INVALID_URL: 'invalid URL',
  CONDITIONAL_PRESENCE: 'missing a conditionally required field',
  UNKNOWN_ROUTE_TYPE: 'unknown route_type',
  UNKNOWN_LOCATION_TYPE: 'unknown location_type',
  INVALID_EXCEPTION_TYPE: 'invalid exception_type',
  INVALID_AREA_ASSIGNMENT: 'invalid area assignment',
  TRIP_WITHOUT_STOP_TIMES: 'without any stop_times',
  ORPHANED_STOP: 'not served by any trip',
  NETWORK_ID_CONFLICT: 'conflicting network_id',
  MISSING_CALENDAR_FILE: 'missing calendar file',
  MISSING_COORDS_INHERITED: 'inheriting coordinates from a parent',
};

// Wording worth spelling out per file, keyed by `${file}:${code}`.
const OVERRIDES: Record<string, { label?: string; note?: string }> = {
  'routes.txt:INVALID_REFERENCE': {
    label: 'routes with an agency_id not in agency.txt',
    note: "These routes won't appear under any agency until agency_id is fixed.",
  },
};

let currentIssues: IssueRow[] = [];

export function deriveFeedIssues(results: ValidationResults): IssueRow[] {
  const counts = new Map<string, number>();
  for (const message of [...results.errors, ...results.warnings]) {
    const key = `${message.file ?? 'feed'}:${message.code ?? 'UNKNOWN'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [file, code] = key.split(':');
      const override = OVERRIDES[key];
      const generic =
        CODE_LABELS[code] ?? code.toLowerCase().replace(/_/g, ' ');
      return {
        label: override?.label ?? `${file} rows ${generic}`,
        count,
        note: override?.note,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export function setFeedIssues(issues: IssueRow[]): void {
  currentIssues = issues;
}

export function getFeedIssues(): IssueRow[] {
  return currentIssues;
}
