/**
 * New Service Modal
 *
 * Creates one `calendar.txt` row: a service_id, a weekly pattern and a date
 * range. Opened from the timetable modal's service picker and from the route
 * page's "no services" empty state, both of which want a service to exist
 * before they can show a timetable for it.
 *
 * The row is written and recorded here, so the caller only has to deal with the
 * new service_id it resolves with.
 */

import { showModal } from './modal-utils.js';
import { escapeHtml } from '../utils/escape-html.js';
import { notify } from './notification-system.js';
import { createDefaultService } from '../utils/default-values.js';
import { feedBounds, type FeedBoundsSource } from '../utils/feed-bounds.js';
import {
  fromInputValue,
  toInputValue,
  todayInputValue,
} from '../utils/gtfs-date.js';
import { DAYS_OF_WEEK } from './service-days-controller.js';

export interface NewServiceModalDeps {
  database: FeedBoundsSource & {
    getRow: (tableName: string, key: string) => Promise<unknown>;
    getAllRows: (tableName: string) => Promise<unknown[]>;
    insertRows: (
      tableName: string,
      rows: Record<string, unknown>[]
    ) => Promise<void>;
  };
  patchManager: {
    recordInsert: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
  } | null;
}

const ERROR_ID = 'new-service-error';

function renderBody(startInput: string, endInput: string): string {
  const dayToggles = DAYS_OF_WEEK.map(
    ({ key, label }) => `
      <button
        type="button"
        class="btn btn-xs btn-outline new-service-day"
        data-day="${key}"
        aria-pressed="false"
      >${label}</button>
    `
  ).join('');

  return `
    <div class="flex flex-col gap-4">
      <label class="flex flex-col gap-1">
        <span class="text-sm opacity-60">Service ID</span>
        <input
          id="new-service-id"
          type="text"
          class="input input-bordered w-full"
          placeholder="e.g. WEEKDAY"
          autocomplete="off"
        />
      </label>

      <div class="flex flex-col gap-1">
        <span class="text-sm opacity-60">Runs on</span>
        <div class="flex gap-1">${dayToggles}</div>
      </div>

      <div class="flex gap-4">
        <label class="flex flex-1 flex-col gap-1">
          <span class="text-sm opacity-60">Start date</span>
          <input
            id="new-service-start"
            type="date"
            class="input input-bordered w-full"
            value="${escapeHtml(startInput)}"
          />
          <button
            type="button"
            class="btn btn-xs btn-ghost self-start"
            data-today-for="new-service-start"
          >Today</button>
        </label>
        <label class="flex flex-1 flex-col gap-1">
          <span class="text-sm opacity-60">End date</span>
          <input
            id="new-service-end"
            type="date"
            class="input input-bordered w-full"
            value="${escapeHtml(endInput)}"
          />
          <button
            type="button"
            class="btn btn-xs btn-ghost self-start"
            data-today-for="new-service-end"
          >Today</button>
        </label>
      </div>

      <div id="${ERROR_ID}" class="text-sm text-error"></div>
    </div>
  `;
}

/**
 * Ask for a new service and write it.
 *
 * Resolves with the created `service_id`, or `null` when cancelled. Zero days
 * selected is allowed: a service that only runs on `calendar_dates` exception
 * dates is legal, and the service page can add those afterwards.
 */
export async function showNewServiceModal(
  deps: NewServiceModalDeps
): Promise<string | null> {
  const bounds = await feedBounds(deps.database);
  const defaults = createDefaultService('');
  const startDate = bounds.start ?? defaults.start_date;
  const endDate = bounds.end ?? defaults.end_date;

  const days = new Set<string>();
  let created: string | null = null;

  const setError = (message: string): void => {
    const el = document.getElementById(ERROR_ID);
    if (el) {
      el.textContent = message;
    }
  };

  const create = async (): Promise<boolean> => {
    const idInput = document.getElementById(
      'new-service-id'
    ) as HTMLInputElement | null;
    const startInput = document.getElementById(
      'new-service-start'
    ) as HTMLInputElement | null;
    const endInput = document.getElementById(
      'new-service-end'
    ) as HTMLInputElement | null;
    if (!idInput || !startInput || !endInput) {
      return true;
    }

    const service_id = idInput.value.trim();
    if (service_id === '') {
      setError('A service needs an ID.');
      return true;
    }

    const existingCalendar = await deps.database.getRow('calendar', service_id);
    if (existingCalendar) {
      setError(`Service "${service_id}" already exists.`);
      return true;
    }
    const exceptions = (await deps.database.getAllRows(
      'calendar_dates'
    )) as Record<string, unknown>[];
    if (exceptions.some((row) => String(row.service_id ?? '') === service_id)) {
      setError(
        `Service "${service_id}" already exists in calendar_dates.txt. Open it to give it a weekly pattern.`
      );
      return true;
    }

    const start_date = fromInputValue(startInput.value);
    const end_date = fromInputValue(endInput.value);
    if (start_date === '' || end_date === '') {
      setError('A service needs both a start and an end date.');
      return true;
    }
    if (end_date < start_date) {
      setError('The end date is before the start date.');
      return true;
    }

    const row: Record<string, unknown> = {
      ...createDefaultService(service_id),
      ...Object.fromEntries(
        DAYS_OF_WEEK.map(({ key }) => [key, days.has(key) ? 1 : 0])
      ),
      start_date,
      end_date,
    };

    console.log('[NewServiceModal] creating service', service_id, row);
    await deps.database.insertRows('calendar', [row]);
    if (deps.patchManager) {
      await deps.patchManager.recordInsert('calendar', service_id, row);
    } else {
      console.warn(
        '[NewServiceModal] no patchManager wired, the insert is not undoable'
      );
    }

    notify.success(`Created service ${service_id}`);
    created = service_id;
    return false;
  };

  await showModal({
    title: 'New service',
    body: renderBody(toInputValue(startDate), toInputValue(endDate)),
    actions: [
      { label: 'Create', className: 'btn-primary', onClick: create },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    enterAction: 0,
    escapeAction: 1,
    boxClassName: 'max-w-lg',
    onMount: () => {
      document.getElementById('new-service-id')?.focus();

      document
        .querySelectorAll<HTMLButtonElement>('[data-today-for]')
        .forEach((btn) => {
          btn.addEventListener('click', () => {
            const target = document.getElementById(
              btn.dataset.todayFor ?? ''
            ) as HTMLInputElement | null;
            if (target) {
              target.value = todayInputValue();
            }
          });
        });

      document
        .querySelectorAll<HTMLButtonElement>('.new-service-day')
        .forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.day;
            if (!key) {
              return;
            }
            const on = !days.has(key);
            if (on) {
              days.add(key);
            } else {
              days.delete(key);
            }
            btn.classList.toggle('btn-primary', on);
            btn.classList.toggle('btn-outline', !on);
            btn.setAttribute('aria-pressed', String(on));
          });
        });
    },
  });

  return created;
}
