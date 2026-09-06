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

import { promptNewEntity } from './entity-form-modal.js';
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

/** The weekly pattern, which has no single field of its own to render into. */
function renderDayToggles(): string {
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
    <div class="flex flex-col gap-1">
      <span class="text-sm opacity-60">Runs on</span>
      <div class="flex gap-1">${dayToggles}</div>
    </div>
  `;
}

/** A "Today" shortcut under a date input. */
function todayButton(inputField: string): string {
  return `<button
    type="button"
    class="btn btn-xs btn-ghost self-start"
    data-today-for="entity-form-${inputField}"
  >Today</button>`;
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

  const values = await promptNewEntity({
    title: 'New service',
    boxClassName: 'max-w-lg',
    fields: [
      {
        field: 'service_id',
        tableName: 'calendar',
        mono: true,
        placeholder: 'weekday',
      },
      {
        field: 'start_date',
        tableName: 'calendar',
        type: 'date',
        value: toInputValue(startDate),
        note: todayButton('start_date'),
      },
      {
        field: 'end_date',
        tableName: 'calendar',
        type: 'date',
        value: toInputValue(endDate),
        note: todayButton('end_date'),
      },
    ],
    extraBody: renderDayToggles(),
    onMount: () => {
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
    validate: async (v) => {
      const service_id = v.service_id;
      if (service_id === '') {
        return 'A service needs an ID.';
      }

      const existingCalendar = await deps.database.getRow(
        'calendar',
        service_id
      );
      if (existingCalendar) {
        return `Service "${service_id}" already exists.`;
      }
      const exceptions = (await deps.database.getAllRows(
        'calendar_dates'
      )) as Record<string, unknown>[];
      if (
        exceptions.some((row) => String(row.service_id ?? '') === service_id)
      ) {
        return `Service "${service_id}" already exists in calendar_dates.txt. Open it to give it a weekly pattern.`;
      }

      const start_date = fromInputValue(v.start_date);
      const end_date = fromInputValue(v.end_date);
      if (start_date === '' || end_date === '') {
        return 'A service needs both a start and an end date.';
      }
      if (end_date < start_date) {
        return 'The end date is before the start date.';
      }
      return null;
    },
    onCreate: async (v) => {
      const service_id = v.service_id;
      const row: Record<string, unknown> = {
        ...createDefaultService(service_id),
        ...Object.fromEntries(
          DAYS_OF_WEEK.map(({ key }) => [key, days.has(key) ? 1 : 0])
        ),
        start_date: fromInputValue(v.start_date),
        end_date: fromInputValue(v.end_date),
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
    },
  });

  return values ? values.service_id : null;
}
