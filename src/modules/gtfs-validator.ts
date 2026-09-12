import { GTFSDatabaseRecord } from './gtfs-database';
import {
  GTFS_TABLES,
  GTFS_FOREIGN_KEYS,
  GTFS_FIELD_SPECS,
} from '../types/gtfs';
import type { GTFSForeignKeyRef } from '../gtfs-spec/adapter';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import { GTFSFieldType, mapGTFSTypeString } from '../types/gtfs-field-types';
import {
  isValidCurrencyCode,
  isValidLanguageCode,
  isValidTimezone,
} from '../utils/constrained-values';
import { validateValue } from '../utils/field-formatters';
import { buildStopCoordResolver, hasValidCoords } from '../utils/stop-coords';
import type { Pathways, Stops } from '../types/gtfs-entities';
import { stopLocationType } from '../utils/area-hierarchy';
import {
  validateFareLegJoinRuleRow,
  validateFareTransferRuleRow,
  validateTimeframeRow,
  validateTransferRow,
} from '../utils/fares-rules';
import {
  validateBookingRuleRow,
  validateFlexStopTimeRow,
  validateLocationGroupId,
} from '../utils/flex-rules';
import {
  frequencyEndIsAmbiguous,
  frequencyPeriodKey,
  frequencyRowProblem,
} from '../utils/frequency-rules';
import { TimeFormatter } from '../utils/time-formatter';
import { yieldToEventLoop } from '../utils/async-yield';
import {
  StopTimesValidationCache,
  type PatchLogSource,
  type RowIssues,
  type StopTimesPassCache,
  type WarmSweep,
} from './stop-times-validation-cache';
import { CONFIG } from '../config';

/** The offending row, so a message can be traced back to an editable object. */
export interface ValidationEntity {
  /** File the offending row lives in, e.g. "trips.txt". */
  file: string;
  /** Primary key of that row, as produced by generateCompositeKeyFromRecord. */
  id: string;
  /** Field carrying the problem. */
  field: string;
  /** Value of that field. */
  value: string;
}

export interface ValidationMessage {
  level: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
  file?: string;
  line?: number;
  field?: string;
  entity?: ValidationEntity;
}

/**
 * Declarations the generic sweep must not treat as hard references. They stay
 * on the spec because the pickers use them to offer options.
 *
 * - calendar_dates.service_id: the reference type is "Foreign ID referencing
 *   calendar.service_id or ID", so a service defined only in calendar_dates.txt
 *   is valid, not dangling.
 * - stop_times.location_id: locations.geojson is not a row table, so there is
 *   no id column to collect values from.
 */
const SKIPPED_FOREIGN_KEYS = new Set([
  'calendar_dates.txt:service_id',
  'stop_times.txt:location_id',
]);

/** Leading/trailing whitespace, or a control character anywhere in the value. */
// eslint-disable-next-line no-control-regex
const UNCLEAN_VALUE = /^\s|\s$|[\u0000-\u001f]/;

export interface ValidationResults {
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  info: ValidationMessage[];
  summary: {
    isValid: boolean;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

interface GTFSParserInterface {
  getFileDataSync(fileName: string): GTFSDatabaseRecord[];
  getFileDataSyncTyped(fileName: string): GTFSDatabaseRecord[];
  getAllFileNames(): string[];
  readonly feedGeneration: number;
}

/**
 * One message, built rather than pushed.
 *
 * The per-row checks write into a caller-supplied sink so the same code can
 * either append to the live results (a cold sweep) or rebuild one row's
 * messages in isolation (a warm sweep). addError/addWarning go through these
 * too, so there is one definition of a message's shape.
 */
function errorMessage(
  message: string,
  code: string,
  fileName: string | null = null,
  rowNum: number | null = null,
  entity: ValidationEntity | null = null
): ValidationMessage {
  return {
    level: 'error',
    message,
    code,
    file: fileName || undefined,
    line: rowNum || undefined,
    field: entity?.field,
    entity: entity || undefined,
  };
}

function warningMessage(
  message: string,
  code: string,
  fileName: string | null = null,
  rowNum: number | null = null,
  entity: ValidationEntity | null = null
): ValidationMessage {
  return {
    level: 'warning',
    message,
    code,
    file: fileName || undefined,
    line: rowNum || undefined,
    field: entity?.field,
    entity: entity || undefined,
  };
}

function emptyResults(): ValidationResults {
  return {
    errors: [],
    warnings: [],
    info: [],
    summary: {
      isValid: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
    },
  };
}

/** A fresh, empty per-pass cache for a cold sweep to fill. */
function emptyPassCache(
  feedGeneration: number,
  rowCount: number
): StopTimesPassCache {
  return {
    feedGeneration,
    rowCount,
    stopTimes: [],
    conditional: [],
    whitespace: [],
    foreignKeys: [],
    flexLocation: [],
    flexPairing: [],
    tripsWithStopTimes: new Set<unknown>(),
  };
}

/**
 * Replace one row's messages in a sparse list that is sorted by row index, so
 * a rebuilt row lands back in the position a full sweep would have put it.
 */
function setRowIssues(
  entries: RowIssues[],
  index: number,
  messages: ValidationMessage[]
): void {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].index < index) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const hit = lo < entries.length && entries[lo].index === index;
  if (messages.length === 0) {
    if (hit) {
      entries.splice(lo, 1);
    }
    return;
  }
  if (hit) {
    entries[lo] = { index, messages };
  } else {
    entries.splice(lo, 0, { index, messages });
  }
}

export class GTFSValidator {
  private gtfsParser: GTFSParserInterface;
  /** The sweep in progress writes here, pass by pass. */
  private validationResults: ValidationResults;
  /** What the last sweep finished with, which is what readers get. */
  private publishedResults: ValidationResults;

  /** Survives across calls; the three below live for one validateFeed run. */
  private stopTimesCache = new StopTimesValidationCache();
  /** Where a cold sweep records its stop_times messages, null when not run
   * from validateFeed (a pass called on its own must not touch the cache). */
  private passCache: StopTimesPassCache | null = null;
  /** Non-null while this run is reusing the cache. */
  private warm: WarmSweep | null = null;
  /** The sweep in progress, so a second caller queues instead of interleaving. */
  private inFlight: Promise<void> | null = null;
  /** The edited rows a warm run has to recheck, by primary key. */
  private touchedRows = new Map<
    string,
    { index: number; row: GTFSDatabaseRecord }
  >();

  constructor(gtfsParser: GTFSParserInterface) {
    this.gtfsParser = gtfsParser;
    this.validationResults = emptyResults();
    this.publishedResults = this.validationResults;
  }

  /**
   * Walk rows, awaiting a macrotask every CONFIG.HYDRATE_YIELD_ROWS rows so the
   * event loop drains. A pass over a 4.5M-row stop_times.txt would otherwise
   * freeze the page for seconds.
   */
  private async eachRow<T>(
    rows: T[],
    fn: (row: T, index: number) => void
  ): Promise<void> {
    for (let index = 0; index < rows.length; index++) {
      if (index > 0 && index % CONFIG.HYDRATE_YIELD_ROWS === 0) {
        await yieldToEventLoop();
      }
      fn(rows[index], index);
    }
  }

  /**
   * Wire the stop_times cache to the patch log, so an edit that touched a few
   * rows can be revalidated without re-walking the table.
   */
  trackPatches(patchLog: PatchLogSource): void {
    this.stopTimesCache.track(patchLog);
  }

  /** Drop the stop_times cache, e.g. when the feed is replaced. */
  invalidateStopTimesCache(reason: string): void {
    this.stopTimesCache.invalidate(reason);
  }

