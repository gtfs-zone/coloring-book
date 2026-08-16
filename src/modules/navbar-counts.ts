import { GTFS_TABLES } from '../types/gtfs.js';
import { getZoneCollection } from './zone-store.js';
import type { GTFSParser } from './gtfs-parser.js';
import type { PatchManager } from './patch-manager.js';

interface NavbarCountsDeps {
  gtfsParser: GTFSParser;
  patchManager: PatchManager;
}

/**
 * Count bubbles on the navbar buttons (shapes, services, levels, fare products,
 * on-demand objects, changes), and the On-Demand button's visibility.
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
      'levels-count-badge',
      gtfsParser.getFileDataSync(GTFS_TABLES.LEVELS).length
    );
    setBadge(
      'fares-count-badge',
      gtfsParser.getFileDataSync(GTFS_TABLES.FARE_PRODUCTS).length
    );
    setBadge('feed-data-count-badge', this.countFeedDataRows());
    setBadge('on-demand-count-badge', this.countOnDemandObjects());
    setBadge('history-count-badge', patchManager.changeCount);

    // The On-Demand button is the one navbar affordance that is hidden on a
    // feed it does not apply to: flex is rare, and an always-visible button
    // would imply every feed has on-demand service to configure. The wrapper's
    // base class is `hidden`, so showing it means adding back the responsive
    // display class rather than removing `hidden`.
    document
      .getElementById('on-demand-indicator')
      ?.classList.toggle('md:inline-flex', this.hasOnDemandService());
  }

  /** Transfers, attributions and translations together. */
  private countFeedDataRows(): number {
    const { gtfsParser } = this.deps;
    return (
      gtfsParser.getFileDataSync(GTFS_TABLES.TRANSFERS).length +
      gtfsParser.getFileDataSync(GTFS_TABLES.ATTRIBUTIONS).length +
      gtfsParser.getFileDataSync(GTFS_TABLES.TRANSLATIONS).length
    );
  }

  /** Booking rules, location groups and zones together. */
  private countOnDemandObjects(): number {
    const { gtfsParser } = this.deps;
    return (
      gtfsParser.getFileDataSync(GTFS_TABLES.BOOKING_RULES).length +
      gtfsParser.getFileDataSync(GTFS_TABLES.LOCATION_GROUPS).length +
      getZoneCollection(gtfsParser).features.length
    );
  }

  /**
   * Whether the feed has anything on-demand at all.
   *
   * The flex files are the cheap answer, but a feed may legally put a
   * pickup/drop-off window on an ordinary `stop_id` row and carry none of them,
   * so stop_times is scanned as a fallback. The scan stops at the first hit and
   * only runs when every flex file is empty.
   */
  private hasOnDemandService(): boolean {
    if (this.countOnDemandObjects() > 0) {
      return true;
    }
    for (const row of this.deps.gtfsParser.getFileDataSync(
      GTFS_TABLES.STOP_TIMES
    )) {
      if (
        String(row['start_pickup_drop_off_window'] ?? '') !== '' ||
        String(row['end_pickup_drop_off_window'] ?? '') !== ''
      ) {
        return true;
      }
    }
    return false;
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
