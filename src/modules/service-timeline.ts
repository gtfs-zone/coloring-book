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
  formatGtfsDateWithWeekday,
  parseGtfsDate,
  toGtfsDate as formatGTFS,
} from '../utils/gtfs-date.js';

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

/**
 * Scope a loaded map to a set of services. Colors stay as assigned by
 * `loadServiceData`, so a service keeps the same color on every page.
 */
export function filterServiceDataMap(
  data: ServiceDataMap,
  service_ids: Iterable<string>
): ServiceDataMap {
  const wanted = new Set(service_ids);
  const result: ServiceDataMap = new Map();
  for (const [sid, sd] of data) {
    if (wanted.has(sid)) {
      result.set(sid, sd);
    }
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

          const ticks: string[] = [];
          for (let t = weekStartTs; t <= weekEndTs; t += 86400000) {
            const dateStr = formatGTFS(new Date(t));
            const excType = excByDate.get(dateStr);
            if (excType === 1) {
              ticks.push(
                `<span class="tooltip tooltip-top" data-tip="${escapeHtml(formatGtfsDateWithWeekday(dateStr))}"><span style="color:#4ade80">▲</span></span>`
              );
            } else if (excType === 2) {
              ticks.push(
                `<span class="tooltip tooltip-top" data-tip="${escapeHtml(formatGtfsDateWithWeekday(dateStr))}"><span style="color:#f87171">▼</span></span>`
              );
            }
          }

          const bgStyle = isActive
            ? `background-color:${hexToRgba(sd.color, 0.2)}`
            : '';
          return `<td class="w-5 min-w-5 h-7 border-r border-base-300/20 text-center align-middle leading-none" style="${bgStyle}">${ticks.join('')}</td>`;
        })
        .join('');

      const labelCell = `<td class="sticky left-0 z-10 bg-base-200 px-2 py-1 border-b border-base-300/30" style="width:${labelColPx}px;min-width:${labelColPx}px;max-width:${labelColPx}px">
        <span class="inline-flex items-center gap-1 overflow-hidden max-w-full">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color:${escapeHtml(sd.color)}"></span>
          <span class="truncate" title="${escapeHtml(sid)}">${escapeHtml(sid)}</span>
        </span>
      </td>`;

      const dotCell = `<td class="w-14 min-w-14 px-1 py-1 border-b border-base-300/30 text-xs tooltip tooltip-right" data-tip="${escapeHtml(getDaysTooltip(sd.calendar))}">${renderWeekdayDots(sd.calendar)}</td>`;

      return `<tr class="timeline-row cursor-pointer hover:bg-base-300/20" data-service-id="${escapeHtml(sid)}"${routeAttr}>${labelCell}${dotCell}${cells}</tr>`;
    })
    .join('');

  const warningHtml = truncated
    ? `<div class="text-xs text-warning mb-2">Date range exceeds 3 years: display truncated.</div>`
    : '';

  return `
    <div>
      ${warningHtml}
      <div class="overflow-x-auto">
        <table class="text-xs border-collapse">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-base-200 border-b border-base-300" style="width:${labelColPx}px;min-width:${labelColPx}px"></th>
              <th class="w-14 min-w-14 px-1 py-0.5 border-b border-base-300 text-center whitespace-nowrap"><span class="font-mono tracking-tight text-base-content/50 text-xs">SMTWTFS</span></th>
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
}
