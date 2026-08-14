import uFuzzy from '@leeoniya/ufuzzy';
import { showModal } from './modal-utils';

export interface OptionPickerItem {
  value: string;
  primary: string;
  secondary?: string;
}

export interface OptionPickerOptions {
  title: string;
  options: OptionPickerItem[];
  selectedValue?: string;
  searchable?: boolean;
  placeholder?: string;
}

export interface MultiOptionPickerOptions {
  title: string;
  options: OptionPickerItem[];
  selectedValues?: string[];
  searchable?: boolean;
  placeholder?: string;
  /**
   * A row pinned above the list standing for "none of these", selected exactly
   * when nothing else is. Choosing it clears the selection, and choosing
   * anything else drops it, so the two can never both be on.
   */
  emptyOption?: { label: string; hint?: string };
}

const uf = new uFuzzy({ intraIns: 1 });

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debounce(fn: () => void, ms: number): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    fn();
  }, ms);
}

/** How many matches the list shows before it asks for a narrower search. */
const MAX_SHOWN = 50;

interface PickerMode {
  /** Values checked when the modal opens. Empty in single-select mode. */
  selected: Set<string>;
  /** Value highlighted when the modal opens, in single-select mode. */
  selectedValue?: string;
  /** Picking an option resolves the modal, rather than toggling it. */
  closeOnPick: boolean;
  onPick: (value: string, close: () => void) => void;
}

/**
 * The shared body of both pickers: a search box over a scrolling result list,
 * with arrow-key navigation and Enter acting on the active row.
 */
function pickerBody(
  searchable: boolean,
  placeholder: string,
  emptyOption?: { label: string; hint?: string }
): string {
  return `
    <div class="flex flex-col gap-3">
      ${
        searchable
          ? `<input
              id="option-picker-search"
              type="search"
              class="input input-bordered w-full"
              placeholder="${escapeHtml(placeholder)}"
              autocomplete="off"
            />`
          : ''
      }
      ${
        emptyOption
          ? `<button
              type="button"
              id="option-picker-empty"
              class="flex w-full cursor-pointer items-center gap-2 rounded border px-3 py-2 text-left text-sm hover:bg-base-200"
            >
              <span class="min-w-0 flex-1 truncate">${escapeHtml(emptyOption.label)}</span>
              ${emptyOption.hint ? `<span class="shrink-0 text-xs opacity-60">${escapeHtml(emptyOption.hint)}</span>` : ''}
            </button>`
          : ''
      }
      <div
        id="option-picker-results"
        class="overflow-y-auto max-h-96 border border-base-200 rounded"
        tabindex="0"
      ></div>
    </div>
  `;
}