  /**
   * Validate the whole feed.
   *
   * Runs serialized: a sweep yields to the event loop between passes, and a
   * patch event landing in one of those gaps re-renders the home panel, which
   * asks for the issues, which asks to validate. Two sweeps interleaving would
   * write into the same results and the same cache. Callers arriving during a
   * sweep queue behind it and get their own pass over the feed as it stands
   * when their turn comes.
   */
  async validateFeed(): Promise<ValidationResults> {
    const running = this.inFlight;
    let done!: () => void;
    const turn = new Promise<void>((resolve) => {
      done = resolve;
    });
    this.inFlight = turn;
    if (running) {
      console.log(
        '[GTFSValidator] a sweep is already running: queueing behind it'
      );
      await running;
    }
    try {
      return await this.sweepFeed();
    } finally {
      done();
      if (this.inFlight === turn) {
        this.inFlight = null;
      }
    }
  }

  private async sweepFeed(): Promise<ValidationResults> {
    this.validationResults = emptyResults();

    const stopTimes = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.STOP_TIMES
    );
    const generation = this.gtfsParser.feedGeneration;
    this.warm = this.stopTimesCache.begin(generation, stopTimes.length);
    if (this.warm) {
      const problem = await this.resolveTouchedRows(stopTimes, this.warm);
      if (problem) {
        this.stopTimesCache.invalidate(problem);
        this.warm = null;
      }
    }
    const passCache = this.warm
      ? this.warm.data
      : emptyPassCache(generation, stopTimes.length);
    this.passCache = passCache;

    // Run all validation checks, yielding between passes so the page keeps
    // painting while a large feed is swept.
    const passes = [
      () => this.validateRequiredFiles(),
      () => this.validateAgencies(),
      () => this.validateRoutes(),
      () => this.validateTrips(),
      () => this.validateStops(),
      () => this.validateStopTimes(),
      () => this.validateCalendar(),
      () => this.validateShapes(),
      () => this.validateNetworks(),
      () => this.validateStopAreas(),
      () => this.validateFlexLocations(),
      () => this.validateTransfers(),
      () => this.validateFrequencies(),
      () => this.validateConditionalPresence(),
      () => this.validateRiderCategoryDefaults(),
      () => this.validateForeignKeys(),
      () => this.validateFieldWhitespace(),
      () => this.validateConstrainedCodes(),
      () => this.validateReferences(),
    ];
    try {
      for (const pass of passes) {
        await pass();
        await yieldToEventLoop();
      }
      if (this.warm) {
        this.stopTimesCache.settle();
      } else {
        this.stopTimesCache.store(passCache);
      }
    } finally {
      // A pass called on its own (the timing snippet in
      // docs/validation-performance.md does exactly that) must run cold and
      // must not append to the stored cache, so nothing outlives the run.
      this.passCache = null;
      this.warm = null;
      this.touchedRows = new Map();
    }

    // Update summary
    this.validationResults.summary.errorCount =
      this.validationResults.errors.length;
    this.validationResults.summary.warningCount =
      this.validationResults.warnings.length;
    this.validationResults.summary.infoCount =
      this.validationResults.info.length;
    this.validationResults.summary.isValid =
      this.validationResults.errors.length === 0;

