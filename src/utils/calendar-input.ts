/**
 * A calendar input: a text box whose companion month grid is ours rather than
 * the browser's.
 *
 * The native `<input type="date">` is a calendar input, but it is one we cannot
 * say anything about. It insists on `YYYY-MM-DD` while GTFS stores `YYYYMMDD`
 * and a realtime alert window is a timestamp, so every caller wraps it in a
 * conversion at the boundary; it picks the week's first day from the browser's
 * locale, which is not a question an app should be unable to answer; and it
 * looks like the host OS rather than like the rest of the app. This module is
 * the same affordance with those three things handed in.
 *
 * What it does not do is hold the value. The anchor `<input>` holds and shows
 * the stored string verbatim, so it stays typeable and whatever already reads
 * `input.value` keeps working. The grid is an additional way to fill it in, not
 * a replacement for the box. That also means no display/storage split: a format
 * a person cannot read in the box is a sign the codec is wrong for the field,
 * not a reason for this module to grow a third format.
 *
 * It takes focus from nobody. Every mousedown inside the popover is prevented,
 * so an anchor that commits on blur - the inline editor does - does not commit
 * out from under a click on a day. The keyboard path is the input itself, which
 * is why the box stays typeable rather than going readonly.
 *
 * No imports, by design: this file is vendored into the other gtfs.zone apps
 * and every string it renders is a number or a constant, so it needs no
 * escaping helper to be safe.
 */

/**
 * How this app's stored date strings become days, and back.
 *
 * Both sides work in `Date`s pinned to UTC midnight: a calendar day is not an
 * instant, and reading a date-only value with local getters is how a day goes
 * missing west of Greenwich.
 */
export interface DateCodec {
  /** The stored string as a UTC-midnight Date, or null when it is not a date. */
  parse: (value: string) => Date | null;
  /** A UTC-midnight Date as the stored string. */
  format: (date: Date) => string;
}