function mountPicker(
  options: OptionPickerItem[],
  searchable: boolean,
  mode: PickerMode,
  close: () => void
): void {
  const resultsEl = document.getElementById(
    'option-picker-results'
  ) as HTMLElement;
  const searchInput = searchable
    ? (document.getElementById('option-picker-search') as HTMLInputElement)
    : null;
  const emptyEl = document.getElementById('option-picker-empty');

  // The "none of these" row is not a checkbox: it is on exactly when nothing
  // else is, so selecting an option turns it off and it needs no state of its
  // own.
  const syncEmpty = () => {
    if (!emptyEl) {
      return;
    }
    const active = mode.selected.size === 0;
    emptyEl.classList.toggle('border-primary', active);
    emptyEl.classList.toggle('bg-primary/10', active);
    emptyEl.classList.toggle('border-base-200', !active);
    emptyEl.classList.toggle('opacity-60', !active);
  };

  // Selected options lead the list, so a long option set opens on what is
  // already chosen. Fixed at open time: re-sorting as the user types would move
  // rows out from under the pointer.
  const ordered =
    mode.selected.size > 0
      ? [
          ...options.filter((o) => mode.selected.has(o.value)),
          ...options.filter((o) => !mode.selected.has(o.value)),
        ]
      : options;

  let shown: OptionPickerItem[] = [];
  let activeIndex = 0;

  const setActive = (index: number) => {
    activeIndex = index;
    const rows = resultsEl.children;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('bg-base-200', i === index);
    }
    rows[index]?.scrollIntoView({ block: 'nearest' });
  };

  const render = (query: string) => {
    const q = query.trim();
    let filtered: OptionPickerItem[];
    if (!q) {
      filtered = ordered;
    } else {
      const haystack = ordered.map((o) => `${o.primary} ${o.secondary ?? ''}`);
      const [idxs] = uf.search(haystack, q);
      filtered = idxs && idxs.length > 0 ? idxs.map((i) => ordered[i]) : [];
    }

    shown = filtered.slice(0, MAX_SHOWN);

    if (shown.length === 0) {
      resultsEl.innerHTML = `<div class="text-base-content/60 text-sm p-4 text-center">No options found</div>`;
      return;
    }

    resultsEl.innerHTML = '';
    shown.forEach((item, i) => {
      const row = document.createElement('div');
      row.className =
        'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 border-b border-base-200 last:border-0';
      const check = mode.closeOnPick
        ? ''
        : `<input type="checkbox" class="checkbox checkbox-xs shrink-0 pointer-events-none" ${mode.selected.has(item.value) ? 'checked' : ''} />`;
      row.innerHTML = `
        ${check}
        <span class="min-w-0 flex-1 truncate text-sm">${escapeHtml(item.primary)}</span>
        ${item.secondary ? `<span class="shrink-0 text-xs opacity-60">${escapeHtml(item.secondary)}</span>` : ''}
      `;
      row.addEventListener('mouseenter', () => setActive(i));
      row.addEventListener('click', () => {
        mode.onPick(item.value, close);
        if (!mode.closeOnPick) {
          const box = row.querySelector('input');
          if (box instanceof HTMLInputElement) {
            box.checked = mode.selected.has(item.value);
          }
          syncEmpty();
        }
      });
      resultsEl.appendChild(row);
    });

    if (filtered.length > MAX_SHOWN) {
      const note = document.createElement('div');
      note.className = 'text-xs text-base-content/50 text-center p-2';
      note.textContent = `Showing ${MAX_SHOWN} of ${filtered.length} results. Refine your search`;
      resultsEl.appendChild(note);
    }

    const preselected = shown.findIndex((o) => o.value === mode.selectedValue);
    setActive(preselected >= 0 ? preselected : 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = shown[activeIndex];
      if (item) {
        mode.onPick(item.value, close);
        if (!mode.closeOnPick) {
          const box = resultsEl.children[activeIndex]?.querySelector('input');
          if (box instanceof HTMLInputElement) {
            box.checked = mode.selected.has(item.value);
          }
          syncEmpty();
        }
      }
    } else if (e.key === 'ArrowDown' && shown.length > 0) {
      e.preventDefault();
      setActive((activeIndex + 1) % shown.length);
    } else if (e.key === 'ArrowUp' && shown.length > 0) {
      e.preventDefault();
      setActive((activeIndex - 1 + shown.length) % shown.length);
    }
  };

  render('');
  syncEmpty();

  emptyEl?.addEventListener('click', () => {
    mode.selected.clear();
    render(searchInput?.value ?? '');
    syncEmpty();
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      debounce(() => render(searchInput.value), 200);
    });
    searchInput.addEventListener('keydown', onKeyDown);
    searchInput.focus();
  } else {
    resultsEl.addEventListener('keydown', onKeyDown);
    resultsEl.focus();
  }
}

/**
 * A searchable option-picker modal, styled like the search bar dropdown.
 * Resolves with the chosen option's `value`, or `null` if cancelled.
 */
export async function showOptionPickerModal(
  opts: OptionPickerOptions
): Promise<string | null> {
  let selected: string | null = null;
  const searchable = opts.searchable !== false;

  await showModal({
    title: opts.title,
    body: pickerBody(searchable, opts.placeholder ?? 'Search…'),
    actions: [{ label: 'Cancel', onClick: () => {} }],
    escapeAction: 0,
    onMount: (close) => {
      mountPicker(
        opts.options,
        searchable,
        {
          selected: new Set(),
          selectedValue: opts.selectedValue,
          closeOnPick: true,
          onPick: (value, closePicker) => {
            selected = value;
            closePicker();
          },
        },
        close
      );
    },
  });

  return selected;
}

/**
 * The same picker with checkboxes: clicking a row toggles it and the modal
 * stays open until Done. Resolves with the selected values, or `null` if
 * cancelled.
 */
export async function showMultiOptionPickerModal(
  opts: MultiOptionPickerOptions
): Promise<string[] | null> {
  const searchable = opts.searchable !== false;
  const selected = new Set(opts.selectedValues ?? []);
  let confirmed = false;

  await showModal({
    title: opts.title,
    body: pickerBody(
      searchable,
      opts.placeholder ?? 'Search…',
      opts.emptyOption
    ),
    actions: [
      {
        label: 'Done',
        className: 'btn-primary',
        onClick: () => {
          confirmed = true;
        },
      },
      { label: 'Cancel', className: 'btn-ghost', onClick: () => {} },
    ],
    escapeAction: 1,
    onMount: (close) => {
      mountPicker(
        opts.options,
        searchable,
        {
          selected,
          closeOnPick: false,
          onPick: (value) => {
            if (selected.has(value)) {
              selected.delete(value);
            } else {
              selected.add(value);
            }
          },
        },
        close
      );
    },
  });

  return confirmed ? [...selected] : null;
}
