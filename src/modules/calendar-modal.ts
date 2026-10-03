import { renderTriangleIcon } from 'gtfs-zone-web-common/ui/modal-utils';
import type { DateCodec } from 'gtfs-zone-web-common/ui/calendar-input';
import {
  renderMonthGrid,
  showCalendarModal as showSharedCalendarModal,
} from 'gtfs-zone-web-common/ui/calendar-modal';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { CONFIG } from '../config';
import { parseGtfsDate, toGtfsDate, todayGtfsDate } from '../utils/gtfs-date';
import {
  feedBounds,
  trimOrExtendServices,
  type BatchMixedPatchManager,
  type FeedBoundsWriteDatabase,
} from '../utils/feed-bounds';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import {
  attachServiceTimelineListeners,
  isServiceActive,
  loadServiceData,
  loadTripCounts,
  renderServiceTimeline,
  type ServiceData,
  type ServiceTimelineSource,
} from './service-timeline';
import { t } from '../i18n/messages';

export interface CalendarModalDeps {
  gtfsDatabase: ServiceTimelineSource & FeedBoundsWriteDatabase;
  patchManager?: BatchMixedPatchManager | null;
  onServiceClick: (service_id: string) => void;
}

const GTFS_DATE_CODEC: DateCodec = { parse: parseGtfsDate, format: toGtfsDate };

function renderServiceChip(sid: string, sd: ServiceData, date: string): string {
  const excForDay = sd.exceptions.find((e) => String(e.date) === date);
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
}

function renderFeedEdgeBadges(
  date: string,
  feedStartDate: string | null,
  feedEndDate: string | null
): string {
  const start =
    date === feedStartDate
      ? `<span class="badge badge-xs badge-success ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="${t('cal.feedStart')}">${renderTriangleIcon('h-2 w-2')}</span>`
      : '';
  const end =
    date === feedEndDate
      ? `<span class="badge badge-xs badge-error ml-1 field-tooltip-trigger" tabindex="0" data-tooltip-content="${t('cal.feedEnd')}">${renderTriangleIcon('h-2 w-2 rotate-180')}</span>`
      : '';
  return start + end;
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
  let batchRunning = false;
  let openService: (sid: string) => void = () => {};

  const trimTitle = feedStartDate
    ? t('page.trimAllTitle', { date: feedStartDate })
    : t('page.noFeedStart');
  const extendTitle = feedEndDate
    ? t('page.extendAllTitle', { date: feedEndDate })
    : t('page.noFeedEnd');

  const toolbarHtml = (): string => `
    <button
      type="button"
      class="btn btn-xs btn-outline"
      data-cal-bound="start_date"
      title="${escapeHtml(trimTitle)}"
      ${feedStartDate && !batchRunning ? '' : 'disabled'}
    >${t('page.trimAll')}</button>
    <button
      type="button"
      class="btn btn-xs btn-outline"
      data-cal-bound="end_date"
      title="${escapeHtml(extendTitle)}"
      ${feedEndDate && !batchRunning ? '' : 'disabled'}
    >${t('page.extendAll')}</button>
  `;

  const renderGrid = (month: string): string =>
    renderMonthGrid(month, {
      codec: GTFS_DATE_CODEC,
      weekStart: CONFIG.WEEK_START,
      today: todayGtfsDate,
      renderDay: ({ date }) => ({
        badges: renderFeedEdgeBadges(date, feedStartDate, feedEndDate),
        chips: [...data.entries()]
          .filter(([, sd]) => isServiceActive(sd.calendar, sd.exceptions, date))
          .map(([sid, sd]) => renderServiceChip(sid, sd, date))
          .join(''),
      }),
    });

  /** Reloads every service's calendar/exception rows after a batch write. */
  const refreshServiceData = async (): Promise<void> => {
    const fresh = await loadServiceData(deps.gtfsDatabase);
    data.clear();
    for (const [sid, sd] of fresh) {
      data.set(sid, sd);
    }
  };

  const runBoundBatch = async (
    field: 'start_date' | 'end_date',
    value: string,
    redraw: () => void
  ): Promise<void> => {
    if (!deps.patchManager) {
      console.warn('[CalendarModal] No patchManager wired, cannot batch');
      return;
    }
    batchRunning = true;
    redraw();
    try {
      const { services, exceptions } = await trimOrExtendServices(
        deps.gtfsDatabase,
        deps.patchManager,
        field,
        value
      );
      if (services === 0 && exceptions === 0) {
        notify.info(t('page.alreadyAtBound'));
      } else {
        const vars = {
          services: t('count.services', { count: services }),
          exceptions: t('count.exceptions', { count: exceptions }),
        };
        const trim = field === 'start_date';
        notify.success(
          exceptions > 0
            ? t(trim ? 'page.trimmedRemoved' : 'page.extendedRemoved', vars)
            : t(trim ? 'page.trimmed' : 'page.extended', vars)
        );
      }
      await refreshServiceData();
    } finally {
      batchRunning = false;
      redraw();
    }
  };

  await showSharedCalendarModal({
    title: t('cal.title'),
    codec: GTFS_DATE_CODEC,
    weekStart: CONFIG.WEEK_START,
    today: todayGtfsDate,
    toolbarHtml,
    tabs: [
      { key: 'month', label: t('cal.monthGrid'), render: renderGrid },
      {
        key: 'timeline',
        label: t('cal.timeline'),
        monthless: true,
        render: () => renderServiceTimeline(data, { tripCounts }),
      },
    ],
    onMount: ({ root, redraw, close }) => {
      openService = (sid) => {
        close();
        deps.onServiceClick(sid);
      };

      root.addEventListener('click', (event) => {
        const source = event.target as HTMLElement | null;
        const chip = source?.closest<HTMLElement>('.cal-chip');
        if (chip?.dataset.serviceId) {
          openService(chip.dataset.serviceId);
          return;
        }
        const bound = source?.closest<HTMLButtonElement>('[data-cal-bound]');
        if (!bound || bound.disabled) {
          return;
        }
        if (bound.dataset.calBound === 'start_date' && feedStartDate) {
          void runBoundBatch('start_date', feedStartDate, redraw);
        } else if (bound.dataset.calBound === 'end_date' && feedEndDate) {
          void runBoundBatch('end_date', feedEndDate, redraw);
        }
      });

      console.log('[CalendarModal] Opened with', data.size, 'services');
    },
    onRender: (root) =>
      attachServiceTimelineListeners(root, (sid) => openService(sid)),
  });
}
