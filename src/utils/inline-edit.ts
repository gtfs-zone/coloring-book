/**
 * Click-to-edit primitives.
 *
 * The timetable established the editing contract this app uses everywhere: a
 * display span carrying `data-*` attributes is swapped for a live input on
 * click, blur commits, Enter blurs, Escape cancels, and at most one editor is
 * live at a time. Editors in a grid additionally opt into `onNavigate`, which
 * commits and hands the caller the direction the user asked to move in.
 * These helpers are that contract, extracted so the timetable
 * and the spec-driven tables share one implementation instead of two copies
 * that drift.
 *
 * They deliberately know nothing about GTFS, patches, or the database: the
 * caller decides what a committed value means. A date editor's value is
 * `YYYY-MM-DD`, which is a format, not GTFS semantics.
 */

import { escapeHtml } from 'interlocking/util/escape-html';
import { attachCalendarInput, ISO_DATE_CODEC } from './calendar-input';
import { CONFIG } from '../config';
import {
  keyToGridDirection,
  isVerticalArrow,
  type GridDirection,
} from './grid-navigation';

/** Marks the single live editor. Any second editor is refused while it exists. */
export const LIVE_EDITOR_CLASS = 'editor-input-live';

/**
 * The live editor's input, for callers that need to read what the user has
 * typed so far. Held here rather than found by query because a redraw can
 * detach it from the document before anyone gets to look.
 */
let liveInput: HTMLInputElement | null = null;

/**
 * Whether the live editor has been typed into since it opened. Distinguishes
 * an edit in progress from an editor that was merely navigated to (Enter/Tab
 * moved focus onto it but the user has not typed a key yet), so a caller
 * deciding whether to carry the input's current text across a re-render does
 * not mistake the latter for the former.
 */
let liveInputDirty = false;

/** Makes each editor's `<datalist>` id unique for as long as it is in the DOM. */
let suggestionListSeq = 0;

/**
 * Input types an inline editor can take. Matches the `inputType` hints in
 * `GTFS_FIELD_TYPE_METADATA`, so a field's editor can be the browser's native
 * date or color picker where the spec type calls for one.
 */
export type InlineEditorInputType =
  | 'text'
  | 'number'
  | 'email'
  | 'url'
  | 'tel'
  | 'color'
  | 'date'
  | 'time';

/**
 * A native color input has no empty state: a blank value shows as black. An
 * editor for an empty color field opens on that same black, so closing it
 * without picking commits nothing rather than writing 000000.
 */
export const COLOR_EMPTY = '#000000';

export interface InlineEditorOptions {
  /**
   * The stored value. Doubles as the baseline a commit is compared against, so
   * an untouched editor commits nothing.
   */
  value: string;
  /**
   * Text to put in the box, when it differs from the stored value - an edit
   * that was in progress when a re-render tore the input out. The commit is
   * still measured against `value`, so restoring mid-edit text does not make
   * the editor think nothing changed.
   */
  initialValue?: string;
  /** Native input type. Defaults to a text input. */
  inputType?: InlineEditorInputType;
  /** DaisyUI size class for the input. Defaults to the compact `input-xs`. */
  sizeClass?: string;
  /** Extra classes on the input, on top of the shared editor classes. */
  className?: string;
  placeholder?: string;
  pattern?: string;
  title?: string;
  /**
   * Existing values offered as autocomplete, for free-text ID fields where the
   * user usually means one of the ids already in the feed but must stay free to
   * type a new one.
   */
  suggestions?: string[];
  /**
   * Called after the span has been restored, and only when the value changed.
   * Never called on Escape.
   */
  onCommit: (value: string) => void;
  /**
   * Called after the editor has committed and closed, when the user asked to
   * move to another cell. Runs after `onCommit`, and unlike it, runs whether or
   * not the value changed - navigation must not stop on an untouched cell.
   */
  onNavigate?: (direction: GridDirection) => void;
  /**
   * Let ArrowUp and ArrowDown move between cells. Off by default: only editors
   * that sit in a grid should steal the vertical arrows.
   */
  arrowNavigation?: boolean;
  /** Caret position to open with. Defaults to selecting the whole value. */
  selectionStart?: number | null;
}

/**
 * What the user has typed into the live editor so far, or null if none is open.
 *
 * Used to carry an in-progress edit across a full re-render, which would
 * otherwise wipe the input mid-keystroke.
 */
export function getLiveEditorState(): {
  value: string;
  selectionStart: number | null;
  dirty: boolean;
} | null {
  if (!liveInput) {
    return null;
  }
  let selectionStart: number | null = null;
  try {
    selectionStart = liveInput.selectionStart;
  } catch {
    // Input type does not expose a caret.
  }
  return { value: liveInput.value, selectionStart, dirty: liveInputDirty };
}

/**
 * Whether an inline editor is currently open.
 *
 * Reads the module reference rather than the DOM: a re-render can detach the
 * input while the editor is still logically live.
 */
export function hasLiveEditor(): boolean {
  return liveInput !== null;
}

/**
 * Swap a display span for a live input until it is committed or cancelled.
 *
 * The span is restored synchronously before `onCommit` runs, so the caller is
 * free to start an async write without leaving a detached input in the DOM.
 */
