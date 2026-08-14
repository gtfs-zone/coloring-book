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

import type { ValidationEntity, ValidationResults } from './gtfs-validator.js';
import type { IssueItem, IssueRow } from '../utils/issue-card.js';
import {
  getEntityDisplay,
  renderOptionLabel,
} from '../utils/entity-display.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';

/** Rows for the entity labels. Just the parser's sync read, narrowed. */
export interface FeedIssueRowSource {
  getFileDataSync(fileName: string): Record<string, unknown>[];
}

/** Most entities a single issue row lists before it collapses into a tail. */
const MAX_ITEMS = 12;

/**
 * Files whose rows have their own page, and the page-state key to navigate by.
 * A file absent here still lists its offending rows, just without a link.
 */
const ENTITY_PAGES: Record<string, { nav: string; idField: string }> = {
  'agency.txt': { nav: 'agency', idField: 'agency_id' },
  'routes.txt': { nav: 'route', idField: 'route_id' },
  'stops.txt': { nav: 'stop', idField: 'stop_id' },
  'calendar.txt': { nav: 'service', idField: 'service_id' },
  'calendar_dates.txt': { nav: 'service', idField: 'service_id' },
  'pathways.txt': { nav: 'pathway', idField: 'pathway_id' },
};

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

// Wording worth spelling out per group, keyed by `${file}:${code}:${field}`.
const OVERRIDES: Record<string, { label?: string; note?: string }> = {
  'routes.txt:INVALID_REFERENCE:agency_id': {
    label: 'routes with an agency_id not in agency.txt',
    note: "These routes won't appear under any agency until agency_id is fixed.",
  },
};

/** One label/count row, before the entity list is turned into markup. */
interface IssueGroup {
  file: string;
  code: string;
  field: string;
  count: number;
  entities: ValidationEntity[];
}

let currentIssues: IssueRow[] = [];

/**
 * Groups messages by file, code and field. Field is part of the key because a
 * single file raises INVALID_REFERENCE for several different columns, and
 * "stop_times rows with a stop_id that does not exist" is actionable where
 * "stop_times rows referencing a record that does not exist" is not.
 */
export function deriveFeedIssueGroups(
  results: ValidationResults
): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const message of [...results.errors, ...results.warnings]) {
    const file = message.file ?? 'feed';
    const code = message.code ?? 'UNKNOWN';
    const field = message.field ?? '';
    const key = `${file}:${code}:${field}`;
    const group = groups.get(key) ?? {
      file,
      code,
      field,
      count: 0,
      entities: [],
    };
    group.count += 1;
    if (message.entity) {
      group.entities.push(message.entity);
    }
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function feedIssueGroupLabel(group: IssueGroup): {
  label: string;
  note?: string;
} {
  const override = OVERRIDES[`${group.file}:${group.code}:${group.field}`];
  if (override?.label) {
    return { label: override.label, note: override.note };
  }
  if (group.code === 'INVALID_REFERENCE' && group.field) {
    return {
      label: `${group.file} rows with a ${group.field} that does not exist`,
      note: override?.note,
    };
  }
  const generic =
    CODE_LABELS[group.code] ?? group.code.toLowerCase().replace(/_/g, ' ');
  return { label: `${group.file} rows ${generic}`, note: override?.note };
}

export function deriveFeedIssues(
  results: ValidationResults,
  source?: FeedIssueRowSource
): IssueRow[] {
  const index = new RowIndex(source);
  return deriveFeedIssueGroups(results).map((group) => {
    const shown = group.entities.slice(0, MAX_ITEMS);
    return {
      ...feedIssueGroupLabel(group),
      count: group.count,
      items: shown.map((entity) => buildIssueItem(entity, index)),
      moreCount: group.entities.length - shown.length,
    };
  });
}

/**
 * The offending row as one list item: its display label, the bad value, and
 * the navigation data the home panel's click handler reads.
 */
function buildIssueItem(entity: ValidationEntity, index: RowIndex): IssueItem {
  const page = ENTITY_PAGES[entity.file];
  const row = index.get(entity.file, entity.id);
  const table = entity.file.replace(/\.txt$/, '');
  const label = row
    ? renderOptionLabel(getEntityDisplay(table, row as Record<string, string>))
    : entity.id || entity.file;

  const data: Record<string, string> = {
    'issue-field': entity.field,
    'issue-value': entity.value,
  };
  if (page && row && String(row[page.idField] ?? '') !== '') {
    data['issue-nav'] = page.nav;
    data['issue-id'] = String(row[page.idField]);
  }

  return { label, detail: `${entity.field}: ${entity.value}`, data };
}

/** Lazily indexes a file's rows by primary key, one file at a time. */
class RowIndex {
  private source?: FeedIssueRowSource;
  private byFile = new Map<string, Map<string, Record<string, unknown>>>();

  constructor(source?: FeedIssueRowSource) {
    this.source = source;
  }

  get(file: string, id: string): Record<string, unknown> | undefined {
    if (!this.source || id === '') {
      return undefined;
    }
    let rows = this.byFile.get(file);
    if (!rows) {
      rows = new Map();
      const tableName = file.replace(/\.txt$/, '');
      for (const row of this.source.getFileDataSync(file)) {
        try {
          rows.set(generateCompositeKeyFromRecord(tableName, row), row);
        } catch {
          // Rows missing their primary key are unreachable by id anyway.
        }
      }
      this.byFile.set(file, rows);
    }
    return rows.get(id);
  }
}

export function setFeedIssues(issues: IssueRow[]): void {
  currentIssues = issues;
}

export function getFeedIssues(): IssueRow[] {
  return currentIssues;
}
