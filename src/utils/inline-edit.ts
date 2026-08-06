/**
 * Click-to-edit primitives.
 *
 * The timetable established the editing contract this app uses everywhere: a
 * display span carrying `data-*` attributes is swapped for a live input on
 * click, blur commits, Enter blurs, Escape cancels, and at most one editor is
 * live at a time. These helpers are that contract, extracted so the timetable
 * and the spec-driven tables share one implementation instead of two copies
 * that drift.
 *
 * They deliberately know nothing about GTFS, patches, or the database: the
 * caller decides what a committed value means.
 */

import { escapeHtml } from './escape-html.js';

/** Marks the single live editor. Any second editor is refused while it exists. */
export const LIVE_EDITOR_CLASS = 'editor-input-live';

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

export interface InlineEditorOptions {
  /** Value the input opens with. */
  value: string;
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
   * Called after the span has been restored, and only when the value changed.
   * Never called on Escape.
   */
  onCommit: (value: string) => void;
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
  input.type = options.inputType ?? 'text';
  input.className =
    `${LIVE_EDITOR_CLASS} input ${options.sizeClass ?? 'input-xs'} ${options.className ?? 'w-full'}`.trim();
  input.value = options.value;
  if (options.placeholder !== undefined) {
    input.placeholder = options.placeholder;
  }
  if (options.pattern !== undefined) {
    input.pattern = options.pattern;
  }
  if (options.title !== undefined) {
    input.title = options.title;
  }

  span.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const commit = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    const newValue = input.value;
    input.replaceWith(span);
    if (newValue !== options.value) {
      options.onCommit(newValue);
    }
  };
  const cancel = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    input.replaceWith(span);
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
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
  menu.className = `${MENU_CLASS} fixed z-50 -translate-x-1/2 bg-base-100 border border-base-300 rounded-lg shadow-lg py-1 min-w-40 max-h-72 overflow-y-auto`;
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
      e.preventDefault();
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
