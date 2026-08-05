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
    body: `
      <div class="flex flex-col gap-3">
        ${
          searchable
            ? `<input
                id="option-picker-search"
                type="search"
                class="input input-bordered w-full"
                placeholder="${escapeHtml(opts.placeholder ?? 'Search…')}"
                autocomplete="off"
              />`
            : ''
        }
        <div
          id="option-picker-results"
          class="overflow-y-auto max-h-96 border border-base-200 rounded"
          tabindex="0"
        ></div>
      </div>
    `,
    actions: [{ label: 'Cancel', onClick: () => {} }],
    escapeAction: 0,
    onMount: (close) => {
      const resultsEl = document.getElementById(
        'option-picker-results'
      ) as HTMLElement;
      const searchInput = searchable
        ? (document.getElementById('option-picker-search') as HTMLInputElement)
        : null;

      let shown: OptionPickerItem[] = [];
      let activeIndex = 0;

      const onSelect = (value: string) => {
        selected = value;
        close();
      };

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
          filtered = opts.options;
        } else {
          const haystack = opts.options.map(
            (o) => `${o.primary} ${o.secondary ?? ''}`
          );
          const [idxs] = uf.search(haystack, q);
          filtered =
            idxs && idxs.length > 0 ? idxs.map((i) => opts.options[i]) : [];
        }

        shown = filtered.slice(0, 50);

        if (shown.length === 0) {
          resultsEl.innerHTML = `<div class="text-base-content/60 text-sm p-4 text-center">No options found</div>`;
          return;
        }

        resultsEl.innerHTML = '';
        shown.forEach((item, i) => {
          const row = document.createElement('div');
          row.className =
            'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 border-b border-base-200 last:border-0';
          row.innerHTML = `
            <span class="min-w-0 flex-1 truncate text-sm">${escapeHtml(item.primary)}</span>
            ${item.secondary ? `<span class="shrink-0 text-xs opacity-60">${escapeHtml(item.secondary)}</span>` : ''}
          `;
          row.addEventListener('mouseenter', () => setActive(i));
          row.addEventListener('click', () => onSelect(item.value));
          resultsEl.appendChild(row);
        });

        if (filtered.length > 50) {
          const note = document.createElement('div');
          note.className = 'text-xs text-base-content/50 text-center p-2';
          note.textContent = `Showing 50 of ${filtered.length} results. Refine your search`;
          resultsEl.appendChild(note);
        }

        const preselected = shown.findIndex(
          (o) => o.value === opts.selectedValue
        );
        setActive(preselected >= 0 ? preselected : 0);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const item = shown[activeIndex];
          if (item) {
            onSelect(item.value);
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
    },
  });

  return selected;
}
