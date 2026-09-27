/**
 * Feed issues.
 *
 * Turns the validator's per-row messages into the grouped label/count rows the
 * home panel renders, and holds the latest set so the panel can draw without
 * re-running validation on every render (a full pass walks stop_times).
 * `ISSUE_KINDS` gives each validator code its label, note and row actions.
 *
 * Only errors and warnings are grouped: the info level carries row counts
 * (ROUTE_COUNT, STOP_COUNT, ...), which are not problems.
 */

import type { ValidationEntity, ValidationResults } from './gtfs-validator';
import { renderIssueCard } from 'interlocking/ui/issue-card';
import type { IssueItem, IssueRow } from 'interlocking/ui/issue-card';
import type { EditableTableDeps } from './editable-table';
import {
  applyWhitespaceFix,
  describeWhitespaceFix,
} from '../utils/whitespace-fix';
import { deleteTrips, describeTripDelete } from '../utils/trip-delete';
import { getEntityDisplay, renderOptionLabel } from '../utils/entity-display';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';

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

/** One button on an issue row, run on that row's group only. */
export interface IssueKindAction {
  /** Value of the button's `data-issue-action`. */
  id: string;
  label: string;
  /** Deletes rows, so the confirm button is red. */
  destructive?: boolean;
  /** The confirm modal's body, stating how many rows the run touches. */
  confirm(entities: ValidationEntity[]): string;
  /** Writes one patch and returns the result notification's text. */
  run(entities: ValidationEntity[], deps: EditableTableDeps): Promise<string>;
}

export interface IssueKind {
  label(group: IssueGroup): string;
  note?(group: IssueGroup): string | undefined;
  actions?: IssueKindAction[];
}

