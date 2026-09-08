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
import { renderIssueCard } from '../utils/issue-card.js';
import type { IssueItem, IssueRow } from '../utils/issue-card.js';
import { WHITESPACE_FIX_ACTION } from '../utils/whitespace-fix.js';
import {
  getEntityDisplay,
  renderOptionLabel,
} from '../utils/entity-display.js';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys.js';

/** Rows for the entity labels. Just the parser's sync read, narrowed. */
export interface FeedIssueRowSource {
  getFileDataSync(fileName: string): Record<string, unknown>[];
}

/**
 * What `refreshFeedIssuesIfStale` needs to re-run a pass on its own: the
 * validator, the rows for the labels, and a key that tells it whether the feed
 * has moved since the last pass.
 */
export interface FeedIssueRevalidator {
  validate(): Promise<ValidationResults>;
  source: FeedIssueRowSource;
  getStalenessKey(): string;
}

/** Most entities a single issue row lists before it collapses into a tail. */
const MAX_ITEMS = 12;

/**
 * Files whose rows have their own page, and the page-state key to navigate by.
 * A file absent here still lists its offending rows, just without a link.
 * trips.txt is the one exception, handled by `timetableNavData`: a trip has no
 * page but does have a timetable to open.
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
  UNCLEAN_VALUE: 'with hidden whitespace in a value',
  DUPLICATE_KEY: 'sharing a primary key with another row',
  FREQUENCY_OVERLAP: 'with overlapping headway periods',
  FREQUENCY_END_AMBIGUOUS: 'whose end_time lands on a departure',
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
 * Every entity the last pass flagged, keyed by code, for the bulk fixes.
 * The issue rows cap their item lists at MAX_ITEMS for display; a fix has to
 * see all of them, so it reads this instead.
 */
const entitiesByCode = new Map<string, ValidationEntity[]>();

/** Every entity the last pass flagged under one code, uncapped. */
export function getFeedIssueEntities(code: string): ValidationEntity[] {
  return entitiesByCode.get(code) ?? [];
}

/**
 * The revalidator and the staleness key the published issues were derived at.
 * `null` until the editor registers one, which is only the case before boot
 * finishes: until then a render draws the empty list rather than validating.
 */
let revalidator: FeedIssueRevalidator | null = null;
let validatedKey: string | null = null;

