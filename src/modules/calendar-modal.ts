import { showModal } from './modal-utils.js';
import { escapeHtml } from '../utils/escape-html.js';
import { toGtfsDate as formatGTFS } from '../utils/gtfs-date.js';
import {
  attachServiceTimelineListeners,
  isServiceActive,
  loadServiceData,
  renderServiceTimeline,
  type ServiceData,
  type ServiceDataMap,
  type ServiceTimelineSource,
} from './service-timeline.js';

export interface CalendarModalDeps {
  gtfsDatabase: ServiceTimelineSource;
  onServiceClick: (service_id: string) => void;
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
          class="cal-chip field-tooltip-trigger cursor-pointer inline-flex items-center gap-0.5 px-1 rounded text-xs text-white font-medium truncate max-w-full"
          style="background-color:${escapeHtml(sd.color)}"
          data-service-id="${escapeHtml(sid)}"
          data-tooltip-content="${escapeHtml(sid)}"
        >${escapeHtml(sd.label)}${suffix}</span>`;
      })
      .join('');

    const feedStartBadge =
      gtfsDate === feedStartDate
        ? `<span class="badge badge-xs badge-success ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="Feed start date">&#9654;</span>`
        : '';
    const feedEndBadge =
      gtfsDate === feedEndDate
        ? `<span class="badge badge-xs badge-error ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="Feed end date">&#9664;</span>`
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

export async function showCalendarModal(
  deps: CalendarModalDeps
): Promise<void> {
  const [data, feedInfoRows] = await Promise.all([
    loadServiceData(deps.gtfsDatabase),
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

  const timelineHtml = renderServiceTimeline(data);

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
        attachServiceTimelineListeners(panelEl, (sid) => {
          close();
          deps.onServiceClick(sid);
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