/** `${file} rows ${text}`, the shape most labels take. */
function rowsLabel(text: string): IssueKind['label'] {
  return (group) => `${group.file} rows ${text}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const ISSUE_KINDS: Record<string, IssueKind> = {
  MISSING_REQUIRED_FIELD: { label: rowsLabel('missing a required field') },
  MISSING_REQUIRED_FILE: { label: rowsLabel('missing a required file') },
  INVALID_REFERENCE: {
    label: (group) => {
      if (group.file === 'routes.txt' && group.field === 'agency_id') {
        return 'routes with an agency_id not in agency.txt';
      }
      return group.field
        ? `${group.file} rows with a ${group.field} that does not exist`
        : `${group.file} rows referencing a record that does not exist`;
    },
    note: (group) =>
      group.file === 'routes.txt' && group.field === 'agency_id'
        ? "These routes won't appear under any agency until agency_id is fixed."
        : undefined,
  },
  EMPTY_FILE: { label: rowsLabel('empty') },
  DUPLICATE_ID: { label: rowsLabel('duplicate id') },
  INVALID_COORDINATE: { label: rowsLabel('invalid coordinate') },
  INVALID_DATE_FORMAT: { label: rowsLabel('invalid date') },
  INVALID_TIME_FORMAT: { label: rowsLabel('invalid time') },
  INVALID_NUMBER: { label: rowsLabel('invalid number') },
  INVALID_URL: { label: rowsLabel('invalid URL') },
  INVALID_CODE: {
    label: (group) =>
      `${group.file} rows whose ${group.field || 'value'} is not a valid code`,
  },
  INVALID_GEOMETRY: {
    label: (group) => `${group.file} zones with an invalid geometry`,
  },
  CONDITIONAL_PRESENCE: {
    label: rowsLabel('missing a conditionally required field'),
  },
  UNKNOWN_ROUTE_TYPE: { label: rowsLabel('unknown route_type') },
  UNKNOWN_LOCATION_TYPE: { label: rowsLabel('unknown location_type') },
  INVALID_EXCEPTION_TYPE: { label: rowsLabel('invalid exception_type') },
  INVALID_AREA_ASSIGNMENT: { label: rowsLabel('invalid area assignment') },
  TRIP_WITHOUT_STOP_TIMES: {
    label: rowsLabel('without any stop_times'),
    actions: [
      {
        id: 'delete-trips',
        label: 'Delete trips',
        destructive: true,
        confirm: (entities) =>
          `Delete ${plural(entities.length, 'trip')} with no stop_times, and any frequencies rows of those trips? This is one undo step.`,
        run: async (entities, deps) =>
          describeTripDelete(
            await deleteTrips(
              entities.map((entity) => entity.id),
              deps
            )
          ),
      },
    ],
  },
  ORPHANED_STOP: {
    label: rowsLabel('with no coordinates of their own or from a parent'),
    note: () =>
      'These are not drawn on the map. Give each one coordinates, or a parent_station that has them.',
  },
  UNPAIRED_FLEX_ROW: {
    label: rowsLabel('with an unpaired pickup/drop-off window'),
    note: () =>
      'Other trips on the route pair this window with a second row for the other direction of travel.',
  },
  RIDER_CATEGORY_DEFAULT: {
    label: () => 'fare products without exactly one default rider category',
  },
  NETWORK_ID_CONFLICT: { label: rowsLabel('conflicting network_id') },
  MISSING_CALENDAR_FILE: { label: rowsLabel('missing calendar file') },
  MISSING_COORDS_INHERITED: {
    label: rowsLabel('inheriting coordinates from a parent'),
  },
  UNCLEAN_VALUE: {
    label: (group) =>
      group.field
        ? `${group.file} rows whose ${group.field} carries hidden whitespace`
        : rowsLabel('with hidden whitespace in a value')(group),
    note: () =>
      'A quoted CSV field that swallowed the line ending. The extra characters are invisible but count, so an id carrying them matches nothing.',
    actions: [
      {
        id: 'fix-whitespace',
        label: 'Fix',
        confirm: (entities) =>
          `Clean the hidden whitespace in ${plural(entities.length, 'value')}? This is one undo step.`,
        run: async (entities, deps) =>
          describeWhitespaceFix(await applyWhitespaceFix(entities, deps)),
      },
    ],
  },
  DUPLICATE_KEY: { label: rowsLabel('sharing a primary key with another row') },
  FREQUENCY_OVERLAP: { label: rowsLabel('with overlapping headway periods') },
  FREQUENCY_END_AMBIGUOUS: {
    label: rowsLabel('whose end_time lands on a departure'),
  },
};

/** Codes already warned about for having no kind, so each warns once. */
const warnedCodes = new Set<string>();

/** The kind for a code, or a generic one built from the code itself. */
function issueKind(code: string): IssueKind {
  const kind = ISSUE_KINDS[code];
  if (kind) {
    return kind;
  }
  if (!warnedCodes.has(code)) {
    warnedCodes.add(code);
    console.warn(
      `[FeedIssues] no issue kind for ${code}, using a generic label`
    );
  }
  return { label: rowsLabel(code.toLowerCase().replace(/_/g, ' ')) };
}

let currentIssues: IssueRow[] = [];

/**
 * Every group the last pass produced, keyed by `file:code:field`, with its full
 * entity list. The issue rows cap their item lists at MAX_ITEMS for display;
 * an action and the full list have to see all of them, so they read this.
 */
const groupsByKey = new Map<string, IssueGroup>();

/** The rows the published groups were labelled from. */
let publishedSource: FeedIssueRowSource | undefined;

/** One group of the last pass, uncapped. */
export function getFeedIssueGroup(key: string): IssueGroup | undefined {
  return groupsByKey.get(key);
}

/** Every group of the last pass, largest first. */
export function getFeedIssueGroups(): IssueGroup[] {
  return [...groupsByKey.values()];
}

/** The actions a group's row offers. None without entities to act on. */
export function getIssueActions(group: IssueGroup): IssueKindAction[] {
  return group.entities.length > 0 ? (issueKind(group.code).actions ?? []) : [];
}

/** A group's action, by the id its button carries. */
export function getIssueAction(
  group: IssueGroup,
  actionId: string
): IssueKindAction | undefined {
  return getIssueActions(group).find((action) => action.id === actionId);
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

/** One label/count row, before the entity list is turned into markup. */
export interface IssueGroup {
  file: string;
  code: string;
  field: string;
  count: number;
  entities: ValidationEntity[];
}

/** `data-issue-key` of a group's row, its buttons and its full-list pane. */
export function groupKey(group: IssueGroup): string {
  return `${group.file}:${group.code}:${group.field}`;
}

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
    const candidate: IssueGroup = {
      file: message.file ?? 'feed',
      code: message.code ?? 'UNKNOWN',
      field: message.field ?? '',
      count: 0,
      entities: [],
    };
    const key = groupKey(candidate);
    const group = groups.get(key) ?? candidate;
    group.count += 1;
    if (message.entity) {
      group.entities.push(message.entity);
    }
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** A group's label and note, from its kind. */
export function feedIssueGroupLabel(group: IssueGroup): {
  label: string;
  note?: string;
} {
  const kind = issueKind(group.code);
  return { label: kind.label(group), note: kind.note?.(group) };
}

export function deriveFeedIssues(
  groups: IssueGroup[],
  source?: FeedIssueRowSource
): IssueRow[] {
  const index = new RowIndex(source);
  return groups.map((group) => {
    const shown = group.entities.slice(0, MAX_ITEMS);
    const row: IssueRow = {
      ...feedIssueGroupLabel(group),
      key: groupKey(group),
      count: group.count,
      items: shown.map((entity) => buildIssueItem(entity, index)),
      moreCount: group.entities.length - shown.length,
    };
    const actions = getIssueActions(group);
    if (actions.length > 0) {
      row.actions = actions.map((action) => ({
        label: action.label,
        dataAction: action.id,
      }));
    }
    return row;
  });
}

/** Every item of one group, uncapped, for the full list. */
export function getFeedIssueItems(group: IssueGroup): IssueItem[] {
  const index = new RowIndex(publishedSource);
  return group.entities.map((entity) => buildIssueItem(entity, index));
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
  for (const message of results.errors) {
    const entity = message.entity;
    if (!entity || message.code !== 'INVALID_REFERENCE') {
      continue;
    }
    danglingByValue.add(valueKey(entity.file, entity.field, entity.value));
    const key = `${entity.file}:${entity.id}`;
    danglingByRow.set(key, [...(danglingByRow.get(key) ?? []), entity]);
  }

  const groups = deriveFeedIssueGroups(results);
  groupsByKey.clear();
  for (const group of groups) {
    groupsByKey.set(groupKey(group), group);
  }
  publishedSource = source;

  const issues = deriveFeedIssues(groups, source);
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
