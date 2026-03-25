import { GTFSDatabaseRecord } from './gtfs-database.js';
import { GTFSTableMap } from '../types/gtfs-entities.js';
import { GTFS_TABLES, GTFSTableName } from '../types/gtfs.js';
import { GTFSFieldType } from '../types/gtfs-field-types.js';
import { validateValue } from '../utils/field-formatters.js';

interface ValidationMessage {
  level: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  field?: string;
}

interface ValidationResults {
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
  getFileDataSyncTyped<T extends GTFSTableName>(
    fileName: `${T}.txt`
  ): GTFSTableMap[T][];
  getAllFileNames(): string[];
  gtfsData: {
    [fileName: string]: {
      content: string;
      data: GTFSDatabaseRecord[];
      errors: unknown[];
    };
  };
}

export class GTFSValidator {
  private gtfsParser: GTFSParserInterface;
  private validationResults: ValidationResults;

  constructor(gtfsParser: GTFSParserInterface) {
    this.gtfsParser = gtfsParser;
    this.validationResults = {
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

  validateFeed() {
    this.validationResults = {
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

    // Run all validation checks
    this.validateRequiredFiles();
    this.validateAgencies();
    this.validateRoutes();
    this.validateTrips();
    this.validateStops();
    this.validateStopTimes();
    this.validateCalendar();
    this.validateShapes();
    this.validateReferences();

    // Update summary
    this.validationResults.summary.errorCount =
      this.validationResults.errors.length;
    this.validationResults.summary.warningCount =
      this.validationResults.warnings.length;
    this.validationResults.summary.infoCount =
      this.validationResults.info.length;
    this.validationResults.summary.isValid =
      this.validationResults.errors.length === 0;

    return this.validationResults;
  }

  validateRequiredFiles() {
    const requiredFiles = [
      GTFS_TABLES.AGENCY,
      GTFS_TABLES.ROUTES,
      GTFS_TABLES.TRIPS,
      GTFS_TABLES.STOPS,
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
      if (!agency.agency_name || agency.agency_name.trim() === '') {
        this.addError(
          `Row ${rowNum}: agency_name is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      }

      if (!agency.agency_url || agency.agency_url.trim() === '') {
        this.addError(
          `Row ${rowNum}: agency_url is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      } else if (!this.isValidUrl(agency.agency_url)) {
        this.addError(
          `Row ${rowNum}: agency_url is not a valid URL`,
          'INVALID_URL',
          GTFS_TABLES.AGENCY,
          rowNum
        );
      }

      if (!agency.agency_timezone || agency.agency_timezone.trim() === '') {
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
    const agencies = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.AGENCY);

    if (routes.length === 0) {
      this.addError('routes.txt is empty', 'EMPTY_FILE', GTFS_TABLES.ROUTES);
      return;
    }

    const route_ids = new Set();
    const agency_ids = new Set((agencies || []).map((a) => a.agency_id));

    routes.forEach((route, index: number) => {
      const rowNum = index + 1;

      // Required fields
      if (!route.route_id || route.route_id.trim() === '') {
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
        if (!validRouteTypes.includes(route.route_type)) {
          this.addWarning(
            `Row ${rowNum}: Unknown route_type '${route.route_type}'`,
            'UNKNOWN_ROUTE_TYPE',
            GTFS_TABLES.ROUTES,
            rowNum
          );
        }
      }

      // Validate agency_id reference
      if (route.agency_id && !agency_ids.has(route.agency_id)) {
        this.addError(
          `Row ${rowNum}: agency_id '${route.agency_id}' not found in agency.txt`,
          'INVALID_REFERENCE',
          GTFS_TABLES.ROUTES,
          rowNum
        );
      }
    });

    this.addInfo(`Found ${routes.length} routes`, 'ROUTE_COUNT');
  }

  validateStops() {
    const stops = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.STOPS);
    if (stops.length === 0) {
      this.addError('stops.txt is empty', 'EMPTY_FILE', GTFS_TABLES.STOPS);
      return;
    }

    const stop_ids = new Set();

    stops.forEach((stop, index: number) => {
      const rowNum = index + 1;

      // Required fields
      if (!stop.stop_id || stop.stop_id.trim() === '') {
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

      if (!stop.stop_name || stop.stop_name.trim() === '') {
        this.addError(
          `Row ${rowNum}: stop_name is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOPS,
          rowNum
        );
      }

      // Validate coordinates
      if (
        !stop.stop_lat ||
        (typeof stop.stop_lat === 'string' && stop.stop_lat.trim() === '')
      ) {
        this.addError(
          `Row ${rowNum}: stop_lat is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOPS,
          rowNum
        );
      } else if (!this.isValidLatitude(stop.stop_lat)) {
        this.addError(
          `Row ${rowNum}: stop_lat must be between -90.0 and 90.0`,
          'INVALID_COORDINATE',
          GTFS_TABLES.STOPS,
          rowNum
        );
      }

      if (
        !stop.stop_lon ||
        (typeof stop.stop_lon === 'string' && stop.stop_lon.trim() === '')
      ) {
        this.addError(
          `Row ${rowNum}: stop_lon is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOPS,
          rowNum
        );
      } else if (!this.isValidLongitude(stop.stop_lon)) {
        this.addError(
          `Row ${rowNum}: stop_lon must be between -180.0 and 180.0`,
          'INVALID_COORDINATE',
          GTFS_TABLES.STOPS,
          rowNum
        );
      }

      // Validate location_type
      if (stop.location_type) {
        const validLocationTypes = ['0', '1', '2', '3', '4'];
        if (!validLocationTypes.includes(stop.location_type)) {
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

  validateTrips() {
    const trips = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.TRIPS);
    const routes = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.ROUTES);

    if (trips.length === 0) {
      this.addError('trips.txt is empty', 'EMPTY_FILE', GTFS_TABLES.TRIPS);
      return;
    }

    const trip_ids = new Set();
    const route_ids = new Set((routes || []).map((r) => r.route_id));

    trips.forEach((trip, index: number) => {
      const rowNum = index + 1;

      // Required fields
      if (!trip.trip_id || trip.trip_id.trim() === '') {
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

      if (!trip.route_id || trip.route_id.trim() === '') {
        this.addError(
          `Row ${rowNum}: route_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.TRIPS,
          rowNum
        );
      } else if (!route_ids.has(trip.route_id)) {
        this.addError(
          `Row ${rowNum}: route_id '${trip.route_id}' not found in routes.txt`,
          'INVALID_REFERENCE',
          GTFS_TABLES.TRIPS,
          rowNum
        );
      }

      if (!trip.service_id || trip.service_id.trim() === '') {
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

  validateStopTimes() {
    const stopTimes = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.STOP_TIMES
    );
    const trips = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.TRIPS);
    const stops = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.STOPS);

    if (stopTimes.length === 0) {
      this.addError(
        'stop_times.txt is empty',
        'EMPTY_FILE',
        GTFS_TABLES.STOP_TIMES
      );
      return;
    }

    const trip_ids = new Set((trips || []).map((t) => t.trip_id));
    const stop_ids = new Set((stops || []).map((s) => s.stop_id));

    stopTimes.forEach((stopTime, index: number) => {
      const rowNum = index + 1;

      // Required fields
      if (!stopTime.trip_id || stopTime.trip_id.trim() === '') {
        this.addError(
          `Row ${rowNum}: trip_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      } else if (!trip_ids.has(stopTime.trip_id)) {
        this.addError(
          `Row ${rowNum}: trip_id '${stopTime.trip_id}' not found in trips.txt`,
          'INVALID_REFERENCE',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      }

      if (!stopTime.stop_id || stopTime.stop_id.trim() === '') {
        this.addError(
          `Row ${rowNum}: stop_id is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      } else if (!stop_ids.has(stopTime.stop_id)) {
        this.addError(
          `Row ${rowNum}: stop_id '${stopTime.stop_id}' not found in stops.txt`,
          'INVALID_REFERENCE',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      }

      if (!stopTime.stop_sequence) {
        this.addError(
          `Row ${rowNum}: stop_sequence is required`,
          'MISSING_REQUIRED_FIELD',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      } else if (isNaN(parseInt(stopTime.stop_sequence))) {
        this.addError(
          `Row ${rowNum}: stop_sequence must be a number`,
          'INVALID_NUMBER',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      }

      // Validate time format
      if (stopTime.arrival_time && !this.isValidTime(stopTime.arrival_time)) {
        this.addError(
          `Row ${rowNum}: arrival_time format is invalid`,
          'INVALID_TIME_FORMAT',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      }

      if (
        stopTime.departure_time &&
        !this.isValidTime(stopTime.departure_time)
      ) {
        this.addError(
          `Row ${rowNum}: departure_time format is invalid`,
          'INVALID_TIME_FORMAT',
          GTFS_TABLES.STOP_TIMES,
          rowNum
        );
      }
    });

    this.addInfo(`Found ${stopTimes.length} stop times`, 'STOP_TIME_COUNT');
  }

  validateCalendar() {
    const calendar = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.CALENDAR);
    const calendarDates = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.CALENDAR_DATES
    );

    if (calendar) {
      calendar.forEach((service, index: number) => {
        const rowNum = index + 1;

        if (!service.service_id || service.service_id.trim() === '') {
          this.addError(
            `Row ${rowNum}: service_id is required`,
            'MISSING_REQUIRED_FIELD',
            GTFS_TABLES.CALENDAR,
            rowNum
          );
        }

        // Validate date format
        if (service.start_date && !this.isValidDate(service.start_date)) {
          this.addError(
            `Row ${rowNum}: start_date format is invalid (should be YYYYMMDD)`,
            'INVALID_DATE_FORMAT',
            GTFS_TABLES.CALENDAR,
            rowNum
          );
        }

        if (service.end_date && !this.isValidDate(service.end_date)) {
          this.addError(
            `Row ${rowNum}: end_date format is invalid (should be YYYYMMDD)`,
            'INVALID_DATE_FORMAT',
            GTFS_TABLES.CALENDAR,
            rowNum
          );
        }
      });
    }

    if (calendarDates) {
      calendarDates.forEach((exception, index: number) => {
        const rowNum = index + 1;

        if (!exception.service_id || exception.service_id.trim() === '') {
          this.addError(
            `Row ${rowNum}: service_id is required`,
            'MISSING_REQUIRED_FIELD',
            GTFS_TABLES.CALENDAR_DATES,
            rowNum
          );
        }

        if (!exception.date || !this.isValidDate(exception.date)) {
          this.addError(
            `Row ${rowNum}: date format is invalid (should be YYYYMMDD)`,
            'INVALID_DATE_FORMAT',
            GTFS_TABLES.CALENDAR_DATES,
            rowNum
          );
        }

        if (
          !exception.exception_type ||
          !['1', '2'].includes(exception.exception_type)
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

  validateShapes() {
    const shapes = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.SHAPES);
    if (shapes.length === 0) {
      return;
    }

    shapes.forEach((shape, index: number) => {
      const rowNum = index + 1;

      if (!shape.shape_id || shape.shape_id.trim() === '') {
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
      } else if (!this.isValidLatitude(shape.shape_pt_lat)) {
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
      } else if (!this.isValidLongitude(shape.shape_pt_lon)) {
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
      } else if (isNaN(parseInt(shape.shape_pt_sequence))) {
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

  validateReferences() {
    // Additional cross-reference validation
    const trips = this.gtfsParser.getFileDataSyncTyped(GTFS_TABLES.TRIPS);
    const stopTimes = this.gtfsParser.getFileDataSyncTyped(
      GTFS_TABLES.STOP_TIMES
    );

    if (trips && stopTimes) {
      const trip_ids = new Set(trips.map((t) => t.trip_id));
      const tripsWithStopTimes = new Set(stopTimes.map((st) => st.trip_id));

      // Check for trips without stop times
      trip_ids.forEach((trip_id: string) => {
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

  // Helper methods
  addError(
    message: string,
    code: string,
    fileName: string | null = null,
    rowNum: number | null = null
  ) {
    this.validationResults.errors.push({
      level: 'error',
      message,
      file: fileName || undefined,
      line: rowNum || undefined,
    });
  }

  addWarning(
    message: string,
    code: string,
    fileName: string | null = null,
    rowNum: number | null = null
  ) {
    this.validationResults.warnings.push({
      level: 'warning',
      message,
      file: fileName || undefined,
      line: rowNum || undefined,
    });
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

  getValidationSummary() {
    return this.validationResults.summary;
  }

  getValidationResults() {
    return this.validationResults;
  }

  hasErrors() {
    return this.validationResults.errors.length > 0;
  }

  hasWarnings() {
    return this.validationResults.warnings.length > 0;
  }
}
