import uFuzzy from '@leeoniya/ufuzzy';
import { showModal } from './modal-utils';

interface AtlasFeed {
  id: string;
  name: string;
  operator_name: string;
  location: string;
  url: string;
}

const uf = new uFuzzy({ intraIns: 1 });

let cachedFeeds: AtlasFeed[] | null = null;
let cachedHaystack: string[] | null = null;

async function loadAtlasFeeds(): Promise<AtlasFeed[]> {
  if (cachedFeeds !== null) {
    return cachedFeeds;
  }
  const response = await fetch('/atlas-feeds.json');
  if (!response.ok) {
    throw new Error(`Failed to fetch atlas-feeds.json: ${response.status}`);
  }
  cachedFeeds = (await response.json()) as AtlasFeed[];
  cachedHaystack = cachedFeeds.map(
    (f) => `${f.name} ${f.operator_name} ${f.location} ${f.url}`
  );
  console.log(`[AtlasSearch] Loaded ${cachedFeeds.length} feeds from atlas`);
  return cachedFeeds;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debounce(fn: () => void, ms: number) {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    fn();
  }, ms);
}

function filterAndRender(
  query: string,
  feeds: AtlasFeed[],
  haystack: string[],
  resultsEl: HTMLElement,
  onSelect: (url: string) => void
) {
  const q = query.trim();
  let filtered: AtlasFeed[];
  if (!q) {
    filtered = feeds;
  } else {
    const [idxs] = uf.search(haystack, q);
    if (!idxs || idxs.length === 0) {
      filtered = [];
    } else {
      filtered = idxs.map((i) => feeds[i]);
    }
  }

  const shown = filtered.slice(0, 50);

  if (shown.length === 0) {
    resultsEl.innerHTML = `<div class="text-base-content/60 text-sm p-4 text-center">No feeds found</div>`;
    return;
  }

  resultsEl.innerHTML = '';
  for (const feed of shown) {
    const row = document.createElement('div');
    row.className =
      'p-3 hover:bg-base-200 cursor-pointer rounded border-b border-base-200 last:border-0';
    row.innerHTML = `
      <div class="font-medium text-sm">${escapeHtml(feed.name || feed.id)}</div>
      ${feed.operator_name ? `<div class="text-xs text-base-content/70">${escapeHtml(feed.operator_name)}</div>` : ''}
      ${feed.location ? `<div class="text-xs text-base-content/60">${escapeHtml(feed.location)}</div>` : ''}
      <div class="text-xs text-base-content/50 truncate mt-1">${escapeHtml(feed.url)}</div>
    `;
    row.addEventListener('click', () => onSelect(feed.url));
    resultsEl.appendChild(row);
  }

  if (filtered.length > 50) {
    const note = document.createElement('div');
    note.className = 'text-xs text-base-content/50 text-center p-2';
    note.textContent = `Showing 50 of ${filtered.length} results. Refine your search`;
    resultsEl.appendChild(note);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function showAtlasSearchModal(): Promise<{
  url: string;
  useCors: boolean;
} | null> {
  let selectedUrl: { url: string; useCors: boolean } | null = null;

  await showModal({
    title: 'From TransitLand Atlas',
    body: `
      <div class="flex flex-col gap-3">
        <input
          id="atlas-search-input"
          type="search"
          class="input input-bordered w-full"
          placeholder="Search by name, operator, location, or URL…"
          autocomplete="off"
        />
        <div
          id="atlas-results"
          class="overflow-y-auto max-h-96 border border-base-200 rounded"
        >
          <div class="text-base-content/60 text-sm p-4 text-center">Loading…</div>
        </div>
      </div>
    `,
    actionBarContent: `
      <input type="checkbox" id="cors-proxy-checkbox" class="checkbox checkbox-sm" checked />
      <span class="label-text text-sm">Use CORS proxy</span>
      <a
        href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS"
        target="_blank"
        rel="noopener noreferrer"
        class="tooltip tooltip-top btn btn-ghost btn-xs btn-circle"
        data-tip="For most feeds, this is required. Note that the proxy (running on my computer) will see your request. What is CORS and why does my request fail without this proxy? Click to learn more in a new tab."
      >?</a>
    `,
    actions: [{ label: 'Cancel', onClick: () => {} }],
    escapeAction: 0,
    onMount: (close) => {
      const resultsEl = document.getElementById('atlas-results') as HTMLElement;
      const searchInput = document.getElementById(
        'atlas-search-input'
      ) as HTMLInputElement;

      const onSelect = (url: string) => {
        const useCors = (
          document.getElementById('cors-proxy-checkbox') as HTMLInputElement
        ).checked;
        selectedUrl = { url, useCors };
        close();
      };

      loadAtlasFeeds()
        .then((feeds) => {
          const haystack = cachedHaystack!;
          filterAndRender('', feeds, haystack, resultsEl, onSelect);

          searchInput.addEventListener('input', () => {
            debounce(() => {
              filterAndRender(
                searchInput.value,
                feeds,
                haystack,
                resultsEl,
                onSelect
              );
            }, 200);
          });

          searchInput.focus();
        })
        .catch((err) => {
          console.error('[AtlasSearch] Failed to load feeds:', err);
          resultsEl.innerHTML = `<div class="text-error text-sm p-4 text-center">Failed to load atlas data</div>`;
        });
    },
  });

  return selectedUrl;
}
