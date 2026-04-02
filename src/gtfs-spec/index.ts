import type { GTFSSpec } from './types';
import { agencySpec } from './files/agency';
import { feedInfoSpec } from './files/feed-info';
import { stopsSpec } from './files/stops';
import { routesSpec } from './files/routes';
import { tripsSpec } from './files/trips';
import { stopTimesSpec } from './files/stop-times';
import { calendarSpec } from './files/calendar';
import { calendarDatesSpec } from './files/calendar-dates';
import { shapesSpec } from './files/shapes';
import { frequenciesSpec } from './files/frequencies';
import { transfersSpec } from './files/transfers';

export const gtfsSpec: GTFSSpec = {
  specVersion: '2026-04',
  files: [
    agencySpec,
    feedInfoSpec,
    stopsSpec,
    routesSpec,
    tripsSpec,
    stopTimesSpec,
    calendarSpec,
    calendarDatesSpec,
    shapesSpec,
    frequenciesSpec,
    transfersSpec,
  ],
};
