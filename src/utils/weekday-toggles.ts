import { t } from '../i18n/messages';

/**
 * The weekly pattern toggles: one button per `calendar.txt` weekday field.
 *
 * Markup and classes only. The caller wires the clicks: the service page
 * writes each toggle through the patch system, the new service modal into its
 * draft record.
 */

// Days of the week in US format (Sunday first)
export const DAYS_OF_WEEK = [
  { key: 'sunday', label: t('weekday.sun') },
  { key: 'monday', label: t('weekday.mon') },
  { key: 'tuesday', label: t('weekday.tue') },
  { key: 'wednesday', label: t('weekday.wed') },
  { key: 'thursday', label: t('weekday.thu') },
  { key: 'friday', label: t('weekday.fri') },
  { key: 'saturday', label: t('weekday.sat') },
] as const;

/**
 * Render the toggle row. `attrs` returns extra attributes for a day's button,
 * `inner` extra markup placed before its label.
 */
export function renderWeekdayToggles(
  active: Set<string>,
  attrs: (key: string) => string,
  inner: (key: string) => string = () => ''
): string {
  const dayToggles = DAYS_OF_WEEK.map(({ key, label }) => {
    const activeClass = active.has(key) ? 'btn-primary' : 'btn-outline';
    return `
      <button
        type="button"
        class="btn ${activeClass} btn-xs day-toggle"
        data-day="${key}"
        aria-pressed="${active.has(key)}"
        ${attrs(key)}
      >
        ${inner(key)}
        ${label}
      </button>
    `;
  }).join('');

  return `
    <div class="day-toggles flex gap-1 text-xs">
      ${dayToggles}
    </div>
  `;
}

/** Show a day's button as on or off. */
export function setWeekdayToggle(button: HTMLElement, on: boolean): void {
  button.classList.remove('btn-primary', 'btn-outline');
  button.classList.add(on ? 'btn-primary' : 'btn-outline');
  button.setAttribute('aria-pressed', String(on));
}
