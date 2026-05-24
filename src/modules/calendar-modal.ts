import { showModal } from './modal-utils.js';

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
      label: sid.length > 8 ? sid.slice(0, 8) : sid,
    });
  });

  return result;
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
  month1: number
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

    const MAX_CHIPS = 4;
    const overflow = activeServices.length > MAX_CHIPS;
    const shown = overflow
      ? activeServices.slice(0, MAX_CHIPS)
      : activeServices;
    const overflowCount = activeServices.length - MAX_CHIPS;

    const chipsHtml = shown
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

    const overflowHtml = overflow
      ? `<span class="text-xs text-base-content/60">+${overflowCount}</span>`
      : '';

    cells.push(`
      <div class="min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30">
        <div class="text-xs text-base-content/60 mb-0.5">${day}</div>
        <div class="flex flex-col gap-0.5">
          ${chipsHtml}${overflowHtml}
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

export async function showCalendarModal(
  deps: CalendarModalDeps
): Promise<void> {
  const data = await loadCalendarData(deps.gtfsDatabase);

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

  const timelinePlaceholder = `
    <div class="flex items-center justify-center h-32 text-base-content/50 text-sm">
      Timeline view — coming soon
    </div>
  `;

  const body = `
    <div>
      ${tabBarHtml}
      <div id="cal-panel">${renderMonthGrid(data, year, month1)}</div>
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
        panelEl.innerHTML = renderMonthGrid(data, year, month1);
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
            panelEl.innerHTML = renderMonthGrid(data, year, month1);
            attachGridListeners();
          } else {
            panelEl.innerHTML = timelinePlaceholder;
          }
        });
      });

      console.log('[CalendarModal] Opened with', data.size, 'services');
    },
  });
}