/** `YYYY-MM-DD`, which is what a native date input speaks. */
export const ISO_DATE_CODEC: DateCodec = {
  parse: (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
    if (!match) {
      return null;
    }
    return utcDay(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  },
  format: (date) =>
    `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(
      date.getUTCMonth() + 1
    ).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
};

export interface CalendarOptions {
  /** The currently stored value. Opens on its month; empty opens on today. */
  value: string;
  /** How to read and write that value. Required: there is no default format. */
  codec: DateCodec;
  /**
   * Which day the week starts on, 0 for Sunday through 6 for Saturday.
   *
   * Required for the same reason as `codec`. The three apps disagree and one of
   * them has not settled it yet, so this module refuses to hold an opinion.
   */
  weekStart: number;
  /** Days before this one, and after `max`, cannot be picked. */
  min?: string;
  max?: string;
  /** Offer a Clear button, for a field that is allowed to be empty. */
  allowEmpty?: boolean;
  /** A day was picked. Given the stored string, or '' from Clear. */
  onPick: (value: string) => void;
  /** The popover went away, for any reason, including a pick. */
  onClose?: () => void;
}

/** Class on the popover, for anyone styling or querying it. */
const POPOVER_CLASS = 'calendar-input-popover';

/**
 * The open popover's closer. Held here rather than found by class, so a second
 * open tears the first one's document listeners down with its DOM.
 */
let activeClose: (() => void) | null = null;

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

const WEEKDAY_INITIALS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Always six rows, so the popover does not resize as the months change. */
const GRID_CELLS = 42;

function utcDay(year: number, month0: number, day: number): Date {
  return new Date(Date.UTC(year, month0, day));
}

/** Today as a UTC-midnight Date, read off the user's wall clock. */
function todayUtc(): Date {
  const now = new Date();
  return utcDay(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** The day the grid's first cell shows, given the month and the week start. */
function gridStart(year: number, month0: number, weekStart: number): Date {
  const first = utcDay(year, month0, 1);
  const offset = (first.getUTCDay() - weekStart + 7) % 7;
  return addDays(first, -offset);
}

function renderPopover(
  year: number,
  month0: number,
  selected: Date | null,
  min: Date | null,
  max: Date | null,
  options: CalendarOptions
): string {
  const today = todayUtc();
  const start = gridStart(year, month0, options.weekStart);

  const headers = Array.from({ length: 7 }, (_, i) => {
    const label = WEEKDAY_INITIALS[(options.weekStart + i) % 7];
    return `<div class="text-center text-[0.65rem] font-semibold text-base-content/50 pb-1">${label}</div>`;
  }).join('');

  const cells: string[] = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    const day = addDays(start, i);
    const time = day.getTime();
    const outside = day.getUTCMonth() !== month0;
    const disabled =
      (min !== null && time < min.getTime()) ||
      (max !== null && time > max.getTime());

    const classes = ['btn', 'btn-xs', 'btn-ghost', 'w-full', 'px-0'];
    if (selected && time === selected.getTime()) {
      classes.push('btn-primary');
    } else if (time === today.getTime()) {
      classes.push('ring-1', 'ring-primary');
    }
    if (outside) {
      classes.push('opacity-40');
    }

    cells.push(
      `<button type="button" class="${classes.join(' ')}" data-day="${i}"${
        disabled ? ' disabled' : ''
      }>${day.getUTCDate()}</button>`
    );
  }

  const clearButton = options.allowEmpty
    ? '<button type="button" class="btn btn-xs btn-ghost" data-nav="clear">Clear</button>'
    : '';

  return `
    <div class="flex items-center justify-between gap-1 mb-1">
      <button type="button" class="btn btn-xs btn-ghost" data-nav="prev" aria-label="Previous month">&#8249;</button>
      <span class="text-sm font-semibold">${MONTH_NAMES[month0]} ${year}</span>
      <button type="button" class="btn btn-xs btn-ghost" data-nav="next" aria-label="Next month">&#8250;</button>
    </div>
    <div class="grid grid-cols-7 gap-0.5">
      ${headers}
      ${cells.join('')}
    </div>
    <div class="flex items-center justify-between pt-1">
      <button type="button" class="btn btn-xs btn-ghost text-primary" data-nav="today">Today</button>
      ${clearButton}
    </div>
  `;
}

/**
 * Open the month grid anchored to an element, and return a function that closes
 * it. Any popover already open is closed first.
 */
export function openCalendar(
  anchor: HTMLElement,
  options: CalendarOptions
): () => void {
  activeClose?.();

  const selected = options.codec.parse(options.value);
  const min = options.min ? options.codec.parse(options.min) : null;
  const max = options.max ? options.codec.parse(options.max) : null;
  const opensOn = selected ?? todayUtc();
  let year = opensOn.getUTCFullYear();
  let month0 = opensOn.getUTCMonth();

  const popover = document.createElement('div');
  // Above the modal layer: this is a body child, so a z-index below a modal's
  // would hide it behind the modal whose form opened it.
  popover.className = `${POPOVER_CLASS} fixed z-[2000] w-64 p-2 bg-base-100 border border-base-300 rounded-lg shadow-lg`;

  const draw = (): void => {
    popover.innerHTML = renderPopover(
      year,
      month0,
      selected,
      min,
      max,
      options
    );
  };
  draw();
  document.body.appendChild(popover);

  // Below the anchor, or above it when there is no room. Viewport coordinates,
  // since the popover is positioned `fixed`.
  const anchorRect = anchor.getBoundingClientRect();
  const height = popover.getBoundingClientRect().height;
  const below = anchorRect.bottom + 2;
  popover.style.top = `${
    below + height > window.innerHeight && anchorRect.top - height - 2 > 0
      ? anchorRect.top - height - 2
      : below
  }px`;
  popover.style.left = `${Math.max(
    4,
    Math.min(anchorRect.left, window.innerWidth - popover.offsetWidth - 4)
  )}px`;

  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    if (activeClose === close) {
      activeClose = null;
    }
    popover.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('scroll', close, true);
    options.onClose?.();
  };

  const onOutside = (e: MouseEvent): void => {
    const target = e.target as Node;
    if (!popover.contains(target) && !anchor.contains(target)) {
      close();
    }
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Closes the popover only. Escape belongs to the innermost thing it can
      // dismiss, and inside a modal the same key closes the modal.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  // Keeps the anchor focused, so a click on a day is not swallowed by the
  // anchor's blur handler committing the edit first.
  popover.addEventListener('mousedown', (e) => e.preventDefault());

  popover.addEventListener('click', (e) => {
    const button = (e.target as Element).closest(
      'button'
    ) as HTMLButtonElement | null;
    if (!button || button.disabled) {
      return;
    }

    const nav = button.dataset.nav;
    if (nav === 'prev' || nav === 'next') {
      month0 += nav === 'prev' ? -1 : 1;
      if (month0 < 0) {
        month0 = 11;
        year--;
      } else if (month0 > 11) {
        month0 = 0;
        year++;
      }
      draw();
      return;
    }
    if (nav === 'today') {
      const today = todayUtc();
      year = today.getUTCFullYear();
      month0 = today.getUTCMonth();
      close();
      options.onPick(options.codec.format(today));
      return;
    }
    if (nav === 'clear') {
      close();
      options.onPick('');
      return;
    }

    const index = Number(button.dataset.day);
    if (Number.isNaN(index)) {
      return;
    }
    const day = addDays(gridStart(year, month0, options.weekStart), index);
    close();
    options.onPick(options.codec.format(day));
  });

  activeClose = close;
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKeydown, true);
  // A scrolling ancestor would leave the popover behind, anchored to nothing.
  // A frame late, because focusing the anchor can scroll it into view and that
  // scroll must not close the popover the same focus just opened.
  requestAnimationFrame(() => {
    if (!closed) {
      document.addEventListener('scroll', close, true);
    }
  });

  return close;
}

export interface CalendarInputOptions extends Omit<
  CalendarOptions,
  'value' | 'onPick'
> {
  /** Runs after a pick has been written to the input. */
  onPick?: (value: string) => void;
}

/**
 * Wire an `<input>` so that clicking it opens the grid and a pick writes the
 * stored string into it.
 *
 * The input keeps whatever type and classes it already has. Returns a function
 * that closes the popover, for an owner that tears the input out itself.
 */
export function attachCalendarInput(
  input: HTMLInputElement,
  options: CalendarInputOptions
): () => void {
  let close: (() => void) | null = null;

  const open = (): void => {
    if (close) {
      return;
    }
    close = openCalendar(input, {
      ...options,
      value: input.value,
      onPick: (value) => {
        input.value = value;
        options.onPick?.(value);
      },
      onClose: () => {
        close = null;
        options.onClose?.();
      },
    });
  };

  input.addEventListener('focus', open);
  input.addEventListener('click', open);

  return () => close?.();
}
