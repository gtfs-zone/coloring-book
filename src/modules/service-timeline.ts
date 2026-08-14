/**
 * Shared services timeline: one row per service, one column per week, shaded
 * where the service runs, with exception ticks on individual days.
 *
 * Extracted from `calendar-modal.ts` so the home, route and stop pages can
 * render the same view. The modal remains a caller like any other.
 */

import { escapeHtml } from '../utils/escape-html.js';
import { formatDaysOfWeek } from '../utils/entity-references.js';
import {
  formatGtfsDateRange,
  formatGtfsDateWithWeekday,
  parseGtfsDate,
  toGtfsDate as formatGTFS,
} from '../utils/gtfs-date.js';
import { renderPencilIcon, renderTriangleIcon } from './modal-utils.js';

export interface ServiceData {
  calendar: Record<string, unknown> | null;
  exceptions: Record<string, unknown>[];
  color: string;
  label: string;
}

export type ServiceDataMap = Map<string, ServiceData>;

export interface ServiceTimelineSource {
  getAllRows: (tableName: string) => Promise<Record<string, unknown>[]>;
}

/** Per-row button that opens the service itself rather than the timetable. */
const SERVICE_EDIT_BTN = 'timeline-service-edit-btn';

export interface ServiceTimelineOptions {
  /** Fixed route context: every row carries it, so a click can land on a
   * specific timetable rather than the service page. */
  route_id?: string;
}

const PALETTE: string[] = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

export function getServiceColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/**
 * Timeline arithmetic below is all `.getTime()` on the result, so an Invalid
 * Date for a malformed feed value propagates as NaN rather than needing a null
 * check at every site.
 */
function parseGTFSDate(s: string): Date {
  return parseGtfsDate(s) ?? new Date(NaN);
}

function getDayOfWeek(gtfsDate: string): number {
  return parseGTFSDate(gtfsDate).getUTCDay();
}

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function isServiceActive(
  calendar: Record<string, unknown> | null,
  exceptions: Record<string, unknown>[],
  gtfsDate: string
): boolean {
  for (const ex of exceptions) {
    if (String(ex.date) === gtfsDate) {
      if (Number(ex.exception_type) === 2) {
        return false;
      }
      if (Number(ex.exception_type) === 1) {
        return true;
      }
    }
  }
  if (!calendar) {
    return false;
  }
  if (String(calendar.start_date) > gtfsDate) {
    return false;
  }
  if (String(calendar.end_date) < gtfsDate) {
    return false;
  }
  const dow = getDayOfWeek(gtfsDate);
  return Number(calendar[WEEKDAY_KEYS[dow]]) === 1;
}

export async function loadServiceData(
  db: ServiceTimelineSource
): Promise<ServiceDataMap> {
  const [calendarRows, calendarDatesRows] = await Promise.all([
    db.getAllRows('calendar'),
    db.getAllRows('calendar_dates'),
  ]);

  const exceptionsByService = new Map<string, Record<string, unknown>[]>();
  for (const row of calendarDatesRows) {
    const sid = String(row.service_id);
    if (!exceptionsByService.has(sid)) {
      exceptionsByService.set(sid, []);
    }
    exceptionsByService.get(sid)!.push(row);
  }

  const calendarByService = new Map<string, Record<string, unknown>>();
  for (const row of calendarRows) {
    calendarByService.set(String(row.service_id), row);
  }

  const allServiceIds = new Set<string>([
    ...calendarByService.keys(),
    ...exceptionsByService.keys(),
  ]);

  const sortedIds = [...allServiceIds].sort();
  const result: ServiceDataMap = new Map();

  sortedIds.forEach((sid, i) => {
    result.set(sid, {
      calendar: calendarByService.get(sid) ?? null,
      exceptions: exceptionsByService.get(sid) ?? [],
      color: getServiceColor(i),
      label: sid,
    });
  });

  return result;
}

/** Row color for a service no calendar row defines. */
const UNDEFINED_SERVICE_COLOR = '#9ca3af';

/**
 * Scope a loaded map to a set of services. Colors stay as assigned by
 * `loadServiceData`, so a service keeps the same color on every page.
 *
 * A requested service that no calendar defines still gets a row: trips can
 * point at a service_id that does not exist, and dropping it would hide the
 * timetable entirely instead of surfacing the broken reference.
 */
