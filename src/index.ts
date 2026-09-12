import { GTFSParser } from './modules/gtfs-parser';
import { MapController } from './modules/map-controller';
import { Editor } from './modules/editor';
import { UIController } from './modules/ui';
import { BottomSheetController } from './modules/bottom-sheet';
import { GTFSRelationships } from './modules/gtfs-relationships';
import { BrowseNavigation } from './modules/browse-navigation';
import { InfoDisplay } from './modules/info-display';
import { SearchController } from './modules/search-controller';
import { buildSearchEntries } from './modules/search-entries';
import { GTFSValidator } from './modules/gtfs-validator';
import {
  refreshFeedIssuesIfStale,
  setFeedIssueRevalidator,
} from './modules/feed-issues';
import { KeyboardShortcuts } from './modules/keyboard-shortcuts';
import { ScheduleController } from './modules/schedule-controller';
import { ServiceDaysController } from './modules/service-days-controller';
import { ThemeController } from './modules/theme-controller';
import { notify } from './modules/notification-system';
import {
  initializePageStateWithGTFS,
  takeLoadCommand,
} from './modules/page-state-integration';
import { PageStateManager } from './modules/page-state-manager';
import { openModal, openTimetable } from './modules/navigation-actions';
import { getModalRouter } from './modules/modal-router';
import { showModal } from './modules/modal-utils';
import { showTimetableModal } from './modules/timetable-modal';
import type { PageState } from './types/page-state';
import { PatchManager } from './modules/patch-manager';
import { HistoryController } from './modules/history-controller';
import { TabLockController } from './modules/tab-lock';
import { humanLabel } from './utils/patch-label';
import { loadExtensionColumns } from './utils/extension-fields';
import { runWhenIdle } from './utils/run-when-idle';
import { showHelpModal, showHelpPageOnce } from './modules/help-modal';
import { setHelpRuntimeData } from './modules/help-pages';
import { showFaresModal } from './modules/fares-modal';
import { showFeedDataModal } from './modules/feed-data-modal';
import { showOnDemandModal } from './modules/on-demand-modal';
import {
  getZoneFeatures,
  writeZoneFeatures,
  type ZoneFeature,
} from './modules/zone-store';
import {
  showCalendarModal,
  type CalendarModalDeps,
} from './modules/calendar-modal';
import { ShapesManager } from './modules/shapes-manager';
import { renderDockIcons, renderNavbarActions } from './modules/navbar-actions';
import { NavbarCounts } from './modules/navbar-counts';
import { PanelResizer, restorePanelWidth } from './modules/panel-resizer';
import { LevelsController } from './modules/levels-controller';
import { feedProgressIndicator } from './modules/feed-progress-indicator';
import { databaseFallbackManager } from './modules/database-fallback-manager';
import { LoadCancelledError } from './modules/feed-download';
import { CONFIG } from './config';
import { initFieldTooltipPortal } from './utils/tooltip-position';
import './styles/main.css';

declare global {
  interface Window {
    gtfsEditor: GTFSEditor;
  }
  const __APP_VERSION__: string;
}

/**
 * What boot did about a feed. Explicit because only 'nothing-stored' may be
 * followed by creating an empty feed: that commits a new generation and clears
 * the patch log, so guessing from a row count destroys a stored feed whenever a
 * restore or a load failed.
 */
type BootOutcome =
  | 'restored'
  | 'created-empty'
  | 'loaded'
  | 'nothing-stored'
  | 'failed';

export class GTFSEditor {
  public gtfsParser: GTFSParser;
  public mapController: MapController;
  public editor: Editor;
  public uiController: UIController;
  public relationships: GTFSRelationships;
  public infoDisplay: InfoDisplay;
  public browseNavigation: BrowseNavigation;
  public searchController: SearchController<PageState>;
  public validator: GTFSValidator;
  public keyboardShortcuts: KeyboardShortcuts;
  public scheduleController: ScheduleController;
  public serviceDaysController: ServiceDaysController;
  public themeController: ThemeController;
  public pageStateManager: PageStateManager;
  public patchManager: PatchManager;
  public historyController: HistoryController;
  public navbarCounts: NavbarCounts;
  public tabLock: TabLockController;
  public levelsController: LevelsController;
  public shapesManager: ShapesManager;