export function openInlineEditor(
  span: HTMLElement,
  options: InlineEditorOptions
): void {
  if (document.querySelector(`.${LIVE_EDITOR_CLASS}`)) {
    return;
  }

  const input = document.createElement('input');
  // A date is a text box with our own month grid behind it rather than a
  // native `type="date"`, so it looks like the rest of the app and the week
  // start is ours to pick. See `calendar-input.ts`.
  const isDate = options.inputType === 'date';
  input.type = isDate ? 'text' : (options.inputType ?? 'text');
  input.className =
    `${LIVE_EDITOR_CLASS} input ${options.sizeClass ?? 'input-xs'} ${options.className ?? 'w-full'}`.trim();
  input.value = options.initialValue ?? options.value;
  if (options.placeholder !== undefined) {
    input.placeholder = options.placeholder;
  }
  if (options.pattern !== undefined) {
    input.pattern = options.pattern;
  }
  if (options.title !== undefined) {
    input.title = options.title;
  }

  let datalist: HTMLDataListElement | null = null;
  if (options.suggestions && options.suggestions.length > 0) {
    datalist = document.createElement('datalist');
    datalist.id = `inline-edit-suggestions-${++suggestionListSeq}`;
    datalist.innerHTML = options.suggestions
      .map((value) => `<option value="${escapeHtml(value)}"></option>`)
      .join('');
    document.body.appendChild(datalist);
    input.setAttribute('list', datalist.id);
  }

  span.replaceWith(input);
  liveInput = input;
  liveInputDirty = false;
  input.addEventListener('input', () => {
    liveInputDirty = true;
  });
  input.focus();
  if (options.selectionStart !== undefined && options.selectionStart !== null) {
    try {
      input.setSelectionRange(options.selectionStart, options.selectionStart);
    } catch {
      input.select();
    }
  } else {
    input.select();
  }

  // Clicking anywhere in a date box opens the grid. The box stays typeable,
  // which is the keyboard path: the grid takes focus from nobody, so it cannot
  // trip the blur commit below.
  let closeCalendar: (() => void) | null = null;
  if (isDate) {
    closeCalendar = attachCalendarInput(input, {
      codec: ISO_DATE_CODEC,
      weekStart: CONFIG.WEEK_START,
      allowEmpty: true,
      onPick: () => {
        liveInputDirty = true;
        input.blur();
      },
    });
  }

  let settled = false;
  const restore = (): void => {
    input.replaceWith(span);
    datalist?.remove();
    closeCalendar?.();
    if (liveInput === input) {
      liveInput = null;
    }
  };
  const commit = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    const newValue = input.value;
    restore();
    if (newValue !== options.value) {
      options.onCommit(newValue);
    }
  };
  const cancel = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    restore();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Cancel the edit and stop there: inside a modal (the timetable) the
      // same key closes the modal, and Escape belongs to the innermost thing
      // it can dismiss.
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }

    // Grid movement, for editors that opted in. Commit first: that restores the
    // span and clears the single-live-editor guard, so the destination cell can
    // open. Chaining this off onCommit instead would stall on an unchanged cell,
    // since onCommit only fires when the value actually changed.
    const direction = keyToGridDirection(e);
    if (
      direction &&
      options.onNavigate &&
      (options.arrowNavigation || !isVerticalArrow(e))
    ) {
      e.preventDefault();
      commit();
      options.onNavigate(direction);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });
}

export interface InlineMenuOption {
  value: string;
  label: string;
}

export interface InlineMenuOptions {
  options: InlineMenuOption[];
  currentValue: string;
  /** Called only when the picked value differs from `currentValue`. */
  onPick: (value: string, label: string) => void;
}

/** Class on the floating menu, so a second open can clear the first. */
const MENU_CLASS = 'inline-enum-menu';

/**
 * Open a small menu of fixed options anchored under a span.
 *
 * Small enums get this rather than the searchable modal: it is one click
 * instead of three, and the whole option set is visible at once.
 */
export function openInlineMenu(
  span: HTMLElement,
  options: InlineMenuOptions
): void {
  document.querySelectorAll(`.${MENU_CLASS}`).forEach((el) => el.remove());

  const rect = span.getBoundingClientRect();
  const menu = document.createElement('div');
  // Above the modal layer: the menu is a body child, so a z-index below a
  // modal's would hide it behind the modal that opened the cell.
  menu.className = `${MENU_CLASS} fixed z-[2000] -translate-x-1/2 bg-base-100 border border-base-300 rounded-lg shadow-lg py-1 min-w-40 max-h-72 overflow-y-auto`;
  menu.style.top = `${rect.bottom + window.scrollY + 2}px`;
  menu.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
  menu.innerHTML = options.options
    .map((row) => {
      const activeClass =
        row.value === options.currentValue ? ' bg-base-200 font-medium' : '';
      return `<div class="px-3 py-1.5 text-sm text-center cursor-pointer hover:bg-base-200${activeClass}" data-value="${escapeHtml(row.value)}">${escapeHtml(row.label)}</div>`;
    })
    .join('');
  document.body.appendChild(menu);

  const close = (): void => {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
  };
  const onOutside = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) {
      close();
    }
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Closes the menu only: see the editor's handler above.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  menu.addEventListener('click', (e) => {
    const row = (e.target as Element).closest(
      '[data-value]'
    ) as HTMLElement | null;
    if (!row) {
      return;
    }
    const newValue = row.dataset.value ?? '';
    close();
    if (newValue !== options.currentValue) {
      const picked = options.options.find((r) => r.value === newValue);
      options.onPick(newValue, picked?.label ?? newValue);
    }
  });

  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKeydown, true);
}
