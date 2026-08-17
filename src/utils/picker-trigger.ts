/**
 * Picker Trigger
 *
 * One shape for "clicking this opens a picker modal".
 *
 * The app has three click-to-edit affordances that look alike but behave
 * differently: a span that swaps for an inline input, a span that drops a small
 * inline menu, and a span that opens a searchable modal. Only the third takes
 * the screen over, and nothing in the markup used to say which one a cell was.
 * Every `showOptionPickerModal` / `showMultiOptionPickerModal` trigger renders
 * through here, so the trailing chevron is the cue.
 *
 * A control that opens a picker but shows no value - an `+ Add area...` button,
 * the timetable's `Add stop or zone...` row - keeps its button shape and marks
 * itself with a trailing ellipsis instead: a chevron on a button that has no
 * value beside it reads as a dropdown of actions, which it is not.
 */

import { renderChevronIcon } from '../modules/modal-utils.js';

/** Marks a span whose click opens a picker modal. */
export const PICKER_TRIGGER_CLASS = 'picker-trigger';

/**
 * The value node inside a trigger. Updating a trigger after a pick writes here,
 * so the chevron survives (see `setPickerTriggerContent`).
 */
export const PICKER_TRIGGER_VALUE_CLASS = 'picker-trigger-value';

export interface PickerTriggerOptions {
  /**
   * The value, as HTML. Callers escape their own text: several render markup
   * here (a muted placeholder, a revisit badge).
   */
  content: string;
  /**
   * `'inline'` brings the shared appearance of a grid trigger: padding, hover
   * and the focus ring `.time-span` uses. `'bare'` is layout and chevron only,
   * for a caller that already carries its own box - a bordered field, or a
   * `.time-span` whose classes are computed per value state. Merging Tailwind
   * utilities from both would leave the winner to stylesheet order.
   */
  variant?: 'inline' | 'bare';
  /** Classes merged after the variant's: the caller's own marker and layout. */
  className?: string;
  /** Pre-built attribute string: the caller's `data-*`, role, tabindex, title. */
  attrs?: string;
}

/** Layout every trigger shares, whatever box it sits in. */
const LAYOUT = 'inline-flex items-center gap-1 min-w-0 max-w-full';

/** The appearance of a trigger that brings no box of its own. */
const INLINE_APPEARANCE =
  'cursor-pointer rounded px-1 hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary';

/**
 * A value plus a trailing chevron, as one `<span>`.
 *
 * The value truncates and the chevron does not, so a long id clips instead of
 * pushing the cue out of the cell.
 */
export function renderPickerTrigger(opts: PickerTriggerOptions): string {
  const classes = [
    PICKER_TRIGGER_CLASS,
    LAYOUT,
    opts.variant === 'bare' ? '' : INLINE_APPEARANCE,
    opts.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<span class="${classes}" ${opts.attrs ?? ''}
    ><span class="${PICKER_TRIGGER_VALUE_CLASS} min-w-0 flex-1 truncate text-left">${opts.content}</span
    ><span class="shrink-0 opacity-50" aria-hidden="true">${renderChevronIcon('h-3 w-3')}</span
  ></span>`;
}

/**
 * Show a newly picked value without waiting for a re-render.
 *
 * Writes into the value node when the span is a trigger, so the chevron is not
 * wiped; falls back to the span itself for the spans that are not.
 */
export function setPickerTriggerContent(span: HTMLElement, html: string): void {
  const value = span.querySelector(`.${PICKER_TRIGGER_VALUE_CLASS}`);
  (value ?? span).innerHTML = html;
}