  constructor() {
    this.gtfsParser = new GTFSParser();
    this.mapController = new MapController();
    this.editor = new Editor();
    this.uiController = new UIController();
    this.relationships = new GTFSRelationships(this.gtfsParser);
    this.infoDisplay = new InfoDisplay(this.relationships);
    this.scheduleController = new ScheduleController(
      this.relationships,
      this.gtfsParser
    );
    this.serviceDaysController = new ServiceDaysController(this.gtfsParser);
    this.browseNavigation = new BrowseNavigation(
      this.relationships,
      this.mapController,
      this.serviceDaysController,
      this.gtfsParser
    );
    this.searchController = new SearchController<PageState>({
      getEntries: () => buildSearchEntries(this.gtfsParser),
      onSelect: (state) => this.focusSearchResult(state),
    });
    this.validator = new GTFSValidator(this.gtfsParser);
    this.keyboardShortcuts = new KeyboardShortcuts(this);
    this.themeController = new ThemeController();

    // Initialize PageStateManager (will be fully set up after GTFS parser initialization)
    this.pageStateManager = initializePageStateWithGTFS(
      this.gtfsParser,
      this.relationships
    );

    // PatchManager wires the append-only patch log to the parser's database
    this.patchManager = new PatchManager(
      this.gtfsParser.gtfsDatabase,
      this.gtfsParser
    );
    // Lets the home panel re-run validation itself when the feed has moved on
    // since the issues it is about to draw were published.
    setFeedIssueRevalidator({
      validate: () => this.validator.validateFeed(),
      source: this.gtfsParser,
      getStalenessKey: () =>
        `${this.gtfsParser.feedGeneration}:${this.patchManager.version}`,
    });
    // Lets the validator reuse its stop_times passes across an edit that could
    // not have changed them, instead of re-walking the table every time.
    this.validator.trackPatches(this.patchManager);

    this.historyController = new HistoryController();
    this.navbarCounts = new NavbarCounts({
      gtfsParser: this.gtfsParser,
      patchManager: this.patchManager,
    });
    this.tabLock = new TabLockController();
    this.levelsController = new LevelsController(this.gtfsParser.gtfsDatabase);
    this.shapesManager = new ShapesManager(this.gtfsParser, this.patchManager);

    const appContainer = document.querySelector<HTMLElement>('.app-container')!;
    restorePanelWidth(appContainer);
    new PanelResizer(appContainer, this.mapController);
    initFieldTooltipPortal();

    // Inject patchManager so edit operations are recorded
    this.gtfsParser.setPatchManager(this.patchManager);
    this.editor.setPatchManager(this.patchManager);
    this.levelsController.setPatchManager(this.patchManager);
    this.browseNavigation.setPatchManager(this.patchManager);
    this.scheduleController.setPatchManager(this.patchManager);
    this.serviceDaysController.setPatchManager(this.patchManager);

    // Timetable stop column -> map: click the rail dot to focus, hover the row
    // to light up whatever it references. A null ref clears all three kinds:
    // the row is already gone, so its kind is no longer readable.
    this.scheduleController.setStopHighlightHandlers({
      onStopFocus: (stop_id) => this.mapController.highlightStop(stop_id),
      onRefHover: (ref) => {
        if (ref === null) {
          this.mapController.hoverStop(null);
          this.mapController.hoverZone(null);
          this.mapController.hoverLocationGroup(null);
          return;
        }
        if (ref.kind === 'stop') {
          this.mapController.hoverStop(ref.id);
        } else if (ref.kind === 'location') {
          this.mapController.hoverZone(ref.id);
        } else {
          this.mapController.hoverLocationGroup(ref.id);
        }
      },
    });

    // A timetable picker's footer button -> the modal that authors what the
    // picker lists. Both go through the hash, so the modal is linkable and
    // back closes it.
    this.scheduleController.setManagerHandlers({
      openOnDemand: (target) => {
        void openModal(
          { type: 'on_demand', ...(target.table && { table: target.table }) },
          { rowKey: target.rowKey }
        );
      },
      openShapes: () => {
        void openModal({ type: 'shapes' });
      },
      uploadShape: (tripId, currentShapeId) =>
        this.shapesManager.uploadShapeForTrip(tripId, currentShapeId),
    });

    this.init().catch((error) => {
      console.error('Failed to initialize GTFSEditor:', error);
      notify.error(
        'Failed to initialize application. Please refresh the page and try again.'
      );
    });
  }

