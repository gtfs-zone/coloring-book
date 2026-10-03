/**
 * Timetable Browser Modal
 *
 * Every timetable of the feed at a glance: one section per agency, a table of
 * that agency's routes against the services they run, with the trip count of
 * each (route, service) pair in its cell.
 *
 * A cell opens that timetable. The timetable is a different modal type, so the
 * router closes this one when the page state switches to it.
 */

import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { routeColor } from 'gtfs-zone-web-common/gtfs/route-colors';
import { routeSortKey } from 'gtfs-zone-web-common/gtfs/route-sort';
import { SELECTED_ROW_CLASS } from 'gtfs-zone-web-common/ui/selectable-row';
import type { GTFSParser } from './gtfs-parser';
import type { ScheduleController } from './schedule-controller';
import { GTFS_TABLES } from '../types/gtfs';
import { openTimetable } from './navigation-actions';
import {
  getAgencyDisplay,
  getRouteDisplay,
  getServiceDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display';
import { formatDaysOfWeek } from '../utils/entity-references';
import { t } from '../i18n/messages';
import { formatNumber } from 'gtfs-zone-web-common/i18n/fmt';

export interface TimetableBrowserDeps {
  gtfsParser: GTFSParser;
  scheduleController: ScheduleController;
}

type Row = Record<string, string>;

interface AgencySection {
  /** Null for the routes whose agency_id resolves to no agency. */
  agency: Row | null;
  routes: Row[];
}

/** Map key of the (route, service) pair a trip belongs to. */
function pairKey(route_id: string, service_id: string): string {
  return `${route_id}\u0000${service_id}`;
}

/**
 * Group routes by agency. A route without agency_id belongs to the only
 * agency of a single-agency feed; any other route whose agency_id names no
 * agency lands in the "No agency" section.
 */
function groupByAgency(agencies: Row[], routes: Row[]): AgencySection[] {
  const byId = new Map<string, AgencySection>();
  for (const agency of agencies) {
    byId.set(agency.agency_id ?? '', { agency, routes: [] });
  }
  const orphans: AgencySection = { agency: null, routes: [] };
  const soleAgency = agencies.length === 1 ? agencies[0] : null;

  for (const route of routes) {
    const agency_id = route.agency_id ?? '';
    const section =
      byId.get(agency_id) ??
      (agency_id === '' && soleAgency
        ? byId.get(soleAgency.agency_id ?? '')
        : undefined);
    if (section) {
      section.routes.push(route);
    } else {
      console.warn(
        `[TimetableBrowser] route ${route.route_id} has agency_id "${agency_id}", which names no agency`
      );
      orphans.routes.push(route);
    }
  }

  const sections = [...byId.values()].sort(
    (a, b) =>
      b.routes.length - a.routes.length ||
      getAgencyDisplay(a.agency!).primary.localeCompare(
        getAgencyDisplay(b.agency!).primary
      )
  );
  if (orphans.routes.length > 0) {
    sections.push(orphans);
  }
  return sections;
}

function renderSection(
  section: AgencySection,
  tripCounts: Map<string, number>,
  routeTripCounts: Map<string, number>,
  services: Map<string, Row>,
  currentRouteId: string | null
): string {
  const title = section.agency
    ? renderCardLabel(getAgencyDisplay(section.agency))
    : `<span>${t('tt.noAgency')}</span>`;

  if (section.routes.length === 0) {
    return `
      <section class="space-y-2">
        <h4 class="font-semibold">${title}</h4>
        <p class="text-sm opacity-70">${t('tt.noRoutes')}</p>
      </section>`;
  }

  const routes = section.routes
    .map((route) => ({
      route,
      label: getRouteDisplay(route).primary,
      key: routeSortKey(
        route.route_type,
        routeTripCounts.get(route.route_id ?? '') ?? 0
      ),
    }))
    .sort((a, b) => b.key - a.key || a.label.localeCompare(b.label))
    .map(({ route }) => route);

  // Columns: the services these routes run, busiest first.
  const serviceTotals = new Map<string, number>();
  for (const route of routes) {
    for (const service_id of services.keys()) {
      const count = tripCounts.get(pairKey(route.route_id ?? '', service_id));
      if (count) {
        serviceTotals.set(
          service_id,
          (serviceTotals.get(service_id) ?? 0) + count
        );
      }
    }
  }
  const columns = [...serviceTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([service_id]) => service_id);

  const headers = columns
    .map((service_id) => {
      const service = services.get(service_id) ?? { service_id };
      return `<th class="text-center align-bottom">
        <div class="font-semibold">${escapeHtml(renderOptionLabel(getServiceDisplay(service)))}</div>
        <div class="text-xs font-normal opacity-60">${escapeHtml(formatDaysOfWeek(service))}</div>
      </th>`;
    })
    .join('');

  const rows = routes
    .map((route) => {
      const route_id = route.route_id ?? '';
      const color = routeColor(route_id, route.route_color);
      const isCurrent = route_id === currentRouteId;
      const selected = isCurrent ? SELECTED_ROW_CLASS : '';
      // The sticky cell needs an opaque background, or scrolled cells show
      // through it.
      const stickyBg = isCurrent ? 'bg-base-200' : 'bg-base-100';
      const routeCell = `<th class="sticky left-0 z-10 ${stickyBg} font-normal">
        <div class="flex items-center gap-2 min-w-40">
          <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${escapeHtml(color)}"></span>
          ${renderCardLabel(getRouteDisplay(route))}
        </div>
      </th>`;

      if ((routeTripCounts.get(route_id) ?? 0) === 0) {
        return `<tr class="${selected}">${routeCell}<td colspan="${Math.max(1, columns.length)}">
          <button type="button" class="btn btn-xs btn-primary" data-new-timetable data-route-id="${escapeHtml(route_id)}">${t('tt.newTimetable')}</button>
        </td></tr>`;
      }

      const cells = columns
        .map((service_id) => {
          const count = tripCounts.get(pairKey(route_id, service_id)) ?? 0;
          if (count === 0) {
            return '<td class="text-center opacity-40">-</td>';
          }
          return `<td class="text-center"><button type="button" class="btn btn-xs btn-ghost" data-route-id="${escapeHtml(route_id)}" data-service-id="${escapeHtml(service_id)}" title="${t('tt.openTimetable')}">${formatNumber(count)}</button></td>`;
        })
        .join('');
      return `<tr class="${selected}">${routeCell}${cells}</tr>`;
    })
    .join('');

  return `
    <section class="space-y-2">
      <h4 class="font-semibold">${title}</h4>
      <div class="overflow-x-auto">
        <table class="table table-sm w-auto">
          <thead>
            <tr><th class="sticky left-0 z-10 bg-base-100">${t('tt.route')}</th>${headers}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

/**
 * Open the timetable browser and resolve once it closes. `currentRouteId` is
 * the route page the browser was opened from, if any; its row is highlighted.
 */
export async function showTimetableBrowserModal(
  deps: TimetableBrowserDeps,
  currentRouteId: string | null
): Promise<void> {
  const { gtfsParser } = deps;
  const agencies = gtfsParser.getFileDataSyncTyped<Row>(GTFS_TABLES.AGENCY);
  const routes = gtfsParser.getFileDataSyncTyped<Row>(GTFS_TABLES.ROUTES);
  const trips = gtfsParser.getFileDataSyncTyped<Row>(GTFS_TABLES.TRIPS);

  // One pass over trips for both the per-pair and the per-route counts.
  const tripCounts = new Map<string, number>();
  const routeTripCounts = new Map<string, number>();
  const services = new Map<string, Row>();
  for (const trip of trips) {
    const route_id = trip.route_id ?? '';
    const service_id = trip.service_id ?? '';
    const key = pairKey(route_id, service_id);
    tripCounts.set(key, (tripCounts.get(key) ?? 0) + 1);
    routeTripCounts.set(route_id, (routeTripCounts.get(route_id) ?? 0) + 1);
    services.set(service_id, { service_id });
  }
  // Day patterns come from calendar.txt; a service only in calendar_dates.txt
  // keeps its id-only record.
  for (const row of gtfsParser.getFileDataSyncTyped<Row>(
    GTFS_TABLES.CALENDAR
  )) {
    if (services.has(row.service_id ?? '')) {
      services.set(row.service_id, row);
    }
  }

  const sections = groupByAgency(agencies, routes);
  console.log(
    `[TimetableBrowser] ${sections.length} sections, ${routes.length} routes, ${tripCounts.size} timetables`
  );

  const body =
    routes.length === 0
      ? `<p class="opacity-70">${t('tt.feedNoRoutes')}</p>`
      : `<div id="timetable-browser" class="space-y-6">${sections
          .map((section) =>
            renderSection(
              section,
              tripCounts,
              routeTripCounts,
              services,
              currentRouteId
            )
          )
          .join('')}</div>`;

  await showModal({
    title: t('tt.browserTitle'),
    body,
    actions: [{ label: t('common.close'), onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-6xl',
    onMount: () => {
      const root = document.getElementById('timetable-browser');
      root?.addEventListener('click', (event) => {
        const target = event.target as Element;
        const create = target.closest<HTMLElement>('[data-new-timetable]');
        if (create) {
          const route_id = create.dataset.routeId ?? '';
          console.log(`[TimetableBrowser] new timetable for route ${route_id}`);
          void deps.scheduleController.pickTimetableService(route_id);
          return;
        }
        const cell = target.closest<HTMLElement>('[data-service-id]');
        if (cell) {
          const route_id = cell.dataset.routeId ?? '';
          const service_id = cell.dataset.serviceId ?? '';
          console.log(
            `[TimetableBrowser] opening timetable ${route_id} / ${service_id}`
          );
          void openTimetable(route_id, service_id);
        }
      });
    },
  });
}