export function filterServiceDataMap(
  data: ServiceDataMap,
  service_ids: Iterable<string>
): ServiceDataMap {
  const result: ServiceDataMap = new Map();
  for (const sid of [...new Set(service_ids)].sort()) {
    result.set(
      sid,
      data.get(sid) ?? {
        calendar: null,
        exceptions: [],
        color: UNDEFINED_SERVICE_COLOR,
        label: sid,
      }
    );
  }
  return result;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const THREE_YEARS_MS = 3 * 365.25 * 24 * 60 * 60 * 1000;

// Sun-Sat order for weekday dot display (matches WEEKDAY_KEYS)
const WEEKDAY_DOT_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function renderWeekdayDots(calendar: Record<string, unknown> | null): string {
  const dots = WEEKDAY_DOT_KEYS.map((k) =>
    calendar && Number(calendar[k]) === 1 ? '●' : '○'
  ).join('');
  return `<span class="font-mono tracking-tight text-base-content/70">${dots}</span>`;
}

/**
 * Wrap content in the app's portaled tooltip trigger (see
 * `src/utils/tooltip-position.ts`). `text` is plain text; the portal renders
 * the attribute as HTML, so it is escaped here.
 */
function renderTooltipTrigger(
  text: string,
  content: string,
  className = ''
): string {
  return `<span class="field-tooltip-trigger ${className}" tabindex="0" data-tooltip-content="${escapeHtml(text)}">${content}</span>`;
}

function getDaysTooltip(calendar: Record<string, unknown> | null): string {
  if (!calendar) {
    return 'No regular days';
  }
  return formatDaysOfWeek(calendar);
}

export function renderServiceTimeline(
  data: ServiceDataMap,
  options: ServiceTimelineOptions = {}
): string {
  if (data.size === 0) {
    return `<div class="flex items-center justify-center h-32 text-base-content/50 text-sm">No service data available</div>`;
  }

  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const [, sd] of data) {
    if (sd.calendar) {
      const s = parseGTFSDate(String(sd.calendar.start_date)).getTime();
      const e = parseGTFSDate(String(sd.calendar.end_date)).getTime();
      if (s < minTs) {
        minTs = s;
      }
      if (e > maxTs) {
        maxTs = e;
      }
    }
    for (const ex of sd.exceptions) {
      const t = parseGTFSDate(String(ex.date)).getTime();
      if (t < minTs) {
        minTs = t;
      }
      if (t > maxTs) {
        maxTs = t;
      }
    }
  }

  if (!isFinite(minTs) || !isFinite(maxTs)) {
    return `<div class="flex items-center justify-center h-32 text-base-content/50 text-sm">No date data available</div>`;
  }

  // Snap minDate back to the nearest Sunday
  const dow = new Date(minTs).getUTCDay();
  const minDate = new Date(minTs - dow * 86400000);

  let maxDate = new Date(maxTs);
  let truncated = false;
  if (maxTs - minDate.getTime() > THREE_YEARS_MS) {
    maxDate = new Date(minDate.getTime() + THREE_YEARS_MS);
    truncated = true;
  }

  // Build weeks array (Sunday-start)
  const weeks: string[] = [];
  let cur = minDate.getTime();
  const maxTime = maxDate.getTime();
  while (cur <= maxTime) {
    weeks.push(formatGTFS(new Date(cur)));
    cur += 7 * 86400000;
  }

  // Group weeks into month header spans
  const monthSpans: Array<{ label: string; colspan: number }> = [];
  for (const week of weeks) {
    const d = parseGTFSDate(week);
    const label = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    if (
      monthSpans.length === 0 ||
      monthSpans[monthSpans.length - 1].label !== label
    ) {
      monthSpans.push({ label, colspan: 1 });
    } else {
      monthSpans[monthSpans.length - 1].colspan++;
    }
  }

  const maxIdLen = Math.max(0, ...[...data.keys()].map((k) => k.length));
  const labelColPx = Math.min(300, Math.max(80, maxIdLen * 7 + 32));

  const headerHtml = monthSpans
    .map(
      ({ label, colspan }) =>
        `<th colspan="${colspan}" class="px-1 py-0.5 text-center text-base-content/60 font-medium border-b border-base-300 whitespace-nowrap">${label}</th>`
    )
    .join('');

  const routeAttr = options.route_id
    ? ` data-route-id="${escapeHtml(options.route_id)}"`
    : '';

  const rowsHtml = [...data.entries()]
    .map(([sid, sd]) => {
      const calStart = sd.calendar ? String(sd.calendar.start_date) : null;
      const calEnd = sd.calendar ? String(sd.calendar.end_date) : null;
      const hasActiveWeekday = sd.calendar
        ? WEEKDAY_KEYS.some((k) => Number(sd.calendar![k]) === 1)
        : false;

      const excByDate = new Map<string, number>();
      for (const ex of sd.exceptions) {
        excByDate.set(String(ex.date), Number(ex.exception_type));
      }

      const cells = weeks
        .map((weekStart) => {
          const weekStartTs = parseGTFSDate(weekStart).getTime();
          const weekEndTs = weekStartTs + 6 * 86400000;
          const weekEnd = formatGTFS(new Date(weekEndTs));

          const isActive =
            calStart !== null &&
            calEnd !== null &&
            hasActiveWeekday &&
            calStart <= weekEnd &&
            calEnd >= weekStart;

          // Tooltips are the portaled `.field-tooltip-trigger` ones, not
          // DaisyUI's CSS tooltip: `.tooltip` sets `display:inline-block`,
          // which would pull every week cell out of the table layout. A tick
          // carries its own trigger, and the portal resolves the innermost
          // trigger under the pointer, so hovering a tick shows the exception
          // date while the rest of the highlighted span shows the service dates.
          const ticks: string[] = [];
          for (let day = 0; day < 7; day++) {
            const dateStr = formatGTFS(new Date(weekStartTs + day * 86400000));
            const excType = excByDate.get(dateStr);
            if (excType === 1) {
              ticks.push(
                renderTooltipTrigger(
                  `Added ${formatGtfsDateWithWeekday(dateStr)}`,
                  renderTriangleIcon('h-2.5 w-2.5 -rotate-90'),
                  'inline-flex text-success'
                )
              );
            } else if (excType === 2) {
              ticks.push(
                renderTooltipTrigger(
                  `Removed ${formatGtfsDateWithWeekday(dateStr)}`,
                  renderTriangleIcon('h-2.5 w-2.5 rotate-90'),
                  'inline-flex text-error'
                )
              );
            }
          }

          // Every highlighted cell carries the same service date range, so the
          // whole span reads as one tooltip. A week is not a meaningful unit
          // here (a service can start or end mid-week), so cells outside the
          // range say nothing at all.
          const tipAttr = isActive
            ? ` data-tooltip-content="${escapeHtml(formatGtfsDateRange(calStart!, calEnd!))}"`
            : '';
          const triggerClass = isActive ? ' field-tooltip-trigger' : '';

          const bgStyle = isActive
            ? `background-color:${hexToRgba(sd.color, 0.2)}`
            : '';
          return `<td class="w-5 min-w-5 h-7 border-r border-base-300/20 text-center align-middle leading-none${triggerClass}" style="${bgStyle}"${tipAttr}>${ticks.join('')}</td>`;
        })
        .join('');

      const labelCell = `<td class="sticky left-0 z-10 bg-base-200 px-2 py-1 border-b border-base-300/30" style="width:${labelColPx}px;min-width:${labelColPx}px;max-width:${labelColPx}px">
        <span class="inline-flex items-center gap-1 overflow-hidden max-w-full">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color:${escapeHtml(sd.color)}"></span>
          <span class="truncate field-tooltip-trigger" tabindex="0" data-tooltip-content="${escapeHtml(sid)}">${escapeHtml(sid)}</span>
        </span>
      </td>`;

      const dotCell = `<td class="w-14 min-w-14 px-1 py-1 border-b border-base-300/30 text-xs">${renderTooltipTrigger(getDaysTooltip(sd.calendar), renderWeekdayDots(sd.calendar))}</td>`;

      // Only needed where the row itself goes somewhere else: without a route
      // context the row already opens the service page.
      const editCell = options.route_id
        ? `<td class="w-8 min-w-8 px-1 py-1 border-b border-base-300/30 text-center">
          <button type="button" class="btn btn-ghost btn-xs px-1 field-tooltip-trigger ${SERVICE_EDIT_BTN}" data-service-id="${escapeHtml(sid)}" data-tooltip-content="${escapeHtml(`Edit service ${sid}`)}">${renderPencilIcon('h-3 w-3')}</button>
        </td>`
        : '';

      return `<tr class="timeline-row cursor-pointer hover:bg-base-300/20" data-service-id="${escapeHtml(sid)}"${routeAttr}>${labelCell}${dotCell}${editCell}${cells}</tr>`;
    })
    .join('');

  const warningHtml = truncated
    ? `<div class="text-xs text-warning mb-2">Date range exceeds 3 years: display truncated.</div>`
    : '';

  const hintHtml = options.route_id
    ? `<div class="text-xs opacity-70 mb-2">Select a service to show the timetable for that service, or use the pencil to edit the service itself.</div>`
    : '';

  const editHeader = options.route_id
    ? `<th class="w-8 min-w-8 border-b border-base-300"></th>`
    : '';

  return `
    <div>
      ${hintHtml}
      ${warningHtml}
      <div class="overflow-x-auto">
        <table class="text-xs border-collapse">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-base-200 border-b border-base-300" style="width:${labelColPx}px;min-width:${labelColPx}px"></th>
              <th class="w-14 min-w-14 px-1 py-0.5 border-b border-base-300 text-center whitespace-nowrap"><span class="font-mono tracking-tight text-base-content/50 text-xs">SMTWTFS</span></th>
              ${editHeader}
              ${headerHtml}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Wire row clicks. `route_id` is only passed when the timeline was rendered
 * with a route context.
 *
 * The per-row edit button calls back without a `route_id`, which is the same
 * shape as a row on a timeline that has no route context, so a caller only
 * needs the one branch: route present means the timetable, absent means the
 * service itself.
 */
export function attachServiceTimelineListeners(
  root: ParentNode,
  onRowClick: (service_id: string, route_id?: string) => void
): void {
  root.querySelectorAll<HTMLElement>('.timeline-row').forEach((row) => {
    row.addEventListener('click', () => {
      const sid = row.dataset.serviceId;
      if (sid) {
        onRowClick(sid, row.dataset.routeId);
      }
    });
  });

  root.querySelectorAll<HTMLElement>(`.${SERVICE_EDIT_BTN}`).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sid = btn.dataset.serviceId;
      if (sid) {
        onRowClick(sid);
      }
    });
  });
}