  private async init(): Promise<void> {
    try {
      if (CONFIG.DEBUG_BOOT) {
        console.time('[boot] total');
      }
      // Build the navbar before anything looks up a button by id.
      const navbarActions = document.getElementById('navbar-actions');
      if (navbarActions) {
        renderNavbarActions(navbarActions);
      }
      renderDockIcons();

      feedProgressIndicator.startLoading('boot', 'Opening database...');

      // Claim tab lock before any module initialization
      this.tabLock.init();

      // Display version in header
      this.displayVersion();

      // Initialize notification system
      notify.initialize();

      // Initialize GTFSParser database
      if (CONFIG.DEBUG_BOOT) {
        console.time('[boot] gtfs-parser.initialize');
      }
      await this.gtfsParser.initialize();
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] gtfs-parser.initialize');
      }

      // Non-spec columns are derived from row data, except the ones the user
      // created and has not filled in, which come from the meta store. Read
      // them now: every consumer of that list is synchronous.
      await loadExtensionColumns(this.gtfsParser.gtfsDatabase);
      feedProgressIndicator.updateProgress('boot', 60, 'Restoring patches...');

      const exportBtn = document.getElementById(
        'export-btn'
      ) as HTMLButtonElement;
      if (exportBtn) {
        exportBtn.disabled = false;
      }

      feedProgressIndicator.updateProgress('boot', 80, 'Building map...');
      this.historyController.initialize(this.patchManager);
      this.navbarCounts.initialize();

      // Initialize all modules
      await this.mapController.initialize(this.gtfsParser, this.patchManager);
      this.mapController.setPageStateManager(this.pageStateManager);
      this.mapController.setCallbacks({
        onEmptyClick: () => {
          this.pageStateManager.setPageState({ type: 'home' });
        },
      });
      this.editor.initialize(this.gtfsParser);

      // Note: InfoDisplay is not used in the new UI structure
      this.uiController.initialize(
        this.gtfsParser,
        this.editor,
        this.mapController,
        this.browseNavigation
      );

      // Initialize Browse navigation
      this.browseNavigation.initialize('browse-navigation');

      // Set up circular references
      this.browseNavigation.uiController = this.uiController;

      // Initialize search controller
      this.searchController.initialize();

      // Wire undo/redo events to refresh editor and browse navigation.
      // Map updates are handled by MapController's own patch subscription.
      const refreshAfterUndoRedo = async () => {
        const openFile = this.editor.getCurrentFile();
        if (openFile) {
          await this.editor.buildTableEditor();
        }
        await this.browseNavigation.refresh();
      };
      const onUndoRedoJump = () => {
        refreshAfterUndoRedo().catch((e: unknown) =>
          notify.error(
            `Failed to refresh after undo/redo: ${e instanceof Error ? e.message : String(e)}`
          )
        );
      };
      this.patchManager.on('undo', onUndoRedoJump);
      this.patchManager.on('redo', onUndoRedoJump);
      this.patchManager.on('jump', onUndoRedoJump);

