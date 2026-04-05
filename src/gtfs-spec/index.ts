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
import { pathwaysSpec } from './files/pathways';
import { levelsSpec } from './files/levels';
import { fareAttributesSpec } from './files/fare-attributes';
import { fareRulesSpec } from './files/fare-rules';
import { fareMediaSpec } from './files/fare-media';
import { fareProductsSpec } from './files/fare-products';
import { fareLegRulesSpec } from './files/fare-leg-rules';
import { fareLegJoinRulesSpec } from './files/fare-leg-join-rules';
import { fareTransferRulesSpec } from './files/fare-transfer-rules';
import { timeframesSpec } from './files/timeframes';
import { riderCategoriesSpec } from './files/rider-categories';
import { areasSpec } from './files/areas';
import { stopAreasSpec } from './files/stop-areas';
import { networksSpec } from './files/networks';
import { routeNetworksSpec } from './files/route-networks';
import { locationGroupsSpec } from './files/location-groups';
import { locationGroupStopsSpec } from './files/location-group-stops';
import { bookingRulesSpec } from './files/booking-rules';
import { translationsSpec } from './files/translations';
import { attributionsSpec } from './files/attributions';
import { locationsGeojsonSpec } from './files/locations-geojson';

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
    pathwaysSpec,
    levelsSpec,
    fareAttributesSpec,
    fareRulesSpec,
    fareMediaSpec,
    fareProductsSpec,
    fareLegRulesSpec,
    fareLegJoinRulesSpec,
    fareTransferRulesSpec,
    timeframesSpec,
    riderCategoriesSpec,
    areasSpec,
    stopAreasSpec,
    networksSpec,
    routeNetworksSpec,
    locationGroupsSpec,
    locationGroupStopsSpec,
    bookingRulesSpec,
    translationsSpec,
    attributionsSpec,
    locationsGeojsonSpec,
  ],
};
