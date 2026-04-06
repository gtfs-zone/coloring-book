interface AtlasFeed {
  id: string;
  name: string;
  operator_name: string;
  location: string;
  url: string;
}

let cachedFeeds: AtlasFeed[] | null = null;

async function loadAtlasFeeds(): Promise<AtlasFeed[]> {
  if (cachedFeeds !== null) {
    return cachedFeeds;
  }
  const response = await fetch('/atlas-feeds.json');
  if (!response.ok) {
    throw new Error(`Failed to fetch atlas-feeds.json: ${response.status}`);
  }
  cachedFeeds = (await response.json()) as AtlasFeed[];
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
  resultsEl: HTMLElement,
  onSelect: (url: string) => void
) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? feeds.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.operator_name.toLowerCase().includes(q) ||
          f.location.toLowerCase().includes(q) ||
          f.url.toLowerCase().includes(q)
      )
    : feeds;

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
    note.textContent = `Showing 50 of ${filtered.length} results — refine your search`;
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

export async function showAtlasSearchModal(): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal modal-open';
    modal.innerHTML = `
      <div class="modal-box max-w-2xl flex flex-col gap-3">
        <h3 class="font-bold text-lg">From TransitLand Atlas</h3>
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
        <div class="modal-action">
          <button id="atlas-cancel-btn" class="btn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const cleanup = (url: string | null) => {
      document.body.removeChild(modal);
      resolve(url);
    };

    modal
      .querySelector('#atlas-cancel-btn')!
      .addEventListener('click', () => cleanup(null));

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cleanup(null);
      }
    });

    const resultsEl = modal.querySelector('#atlas-results') as HTMLElement;
    const searchInput = modal.querySelector(
      '#atlas-search-input'
    ) as HTMLInputElement;

    const onSelect = (url: string) => cleanup(url);

    loadAtlasFeeds()
      .then((feeds) => {
        filterAndRender('', feeds, resultsEl, onSelect);

        searchInput.addEventListener('input', () => {
          debounce(() => {
            filterAndRender(searchInput.value, feeds, resultsEl, onSelect);
          }, 200);
        });

        searchInput.focus();
      })
      .catch((err) => {
        console.error('[AtlasSearch] Failed to load feeds:', err);
        resultsEl.innerHTML = `<div class="text-error text-sm p-4 text-center">Failed to load atlas data</div>`;
      });
  });
}
