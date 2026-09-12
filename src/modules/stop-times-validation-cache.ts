/**
 * Patch-scoped cache of the stop_times-derived validation messages.
 *
 * Six of `GTFSValidator`'s passes walk stop_times, and on a large feed that is
 * essentially the whole cost of `validateFeed`. This module remembers what
 * those passes produced and watches the patch log, so an edit that touched
 * three rows only redoes the work those three rows could have changed.
 *
 * The bar is that the published results stay byte-identical to what a full
 * sweep would have produced. Anything this model cannot guarantee falls back to
 * a full sweep with a logged reason, so a correct slow path is always the
 * default.
 */

import type { ValidationMessage } from './gtfs-validator';
import type { PatchRecord, SingleGTFSPatch } from '../types/patch';
import { GTFS_FOREIGN_KEYS, GTFS_TABLES } from '../types/gtfs';

/** The messages one stop_times row produced in one pass. */
export interface RowIssues {
  index: number;
  messages: ValidationMessage[];
}

/** What a cold sweep records so the next warm sweep can skip the walks. */
export interface StopTimesPassCache {
  feedGeneration: number;
  rowCount: number;
  /** Row-local chunks, one per pass, sorted by row index. */
  stopTimes: RowIssues[];
  conditional: RowIssues[];
  whitespace: RowIssues[];
  foreignKeys: RowIssues[];
  flexLocation: RowIssues[];
  /** validateFlexRowPairing is an aggregate: kept or dropped whole. */
  flexPairing: ValidationMessage[];
  /** validateReferences' set of trip_ids that have stop times. */
  tripsWithStopTimes: Set<unknown>;
}

/** Just the part of PatchManager this module reads. */
export interface PatchLogSource {
  readonly version: number;
  on(
    event: 'undo' | 'redo' | 'change' | 'jump',
    listener: (record?: PatchRecord) => void
  ): void;
}

/**
 * A stop_times update touching one of these cannot be handled row-locally: the
 * first two re-key the row, the last two move it in or out of the flex pairing
 * and location aggregates.
 */
const ROW_SHAPE_FIELDS = new Set([
  'trip_id',
  'stop_sequence',
  'location_id',
  'location_group_id',
]);

/**
 * Read by validateFlexRowPairing, but only for rows that name a location group
 * or zone. Whether this row is one of those is settled during the recheck walk,
 * where the row itself is in hand.
 */
const FLEX_SENSITIVE_FIELDS = new Set(['pickup_type', 'drop_off_type']);

/** Above this many touched rows a full sweep is cheaper than the bookkeeping. */
const MAX_TOUCHED_ROWS = 200;

const LOCATIONS_TABLE = 'locations';

/**
 * Other tables whose edits can move a value set the stop_times passes read,
 * as `table -> fields`. Derived from the spec's foreign keys rather than
 * hand-listed, so a spec refresh cannot leave it stale.
 */
const DEPENDENCY_FIELDS = new Map<string, Set<string>>();
function dependencyField(table: string, field: string): void {
  const fields = DEPENDENCY_FIELDS.get(table) ?? new Set<string>();
  fields.add(field);
  DEPENDENCY_FIELDS.set(table, fields);
}
for (const ref of GTFS_FOREIGN_KEYS) {
  if (ref.file !== GTFS_TABLES.STOP_TIMES) {
    continue;
  }
  for (const target of ref.targets) {
    const table = target.file.replace(/\.(txt|geojson)$/, '');
    dependencyField(table, target.field);
  }
}
// The one dependency the foreign keys do not carry: validateFlexRowPairing
// groups a trip's rows by the trip's route.
dependencyField('trips', 'route_id');

/**
 * Tables where any patch at all invalidates. locations.geojson is a single
 * JSON row rather than a column, so there is no field-level test to make.
 */
const DEPENDENCY_TABLES_ANY = new Set([LOCATIONS_TABLE]);

/** The stop_times ids a warm sweep must recheck, plus how they were flagged. */
export interface WarmSweep {
  data: StopTimesPassCache;
  touched: string[];
  /** Subset of `touched` that also has to be proved not to be a flex row. */
  flexSensitive: Set<string>;
}

export class StopTimesValidationCache {
  private data: StopTimesPassCache | null = null;
  private touched = new Set<string>();
  private flexSensitive = new Set<string>();
  private coldReason: string | null = 'nothing cached yet';
  private patchLog: PatchLogSource | null = null;
  private expectedVersion = 0;

  /**
   * Subscribe to the patch log. Patch events, not version numbers, are the
   * signal: after an undo followed by a new edit the discarded branch is
   * deleted and its version number reused, so version N before and after can be
   * two different patches.
   */
  track(patchLog: PatchLogSource): void {
    this.patchLog = patchLog;
    this.expectedVersion = patchLog.version;
    patchLog.on('change', (record) => this.observe(record));
    patchLog.on('undo', (record) => this.observe(record));
    patchLog.on('redo', (record) => this.observe(record));
    patchLog.on('jump', () => this.invalidate('a history jump'));
  }