      // Patch notifications + console logging
      this.patchManager.on('change', (r) => {
        console.log('[patch:change]', r);
        notify.info(humanLabel(r?.patch), { duration: 3000 });
        this.browseNavigation
          .refresh()
          .catch((e: unknown) =>
            notify.error(
              `Failed to refresh after edit: ${e instanceof Error ? e.message : String(e)}`
            )
          );
        this.updateUndoRedoState();
      });
      this.patchManager.on('undo', (r) => {
        console.log('[patch:undo]', r);
        notify.info(`Undone: ${humanLabel(r?.patch)}`, {
          duration: 3000,
        });
        this.updateUndoRedoState();
      });
      this.patchManager.on('redo', (r) => {
        console.log('[patch:redo]', r);
        notify.info(`Redone: ${humanLabel(r?.patch)}`, {
          duration: 3000,
        });
        this.updateUndoRedoState();
      });
      this.patchManager.on('jump', () => {
        this.updateUndoRedoState();
      });

      // Every feed-scoped cache invalidation, in one place. Before this signal
      // existed each swap path had to remember these by hand, and the boot
      // paths did not. The parser fires it only once the new rows are final.
      this.gtfsParser.onFeedReplaced(() => {
        // The stop_times messages the validator cached describe the previous
        // feed's rows, and its row numbers.
        this.validator.invalidateStopTimesCache('the feed was replaced');
        // Timetable data and picker options are keyed by ids that collide
        // across feeds, so stale entries redisplay the previous feed's rows.
        this.scheduleController.resetForNewFeed();
        // The previous feed's routes, stops and zones come off the map here
        // rather than at the start of the next render, which on a large feed is
        // seconds later: until then the map would still be showing a feed that
        // is no longer loaded.
        this.mapController.clearForNewFeed();
        // Issues and the navbar count badges: import writes rows directly,
        // bypassing the patch events these otherwise listen to. Validation is
        // a full sweep of every table, so it runs off the critical path: the
        // feed is usable, and the issues populate when they are ready.
        runWhenIdle(() => {
          this.validateAndUpdateInfo().catch((e: unknown) =>
            console.error('[GTFSEditor] validation failed:', e)
          );
        });
        // Async, and nothing renders a column list synchronously inside the
        // swap, so it is fire-and-forget. User-added columns live in the meta
        // store, which the feed commit clears; without this the in-memory list
        // keeps the previous feed's columns.
        loadExtensionColumns(this.gtfsParser.gtfsDatabase).catch((e: unknown) =>
          console.error('[GTFSEditor] failed to reload extension columns:', e)
        );
      });

      // Initialize keyboard shortcuts
      this.keyboardShortcuts.initialize();

      // Content modals live in the URL hash: the navbar buttons move page
      // state, and the router below opens the modal that state names. The guide
      // page gating sits in the opener, not the button, so a deep link gets the
      // same first-use guide.
      this.registerModals(this.shapesManager);

      document
        .getElementById('timetable-btn')
        ?.addEventListener('click', () => void this.openDefaultTimetable());
      document
        .getElementById('dock-timetable')
        ?.addEventListener('click', () => void this.openDefaultTimetable());
      document.getElementById('shapes-btn')?.addEventListener('click', () => {
        void openModal({ type: 'shapes' });
      });
      document.getElementById('fares-btn')?.addEventListener('click', () => {
        void openModal({ type: 'fares' });
      });
      document
        .getElementById('feed-data-btn')
        ?.addEventListener('click', () => {
          void openModal({ type: 'feed_data' });
        });
      document
        .getElementById('on-demand-btn')
        ?.addEventListener('click', () => {
          void openModal({ type: 'on_demand' });
        });
      document.getElementById('calendar-btn')?.addEventListener('click', () => {
        void openModal({ type: 'calendar' });
      });
      document.getElementById('levels-btn')?.addEventListener('click', () => {
        void openModal({ type: 'levels' });
      });

      // Wire up guide modal
      setHelpRuntimeData({
        version: __APP_VERSION__,
        shortcuts: this.keyboardShortcuts.getShortcutsList(),
      });
      this.keyboardShortcuts.setShowHelpHandler(() => showHelpModal('about'));
      document
        .getElementById('help-btn')
        ?.addEventListener('click', () => void showHelpModal());

