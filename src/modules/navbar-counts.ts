import { GTFS_TABLES } from '../types/gtfs.js';
import type { GTFSParser } from './gtfs-parser.js';
import type { PatchManager } from './patch-manager.js';

interface NavbarCountsDeps {
  gtfsParser: GTFSParser;
  patchManager: PatchManager;
}

/**
 * Count bubbles on the navbar buttons (shapes, services, fare products,
 * changes).
 *
 * Counts are read from the parser's in-memory tables, which share their row
 * arrays with the virtual tables, so they are current without hitting IndexedDB
 * on every refresh. `shapes.txt` is the exception: it is counted via the cached
 * `getShapeIds()` because reading its rows copies every shape point.
 */
export class NavbarCounts {
  private deps: NavbarCountsDeps;

  constructor(deps: NavbarCountsDeps) {
    this.deps = deps;
  }

  /** Wire refreshes to every event that can change one of the counts. */
  initialize(): void {
    for (const event of ['change', 'undo', 'redo', 'jump'] as const) {
      this.deps.patchManager.on(event, () => this.refresh());
    }
    this.refresh();
  }

  refresh(): void {
    const { gtfsParser, patchManager } = this.deps;

    setBadge('shapes-count-badge', gtfsParser.getShapeIds().length);
    setBadge('calendar-count-badge', this.countServices());
    setBadge(
      'fares-count-badge',
      gtfsParser.getFileDataSync(GTFS_TABLES.FARE_PRODUCTS).length
    );
    setBadge('history-count-badge', patchManager.version);
  }

  /** Distinct service_ids across calendar.txt and calendar_dates.txt. */
  private countServices(): number {
    const ids = new Set<string>();
    for (const table of [GTFS_TABLES.CALENDAR, GTFS_TABLES.CALENDAR_DATES]) {
      for (const row of this.deps.gtfsParser.getFileDataSync(table)) {
        const id = String(row['service_id'] ?? '');
        if (id !== '') {
          ids.add(id);
        }
      }
    }
    return ids.size;
  }
}

// A zero count renders nothing rather than a "0" bubble on an empty feed.
function setBadge(id: string, count: number): void {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }
  el.textContent = String(count);
  el.classList.toggle('hidden', count === 0);
}