  /** Drop everything, e.g. when the feed is replaced. */
  invalidate(reason: string): void {
    if (this.data !== null || this.coldReason === null) {
      console.log(`[StopTimesValidationCache] dropping the cache: ${reason}`);
    }
    this.data = null;
    this.touched.clear();
    this.flexSensitive.clear();
    this.coldReason = reason;
    this.expectedVersion = this.patchLog?.version ?? 0;
  }

  /**
   * Decide whether the next `validateFeed` can run warm. Returns null when it
   * must sweep, having logged why.
   */
  begin(feedGeneration: number, rowCount: number): WarmSweep | null {
    // The version has to have moved exactly as far as the events said it did.
    // Anything else means the patch log was changed without telling us.
    const version = this.patchLog?.version ?? 0;
    if (version !== this.expectedVersion) {
      this.invalidate(
        `the patch version is ${version} but ${this.expectedVersion} events were seen`
      );
    }

    const data = this.data;
    if (!data) {
      console.log(
        `[StopTimesValidationCache] full sweep: ${this.coldReason ?? 'unknown'}`
      );
      return null;
    }
    if (data.feedGeneration !== feedGeneration) {
      this.invalidate(
        `the feed moved from generation ${data.feedGeneration} to ${feedGeneration}`
      );
      return null;
    }
    if (data.rowCount !== rowCount) {
      // A write that bypassed the patch system. Every row number after it has
      // shifted, so nothing cached can be trusted.
      this.invalidate(
        `stop_times went from ${data.rowCount} to ${rowCount} rows without a patch`
      );
      return null;
    }
    if (this.touched.size > MAX_TOUCHED_ROWS) {
      this.invalidate(
        `${this.touched.size} rows were touched, over the ${MAX_TOUCHED_ROWS} row limit`
      );
      return null;
    }

    return {
      data,
      touched: [...this.touched],
      flexSensitive: new Set(this.flexSensitive),
    };
  }

  /** The warm sweep resolved and rechecked its rows; the cache is current. */
  settle(): void {
    console.log(
      `[StopTimesValidationCache] warm sweep rechecked ${this.touched.size} row(s)`
    );
    this.touched.clear();
    this.flexSensitive.clear();
  }

  /** A cold sweep finished: adopt what it built. */
  store(data: StopTimesPassCache): void {
    this.data = data;
    this.touched.clear();
    this.flexSensitive.clear();
    this.coldReason = null;
    this.expectedVersion = this.patchLog?.version ?? 0;
    console.log(
      `[StopTimesValidationCache] cached ${data.rowCount} stop_times rows: ` +
        `${data.stopTimes.length} row / ${data.conditional.length} conditional / ` +
        `${data.whitespace.length} whitespace / ${data.foreignKeys.length} reference / ` +
        `${data.flexLocation.length} zone offending rows, ` +
        `${data.flexPairing.length} pairing warnings`
    );
  }

  // ===== Private =====

  private observe(record?: PatchRecord): void {
    this.expectedVersion = this.patchLog?.version ?? 0;
    if (!record) {
      this.invalidate('a patch event arrived with no patch attached');
      return;
    }
    if (!this.data) {
      return;
    }
    const patch = record.patch;
    const ops: SingleGTFSPatch[] = patch.op === 'batch' ? patch.ops : [patch];
    for (const op of ops) {
      this.classify(op);
      if (!this.data) {
        return;
      }
    }
  }

  /**
   * Direction does not matter here: an update's forward and inverse changes
   * carry the same field names, and an insert or delete forces a sweep either
   * way.
   */
  private classify(op: SingleGTFSPatch): void {
    const table = op.source.table;

    if (table !== 'stop_times') {
      if (DEPENDENCY_TABLES_ANY.has(table)) {
        this.invalidate(`a patch on ${table}`);
        return;
      }
      const fields = DEPENDENCY_FIELDS.get(table);
      if (!fields) {
        return;
      }
      if (op.op !== 'update') {
        this.invalidate(
          `a row was ${op.op === 'insert' ? 'added to' : 'removed from'} ${table}`
        );
        return;
      }
      for (const field of this.changedFields(op)) {
        if (fields.has(field)) {
          this.invalidate(`${table}.${field} changed`);
          return;
        }
      }
      return;
    }

    if (op.op !== 'update') {
      // Row numbers are in both the message text and `line`, so an insert or a
      // delete shifts every later row's messages.
      this.invalidate(
        `a row was ${op.op === 'insert' ? 'added to' : 'removed from'} stop_times, shifting every later row number`
      );
      return;
    }

    let flexSensitive = false;
    for (const field of this.changedFields(op)) {
      if (ROW_SHAPE_FIELDS.has(field)) {
        this.invalidate(`stop_times.${field} changed`);
        return;
      }
      if (FLEX_SENSITIVE_FIELDS.has(field)) {
        flexSensitive = true;
      }
    }
    this.touched.add(op.source.id);
    if (flexSensitive) {
      this.flexSensitive.add(op.source.id);
    }
  }

  private changedFields(op: SingleGTFSPatch): string[] {
    const forward = op.forward as { changes?: Record<string, unknown> };
    return forward.changes ? Object.keys(forward.changes) : [];
  }
}