      // Initialize theme controller
      this.themeController.initialize();
      this.themeController.onThemeChange(() =>
        this.mapController.refreshAccentColor()
      );

      // The Changes panel renders into the modal body, so it is filled on mount
      // and torn down with the modal.
      const openHistoryModal = () => {
        void showModal({
          title: 'History',
          body: '<div id="changes-panel"></div>',
          actions: [{ label: 'Close', onClick: () => {} }],
          escapeAction: 0,
          boxClassName: 'max-w-2xl w-11/12 h-[80vh]',
          onMount: () => {
            this.historyController
              .render()
              .catch((e: unknown) =>
                console.error('[history] render failed:', e)
              );
          },
        });
      };

      document
        .getElementById('history-btn')
        ?.addEventListener('click', openHistoryModal);

      // Initialize bottom sheet controller (mobile only)
      const rightPanel = document.getElementById('right-panel');
      const bottomSheet = rightPanel
        ? new BottomSheetController(rightPanel, [
            { id: 'dock-browse' },
            {
              id: 'dock-files',
              onSelect: () => void this.uiController.openFilesModal(),
            },
            { id: 'dock-changes', snap: null, onSelect: openHistoryModal },
          ])
        : null;

      if (bottomSheet) {
        bottomSheet.onDismiss(
          () => void this.pageStateManager.setPageState({ type: 'home' })
        );
      }

      if (window.innerWidth < 768) {
        this.mapController.setBottomPadding(
          Math.round(window.innerHeight * 0.45)
        );
      }

      // Set up navigation event listener for automatic tab switching
      this.setupNavigationTabSwitching(bottomSheet);

      // Decide which feed this session is about, and hydrate it.
      const outcome = await this.bootFeed();

      // Initialize PageStateManager from URL. After the feed, so a deep-linked
      // object is validated against the rows that are actually loaded.
      await this.pageStateManager.initializeFromURL();

      // Only when the database holds no feed at all: creating one commits a new
      // generation and clears the patch log, so a failed restore or a failed
      // load must never land here. The user keeps whatever is stored and can
      // load again from the modal.
      if (outcome === 'nothing-stored') {
        console.log('[boot] nothing stored, creating an empty feed');
        await this.gtfsParser.initializeEmpty();
      }

      this.updateUndoRedoState();

