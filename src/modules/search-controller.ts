import { Routes, Stops } from '../types/gtfs-entities.js';

interface SearchResults {
  stops: Stops[];
  routes: Routes[];
}

interface GTFSParser {
  searchAllAsync?: (query: string) => Promise<SearchResults>;
  searchAll: (query: string) => SearchResults;
  getRouteTypeText: (routeType: string) => string;
}

interface MapController {
  highlightStop: (stop_id: string) => void;
  highlightRoute: (route_id: string) => void;
  clearHighlights: () => void;
}

export class SearchController {
  private gtfsParser: GTFSParser;
  private mapController: MapController;
  private searchInput: HTMLInputElement | null = null;
  private searchResults: HTMLElement | null = null;
  private searchTimeout: NodeJS.Timeout | null = null;

  constructor(gtfsParser: GTFSParser, mapController: MapController) {
    this.gtfsParser = gtfsParser;
    this.mapController = mapController;
  }

  initialize(): void {
    this.searchInput = document.getElementById(
      'map-search'
    ) as HTMLInputElement;
    if (!this.searchInput) {
      return;
    }

    this.createSearchResults();
    this.setupEventListeners();
  }

  private createSearchResults(): void {
    // Create search results dropdown
    const controlsContainer = document.getElementById('map-controls');
    if (!controlsContainer) {
      return;
    }

    this.searchResults = document.createElement('div');
    this.searchResults.id = 'search-results';
    this.searchResults.className =
      'search-results hidden absolute top-full left-0 right-0 bg-white border border-gray-300 rounded-b-lg shadow-lg max-h-64 overflow-y-auto z-50';

    controlsContainer.appendChild(this.searchResults);
  }

  private setupEventListeners(): void {
    if (!this.searchInput) {
      return;
    }

    // Search on input with debounce
    this.searchInput.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value.trim();

      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }

      this.searchTimeout = setTimeout(() => {
        this.performSearch(query);
      }, 300);
    });

    // Handle keyboard navigation
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideResults();
        this.searchInput!.blur();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const firstResult = this.searchResults?.querySelector(
          '.search-result-item'
        ) as HTMLElement;
        if (firstResult) {
          firstResult.click();
        }
      }
    });

    // Hide results when clicking outside
    document.addEventListener('click', (e) => {
      if (!(e.target as Element)?.closest('#map-controls')) {
        this.hideResults();
      }
    });

    // Show results when focusing on search input (if has content)
    this.searchInput.addEventListener('focus', () => {
      if (this.searchInput!.value.trim().length >= 2) {
        this.performSearch(this.searchInput!.value.trim());
      }
    });
  }

  private async performSearch(query: string): Promise<void> {
    if (!query || query.length < 2) {
      this.hideResults();
      return;
    }

    this.showLoadingState();

    try {
      // Use async search methods if available, fallback to sync
      const results = this.gtfsParser.searchAllAsync
        ? await this.gtfsParser.searchAllAsync(query)
        : this.gtfsParser.searchAll(query);
      this.displayResults(results, query);
    } catch (error) {
      console.error('Search error:', error);
      this.showErrorState();
    }
  }

  private displayResults(results: SearchResults, query: string): void {
    if (!this.searchResults) {
      return;
    }

    const { stops, routes } = results;
    const totalResults = stops.length + routes.length;

    if (totalResults === 0) {
      this.showNoResultsState(query);
      return;
    }

    let html = '';

    // Add routes section
    if (routes.length > 0) {
      html += `
        <div class="search-section">
          <div class="search-section-header px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Routes (${routes.length})
          </div>
      `;

      routes.forEach((route: Routes) => {
        const routeColor = route.route_color
          ? `#${route.route_color}`
          : '#3b82f6';
        html += `
          <div class="search-result-item px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100" 
               data-type="route" data-id="${route.route_id}">
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${routeColor}"></div>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-900 truncate">
                  ${route.route_short_name || route.route_long_name || route.route_id}
                </div>
                ${
                  route.route_long_name && route.route_short_name
                    ? `<div class="text-sm text-gray-500 truncate">${route.route_long_name}</div>`
                    : ''
                }
                <div class="text-xs text-gray-400">${this.gtfsParser.getRouteTypeText(String(route.route_type))}</div>
              </div>
            </div>
          </div>
        `;
      });

      html += '</div>';
    }

    // Add stops section
    if (stops.length > 0) {
      html += `
        <div class="search-section">
          <div class="search-section-header px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Stops (${stops.length})
          </div>
      `;

      stops.forEach((stop: Stops) => {
        const stopType = stop.location_type ?? 0;
        const stopIcon = stopType === 1 ? '🚉' : '🚏';

        html += `
          <div class="search-result-item px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100" 
               data-type="stop" data-id="${stop.stop_id}">
            <div class="flex items-center gap-2">
              <span class="text-lg flex-shrink-0">${stopIcon}</span>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-900 truncate">
                  ${stop.stop_name || stop.stop_id}
                </div>
                ${stop.stop_code ? `<div class="text-sm text-gray-500">Code: ${stop.stop_code}</div>` : ''}
                <div class="text-xs text-gray-400">
                  ${
                    stop.stop_lat && stop.stop_lon
                      ? `${stop.stop_lat.toFixed(4)}, ${stop.stop_lon.toFixed(4)}`
                      : 'No coordinates'
                  }
                </div>
              </div>
            </div>
          </div>
        `;
      });

      html += '</div>';
    }

    this.searchResults.innerHTML = html;
    this.showResults();
    this.attachResultHandlers();
  }

  private attachResultHandlers(): void {
    const resultItems = this.searchResults!.querySelectorAll(
      '.search-result-item'
    );

    resultItems.forEach((item) => {
      item.addEventListener('click', () => {
        const el = item as HTMLElement;
        const type = el.dataset.type!;
        const id = el.dataset.id!;

        this.selectResult(type, id);
        this.hideResults();
        this.searchInput!.blur();
      });
    });
  }

  private selectResult(type: string, id: string): void {
    if (type === 'stop') {
      this.mapController.highlightStop(id);
    } else if (type === 'route') {
      this.mapController.highlightRoute(id);
    }
  }

  private showLoadingState(): void {
    if (!this.searchResults) {
      return;
    }

    this.searchResults.innerHTML = `
      <div class="px-3 py-4 text-center text-gray-500">
        <div class="animate-spin inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full mr-2"></div>
        Searching...
      </div>
    `;
    this.showResults();
  }

  private showErrorState(): void {
    if (!this.searchResults) {
      return;
    }

    this.searchResults.innerHTML = `
      <div class="px-3 py-4 text-center text-red-500">
        <div class="text-sm">Search error occurred</div>
        <div class="text-xs text-gray-500 mt-1">Please try again</div>
      </div>
    `;
    this.showResults();
  }

  private showNoResultsState(query: string): void {
    if (!this.searchResults) {
      return;
    }

    this.searchResults.innerHTML = `
      <div class="px-3 py-4 text-center text-gray-500">
        <div class="text-sm">No results found for "${query}"</div>
        <div class="text-xs text-gray-400 mt-1">Try searching for stop names, route names, or IDs</div>
      </div>
    `;
    this.showResults();
  }

  private showResults(): void {
    if (this.searchResults) {
      this.searchResults.classList.remove('hidden');
    }
  }

  private hideResults(): void {
    if (this.searchResults) {
      this.searchResults.classList.add('hidden');
    }
  }

  clearSearch(): void {
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    this.hideResults();
    this.mapController.clearHighlights();
  }
}
