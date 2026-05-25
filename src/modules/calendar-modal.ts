import { showModal } from './modal-utils.js';
import { formatDaysOfWeek } from '../utils/entity-references.js';

export interface CalendarModalDeps {
  gtfsDatabase: {
    getAllRows: (tableName: string) => Promise<Record<string, unknown>[]>;
  };
  onServiceClick: (service_id: string) => void;
}

interface ServiceData {
  calendar: Record<string, unknown> | null;
  exceptions: Record<string, unknown>[];
  color: string;
  label: string;
}

type ServiceDataMap = Map<string, ServiceData>;

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

function getServiceColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function parseGTFSDate(s: string): Date {
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10);
  const day = parseInt(s.slice(6, 8), 10);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatGTFS(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
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

function isServiceActive(
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

async function loadCalendarData(
  db: CalendarModalDeps['gtfsDatabase']
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

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMonthNav(year: number, month1: number): string {
  const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `
    <div class="flex items-center justify-between mb-2" id="cal-month-nav">
      <button class="btn btn-sm btn-ghost" data-action="prev-month">&#8249;</button>
      <span class="font-semibold">${MONTH_NAMES[month1 - 1]} ${year}</span>
      <button class="btn btn-sm btn-ghost" data-action="next-month">&#8250;</button>
    </div>
  `;
}

function renderMonthGrid(
  data: ServiceDataMap,
  year: number,
  month1: number,
  feedStartDate: string | null,
  feedEndDate: string | null
): string {
  const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const firstDayOfMonth = new Date(Date.UTC(year, month1 - 1, 1));
  const startDow = firstDayOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();

  const headerRow = DAY_HEADERS.map(
    (h) =>
      `<div class="text-center text-xs font-semibold text-base-content/50 pb-1">${h}</div>`
  ).join('');

  const cells: string[] = [];

  // Leading empty cells
  for (let i = 0; i < startDow; i++) {
    cells.push(
      `<div class="min-h-16 p-1 rounded bg-base-200/30 opacity-30"></div>`
    );
  }

  const serviceEntries = [...data.entries()];

  for (let day = 1; day <= daysInMonth; day++) {
    const gtfsDate = formatGTFS(new Date(Date.UTC(year, month1 - 1, day)));
    const activeServices: Array<{ sid: string; data: ServiceData }> = [];

    for (const [sid, sd] of serviceEntries) {
      if (isServiceActive(sd.calendar, sd.exceptions, gtfsDate)) {
        activeServices.push({ sid, data: sd });
      }
    }

    const chipsHtml = activeServices
      .map(({ sid, data: sd }) => {
        const excForDay = sd.exceptions.find(
          (e) => String(e.date) === gtfsDate
        );
        let suffix = '';
        if (excForDay) {
          suffix =
            Number(excForDay.exception_type) === 1
              ? `<span style="color:#4ade80">+</span>`
              : `<span style="color:#f87171">−</span>`;
        }
        return `<span
          class="cal-chip cursor-pointer inline-flex items-center gap-0.5 px-1 rounded text-xs text-white font-medium truncate max-w-full"
          style="background-color:${esc(sd.color)}"
          data-service-id="${esc(sid)}"
          title="${esc(sid)}"
        >${esc(sd.label)}${suffix}</span>`;
      })
      .join('');

    const feedStartBadge =
      gtfsDate === feedStartDate
        ? `<span class="badge badge-xs badge-success ml-1" title="Feed start date">&#9654;</span>`
        : '';
    const feedEndBadge =
      gtfsDate === feedEndDate
        ? `<span class="badge badge-xs badge-error ml-1" title="Feed end date">&#9664;</span>`
        : '';

    cells.push(`
      <div class="min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30 overflow-hidden">
        <div class="text-xs text-base-content/60 mb-0.5 flex items-center gap-0.5">${day}${feedStartBadge}${feedEndBadge}</div>
        <div class="max-h-24 overflow-y-auto">
          <div class="flex flex-col gap-0.5">
            ${chipsHtml}
          </div>
        </div>
      </div>
    `);
  }

  // Trailing empty cells to complete grid
  const totalCells = cells.length + startDow;
  const trailingCount = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 0; i < trailingCount; i++) {
    cells.push(
      `<div class="min-h-16 p-1 rounded bg-base-200/30 opacity-30"></div>`
    );
  }

  return `
    <div id="cal-grid-container">
      ${renderMonthNav(year, month1)}
      <div class="grid grid-cols-7 gap-1">
        ${headerRow}
        ${cells.join('')}
      </div>
    </div>
  `;
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

// Sun–Sat order for weekday dot display (matches WEEKDAY_KEYS)
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

function formatHumanDate(gtfsDate: string): string {
  const d = parseGTFSDate(gtfsDate);
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    d.getUTCDay()
  ];
  return `${dayName}, ${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

function renderTimeline(data: ServiceDataMap): string {
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
                `<span class="tooltip tooltip-top" data-tip="${esc(formatHumanDate(dateStr))}"><span style="color:#4ade80">▲</span></span>`
              );
            } else if (excType === 2) {
              ticks.push(
                `<span class="tooltip tooltip-top" data-tip="${esc(formatHumanDate(dateStr))}"><span style="color:#f87171">▼</span></span>`
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
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color:${esc(sd.color)}"></span>
          <span class="truncate" title="${esc(sid)}">${esc(sid)}</span>
        </span>
      </td>`;

      const dotCell = `<td class="w-14 min-w-14 px-1 py-1 border-b border-base-300/30 text-xs tooltip tooltip-right" data-tip="${esc(getDaysTooltip(sd.calendar))}">${renderWeekdayDots(sd.calendar)}</td>`;

      return `<tr class="timeline-row cursor-pointer hover:bg-base-300/20" data-service-id="${esc(sid)}">${labelCell}${dotCell}${cells}</tr>`;
    })
    .join('');

  const warningHtml = truncated
    ? `<div class="text-xs text-warning mb-2">Date range exceeds 3 years — display truncated.</div>`
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

export async function showCalendarModal(
  deps: CalendarModalDeps
): Promise<void> {
  const [data, feedInfoRows] = await Promise.all([
    loadCalendarData(deps.gtfsDatabase),
    deps.gtfsDatabase.getAllRows('feed_info'),
  ]);

  const feedStart = feedInfoRows[0]?.feed_start_date;
  const feedEnd = feedInfoRows[0]?.feed_end_date;
  const feedStartDate: string | null =
    feedStart !== null && feedStart !== undefined ? String(feedStart) : null;
  const feedEndDate: string | null =
    feedEnd !== null && feedEnd !== undefined ? String(feedEnd) : null;

  const now = new Date();
  let year = now.getFullYear();
  let month1 = now.getMonth() + 1;

  let currentTab: 'month' | 'timeline' = 'month';

  const tabBarHtml = `
    <div class="tabs tabs-border mb-4" id="cal-tabs">
      <button class="tab tab-active" data-tab="month">Month Grid</button>
      <button class="tab" data-tab="timeline">Timeline</button>
    </div>
  `;

  const timelineHtml = renderTimeline(data);

  const body = `
    <div>
      ${tabBarHtml}
      <div id="cal-panel">${renderMonthGrid(data, year, month1, feedStartDate, feedEndDate)}</div>
    </div>
  `;

  await showModal({
    title: 'Service Calendar',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-5xl w-full',
    onMount: (close) => {
      const panelEl = document.getElementById('cal-panel');
      const tabBtns = document.querySelectorAll<HTMLButtonElement>(
        '#cal-tabs [data-tab]'
      );

      if (!panelEl) {
        return;
      }

      const rerenderGrid = (): void => {
        panelEl.innerHTML = renderMonthGrid(
          data,
          year,
          month1,
          feedStartDate,
          feedEndDate
        );
        attachGridListeners();
      };

      const attachGridListeners = (): void => {
        panelEl
          .querySelector<HTMLButtonElement>('[data-action="prev-month"]')
          ?.addEventListener('click', () => {
            month1--;
            if (month1 < 1) {
              month1 = 12;
              year--;
            }
            rerenderGrid();
          });

        panelEl
          .querySelector<HTMLButtonElement>('[data-action="next-month"]')
          ?.addEventListener('click', () => {
            month1++;
            if (month1 > 12) {
              month1 = 1;
              year++;
            }
            rerenderGrid();
          });

        panelEl.querySelectorAll<HTMLElement>('.cal-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            const sid = chip.dataset.serviceId;
            if (sid) {
              close();
              deps.onServiceClick(sid);
            }
          });
        });
      };

      const attachTimelineListeners = (): void => {
        panelEl
          .querySelectorAll<HTMLElement>('.timeline-row')
          .forEach((row) => {
            row.addEventListener('click', () => {
              const sid = row.dataset.serviceId;
              if (sid) {
                close();
                deps.onServiceClick(sid);
              }
            });
          });
      };

      attachGridListeners();

      tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab as 'month' | 'timeline';
          if (tab === currentTab) {
            return;
          }
          currentTab = tab;
          tabBtns.forEach((b) => b.classList.remove('tab-active'));
          btn.classList.add('tab-active');

          if (tab === 'month') {
            panelEl.innerHTML = renderMonthGrid(
              data,
              year,
              month1,
              feedStartDate,
              feedEndDate
            );
            attachGridListeners();
          } else {
            panelEl.innerHTML = timelineHtml;
            attachTimelineListeners();
          }
        });
      });

      console.log('[CalendarModal] Opened with', data.size, 'services');
    },
  });
}