      if (CONFIG.DEBUG_BOOT) {
        console.time('[boot] refresh after feed swap');
      }
      // The same post-swap refresh a user load runs, minus the navigation home:
      // boot's page state comes from the URL. The map update it schedules also
      // refreshes navigation once it lands, so a deep-linked stop keeps its
      // selection through the focus reset inside updateMap.
      await this.uiController
        .refreshAfterFeedSwap()
        .catch((e: unknown) =>
          notify.error(
            `Failed to refresh navigation: ${e instanceof Error ? e.message : String(e)}`
          )
        );
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] refresh after feed swap');
      }
      // initializeFromURL sets the state without dispatching a navigation, so
      // a modal named by the boot URL is opened here, once the feed it reads
      // is in place.
      getModalRouter().sync(this.pageStateManager.getPageState());
    } catch (error) {
      console.error('Failed to initialize application:', error);
      notify.error(
        'Failed to initialize application. Please refresh the page and try again.'
      );
    } finally {
      feedProgressIndicator.finishLoading('boot');
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] total');
      }
    }
  }

  /**
   * Which feed this session opens with.
   *
   * Boot no longer restores the stored feed unconditionally: parsing it is the
   * expensive half of startup, and it is the wrong feed as often as it is the
   * right one. The load modal comes first and the stored feed is one of its
   * offers. A `#load=` command and a deep link into an object both already
   * state which feed is wanted, so neither shows the modal.
   */
  private async bootFeed(): Promise<BootOutcome> {
    const loadUrl = takeLoadCommand();
    if (loadUrl) {
      console.log('[boot] skipped modal: #load', loadUrl);
      await this.uiController.loadSelection({
        scheduled: {
          kind: 'url',
          url: loadUrl,
          useCors: true,
          label: 'Linked feed',
        },
        realtime: null,
      });
      return 'loaded';
    }

    const deepLink = this.pageStateManager.peekURLPageState();
    if (deepLink.type !== 'home' || deepLink.modal) {
      console.log(
        `[boot] skipped modal: deep link to ${deepLink.modal?.type ?? deepLink.type}`
      );
      return this.restoreStoredFeed();
    }

    // Both reads are single meta records: the stored feed is described without
    // parsing a byte of it.
    const [summary, versions] = await Promise.all([
      this.gtfsParser.gtfsDatabase.getFeedSummary(),
      this.gtfsParser.gtfsDatabase.getVersions(),
    ]);

    // The modal is the boot screen, not an interruption of a load in progress,
    // so the progress bar comes down while both it and the welcome page are up.
    feedProgressIndicator.finishLoading('boot');
    await showHelpPageOnce('welcome');
    const choice = await this.uiController.openBootLoadModal(
      summary ? { ...summary, edits: versions.currentVersion } : undefined
    );
    feedProgressIndicator.startLoading('boot', 'Opening feed...');
    console.log(`[boot] load modal: user chose ${choice}`);

    if (choice === 'continue') {
      return this.restoreStoredFeed();
    }
    if (choice === 'empty') {
      await this.gtfsParser.initializeEmpty();
      feedProgressIndicator.finishLoading('boot');
      await showHelpPageOnce('getting-started');
      feedProgressIndicator.startLoading('boot', 'Opening feed...');
      return 'created-empty';
    }
    // 'loaded' has already parsed the chosen feed into place.
    return 'loaded';
  }

  /** Hydrate the feed sitting in IndexedDB: rows first, then the patch log. */
  private async restoreStoredFeed(): Promise<BootOutcome> {
    if (CONFIG.DEBUG_BOOT) {
      console.time('[boot] restore stored feed');
    }
    try {
      const restored = await this.gtfsParser.restoreDataFromDatabase();
      if (!restored) {
        console.log('[boot] no stored feed to continue from');
        return 'nothing-stored';
      }
      // Paired with the restore, never run on a feed the user declined: replaying
      // patches over the wrong rows is how a feed gets corrupted.
      await this.patchManager.initialize();
      // Only now are the rows final: the snapshot branch of patchManager.initialize
      // rebinds tables and replays the patch log on top of what the restore read.
      this.gtfsParser.markFeedReplaced();
      const routes = this.gtfsParser.getFileDataSync('routes.txt')?.length ?? 0;
      console.log(`[boot] continue with stored feed (${routes} routes)`);
      return 'restored';
    } catch (error) {
      // A cancelled restore is a clean state, not a failure: nothing was
      // installed, so the session lands on the same empty screen as declining
      // the boot modal and the stored feed is untouched.
      if (error instanceof LoadCancelledError) {
        console.log('[boot] restore cancelled by the user');
        notify.info('Load cancelled');
        return 'failed';
      }
      // The patch log is deliberately not replayed: a half-restored feed with
      // patches applied on top of it is worse than no feed at all. The modal
      // offers an export of what is still on disk before clearing.
      console.error('[boot] failed to restore the stored feed:', error);
      databaseFallbackManager.showDatabaseError(
        error,
        'restoring the stored feed',
        () => this.gtfsParser.gtfsDatabase.exportCurrentBlobsAsZip()
      );
      return 'failed';
    } finally {
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] restore stored feed');
      }
    }
  }

  // Runs on every whole-feed swap, via the parser's feed-replaced signal.
  // Publishes the grouped issues the home panel renders. Scheduled rather than
  // awaited by that signal, so a large feed is usable before it finishes.
  public async validateAndUpdateInfo(): Promise<void> {
    // Feed import writes rows directly, bypassing the patch events the count
    // badges otherwise listen to.
    this.navbarCounts.refresh();

    // Through the staleness check rather than straight at the validator: the
    // home panel usually renders the new feed first and has already validated
    // this generation, and a second full sweep would publish the same issues.
    await refreshFeedIssuesIfStale();
  }

  /**
   * Teach the modal router how to open each content modal, then let it react
   * to every navigation. Registration happens before the handler is added so a
   * navigation can never arrive at an empty registry.
   */
  private registerModals(shapesManager: ShapesManager): void {
    const router = getModalRouter();

    router.register('timetable', (modal) =>
      showTimetableModal(
        {
          scheduleController: this.scheduleController,
          patchManager: this.patchManager,
        },
        modal
      )
    );

    router.register('shapes', async (_modal, _transient, cancelled) => {
      if (
        (await showHelpPageOnce('shapes', {
          continueLabel: 'Continue to Shapes',
        })) &&
        cancelled()
      ) {
        return;
      }
      await shapesManager.open();
    });

    router.register('fares', async (_modal, _transient, cancelled) => {
      if (
        (await showHelpPageOnce('fares', {
          continueLabel: 'Continue to Fares',
        })) &&
        cancelled()
      ) {
        return;
      }
      await showFaresModal({
        gtfsDatabase: this.gtfsParser.gtfsDatabase as Parameters<
          typeof showFaresModal
        >[0]['gtfsDatabase'],
        patchManager: this.patchManager,
      });
    });

    router.register('feed_data', (modal, transient) =>
      showFeedDataModal(
        {
          gtfsDatabase: this.gtfsParser.gtfsDatabase as Parameters<
            typeof showFeedDataModal
          >[0]['gtfsDatabase'],
          patchManager: this.patchManager,
        },
        { table: modal.table, rowKey: transient.rowKey }
      )
    );

    router.register('on_demand', async (modal, transient, cancelled) => {
      if (
        (await showHelpPageOnce('on-demand', {
          continueLabel: 'Continue to On-Demand',
        })) &&
        cancelled()
      ) {
        return;
      }
      await showOnDemandModal(this.onDemandModalDeps(), {
        table: modal.table,
        rowKey: transient.rowKey,
      });
    });

    router.register('calendar', () =>
      showCalendarModal({
        gtfsDatabase: this.gtfsParser
          .gtfsDatabase as CalendarModalDeps['gtfsDatabase'],
        patchManager: this.patchManager,
        onServiceClick: (service_id) => {
          // Navigating drops the modal from the state, so the router closes it.
          void this.pageStateManager.setPageState({
            type: 'service',
            service_id,
          });
        },
      })
    );

    router.register('levels', () => this.levelsController.showLevelsModal());

    this.pageStateManager.addNavigationHandler((event) => {
      router.sync(event.to);
    });
  }

  /**
   * The navbar and dock buttons name the route the browse page is on, so the
   * controller only has to pick that route's first service and busiest
   * direction. Anywhere else it picks the whole target: the first route with
   * trips, its first service, its busiest direction.
   */
  private async openDefaultTimetable(): Promise<void> {
    const state = this.pageStateManager.getPageState();
    const target = await this.scheduleController.resolveTimetableTarget(
      state.type === 'route' ? { route_id: state.route_id } : {}
    );
    if (!target) {
      notify.warning('This feed has no trips yet, so there is no timetable.');
      return;
    }
    await openTimetable(target.route_id, target.service_id);
  }

  /** Deps for the On-Demand modal, which several affordances can open. */
  private onDemandModalDeps(): Parameters<typeof showOnDemandModal>[0] {
    return {
      gtfsDatabase: this.gtfsParser.gtfsDatabase as Parameters<
        typeof showOnDemandModal
      >[0]['gtfsDatabase'],
      patchManager: this.patchManager,
      onZoneClick: (location_id) => {
        void this.pageStateManager.setPageState({ type: 'zone', location_id });
      },
      onCreateZone: async ({ location_id, stop_name, geometry }) => {
        const feature: ZoneFeature = {
          type: 'Feature',
          id: location_id,
          properties: stop_name ? { stop_name } : {},
          geometry,
        };
        await writeZoneFeatures(this.gtfsParser, this.patchManager, [
          ...getZoneFeatures(this.gtfsParser),
          feature,
        ]);
        console.log(`[GTFSEditor] created zone ${location_id}`);
      },
    };
  }

  /**
   * A search result behaves exactly like clicking the object on the map or in
   * the sidebar: highlight it (which flies the map and sets the focused
   * object), then move page state so the sidebar and the URL follow.
   */
  private focusSearchResult(state: PageState): void {
    if (state.type === 'stop') {
      this.mapController.highlightStop(state.stop_id);
    } else if (state.type === 'route') {
      this.mapController.highlightRoute(state.route_id);
    }
    void this.pageStateManager.setPageState(state);
  }

  /**
   * Set up navigation event listener to automatically switch tabs based on PageState changes
   */
  private setupNavigationTabSwitching(
    bottomSheet: BottomSheetController | null
  ): void {
    this.pageStateManager.addNavigationHandler((event) => {
      const { to } = event;

      // Open the bottom sheet on mobile for route and stop navigation
      if (to.type === 'route' || to.type === 'stop') {
        bottomSheet?.open('half');
      }
    });
  }

  /**
   * Display version in header
   */
  private displayVersion(): void {
    const versionElement = document.getElementById('app-version');
    if (versionElement) {
      versionElement.textContent = `v${__APP_VERSION__}`;
    }
  }

  private updateUndoRedoState(): void {
    const undoBtn = document.getElementById(
      'undo-btn'
    ) as HTMLButtonElement | null;
    const redoBtn = document.getElementById(
      'redo-btn'
    ) as HTMLButtonElement | null;
    const undoTooltip = document.getElementById('undo-tooltip');
    const redoTooltip = document.getElementById('redo-tooltip');

    const canUndo = this.patchManager.canUndo;
    const canRedo = this.patchManager.canRedo;

    if (undoBtn) {
      undoBtn.disabled = !canUndo;
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo;
    }

    if (!canUndo && !canRedo) {
      if (undoTooltip) {
        undoTooltip.dataset.tip = 'Nothing to undo';
      }
      if (redoTooltip) {
        redoTooltip.dataset.tip = 'Nothing to redo';
      }
      return;
    }

    this.patchManager
      .getHistory()
      .then((history) => {
        const currentVersion = this.patchManager.version;

        if (undoTooltip) {
          if (canUndo) {
            const undoPatch = history.find((r) => r.version === currentVersion);
            undoTooltip.dataset.tip = undoPatch
              ? `Undo: ${humanLabel(undoPatch.patch)}`
              : 'Nothing to undo';
          } else {
            undoTooltip.dataset.tip = 'Nothing to undo';
          }
        }

        if (redoTooltip) {
          if (canRedo) {
            const redoPatch = history.find(
              (r) => r.version === currentVersion + 1
            );
            redoTooltip.dataset.tip = redoPatch
              ? `Redo: ${humanLabel(redoPatch.patch)}`
              : 'Nothing to redo';
          } else {
            redoTooltip.dataset.tip = 'Nothing to redo';
          }
        }
      })
      .catch((e: unknown) =>
        console.error('[undo/redo] Failed to get history for tooltip:', e)
      );
  }

  public undoEdit(): void {
    const stackSize = this.patchManager.canUndo;
    if (!stackSize) {
      notify.info('Nothing to undo');
      return;
    }
    this.patchManager
      .undo()
      .catch((e: unknown) =>
        notify.error(
          `Undo failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
  }

  public redoEdit(): void {
    if (!this.patchManager.canRedo) {
      notify.info('Nothing to redo');
      return;
    }
    this.patchManager
      .redo()
      .catch((e: unknown) =>
        notify.error(
          `Redo failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
  }
}

// Initialize the application
function initializeApp(): void {
  window.gtfsEditor = new GTFSEditor();
}

if (document.readyState === 'loading') {
  // DOM is still loading, wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM is already loaded, initialize immediately
  initializeApp();
}