    this.publishedResults = this.validationResults;
    return this.validationResults;
  }

  /**
   * Locate the rows a warm sweep has to recheck, and their row numbers.
   *
   * Returns a reason to sweep in full instead, or null when every edited row
   * was found. Row numbers are only available by position, and copy-on-read
   * rules out matching the stored row by identity, so this is one walk with a
   * trip_id pre-filter: the composite key is only built for the handful of
   * rows that pass it. It is the one remaining linear step on the warm path.
   */
  private async resolveTouchedRows(
    stopTimes: GTFSDatabaseRecord[],
    warm: WarmSweep
  ): Promise<string | null> {
    this.touchedRows = new Map();
    if (warm.touched.length === 0) {
      return null;
    }

    const wanted = new Set(warm.touched);
    // A stop_times key is `trip_id:stop_sequence`, and a stop_sequence carries
    // no colon, so everything before the last one is the trip_id. Only a
    // pre-filter: the composite key below is what actually decides.
    const wantedTrips = new Set(
      warm.touched.map((id) => id.slice(0, id.lastIndexOf(':')))
    );
    await this.eachRow(stopTimes, (row, index) => {
      const trip = (row as Record<string, unknown>).trip_id;
      if (
        !wantedTrips.has(typeof trip === 'string' ? trip : String(trip ?? ''))
      ) {
        return;
      }
      const id = this.rowId('stop_times', row);
      if (wanted.has(id)) {
        this.touchedRows.set(id, { index, row });
      }
    });

    if (this.touchedRows.size !== wanted.size) {
      return `${wanted.size - this.touchedRows.size} edited stop_times row(s) could not be located`;
    }

    // pickup_type / drop_off_type only reach validateFlexRowPairing's
    // aggregate on a row that names a location group or zone. The row itself
    // settles that, and its location fields cannot have moved: an edit to one
    // of those forces a sweep before it gets here.
    for (const id of warm.flexSensitive) {
      const row = this.touchedRows.get(id)?.row as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        continue;
      }
      if (
        String(row.location_group_id ?? '').trim() !== '' ||
        String(row.location_id ?? '').trim() !== ''
      ) {
        return `pickup_type or drop_off_type changed on flex row ${id}`;
      }
    }
    return null;
  }

  /** Rebuild the edited rows' messages in one pass's sparse list. */
  private refreshChunk(
    entries: RowIssues[],
    produce: (
      row: GTFSDatabaseRecord,
      rowNum: number,
      out: ValidationMessage[]
    ) => void
  ): void {
    for (const { index, row } of this.touchedRows.values()) {
      const messages: ValidationMessage[] = [];
      produce(row, index + 1, messages);
      setRowIssues(entries, index, messages);
    }
  }

  /** Replay a cached chunk in row order, which is the order a sweep produced. */
  private emitChunk(entries: RowIssues[], sink: ValidationMessage[]): void {
    for (const entry of entries) {
      for (const message of entry.messages) {
        sink.push(message);
      }
    }
  }

  /**
   * Whether the feed defines demand-responsive zones, which is what makes
   * stops.txt optional rather than required.
   */
  private hasDemandResponsiveZones(): boolean {
    const collection = this.gtfsParser.getFileDataSync(
      GTFS_TABLES.LOCATIONS_GEOJSON
    )[0] as unknown as Partial<GeoJSON.FeatureCollection> | undefined;
    return (collection?.features ?? []).some(
      (feature) => String(feature.id ?? '').trim() !== ''
    );
  }

  validateRequiredFiles() {
    const requiredFiles = [
      GTFS_TABLES.AGENCY,
      GTFS_TABLES.ROUTES,
      GTFS_TABLES.TRIPS,
      // stops.txt is Conditionally Required: optional when the feed defines
      // demand-responsive zones in locations.geojson, required otherwise.
      ...(this.hasDemandResponsiveZones() ? [] : [GTFS_TABLES.STOPS]),
      GTFS_TABLES.STOP_TIMES,
    ];

    const calendarFiles = [GTFS_TABLES.CALENDAR, GTFS_TABLES.CALENDAR_DATES];
    let hasCalendarFile = false;

    requiredFiles.forEach((fileName) => {
      if (this.gtfsParser.getFileDataSync(fileName).length === 0) {
        this.addError(
          `Required file ${fileName} is empty`,
          'MISSING_REQUIRED_FILE',
          fileName
        );
      }
    });

    // Check calendar files - at least one is required
    calendarFiles.forEach((fileName) => {
      if (this.gtfsParser.getFileDataSync(fileName).length > 0) {
        hasCalendarFile = true;
      }
    });

    if (!hasCalendarFile) {
      this.addError(
        'At least one calendar file is required: calendar.txt or calendar_dates.txt',
        'MISSING_CALENDAR_FILE'
      );
    }
  }

  validateAgencies() {
    const agencies = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.AGENCY);
    if (agencies.length === 0) {
      this.addError('agency.txt is empty', 'EMPTY_FILE', GTFS_TABLES.AGENCY);
      return;
    }

    const agency_ids = new Set();

    agencies.forEach((agency, index: number) => {
      const rowNum = index + 1;

      // Required fields
      if (!agency.agency_name || String(agency.agency_name).trim() === '') {
        this.addError(
          `Row ${rowNum}: agency_name is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      }

      if (!agency.agency_url || String(agency.agency_url).trim() === '') {
        this.addError(
          `Row ${rowNum}: agency_url is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      } else if (!this.isValidUrl(String(agency.agency_url))) {
        this.addError(
          `Row ${rowNum}: agency_url is not a valid URL`,
          'INVALID_URL',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      }

      if (
        !agency.agency_timezone ||
        String(agency.agency_timezone).trim() === ''
      ) {
        this.addError(
          `Row ${rowNum}: agency_timezone is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      }

      // Check for duplicate agency_id
      if (agency.agency_id) {
        if (agency_ids.has(agency.agency_id)) {
          this.addError(
            `Row ${rowNum}: Duplicate agency_id '${agency.agency_id}'`,
            'DUPLICATE_ID',
            GTFS_TABLES.AGENCY,
            rowNum
          );
        }
        agency_ids.add(agency.agency_id);
      } else if (agencies.length > 1) {
        this.addError(
          `Row ${rowNum}: agency_id is required when multiple agencies exist`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      }
    });

    this.addInfo(`Found ${agencies.length} agencies`, 'AGENCY_COUNT');
  }

  validateRoutes() {
    const routes = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.ROUTES);

    if (routes.length === 0) {
      this.addError('routes.txt is empty', 'EMPTY_FILE', GTFS_TABLES.ROUTES);
      return;
    }

    const route_ids = new Set();

    routes.forEach((route, index: number) => {
      const rowNum = index + 1;

      // Required fields
      if (!route.route_id || String(route.route_id).trim() === '') {
        this.addError(
          `Row ${rowNum}: route_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.ROUTES,
          rowNum
        );
      } else {
        if (route_ids.has(route.route_id)) {
          this.addError(
            `Row ${rowNum}: Duplicate route_id '${route.route_id}'`,
            'DUPLICATE_ID',
            GTFS_TABLES.ROUTES,
            rowNum
          );
        }
        route_ids.add(route.route_id);
      }

      if (!route.route_short_name && !route.route_long_name) {
        this.addError(
          `Row ${rowNum}: Either route_short_name or route_long_name is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.ROUTES,
          rowNum
        );
      }

      if (!route.route_type) {
        this.addError(
          `Row ${rowNum}: route_type is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.ROUTES,
          rowNum
        );
      } else {
        const validRouteTypes = [
          '0',
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
          '7',
          '11',
          '12',
        ];
        if (!validRouteTypes.includes(String(route.route_type))) {
          this.addWarning(
            `Row ${rowNum}: Unknown route_type '${route.route_type}'`,
            'UNKNOWN_ROUTE_TYPE',
            GTFS_TABLES.ROUTES,
            rowNum
          );
        }
      }
    });

    this.addInfo(`Found ${routes.length} routes`, 'ROUTE_COUNT');
  }

  async validateStops() {
    const stops = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.STOPS);
    if (stops.length === 0) {
      // A zone-only demand-responsive feed legitimately has no stops.
      if (!this.hasDemandResponsiveZones()) {
        this.addError('stops.txt is empty', 'EMPTY_FILE', GTFS_TABLES.STOPS);
      }
      return;
    }

    const stop_ids = new Set();
    // Per GTFS spec, lat/lon are only required for stops/platforms (0),
    // stations (1), and entrances/exits (2). Generic nodes (3) and boarding
    // areas (4) may omit them and inherit position from their parent_station.
    // We accept missing coords for any location_type as long as a coord-having
    // ancestor exists; otherwise we error (for 0/1/2) or warn (for 3/4).
    const pathways =
      this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.PATHWAYS) || [];
    const resolveCoord = buildStopCoordResolver(
      stops as Stops[],
      pathways as Pathways[]
    );

    await this.eachRow(stops, (stop, index) => {
      const rowNum = index + 1;

      // Required fields
      if (!stop.stop_id || String(stop.stop_id).trim() === '') {
        this.addError(
          `Row ${rowNum}: stop_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOPS,
          rowNum
        );
      } else {
        if (stop_ids.has(stop.stop_id)) {
          this.addError(
            `Row ${rowNum}: Duplicate stop_id '${stop.stop_id}'`,
            'DUPLICATE_ID',
            GTFS_TABLES.STOPS,
            rowNum
          );
        }
        stop_ids.add(stop.stop_id);
      }

      if (!stop.stop_name || String(stop.stop_name).trim() === '') {
        this.addError(
          `Row ${rowNum}: stop_name is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOPS,
          rowNum
        );
      }

      // Validate coordinates
      const locType = String(stop.location_type ?? '0').trim() || '0';
      const coordRequiredByType =
        locType === '0' || locType === '1' || locType === '2';
      const stopHasOwnCoords = hasValidCoords(stop as Stops);
      const latHasValue =
        stop.stop_lat !== null &&
        stop.stop_lat !== undefined &&
        !(typeof stop.stop_lat === 'string' && stop.stop_lat.trim() === '');
      const lonHasValue =
        stop.stop_lon !== null &&
        stop.stop_lon !== undefined &&
        !(typeof stop.stop_lon === 'string' && stop.stop_lon.trim() === '');

      if (
        latHasValue &&
        !this.isValidLatitude(stop.stop_lat as string | number)
      ) {
        this.addError(
          `Row ${rowNum}: stop_lat must be between -90.0 and 90.0`,
          'INVALID_COORDINATE',
          GTFS_TABLES.STOPS,
          rowNum
        );
      }
      if (
        lonHasValue &&
        !this.isValidLongitude(stop.stop_lon as string | number)
      ) {
        this.addError(
          `Row ${rowNum}: stop_lon must be between -180.0 and 180.0`,
          'INVALID_COORDINATE',
          GTFS_TABLES.STOPS,
          rowNum
        );
      }

      if (!stopHasOwnCoords) {
        const hasAncestorCoords =
          stop.stop_id !== undefined &&
          stop.stop_id !== null &&
          resolveCoord(String(stop.stop_id)) !== null;
        if (coordRequiredByType && !hasAncestorCoords) {
          this.addError(
            `Row ${rowNum}: stop_lat/stop_lon are required for location_type=${locType} (no coord-having parent_station)`,
            'MISSING_REQUIRED_FIELD',
            GTFS_TABLES.STOPS,
            rowNum
          );
        } else if (coordRequiredByType && hasAncestorCoords) {
          this.addWarning(
            `Row ${rowNum}: stop_lat/stop_lon missing for location_type=${locType}; rendering via parent_station coords`,
            'MISSING_COORDS_INHERITED',
            GTFS_TABLES.STOPS,
            rowNum
          );
        } else if (!coordRequiredByType && !hasAncestorCoords) {
          this.addWarning(
            `Row ${rowNum}: stop has no own coords and no coord-having parent_station, will not render`,
            'ORPHANED_STOP',
            GTFS_TABLES.STOPS,
            rowNum
          );
        }
      }

      // Validate location_type
      if (stop.location_type) {
        const validLocationTypes = ['0', '1', '2', '3', '4'];
        if (!validLocationTypes.includes(String(stop.location_type))) {
          this.addWarning(
            `Row ${rowNum}: Unknown location_type '${stop.location_type}'`,
            'UNKNOWN_LOCATION_TYPE',
            GTFS_TABLES.STOPS,
            rowNum
          );
        }
      }
    });

    this.addInfo(`Found ${stops.length} stops`, 'STOP_COUNT');
  }

  async validateTrips() {
    const trips = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.TRIPS);

    if (trips.length === 0) {
      this.addError('trips.txt is empty', 'EMPTY_FILE', GTFS_TABLES.TRIPS);
      return;
    }

    const trip_ids = new Set();

    await this.eachRow(trips, (trip, index) => {
      const rowNum = index + 1;

      // Required fields
      if (!trip.trip_id || String(trip.trip_id).trim() === '') {
        this.addError(
          `Row ${rowNum}: trip_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.TRIPS,
          rowNum
        );
      } else {
        if (trip_ids.has(trip.trip_id)) {
          this.addError(
            `Row ${rowNum}: Duplicate trip_id '${trip.trip_id}'`,
            'DUPLICATE_ID',
            GTFS_TABLES.TRIPS,
            rowNum
          );
        }
        trip_ids.add(trip.trip_id);
      }

      if (!trip.route_id || String(trip.route_id).trim() === '') {
        this.addError(
          `Row ${rowNum}: route_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.TRIPS,
          rowNum
        );
      }

      if (!trip.service_id || String(trip.service_id).trim() === '') {
        this.addError(
          `Row ${rowNum}: service_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.TRIPS,
          rowNum
        );
      }
    });

    this.addInfo(`Found ${trips.length} trips`, 'TRIP_COUNT');
  }

  async validateStopTimes() {
    const stopTimes = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.STOP_TIMES
    );

    if (stopTimes.length === 0) {
      this.addError(
        'stop_times.txt is empty',
        'EMPTY_FILE',
        GTFS_TABLES.STOP_TIMES
      );
      return;
    }

    const errors = this.validationResults.errors;
    const entries = this.passCache?.stopTimes ?? null;
    if (this.warm && entries) {
      this.refreshChunk(entries, (row, rowNum, out) =>
        this.stopTimeRowIssues(row, rowNum, out)
      );
      this.emitChunk(entries, errors);
    } else {
      await this.eachRow(stopTimes, (stopTime, index) => {
        const before = errors.length;
        this.stopTimeRowIssues(stopTime, index + 1, errors);
        if (entries && errors.length > before) {
          entries.push({ index, messages: errors.slice(before) });
        }
      });
    }

    this.addInfo(`Found ${stopTimes.length} stop times`, 'STOP_TIME_COUNT');
  }

  /** The per-row rules of stop_times.txt. */
  private stopTimeRowIssues(
    stopTime: GTFSDatabaseRecord,
    rowNum: number,
    out: ValidationMessage[]
  ): void {
    // Required fields
    if (!stopTime.trip_id || String(stopTime.trip_id).trim() === '') {
      out.push(
        errorMessage(
          `Row ${rowNum}: trip_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        )
      );
    }

    // stop_id is only required when the row names neither a location group
    // nor a zone; validateConditionalPresence carries that rule.

    if (
      stopTime.stop_sequence === null ||
      stopTime.stop_sequence === undefined
    ) {
      out.push(
        errorMessage(
          `Row ${rowNum}: stop_sequence is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        )
      );
    } else if (isNaN(parseInt(String(stopTime.stop_sequence)))) {
      out.push(
        errorMessage(
          `Row ${rowNum}: stop_sequence must be a number`,
          'INVALID_NUMBER',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        )
      );
    }

    // Validate time format
    if (
      stopTime.arrival_time &&
      !this.isValidTime(String(stopTime.arrival_time))
    ) {
      out.push(
        errorMessage(
          `Row ${rowNum}: arrival_time format is invalid`,
          'INVALID_TIME_FORMAT',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        )
      );
    }

    if (
      stopTime.departure_time &&
      !this.isValidTime(String(stopTime.departure_time))
    ) {
      out.push(
        errorMessage(
          `Row ${rowNum}: departure_time format is invalid`,
          'INVALID_TIME_FORMAT',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        )
      );
    }
  }

  validateCalendar() {
    const calendar = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.CALENDAR);
    const calendarDates = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.CALENDAR_DATES
    );

    if (calendar) {
      calendar.forEach((service, index: number) => {
        const rowNum = index + 1;
        const serviceId = this.rowId('calendar', service);

        if (!service.service_id || String(service.service_id).trim() === '') {
          this.addError(
            `Row ${rowNum}: service_id is required`,
            'MISSING_REQUIRED_FIELD',
            GTFS_TABLES.CALENDAR,
            rowNum
          );
        }

        // Validate date format
        if (
          service.start_date &&
          !this.isValidDate(String(service.start_date))
        ) {
          this.addError(
            `Row ${rowNum}: start_date '${String(service.start_date)}' is invalid (should be YYYYMMDD)`,
            'INVALID_DATE_FORMAT',
            GTFS_TABLES.CALENDAR,
            rowNum,
            {
              file: GTFS_TABLES.CALENDAR,
              id: serviceId,
              field: 'start_date',
              value: String(service.start_date),
            }
          );
        }

        if (service.end_date && !this.isValidDate(String(service.end_date))) {
          this.addError(
            `Row ${rowNum}: end_date '${String(service.end_date)}' is invalid (should be YYYYMMDD)`,
            'INVALID_DATE_FORMAT',
            GTFS_TABLES.CALENDAR,
            rowNum,
            {
              file: GTFS_TABLES.CALENDAR,
              id: serviceId,
              field: 'end_date',
              value: String(service.end_date),
            }
          );
        }
      });
    }

    if (calendarDates) {
      calendarDates.forEach((exception, index: number) => {
        const rowNum = index + 1;

        if (
          !exception.service_id ||
          String(exception.service_id).trim() === ''
        ) {
          this.addError(
            `Row ${rowNum}: service_id is required`,
            'MISSING_REQUIRED_FIELD',
            GTFS_TABLES.CALENDAR_DATES,
            rowNum
          );
        }

        if (!exception.date || !this.isValidDate(String(exception.date))) {
          this.addError(
            `Row ${rowNum}: date '${String(exception.date ?? '')}' is invalid (should be YYYYMMDD)`,
            'INVALID_DATE_FORMAT',
            GTFS_TABLES.CALENDAR_DATES,
            rowNum,
            {
              file: GTFS_TABLES.CALENDAR_DATES,
              id: this.rowId('calendar_dates', exception),
              field: 'date',
              value: String(exception.date ?? ''),
            }
          );
        }

        if (
          !exception.exception_type ||
          !['1', '2'].includes(String(exception.exception_type))
        ) {
          this.addError(
            `Row ${rowNum}: exception_type must be 1 or 2`,
            'INVALID_EXCEPTION_TYPE',
            GTFS_TABLES.CALENDAR_DATES,
            rowNum
          );
        }
      });
    }
  }

  async validateShapes() {
    const shapes = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.SHAPES);
    if (shapes.length === 0) {
      return;
    }

    await this.eachRow(shapes, (shape, index) => {
      const rowNum = index + 1;

      if (!shape.shape_id || String(shape.shape_id).trim() === '') {
        this.addError(
          `Row ${rowNum}: shape_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.SHAPES,
          rowNum
        );
      }

      // Validate coordinates
      if (!shape.shape_pt_lat) {
        this.addError(
          `Row ${rowNum}: shape_pt_lat is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.SHAPES,
          rowNum
        );
      } else if (!this.isValidLatitude(shape.shape_pt_lat as string | number)) {
        this.addError(
          `Row ${rowNum}: shape_pt_lat must be between -90.0 and 90.0`,
          'INVALID_COORDINATE',
          GTFS_TABLES.SHAPES,
          rowNum
        );
      }

      if (!shape.shape_pt_lon) {
        this.addError(
          `Row ${rowNum}: shape_pt_lon is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.SHAPES,
          rowNum
        );
      } else if (
        !this.isValidLongitude(shape.shape_pt_lon as string | number)
      ) {
        this.addError(
          `Row ${rowNum}: shape_pt_lon must be between -180.0 and 180.0`,
          'INVALID_COORDINATE',
          GTFS_TABLES.SHAPES,
          rowNum
        );
      }

      if (!shape.shape_pt_sequence) {
        this.addError(
          `Row ${rowNum}: shape_pt_sequence is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.SHAPES,
          rowNum
        );
      } else if (isNaN(parseInt(String(shape.shape_pt_sequence)))) {
        this.addError(
          `Row ${rowNum}: shape_pt_sequence must be a number`,
          'INVALID_NUMBER',
          GTFS_TABLES.SHAPES,
          rowNum
        );
      }
    });

    this.addInfo(`Found ${shapes.length} shape points`, 'SHAPE_POINT_COUNT');
  }

  async validateReferences() {
    // Additional cross-reference validation
    const trips = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.TRIPS);
    const stopTimes = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.STOP_TIMES
    );

    if (trips && stopTimes) {
      const trip_ids = new Set(trips.map((t) => t.trip_id));
      // The set depends only on stop_times, and any edit that could move it
      // (an insert, a delete, a changed trip_id) forces a full sweep, so a
      // warm run reuses it. The warning loop below still re-runs, which is
      // what picks up an edit to trips.txt.
      let tripsWithStopTimes: Set<unknown>;
      if (this.warm && this.passCache) {
        tripsWithStopTimes = this.passCache.tripsWithStopTimes;
      } else {
        // Built row by row rather than from stopTimes.map: the intermediate
        // array would be one throwaway entry per stop time.
        tripsWithStopTimes = new Set<unknown>();
        await this.eachRow(stopTimes, (st) => {
          tripsWithStopTimes.add(st.trip_id);
        });
        if (this.passCache) {
          this.passCache.tripsWithStopTimes = tripsWithStopTimes;
        }
      }

      // Check for trips without stop times
      trip_ids.forEach((trip_id) => {
        if (!tripsWithStopTimes.has(trip_id)) {
          this.addWarning(
            `Trip '${trip_id}' has no stop times`,
            'TRIP_WITHOUT_STOP_TIMES',
            GTFS_TABLES.TRIPS
          );
        }
      });
    }
  }

  /**
   * networks.txt and route_networks.txt are Conditionally Forbidden: the
   * reference forbids them when routes.txt carries a network_id column, since
   * the two forms would disagree about which routes are in which network.
   */
  validateNetworks() {
    const routes = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.ROUTES);
    const networks = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.NETWORKS);
    const routeNetworks = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.ROUTE_NETWORKS
    );

    if (networks.length === 0 && routeNetworks.length === 0) {
      return;
    }

    const inline = routes.filter(
      (route) => String(route.network_id ?? '').trim() !== ''
    ).length;
    if (inline > 0) {
      this.addError(
        `network_id is set on ${inline} route(s) in routes.txt, which is forbidden when networks.txt or route_networks.txt is present. Those values are ignored and will not be exported.`,
        'NETWORK_ID_CONFLICT',
        GTFS_TABLES.ROUTES
      );
    }
  }

  /**
   * Only stops (location_type 0) and stations (1) can belong to an area: an
   * entrance, a generic node or a boarding area is not somewhere a fare leg
   * begins or ends.
   */
  validateStopAreas() {
    const stopAreas = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.STOP_AREAS
    );
    if (stopAreas.length === 0) {
      return;
    }

    const stops = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.STOPS);
    const typeByStopId = new Map(
      stops.map((stop) => [
        String(stop.stop_id ?? ''),
        stopLocationType(stop as Record<string, unknown>),
      ])
    );

    stopAreas.forEach((row, index: number) => {
      const stop_id = String(row.stop_id ?? '');
      const locationType = typeByStopId.get(stop_id);
      if (locationType === undefined) {
        return;
      }
      if (locationType !== 0 && locationType !== 1) {
        this.addError(
          `Row ${index + 1}: stop '${stop_id}' has location_type ${locationType}, which cannot be assigned to an area`,
          'INVALID_AREA_ASSIGNMENT',
          GTFS_TABLES.STOP_AREAS,
          index + 1
        );
      }
    });
  }

  /**
   * The two flex reference rules the generic sweeps cannot express.
   *
   * `location_group_id` shares one ID namespace with `stops.stop_id` and
   * locations.geojson `id`, which no per-file uniqueness check would catch. And
   * `stop_times.location_id` points into locations.geojson, which is one row
   * holding a FeatureCollection rather than a table with an `id` column, so
   * validateForeignKeys skips it and the ids are collected from the features
   * here instead.
   */
  async validateFlexLocations() {
    const zoneIds = new Set<string>();
    const collection = this.gtfsParser.getFileDataSync(
      GTFS_TABLES.LOCATIONS_GEOJSON
    )[0] as unknown as Partial<GeoJSON.FeatureCollection> | undefined;
    (collection?.features ?? []).forEach((feature, index: number) => {
      const id = String(feature.id ?? '').trim();
      if (id !== '') {
        zoneIds.add(id);
      }
      this.validateZoneFeature(feature, id, index + 1);
    });

    const locationGroups = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.LOCATION_GROUPS
    );
    if (locationGroups.length > 0) {
      const owners = new Map<string, string>();
      for (const stop of this.gtfsParser.getFileDataSyncTyped(
        GTFS_TABLES.STOPS
      )) {
        const id = String(stop.stop_id ?? '').trim();
        if (id !== '') {
          owners.set(id, 'a stops.txt stop_id');
        }
      }
      for (const id of zoneIds) {
        owners.set(id, 'a locations.geojson id');
      }

      locationGroups.forEach((row, index: number) => {
        const id = String(row.location_group_id ?? '').trim();
        const problem = validateLocationGroupId(id, owners);
        if (problem) {
          this.addError(
            `Row ${index + 1}: ${problem}`,
            'DUPLICATE_ID',
            GTFS_TABLES.LOCATION_GROUPS,
            index + 1,
            {
              file: GTFS_TABLES.LOCATION_GROUPS,
              id: this.rowId('location_groups', row),
              field: 'location_group_id',
              value: id,
            }
          );
        }
      });
    }

    const stopTimes = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.STOP_TIMES
    );
    const errors = this.validationResults.errors;
    const entries = this.passCache?.flexLocation ?? null;
    if (this.warm && entries) {
      this.refreshChunk(entries, (row, rowNum, out) =>
        this.flexLocationRowIssues(zoneIds, row, rowNum, out)
      );
      this.emitChunk(entries, errors);
    } else {
      await this.eachRow(stopTimes, (row, index) => {
        const before = errors.length;
        this.flexLocationRowIssues(zoneIds, row, index + 1, errors);
        if (entries && errors.length > before) {
          entries.push({ index, messages: errors.slice(before) });
        }
      });
    }

    // Pairing is an aggregate over every trip on a route, so it is reused
    // whole or recomputed whole; an edit that could move it forces a sweep.
    const warnings = this.validationResults.warnings;
    if (this.warm && this.passCache) {
      for (const message of this.passCache.flexPairing) {
        warnings.push(message);
      }
    } else {
      const before = warnings.length;
      await this.validateFlexRowPairing(stopTimes);
      if (this.passCache) {
        this.passCache.flexPairing = warnings.slice(before);
      }
    }
  }

  private flexLocationRowIssues(
    zoneIds: Set<string>,
    row: GTFSDatabaseRecord,
    rowNum: number,
    out: ValidationMessage[]
  ): void {
    const location_id = String(row.location_id ?? '').trim();
    if (location_id === '' || zoneIds.has(location_id)) {
      return;
    }
    out.push(
      errorMessage(
        `Row ${rowNum}: location_id '${location_id}' not found in locations.geojson`,
        'INVALID_REFERENCE',
        GTFS_TABLES.STOP_TIMES,
        rowNum,
        {
          file: GTFS_TABLES.STOP_TIMES,
          id: this.rowId('stop_times', row),
          field: 'location_id',
          value: location_id,
        }
      )
    );
  }

  /**
   * The per-feature rules of locations.geojson: an id, and a polygon.
   *
   * The editor keeps a feature that breaks either rule rather than dropping it,
   * so this is what tells the user it is there and needs fixing on the zone's
   * page.
   */
  private validateZoneFeature(
    feature: GeoJSON.Feature,
    id: string,
    featureNum: number
  ) {
    const where = id !== '' ? `Zone '${id}'` : `Feature ${featureNum}`;
    const entity = {
      file: GTFS_TABLES.LOCATIONS_GEOJSON,
      id: id || String(featureNum),
    };

    if (id === '') {
      this.addError(
        `Feature ${featureNum}: every locations.geojson feature must have an id, unique across stops.stop_id, locations.geojson id and location_group_id`,
        'MISSING_REQUIRED_FIELD',
        GTFS_TABLES.LOCATIONS_GEOJSON,
        featureNum,
        { ...entity, field: 'id', value: '' }
      );
    }

    const geometry = feature.geometry as GeoJSON.Geometry | null | undefined;
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') {
      this.addError(
        `${where}: geometry is ${String(geometry?.type)}, must be a Polygon or MultiPolygon`,
        'INVALID_GEOMETRY',
        GTFS_TABLES.LOCATIONS_GEOJSON,
        featureNum,
        { ...entity, field: 'geometry', value: String(geometry?.type) }
      );
      return;
    }

    if (geometry.coordinates.length === 0) {
      this.addError(
        `${where}: geometry has no coordinates`,
        'INVALID_GEOMETRY',
        GTFS_TABLES.LOCATIONS_GEOJSON,
        featureNum,
        { ...entity, field: 'geometry', value: '' }
      );
    }
  }

  /**
   * The documented on-demand shape serves a zone with a *pair* of stop_times on
   * one trip: the pickup record `(pickup_type=2, drop_off_type=1)` then the
   * drop-off record `(1,2)`. A trip carrying only one half is legal - a zone can
   * be pickup-only - so this is a warning, and only raised when the same route
   * pairs that same ref up on some other trip, which is what makes a lone half
   * look like an omission rather than a decision. Nothing is auto-created.
   */
  private async validateFlexRowPairing(stopTimes: GTFSDatabaseRecord[]) {
    const PAIRS = ['2:1', '1:2'];
    const refOf = (row: GTFSDatabaseRecord): string | null => {
      const group = String(row.location_group_id ?? '').trim();
      if (group !== '') {
        return `location_group:${group}`;
      }
      const location = String(row.location_id ?? '').trim();
      return location !== '' ? `location:${location}` : null;
    };
    const pairOf = (row: GTFSDatabaseRecord): string =>
      `${String(row.pickup_type ?? '').trim()}:${String(row.drop_off_type ?? '').trim()}`;

    const routeOfTrip = new Map<string, string>();
    for (const trip of this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.TRIPS
    )) {
      routeOfTrip.set(String(trip.trip_id ?? ''), String(trip.route_id ?? ''));
    }

    // trip_id -> ref -> how many stop_times on that trip use it.
    const refsPerTrip = new Map<string, Map<string, number>>();
    // `route_id|ref` -> which halves of the pair the route uses anywhere.
    const halvesPerRoute = new Map<string, Set<string>>();
    // Only a row that is one half of a pair can be reported, so the counting
    // walk keeps those and the reporting walk skips the rest of the table.
    const candidates: {
      row: GTFSDatabaseRecord;
      index: number;
      ref: string;
      pair: string;
    }[] = [];

    await this.eachRow(stopTimes, (row, index) => {
      const ref = refOf(row);
      if (ref === null) {
        return;
      }
      const trip_id = String(row.trip_id ?? '');
      const counts = refsPerTrip.get(trip_id) ?? new Map<string, number>();
      counts.set(ref, (counts.get(ref) ?? 0) + 1);
      refsPerTrip.set(trip_id, counts);

      const pair = pairOf(row);
      if (PAIRS.includes(pair)) {
        const key = `${routeOfTrip.get(trip_id) ?? ''}|${ref}`;
        const halves = halvesPerRoute.get(key) ?? new Set<string>();
        halves.add(pair);
        halvesPerRoute.set(key, halves);
        candidates.push({ row, index, ref, pair });
      }
    });

    for (const { row, index, ref, pair } of candidates) {
      const trip_id = String(row.trip_id ?? '');
      if ((refsPerTrip.get(trip_id)?.get(ref) ?? 0) !== 1) {
        continue;
      }
      const key = `${routeOfTrip.get(trip_id) ?? ''}|${ref}`;
      if ((halvesPerRoute.get(key)?.size ?? 0) < 2) {
        continue;
      }
      const missing = pair === '2:1' ? '(1, 2)' : '(2, 1)';
      this.addWarning(
        `Row ${index + 1}: trip '${trip_id}' uses ${ref.replace(':', ' ')} once, with pickup_type/drop_off_type ${pair.replace(':', ', ')}. Other trips on this route pair it with a ${missing} row - did you mean to add one?`,
        'UNPAIRED_FLEX_ROW',
        GTFS_TABLES.STOP_TIMES,
        index + 1,
        {
          file: GTFS_TABLES.STOP_TIMES,
          id: this.rowId('stop_times', row),
          field: 'pickup_type',
          value: pair,
        }
      );
    }
  }

  /**
   * The row-level conditional-presence rules the fares and on-demand editors
   * enforce on every edit, applied to whatever the feed arrived with.
   */
  async validateConditionalPresence() {
    const checks: [string, (row: Record<string, unknown>) => string | null][] =
      [
        [GTFS_TABLES.TIMEFRAMES, validateTimeframeRow],
        [GTFS_TABLES.FARE_LEG_JOIN_RULES, validateFareLegJoinRuleRow],
        [GTFS_TABLES.FARE_TRANSFER_RULES, validateFareTransferRuleRow],
        [GTFS_TABLES.STOP_TIMES, validateFlexStopTimeRow],
        [GTFS_TABLES.BOOKING_RULES, validateBookingRuleRow],
      ];

    const errors = this.validationResults.errors;
    for (const [table, check] of checks) {
      const rows = this.gtfsParser.getFileDataSyncTyped(table);
      const entries =
        table === GTFS_TABLES.STOP_TIMES
          ? (this.passCache?.conditional ?? null)
          : null;
      if (this.warm && entries) {
        this.refreshChunk(entries, (row, rowNum, out) =>
          this.conditionalRowIssues(table, check, row, rowNum, out)
        );
        this.emitChunk(entries, errors);
        continue;
      }
      await this.eachRow(rows, (row, index) => {
        const before = errors.length;
        this.conditionalRowIssues(table, check, row, index + 1, errors);
        if (entries && errors.length > before) {
          entries.push({ index, messages: errors.slice(before) });
        }
      });
    }
  }

  private conditionalRowIssues(
    table: string,
    check: (row: Record<string, unknown>) => string | null,
    row: GTFSDatabaseRecord,
    rowNum: number,
    out: ValidationMessage[]
  ): void {
    const problem = check(row as Record<string, unknown>);
    if (problem) {
      out.push(
        errorMessage(
          `Row ${rowNum}: ${problem}`,
          'CONDITIONAL_PRESENCE',
          table,
          rowNum
        )
      );
    }
  }

  validateTransfers() {
    const transfers = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.TRANSFERS
    );
    transfers.forEach((row, index: number) => {
      const problem = validateTransferRow(row as Record<string, unknown>);
      if (problem) {
        this.addError(
          `Row ${index + 1}: ${problem}`,
          'CONDITIONAL_PRESENCE',
          GTFS_TABLES.TRANSFERS,
          index + 1
        );
      }
    });
  }

  /**
   * Headway periods, judged by the same rules the timetable band enforces on
   * an edit, so a problem that arrived in the feed shows up on load rather
   * than when someone happens to click the cell.
   *
   * Deliberately not part of validateConditionalPresence, whose checks are all
   * `(row) => string | null`: an overlap can only be judged against the trip's
   * other periods.
   *
   * A dangling trip_id is left alone here: validateForeignKeys already sweeps
   * frequencies.txt's foreign key declaration, and a second check would group
   * the same problem twice in the Issues panel.
   */
  validateFrequencies() {
    const rows = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.FREQUENCIES
    ) as Record<string, unknown>[];
    if (rows.length === 0) {
      return;
    }

    // Duplicate keys are counted over this flat array because the virtual
    // table's byId index has already collapsed them, last row winning.
    const keyCounts = new Map<string, number>();
    for (const row of rows) {
      const key = frequencyPeriodKey(row);
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }

    // Periods per trip, earliest first. Duplicates are left out: two rows on
    // one key would otherwise report as overlapping each other, which sends
    // the user looking for the wrong problem.
    const byTrip = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const trip_id = String(row.trip_id ?? '').trim();
      if (trip_id === '' || (keyCounts.get(frequencyPeriodKey(row)) ?? 0) > 1) {
        continue;
      }
      byTrip.set(trip_id, [...(byTrip.get(trip_id) ?? []), row]);
    }
    // An unparseable start_time sorts last rather than as 0, or a garbage row
    // would appear to overlap everything and bury the real errors.
    const startOf = (row: Record<string, unknown>): number =>
      TimeFormatter.timeToSeconds(String(row.start_time ?? '').trim()) ??
      Number.MAX_SAFE_INTEGER;
    for (const group of byTrip.values()) {
      group.sort((a, b) => startOf(a) - startOf(b));
    }

    rows.forEach((row, index) => {
      const line = index + 1;
      const id = frequencyPeriodKey(row);
      const at = (field: string): ValidationEntity => ({
        file: GTFS_TABLES.FREQUENCIES,
        id,
        field,
        value: String(row[field] ?? ''),
      });

      if ((keyCounts.get(id) ?? 0) > 1) {
        this.addError(
          `Row ${line}: trip_id '${String(row.trip_id ?? '')}' has more than one headway period starting at '${String(row.start_time ?? '')}'. Only one of them is reachable in the timetable, so the duplicate has to be removed in the file.`,
          'DUPLICATE_KEY',
          GTFS_TABLES.FREQUENCIES,
          line,
          at('start_time')
        );
      }

      const problem = frequencyRowProblem(row);
      if (problem) {
        this.addError(
          `Row ${line}: ${problem.message}`,
          'CONDITIONAL_PRESENCE',
          GTFS_TABLES.FREQUENCIES,
          line,
          at(problem.field)
        );
        return;
      }

      // An overlapping pair is reported once, blaming the later-starting
      // period, so one problem reads as one row in the panel. The siblings are
      // therefore this trip's earlier periods only.
      const group = byTrip.get(String(row.trip_id ?? '').trim()) ?? [];
      const position = group.indexOf(row);
      if (position > 0) {
        const overlap = frequencyRowProblem(row, group.slice(0, position));
        if (overlap?.kind === 'overlap') {
          this.addError(
            `Row ${line}: ${overlap.message}`,
            'FREQUENCY_OVERLAP',
            GTFS_TABLES.FREQUENCIES,
            line,
            at(overlap.field)
          );
        }
      }

      if (frequencyEndIsAmbiguous(row)) {
        this.addWarning(
          `Row ${line}: end_time '${String(row.end_time ?? '')}' lands exactly on a departure of this exact_times=1 period, so whether that last trip runs is ambiguous. end_time should fall between the last departure and the one after it.`,
          'FREQUENCY_END_AMBIGUOUS',
          GTFS_TABLES.FREQUENCIES,
          line,
          at('end_time')
        );
      }
    });
  }

  /**
   * Where several rider categories are eligible for the same fare product,
   * exactly one of them must be the default, since that is the one shown to
   * the rider.
   */
  validateRiderCategoryDefaults() {
    const categories = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.RIDER_CATEGORIES
    );
    if (categories.length === 0) {
      return;
    }

    const isDefault = new Map(
      categories.map((row) => [
        String(row.rider_category_id ?? ''),
        String(row.is_default_fare_category ?? '').trim() === '1',
      ])
    );

    const products = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.FARE_PRODUCTS
    );
    const categoriesByProduct = new Map<string, Set<string>>();
    for (const product of products) {
      const productId = String(product.fare_product_id ?? '');
      const categoryId = String(product.rider_category_id ?? '').trim();
      if (productId === '' || categoryId === '') {
        continue;
      }
      const set = categoriesByProduct.get(productId) ?? new Set<string>();
      set.add(categoryId);
      categoriesByProduct.set(productId, set);
    }

    for (const [productId, eligible] of categoriesByProduct) {
      if (eligible.size < 2) {
        continue;
      }
      const defaults = [...eligible].filter((id) => isDefault.get(id) === true);
      if (defaults.length !== 1) {
        this.addError(
          `fare_product_id '${productId}' is eligible for ${eligible.size} rider categories but ${defaults.length} of them are marked is_default_fare_category=1; exactly one is required`,
          'RIDER_CATEGORY_DEFAULT',
          GTFS_TABLES.RIDER_CATEGORIES
        );
      }
    }
  }

  /**
   * Every foreign key the spec declares, checked against the tables it names.
   * A field naming two tables (trips.service_id, network_id) matches a value
   * present in either. Empty values are skipped: an optional reference left
   * blank is not dangling, and a required one missing is a separate check.
   *
   * The match is exact on both sides, never trimmed. An id carrying stray
   * whitespace really does point at nothing, and trimming it here would report
   * the reference as fine while every picker and lookup in the app still fails
   * to resolve it. validateFieldWhitespace names the whitespace separately so
   * the cause is legible rather than an id that looks correct.
   */
  async validateForeignKeys() {
    const valueCache = new Map<string, Set<string>>();

    // Group the declarations by file so each table is walked once.
    const byFile = new Map<string, GTFSForeignKeyRef[]>();
    for (const ref of GTFS_FOREIGN_KEYS) {
      if (SKIPPED_FOREIGN_KEYS.has(`${ref.file}:${ref.field}`)) {
        continue;
      }
      const list = byFile.get(ref.file) ?? [];
      list.push(ref);
      byFile.set(ref.file, list);
    }

    const errors = this.validationResults.errors;
    for (const [file, refs] of byFile) {
      const rows = this.gtfsParser.getFileDataSyncTyped(file);
      if (rows.length === 0) {
        continue;
      }

      const tableName = file.replace(/\.txt$/, '');
      const entries =
        file === GTFS_TABLES.STOP_TIMES
          ? (this.passCache?.foreignKeys ?? null)
          : null;

      // A warm run with nothing edited never needs the target value sets, so
      // the collectValues walks for stop_times' own keys are skipped too.
      if (this.warm && entries) {
        if (this.touchedRows.size > 0) {
          const checks = await this.buildForeignKeyChecks(refs, valueCache);
          this.refreshChunk(entries, (row, rowNum, out) =>
            this.foreignKeyRowIssues(file, tableName, checks, row, rowNum, out)
          );
        }
        this.emitChunk(entries, errors);
        continue;
      }

      const checks = await this.buildForeignKeyChecks(refs, valueCache);
      await this.eachRow(rows, (row, index) => {
        const before = errors.length;
        this.foreignKeyRowIssues(
          file,
          tableName,
          checks,
          row,
          index + 1,
          errors
        );
        if (entries && errors.length > before) {
          entries.push({ index, messages: errors.slice(before) });
        }
      });
    }
  }

  /** The value set and message wording for each foreign key one file declares. */
  private async buildForeignKeyChecks(
    refs: GTFSForeignKeyRef[],
    valueCache: Map<string, Set<string>>
  ): Promise<{ field: string; known: Set<string>; targetNames: string }[]> {
    const checks: { field: string; known: Set<string>; targetNames: string }[] =
      [];
    for (const ref of refs) {
      const known = new Set<string>();
      for (const target of ref.targets) {
        for (const value of await this.collectValues(
          target.file,
          target.field,
          valueCache
        )) {
          known.add(value);
        }
      }
      const targetNames = ref.targets
        .map((target) => `${target.file.replace(/\.txt$/, '')}.${target.field}`)
        .join(' or ');
      checks.push({ field: ref.field, known, targetNames });
    }
    return checks;
  }

  private foreignKeyRowIssues(
    file: string,
    tableName: string,
    checks: { field: string; known: Set<string>; targetNames: string }[],
    row: GTFSDatabaseRecord,
    rowNum: number,
    out: ValidationMessage[]
  ): void {
    for (const check of checks) {
      const value = String(row[check.field] ?? '');
      if (value === '' || check.known.has(value)) {
        continue;
      }
      out.push(
        errorMessage(
          `Row ${rowNum}: ${check.field} '${value}' not found in ${check.targetNames}`,
          'INVALID_REFERENCE',
          file,
          rowNum,
          {
            file,
            id: this.rowId(tableName, row),
            field: check.field,
            value,
          }
        )
      );
    }
  }

  /**
   * Values carrying leading/trailing whitespace or an embedded control
   * character, across every table.
   *
   * These are invisible in every rendering of the value, so on their own they
   * look like a working id next to an identical-looking one. They are usually
   * an export bug: a quoted CSV field that swallowed the line ending, which is
   * how the last row of each file ends up with a trailing newline. Reported as
   * its own issue so the reference error it causes has a stated cause.
   */
  async validateFieldWhitespace() {
    for (const file of Object.values(GTFS_TABLES)) {
      if (!file.endsWith('.txt')) {
        continue;
      }
      const rows = this.gtfsParser.getFileDataSyncTyped(file);
      if (rows.length === 0) {
        continue;
      }

      const tableName = file.replace(/\.txt$/, '');
      const warnings = this.validationResults.warnings;
      const entries =
        file === GTFS_TABLES.STOP_TIMES
          ? (this.passCache?.whitespace ?? null)
          : null;
      if (this.warm && entries) {
        this.refreshChunk(entries, (row, rowNum, out) =>
          this.whitespaceRowIssues(file, tableName, row, rowNum, out)
        );
        this.emitChunk(entries, warnings);
        continue;
      }
      await this.eachRow(rows, (row, index) => {
        const before = warnings.length;
        this.whitespaceRowIssues(file, tableName, row, index + 1, warnings);
        if (entries && warnings.length > before) {
          entries.push({ index, messages: warnings.slice(before) });
        }
      });
    }
  }

  private whitespaceRowIssues(
    file: string,
    tableName: string,
    row: GTFSDatabaseRecord,
    rowNum: number,
    out: ValidationMessage[]
  ): void {
    // `for...in` rather than Object.entries: the rows are plain parsed
    // objects, and building a pairs array for each of stop_times' millions
    // costs more than the check itself (measured 894ms against 142ms per
    // million rows).
    for (const field in row) {
      const raw = (row as Record<string, unknown>)[field];
      // Numeric fields are already numbers by now, so only strings can
      // still be carrying the whitespace they arrived with.
      if (typeof raw !== 'string' || !UNCLEAN_VALUE.test(raw)) {
        continue;
      }
      out.push(
        warningMessage(
          `Row ${rowNum}: ${field} ${JSON.stringify(raw)} has surrounding whitespace or a control character`,
          'UNCLEAN_VALUE',
          file,
          rowNum,
          { file, id: this.rowId(tableName, row), field, value: raw }
        )
      );
    }
  }

  /**
   * Language, timezone and currency values that no standard recognises.
   *
   * These are the field types whose values come from a published list rather
   * than from the feed, so the check is spec-driven: every field the reference
   * types as one of the three is swept, in every table, rather than naming the
   * handful of fields by hand.
   */
  async validateConstrainedCodes() {
    const checks: Record<
      string,
      { label: string; valid: (v: string) => boolean }
    > = {
      [GTFSFieldType.LanguageCode]: {
        label: 'a valid IETF BCP 47 language code',
        valid: isValidLanguageCode,
      },
      [GTFSFieldType.Timezone]: {
        label: 'a valid IANA timezone',
        valid: isValidTimezone,
      },
      [GTFSFieldType.CurrencyCode]: {
        label: 'a 3-letter ISO 4217 currency code',
        valid: isValidCurrencyCode,
      },
    };

    for (const file of Object.values(GTFS_TABLES)) {
      const specs = GTFS_FIELD_SPECS[file];
      if (!specs) {
        continue;
      }
      const constrained = Object.entries(specs)
        .map(([field, spec]) => ({
          field,
          check: checks[mapGTFSTypeString(spec.type)],
        }))
        .filter((entry) => entry.check !== undefined);
      if (constrained.length === 0) {
        continue;
      }

      const tableName = file.replace(/\.txt$/, '');
      await this.eachRow(
        this.gtfsParser.getFileDataSyncTyped(file),
        (row, index) => {
          for (const { field, check } of constrained) {
            const value = String(row[field] ?? '').trim();
            if (value === '' || check.valid(value)) {
              continue;
            }
            this.addWarning(
              `Row ${index + 1}: ${field} '${value}' is not ${check.label}`,
              'INVALID_CODE',
              file,
              index + 1,
              { file, id: this.rowId(tableName, row), field, value }
            );
          }
        }
      );
    }
  }

  /** Primary key of a row, falling back to the row number when it has none. */
  private rowId(tableName: string, row: GTFSDatabaseRecord): string {
    try {
      return generateCompositeKeyFromRecord(
        tableName,
        row as Record<string, unknown>
      );
    } catch {
      return '';
    }
  }

  /** Distinct non-empty values of one column, memoized across foreign keys. */
  private async collectValues(
    file: string,
    field: string,
    cache: Map<string, Set<string>>
  ): Promise<Set<string>> {
    const key = `${file}:${field}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const values = new Set<string>();
    await this.eachRow(this.gtfsParser.getFileDataSyncTyped(file), (row) => {
      const value = String(row[field] ?? '');
      if (value !== '') {
        values.add(value);
      }
    });
    cache.set(key, values);
    return values;
  }

  // Helper methods
  addError(
    message: string,
    code: string,
    fileName: string | null = null,
    rowNum: number | null = null,
    entity: ValidationEntity | null = null
  ) {
    this.validationResults.errors.push(
      errorMessage(message, code, fileName, rowNum, entity)
    );
  }

  addWarning(
    message: string,
    code: string,
    fileName: string | null = null,
    rowNum: number | null = null,
    entity: ValidationEntity | null = null
  ) {
    this.validationResults.warnings.push(
      warningMessage(message, code, fileName, rowNum, entity)
    );
  }

  addInfo(
    message: string,
    code: string,
    fileName: string | null = null,
    rowNum: number | null = null
  ) {
    this.validationResults.info.push({
      level: 'info',
      message,
      code,
      file: fileName || undefined,
      line: rowNum || undefined,
    });
  }

  isValidUrl(url: string) {
    const result = validateValue(url, GTFSFieldType.URL);
    return result.valid;
  }

  isValidTime(time: string) {
    const result = validateValue(time, GTFSFieldType.Time);
    return result.valid;
  }

  isValidDate(date: string) {
    const result = validateValue(date, GTFSFieldType.Date);
    return result.valid;
  }

  isValidColor(color: string) {
    const result = validateValue(color, GTFSFieldType.Color);
    return result.valid;
  }

  isValidEmail(email: string) {
    const result = validateValue(email, GTFSFieldType.Email);
    return result.valid;
  }

  isValidLatitude(lat: number | string) {
    const num = typeof lat === 'number' ? lat : parseFloat(lat);
    const result = validateValue(num, GTFSFieldType.Latitude);
    return result.valid;
  }

  isValidLongitude(lon: number | string) {
    const num = typeof lon === 'number' ? lon : parseFloat(lon);
    const result = validateValue(num, GTFSFieldType.Longitude);
    return result.valid;
  }

  /**
   * The last completed sweep's results.
   *
   * Not `validationResults`: that one is reset at the start of a sweep and
   * filled pass by pass, so reading it while a sweep is running returns a
   * partial set that looks like a clean feed.
   */
  getValidationSummary() {
    return this.publishedResults.summary;
  }

  getValidationResults() {
    return this.publishedResults;
  }

  hasErrors() {
    return this.publishedResults.errors.length > 0;
  }

  hasWarnings() {
    return this.publishedResults.warnings.length > 0;
  }
}
