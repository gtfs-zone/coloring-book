import { showModal, renderTriangleIcon } from './modal-utils';
import { escapeHtml } from '../utils/escape-html';
import { toGtfsDate as formatGTFS, todayGtfsDate } from '../utils/gtfs-date';
import {
  feedBounds,
  trimOrExtendServices,
  type BatchMixedPatchManager,
  type FeedBoundsWriteDatabase,
} from '../utils/feed-bounds';
import { notify } from './notification-system';
import {
  attachServiceTimelineListeners,
  isServiceActive,
  loadServiceData,
  loadTripCounts,
  renderServiceTimeline,
  type ServiceData,
  type ServiceDataMap,
  type ServiceTimelineSource,
} from './service-timeline';

export interface CalendarModalDeps {
  gtfsDatabase: ServiceTimelineSource & FeedBoundsWriteDatabase;
  patchManager?: BatchMixedPatchManager | null;
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
  const now = new Date();
  const onCurrentMonth =
    year === now.getFullYear() && month1 === now.getMonth() + 1;
  return `
    <div class="flex items-center justify-between mb-2" id="cal-month-nav">
      <button class="btn btn-sm btn-ghost" data-action="prev-month">&#8249;</button>
      <div class="flex items-center gap-2">
        <span class="font-semibold">${MONTH_NAMES[month1 - 1]} ${year}</span>
        <button
          class="btn btn-xs btn-ghost"
          data-action="today"
          ${onCurrentMonth ? 'disabled' : ''}
        >Today</button>
      </div>
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

  const today = todayGtfsDate();
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
              ? renderTriangleIcon('h-3 w-3 shrink-0 -rotate-90 text-success')
              : renderTriangleIcon('h-3 w-3 shrink-0 rotate-90 text-error');
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
        ? `<span class="badge badge-xs badge-success ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="Feed start date">${renderTriangleIcon('h-2 w-2')}</span>`
        : '';
    const feedEndBadge =
      gtfsDate === feedEndDate
        ? `<span class="badge badge-xs badge-error ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="Feed end date">${renderTriangleIcon('h-2 w-2 rotate-180')}</span>`
        : '';

    const isToday = gtfsDate === today;
    const todayCellClass = isToday ? ' ring-1 ring-primary bg-primary/5' : '';
    const todayLabel = isToday
      ? '<span class="text-primary font-semibold">Today</span>'
      : '';

    cells.push(`
      <div class="min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30 overflow-hidden${todayCellClass}">
        <div class="text-xs text-base-content/60 mb-0.5 flex items-center gap-0.5">${day}${todayLabel}${feedStartBadge}${feedEndBadge}</div>
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
  const [data, bounds, tripCounts] = await Promise.all([
    loadServiceData(deps.gtfsDatabase),
    feedBounds(deps.gtfsDatabase),
    loadTripCounts(deps.gtfsDatabase),
  ]);

  const feedStartDate = bounds.start ?? null;
  const feedEndDate = bounds.end ?? null;

  const now = new Date();
  let year = now.getFullYear();
  let month1 = now.getMonth() + 1;

  let currentTab: 'month' | 'timeline' = 'month';

  const trimTitle = feedStartDate
    ? `Set every service's start_date to ${feedStartDate}, and remove every exception before it`
    : 'feed_info has no feed_start_date';
  const extendTitle = feedEndDate
    ? `Set every service's end_date to ${feedEndDate}, and remove every exception after it`
    : 'feed_info has no feed_end_date';

  const toolbarHtml = `
    <div class="flex items-center justify-between gap-2 mb-2">
      <div class="tabs tabs-border" id="cal-tabs">
        <button class="tab tab-active" data-tab="month">Month Grid</button>
        <button class="tab" data-tab="timeline">Timeline</button>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-xs btn-outline"
          id="cal-trim-all-btn"
          title="${escapeHtml(trimTitle)}"
          ${feedStartDate ? '' : 'disabled'}
        >Trim all to feed start</button>
        <button
          type="button"
          class="btn btn-xs btn-outline"
          id="cal-extend-all-btn"
          title="${escapeHtml(extendTitle)}"
          ${feedEndDate ? '' : 'disabled'}
        >Extend all to feed end</button>
      </div>
    </div>
  `;

  const body = `
    <div>
      ${toolbarHtml}
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
      const trimAllBtn = document.getElementById(
        'cal-trim-all-btn'
      ) as HTMLButtonElement | null;
      const extendAllBtn = document.getElementById(
        'cal-extend-all-btn'
      ) as HTMLButtonElement | null;

      if (!panelEl) {
        return;
      }

      const renderTimelineHtml = (): string =>
        renderServiceTimeline(data, { tripCounts });

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

      const rerenderPanel = (): void => {
        if (currentTab === 'month') {
          rerenderGrid();
        } else {
          panelEl.innerHTML = renderTimelineHtml();
          attachTimelineListeners();
        }
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

        panelEl
          .querySelector<HTMLButtonElement>('[data-action="today"]')
          ?.addEventListener('click', () => {
            const now = new Date();
            year = now.getFullYear();
            month1 = now.getMonth() + 1;
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

      /** Reloads every service's calendar/exception rows after a batch write. */
      const refreshServiceData = async (): Promise<void> => {
        const fresh = await loadServiceData(deps.gtfsDatabase);
        data.clear();
        for (const [sid, sd] of fresh) {
          data.set(sid, sd);
        }
      };

      const runBoundBatch = async (
        btn: HTMLButtonElement,
        field: 'start_date' | 'end_date',
        value: string
      ): Promise<void> => {
        if (!deps.patchManager) {
          console.warn('[CalendarModal] No patchManager wired, cannot batch');
          return;
        }
        btn.disabled = true;
        try {
          const { services, exceptions } = await trimOrExtendServices(
            deps.gtfsDatabase,
            deps.patchManager,
            field,
            value
          );
          if (services === 0 && exceptions === 0) {
            notify.info('Every service is already at that bound');
          } else {
            const verb = field === 'start_date' ? 'Trimmed' : 'Extended';
            const removed =
              exceptions > 0
                ? `, removed ${exceptions} exception${exceptions === 1 ? '' : 's'}`
                : '';
            notify.success(
              `${verb} ${services} service${services === 1 ? '' : 's'}${removed}`
            );
          }
          await refreshServiceData();
          rerenderPanel();
        } finally {
          btn.disabled = false;
        }
      };

      trimAllBtn?.addEventListener('click', () => {
        if (feedStartDate) {
          void runBoundBatch(trimAllBtn, 'start_date', feedStartDate);
        }
      });

      extendAllBtn?.addEventListener('click', () => {
        if (feedEndDate) {
          void runBoundBatch(extendAllBtn, 'end_date', feedEndDate);
        }
      });

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
            panelEl.innerHTML = renderTimelineHtml();
            attachTimelineListeners();
          }
        });
      });

      console.log('[CalendarModal] Opened with', data.size, 'services');
    },
  });
}
