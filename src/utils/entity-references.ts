import {
  getRouteDisplay,
  getServiceDisplay,
  getStopDisplay,
  renderCardLabel,
  renderOptionLabel,
} from './entity-display';
import { escapeHtml } from './escape-html';
import { formatGtfsDateRange } from './gtfs-date';
import { routeColor } from './route-colors';

function escapeAttr(text: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

export const ROUTE_REF_ROW = 'route-ref-row';
export const SERVICE_REF_ROW = 'service-ref-row';
export const STOP_REF_ROW = 'stop-ref-row';
export const PATHWAY_REF_ROW = 'pathway-ref-row';
export const ENTITY_REF_BTN = 'entity-ref-btn';
export const TIMETABLE_REF_ROW = 'timetable-ref-row';
export const VIEW_ROUTE_BTN = 'view-route-btn';
export const VIEW_SERVICE_BTN = 'view-service-btn';

export interface RouteReferenceOpts {
  agencyName?: string;
  tripCount?: number;
  service_id?: string;
}

export interface ServiceReferenceOpts {
  tripCount?: number;
  routeCount?: number;
  route_id?: string;
  calendarDates?: Array<{ date: string; exception_type: string | number }>;
}

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const DAY_ABBRS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function formatDaysOfWeek(service: Record<string, unknown>): string {
  const hasAnyDayField = DAY_KEYS.some((k) => k in service);
  if (!hasAnyDayField) {
    return 'Specific Days';
  }

  const active: number[] = [];
  for (let i = 0; i < DAY_KEYS.length; i++) {
    const val = service[DAY_KEYS[i]];
    if (val === 1 || val === '1') {
      active.push(i);
    }
  }

  if (active.length === 0) {
    return 'No regular days';
  }

  // Check if active indices are consecutive and at least 3 long
  let consecutive = active.length >= 3;
  for (let i = 1; i < active.length; i++) {
    if (active[i] !== active[i - 1] + 1) {
      consecutive = false;
      break;
    }
  }

  if (consecutive) {
    return `${DAY_ABBRS[active[0]]}–${DAY_ABBRS[active[active.length - 1]]}`;
  }
  return active.map((i) => DAY_ABBRS[i]).join(', ');
}

export function formatDateRange(
  service: Record<string, unknown>,
  calendarDates?: Array<{ date: string; exception_type: string | number }>
): string {
  if (service.start_date) {
    return formatGtfsDateRange(
      String(service.start_date),
      String(service.end_date ?? '')
    );
  }
  if (calendarDates && calendarDates.length > 0) {
    const positives = calendarDates
      .filter((cd) => cd.exception_type === '1' || cd.exception_type === 1)
      .map((cd) => cd.date);
    if (positives.length > 0) {
      const sorted = positives.slice().sort();
      return formatGtfsDateRange(sorted[0], sorted[sorted.length - 1]);
    }
  }
  return '';
}

export function renderRouteReference(
  route: Record<string, unknown>,
  opts: RouteReferenceOpts
): string {
  const color = (route.route_color as string) || '6366f1';
  const dot = `<div class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: #${color}"></div>`;

  const label = renderCardLabel(
    getRouteDisplay(route as Record<string, string>)
  );

  const agencyLine = opts.agencyName
    ? `<div class="text-xs opacity-60">${opts.agencyName}</div>`
    : '';

  const badge =
    opts.tripCount !== undefined
      ? `<div class="badge badge-outline badge-sm">${opts.tripCount} trip${opts.tripCount !== 1 ? 's' : ''}</div>`
      : '';

  const viewBtn = opts.service_id
    ? `<button class="btn btn-xs btn-ghost ${ENTITY_REF_BTN}" data-route-id="${escapeAttr(route.route_id)}">View Route</button>`
    : '';

  const serviceAttr = opts.service_id
    ? ` data-service-id="${escapeAttr(opts.service_id)}"`
    : '';

  return `<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${ROUTE_REF_ROW}" data-route-id="${escapeAttr(route.route_id)}"${serviceAttr}>
  ${dot}
  <div class="flex-1 min-w-0">
    ${label}
    ${agencyLine}
  </div>
  ${badge}
  ${viewBtn}
</div>`;
}

export interface StopReferenceOpts {
  locationTypeLabel?: string;
}

export function renderStopReference(
  stop: Record<string, unknown>,
  opts: StopReferenceOpts = {}
): string {
  const label = renderCardLabel(getStopDisplay(stop as Record<string, string>));
  const badge = opts.locationTypeLabel
    ? `<div class="badge badge-outline badge-sm">${opts.locationTypeLabel}</div>`
    : '';

  return `<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${STOP_REF_ROW}" data-stop-id="${escapeAttr(stop.stop_id)}">
  <div class="flex-1 min-w-0">
    ${label}
  </div>
  ${badge}
</div>`;
}

export interface PathwayReferenceOpts {
  modeLabel: string;
  otherStop?: Record<string, unknown>;
  otherStopId: string;
  direction: 'to' | 'from';
  viewStopButton?: boolean;
}

export function renderPathwayReference(
  pathway: Record<string, unknown>,
  opts: PathwayReferenceOpts
): string {
  const otherDisplay = opts.otherStop
    ? renderOptionLabel(
        getStopDisplay(opts.otherStop as Record<string, string>)
      )
    : String(opts.otherStopId);

  const primaryText = `${opts.modeLabel} ${opts.direction} ${otherDisplay}`;
  const label = `<div class="font-medium truncate">${primaryText}</div>`;

  const viewStopBtn = opts.viewStopButton
    ? `<button class="btn btn-xs btn-ghost ${ENTITY_REF_BTN}" data-stop-id="${escapeAttr(opts.otherStopId)}">View Stop</button>`
    : '';

  return `<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${PATHWAY_REF_ROW}" data-pathway-id="${escapeAttr(pathway.pathway_id)}">
  <div class="flex-1 min-w-0">
    ${label}
  </div>
  ${viewStopBtn}
</div>`;
}

export function renderServiceReference(
  service: Record<string, unknown>,
  opts: ServiceReferenceOpts
): string {
  const label = renderCardLabel(
    getServiceDisplay(service as Record<string, string>)
  );

  const days = formatDaysOfWeek(service);
  const daysLine = days ? `<div class="text-xs opacity-60">${days}</div>` : '';

  const dateRange = formatDateRange(service, opts.calendarDates);
  const dateLine = dateRange
    ? `<div class="text-xs opacity-60">${dateRange}</div>`
    : '';

  const tripBadge =
    opts.tripCount !== undefined
      ? `<div class="badge badge-outline badge-sm">${opts.tripCount} trip${opts.tripCount !== 1 ? 's' : ''}</div>`
      : '';

  const routeBadge =
    opts.routeCount !== undefined
      ? `<div class="badge badge-outline badge-sm">${opts.routeCount} route${opts.routeCount !== 1 ? 's' : ''}</div>`
      : '';

  const viewBtn = opts.route_id
    ? `<button class="btn btn-xs btn-ghost ${ENTITY_REF_BTN}" data-service-id="${escapeAttr(service.service_id)}">View Service</button>`
    : '';

  const routeAttr = opts.route_id
    ? ` data-route-id="${escapeAttr(opts.route_id)}"`
    : '';

  return `<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${SERVICE_REF_ROW}" data-service-id="${escapeAttr(service.service_id)}"${routeAttr}>
  <div class="flex-1 min-w-0">
    ${label}
    ${daysLine}
    ${dateLine}
  </div>
  <div class="flex items-center gap-2">
    ${tripBadge}
    ${routeBadge}
  </div>
  ${viewBtn}
</div>`;
}

/** How many `via` stop names are spelled out before collapsing to "+N more". */
const MAX_VIA_LABELS = 3;

export interface TimetableReferenceOpts {
  calendarDates?: Array<{ date: string; exception_type: string | number }>;
  tripCount?: number;
  agencyName?: string;
  /**
   * Descendant stops that actually carry the stop_times, when the page's stop
   * is a station. Empty for an ordinary stop.
   */
  viaStops?: Array<Record<string, unknown>>;
  /** Suppress the button pointing at the page we are already on. */
  hide?: 'route' | 'service';
}

/**
 * One timetable, which in GTFS terms is a route crossed with a service.
 *
 * Shared by the stop, route and service pages so a timetable looks the same
 * wherever it is listed, and so every listing names both halves of the pair
 * rather than only the one the surrounding page is not already about.
 */
export function renderTimetableReference(
  route: Record<string, unknown>,
  service: Record<string, unknown>,
  opts: TimetableReferenceOpts = {}
): string {
  const route_id = String(route.route_id ?? '');
  const service_id = String(service.service_id ?? '');

  const color = routeColor(route_id, route.route_color as string | undefined);
  const dot = `<div class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${color}"></div>`;

  const routeLabel = renderCardLabel(
    getRouteDisplay(route as Record<string, string>)
  );
  const agencyTag = opts.agencyName
    ? `<span class="text-xs opacity-60 flex-shrink-0">${escapeHtml(opts.agencyName)}</span>`
    : '';

  const serviceName = renderOptionLabel(
    getServiceDisplay(service as Record<string, string>)
  );
  const dateRange = formatDateRange(service, opts.calendarDates);
  const serviceLine = escapeHtml(serviceName);
  const scheduleLine = [
    escapeHtml(formatDaysOfWeek(service)),
    dateRange ? escapeHtml(dateRange) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const viaStops = opts.viaStops ?? [];
  const viaLine =
    viaStops.length > 0
      ? `<div class="text-xs opacity-60 truncate">via ${escapeHtml(
          viaStops
            .slice(0, MAX_VIA_LABELS)
            .map((s) =>
              renderOptionLabel(getStopDisplay(s as Record<string, string>))
            )
            .join(', ')
        )}${
          viaStops.length > MAX_VIA_LABELS
            ? ` +${viaStops.length - MAX_VIA_LABELS} more`
            : ''
        }</div>`
      : '';

  const tripBadge =
    opts.tripCount !== undefined
      ? `<div class="badge badge-outline badge-sm">${opts.tripCount} trip${opts.tripCount !== 1 ? 's' : ''}</div>`
      : '';

  const routeBtn =
    opts.hide === 'route'
      ? ''
      : `<button class="btn btn-xs btn-ghost ${VIEW_ROUTE_BTN}" data-route-id="${escapeAttr(route_id)}">Route</button>`;
  const serviceBtn =
    opts.hide === 'service'
      ? ''
      : `<button class="btn btn-xs btn-ghost ${VIEW_SERVICE_BTN}" data-service-id="${escapeAttr(service_id)}">Service</button>`;

  return `<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${TIMETABLE_REF_ROW}" data-route-id="${escapeAttr(route_id)}" data-service-id="${escapeAttr(service_id)}">
  ${dot}
  <div class="flex-1 min-w-0">
    <div class="flex items-baseline gap-2 min-w-0">
      <span class="truncate">${routeLabel}</span>
      ${agencyTag}
    </div>
    <div class="text-xs opacity-60 truncate">${serviceLine}</div>
    <div class="text-xs opacity-60 truncate">${scheduleLine}</div>
    ${viaLine}
  </div>
  ${tripBadge}
  <div class="flex items-center gap-1 flex-shrink-0">
    ${routeBtn}
    ${serviceBtn}
  </div>
</div>`;
}