/** The pass currently running, if any. */
let pending: Promise<void> | null = null;

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
  if (group.code === 'UNCLEAN_VALUE' && group.field) {
    return {
      label: `${group.file} rows whose ${group.field} carries hidden whitespace`,
      note:
        override?.note ??
        'Usually an export bug: a quoted CSV field that swallowed the line ending. The extra characters are invisible but count, so an id carrying them matches nothing.',
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
    const row: IssueRow = {
      ...feedIssueGroupLabel(group),
      count: group.count,
      items: shown.map((entity) => buildIssueItem(entity, index)),
      moreCount: group.entities.length - shown.length,
    };
    // Hidden whitespace is the one issue with a mechanical fix, and it always
    // arrives in bulk. The button clears every one of them, not just this row.
    if (group.code === 'UNCLEAN_VALUE') {
      row.action = { label: 'Fix all', dataAction: WHITESPACE_FIX_ACTION };
    }
    return row;
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

  // Only navigation data: the card renders an item as a link whenever it
  // carries any data attribute, so a row with no page to go to must carry none.
  const data: Record<string, string> = {};
  if (page && row && String(row[page.idField] ?? '') !== '') {
    data['issue-nav'] = page.nav;
    data['issue-id'] = String(row[page.idField]);
  } else if (entity.file === 'trips.txt' && row) {
    Object.assign(data, timetableNavData(row));
  } else if (entity.file === 'frequencies.txt' && row) {
    // A headway period is edited in the timetable band of its trip's
    // timetable, so it navigates by the trip's route and service. A period
    // whose trip does not exist stays a plain item: there is nothing to open.
    const trip = index.get('trips.txt', String(row.trip_id ?? ''));
    if (trip) {
      Object.assign(data, timetableNavData(trip));
    }
  }

  return {
    label,
    detail: `${entity.field}: ${formatIssueValue(entity.value)}`,
    data,
  };
}

/**
 * Navigation data for a trips.txt row.
 *
 * A trip has no page of its own: it is shown inside the timetable for its
 * route and service, which takes three fields off the row rather than the one
 * id `ENTITY_PAGES` carries. A trip missing either id has no timetable to open,
 * so it stays a plain item.
 */
function timetableNavData(
  row: Record<string, unknown>
): Record<string, string> {
  const route_id = String(row.route_id ?? '');
  const service_id = String(row.service_id ?? '');
  if (route_id === '' || service_id === '') {
    return {};
  }
  const data: Record<string, string> = {
    'issue-nav': 'timetable',
    'issue-route-id': route_id,
    'issue-service-id': service_id,
  };
  const direction_id = String(row.direction_id ?? '');
  if (direction_id !== '') {
    data['issue-direction-id'] = direction_id;
  }
  return data;
}

/**
 * The offending value, made readable. A value whose problem is invisible
 * (surrounding whitespace, an embedded newline from a quoted CSV field) is
 * quoted with its control characters escaped, so "20261231\n" does not read as
 * a perfectly good date.
 *
 * Shared with the use sites (the read-only field tooltips, the picker's
 * synthetic option) so a broken value never renders as a clean id in one place
 * and a quoted one in another.
 */
export function formatIssueValue(value: string): string {
  if (value === '') {
    return '(empty)';
  }
  const hasControlChar = [...value].some((char) => char.charCodeAt(0) < 32);
  if (hasControlChar || value !== value.trim()) {
    return JSON.stringify(value);
  }
  return value;
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

// ─── Dangling references ──────────────────────────────────────────────────────
// The use sites (entity fields, timetable trip properties) ask whether the
// value they are about to render is one the last validation pass flagged. Keyed
// two ways: by value for the read-only render, by row for the per-entity note.

const danglingByValue = new Set<string>();
const danglingByRow = new Map<string, ValidationEntity[]>();

function valueKey(file: string, field: string, value: string): string {
  return `${file}:${field}:${value}`;
}

/**
 * Validate, publish the grouped rows the home panel renders, and index the
 * dangling references so the use sites can colour them.
 */
function publishFeedIssues(
  results: ValidationResults,
  source?: FeedIssueRowSource
): IssueRow[] {
  danglingByValue.clear();
  danglingByRow.clear();
  entitiesByCode.clear();
  for (const message of [...results.errors, ...results.warnings]) {
    if (message.entity && message.code) {
      entitiesByCode.set(message.code, [
        ...(entitiesByCode.get(message.code) ?? []),
        message.entity,
      ]);
    }
  }
  for (const message of results.errors) {
    const entity = message.entity;
    if (!entity || message.code !== 'INVALID_REFERENCE') {
      continue;
    }
    danglingByValue.add(valueKey(entity.file, entity.field, entity.value));
    const key = `${entity.file}:${entity.id}`;
    danglingByRow.set(key, [...(danglingByRow.get(key) ?? []), entity]);
  }

  const issues = deriveFeedIssues(results, source);
  setFeedIssues(issues);
  validatedKey = revalidator?.getStalenessKey() ?? null;
  return issues;
}

export function setFeedIssueRevalidator(next: FeedIssueRevalidator): void {
  revalidator = next;
}

/**
 * Re-run validation if the feed has changed since the issues were published.
 *
 * Called by whatever is about to draw the issues (the home panel). Validation
 * is a full synchronous pass over every table including stop_times, so it is
 * deliberately not wired to the patch events: an edit costs nothing until
 * something asks to see the issues again.
 *
 * The patch version is half the staleness watermark because every user edit
 * goes through the patch log, and it moves on undo, redo and jump too, so
 * undoing a fix brings the issue back. The feed generation is the other half:
 * the patch version resets to 0 on a feed swap, so a fresh unedited feed and
 * the empty boot scaffold both read 0 and the version alone would report "not
 * stale" while these issues describe a feed that is no longer loaded.
 *
 * The pass yields to the event loop, so callers arriving during one are
 * serialized behind it rather than sweeping every table alongside it, and a
 * pass whose key moved on while it ran is discarded instead of published.
 */
export async function refreshFeedIssuesIfStale(): Promise<void> {
  if (!revalidator) {
    return;
  }
  // Wait out a pass that is already running rather than sweeping every table
  // alongside it. At boot the home panel asks once against the empty scaffold
  // and again once the stored feed is restored, and those two used to overlap.
  while (pending) {
    await pending;
  }

  const active = revalidator;
  const key = active.getStalenessKey();
  if (key === validatedKey) {
    return;
  }
  console.log(
    `[FeedIssues] revalidating: issues are from ${validatedKey}, feed is at ${key}`
  );
  const start = performance.now();
  pending = active
    .validate()
    .then((results) => {
      // The feed moved on while the pass ran. Publishing now would stamp these
      // results with the key they no longer describe, leaving issues from a
      // feed that is not loaded looking current. Drop them; the next caller
      // sees the key is still stale and revalidates.
      if (active.getStalenessKey() !== key) {
        console.warn(
          `[FeedIssues] discarding pass from ${key}: feed is now at ${active.getStalenessKey()}`
        );
        return;
      }
      publishFeedIssues(results, active.source);
      console.log(
        `[FeedIssues] revalidated in ${Math.round(performance.now() - start)}ms`
      );
    })
    .finally(() => {
      pending = null;
    });
  await pending;
}

export function isDanglingReference(
  file: string,
  field: string,
  value: string
): boolean {
  return value !== '' && danglingByValue.has(valueKey(file, field, value));
}

/**
 * Drop a reference from the index once it has been repointed, so the use site
 * stops showing it as broken without waiting for the next validation pass.
 */
export function markReferenceResolved(
  file: string,
  field: string,
  value: string
): void {
  danglingByValue.delete(valueKey(file, field, value));
  for (const [key, entities] of danglingByRow) {
    const kept = entities.filter(
      (entity) =>
        !(
          entity.file === file &&
          entity.field === field &&
          entity.value === value
        )
    );
    if (kept.length === 0) {
      danglingByRow.delete(key);
    } else {
      danglingByRow.set(key, kept);
    }
  }
}

/** The dangling references on one row, for the note on its own page. */
export function getRowDanglingRefs(
  file: string,
  recordId: string
): ValidationEntity[] {
  return danglingByRow.get(`${file}:${recordId}`) ?? [];
}

/**
 * The warning note an entity page carries when its own row has a broken
 * reference, so arriving from the home issue card lands on something that
 * explains itself.
 */
export function renderEntityIssueNote(file: string, recordId: string): string {
  const refs = getRowDanglingRefs(file, recordId);
  if (refs.length === 0) {
    return '';
  }
  return renderIssueCard(
    'Issues with this record',
    refs.map((ref) => ({
      label: `${ref.field} refers to '${ref.value}', which does not exist`,
      count: 1,
      note: 'Pick an existing value below, or create the record it refers to.',
    }))
  );
}
