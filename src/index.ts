import { GTFSParser } from './modules/gtfs-parser';
import { MapController } from './modules/map-controller';
import { Editor } from './modules/editor';
import { UIController } from './modules/ui';
import { TabManager } from './modules/tab-manager';
import { BottomSheetController } from './modules/bottom-sheet';
import { GTFSRelationships } from './modules/gtfs-relationships';
import { BrowseNavigation } from './modules/browse-navigation';
import { InfoDisplay } from './modules/info-display';
import { SearchController } from './modules/search-controller';
import { buildSearchEntries } from './modules/search-entries';
import { GTFSValidator } from './modules/gtfs-validator';
import {
  publishFeedIssues,
  setFeedIssueRevalidator,
} from './modules/feed-issues';
import { KeyboardShortcuts } from './modules/keyboard-shortcuts';
import { FieldDescriptionsDisplay } from './modules/field-descriptions';
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
import { showTimetableModal } from './modules/timetable-modal';
import type { PageState } from './types/page-state';
import { PatchManager } from './modules/patch-manager';
import { HistoryController } from './modules/history-controller';
import { TabLockController } from './modules/tab-lock';
import { humanLabel } from './utils/patch-label';
import { loadExtensionColumns } from './utils/extension-fields';
import { showHelpModal, shouldShowHelpPage } from './modules/help-modal';
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
import { renderRouteWaypointsIcon } from './modules/modal-utils';
import { NavbarCounts } from './modules/navbar-counts';
import { PanelResizer } from './modules/panel-resizer';
import { LevelsController } from './modules/levels-controller';
import { feedProgressIndicator } from './modules/feed-progress-indicator';
import { CONFIG } from './config';
import { initFieldTooltipPortal } from './utils/tooltip-position';
import './styles/main.css';

declare global {
  interface Window {
    gtfsEditor: GTFSEditor;
  }
  const __APP_VERSION__: string;
}

function runWhenIdle(fn: () => void): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn);
  } else {
    setTimeout(fn, 0);
  }
}

export class GTFSEditor {
  public gtfsParser: GTFSParser;
  public mapController: MapController;
  public editor: Editor;
  public uiController: UIController;
  public tabManager: TabManager;
  public relationships: GTFSRelationships;
  public infoDisplay: InfoDisplay;
  public browseNavigation: BrowseNavigation;
  public searchController: SearchController<PageState>;
  public validator: GTFSValidator;
  public keyboardShortcuts: KeyboardShortcuts;
  public fieldDescriptions: FieldDescriptionsDisplay;
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
    this.tabManager = new TabManager();
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
    this.fieldDescriptions = FieldDescriptionsDisplay.integrate();
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

    this.historyController = new HistoryController();
    this.navbarCounts = new NavbarCounts({
      gtfsParser: this.gtfsParser,
      patchManager: this.patchManager,
    });
    this.tabLock = new TabLockController();
    this.levelsController = new LevelsController(this.gtfsParser.gtfsDatabase);
    this.shapesManager = new ShapesManager(this.gtfsParser, this.patchManager);

    const appContainer = document.querySelector<HTMLElement>('.app-container')!;
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
        // Timetable data and picker options are keyed by ids that collide
        // across feeds, so stale entries redisplay the previous feed's rows.
        this.scheduleController.resetForNewFeed();
        // Issues and the navbar count badges: import writes rows directly,
        // bypassing the patch events these otherwise listen to.
        this.validateAndUpdateInfo();
        // Async, and nothing renders a column list synchronously inside the
        // swap, so it is fire-and-forget. User-added columns live in the meta
        // store, which clearDatabase() wipes; without this the in-memory list
        // keeps the previous feed's columns.
        loadExtensionColumns(this.gtfsParser.gtfsDatabase).catch((e: unknown) =>
          console.error('[GTFSEditor] failed to reload extension columns:', e)
        );
      });

      // Initialize keyboard shortcuts
      this.keyboardShortcuts.initialize();

      const shapesBtn = document.getElementById('shapes-btn');
      if (shapesBtn) {
        // Same icon as the "open in brouter" affordance, at navbar icon size.
        shapesBtn.innerHTML = renderRouteWaypointsIcon('h-5 w-5');
      }

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

      // Initialize tab manager
      this.tabManager.initialize();

      // Wire history-btn to open History modal
      document.getElementById('history-btn')?.addEventListener('click', () => {
        (
          document.getElementById('history-modal') as HTMLDialogElement
        )?.showModal();
        this.historyController
          .render()
          .catch((e: unknown) => console.error('[history] render failed:', e));
      });

      // Initialize bottom sheet controller (mobile only)
      const rightPanel = document.getElementById('right-panel');
      const openHistoryModal = () => {
        (
          document.getElementById('history-modal') as HTMLDialogElement
        )?.showModal();
        this.historyController
          .render()
          .catch((e: unknown) => console.error('[history] render failed:', e));
      };
      const bottomSheet = rightPanel
        ? new BottomSheetController(
            rightPanel,
            this.tabManager,
            openHistoryModal
          )
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
      await this.bootFeed();

      // Initialize PageStateManager from URL. After the feed, so a deep-linked
      // object is validated against the rows that are actually loaded.
      await this.pageStateManager.initializeFromURL();

      // If no existing data, initialize an empty feed so the invariant "there is always a feed" holds.
      const hasExistingRows = this.gtfsParser
        .getAllFileNames()
        .some((f) => (this.gtfsParser.getFileDataSync(f)?.length ?? 0) > 0);

      if (!hasExistingRows) {
        console.log('[boot] no rows after load, falling back to an empty feed');
        await this.gtfsParser.initializeEmpty();
      }

      this.updateUndoRedoState();

      if (CONFIG.DEBUG_BOOT) {
        console.time('[boot] browse-navigation.refresh');
      }
      this.uiController.updateFileList();
      this.browseNavigation
        .refresh()
        .catch((e: unknown) =>
          notify.error(
            `Failed to refresh navigation: ${e instanceof Error ? e.message : String(e)}`
          )
        );
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] browse-navigation.refresh');
      }
      feedProgressIndicator.finishLoading('boot');
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] total');
      }

      // initializeFromURL sets the state without dispatching a navigation, so
      // a modal named by the boot URL is opened here, once the feed it reads
      // is in place.
      getModalRouter().sync(this.pageStateManager.getPageState());

      runWhenIdle(() => {
        if (CONFIG.DEBUG_BOOT) {
          console.time('[boot] map-controller.updateMap');
        }
        this.mapController
          .updateMap()
          .then(async () => {
            // updateMap clears map focus. Render the URL-restored state only
            // after it completes so a refreshed stop page keeps its selection.
            await this.browseNavigation.refresh();
            if (CONFIG.DEBUG_BOOT) {
              console.timeEnd('[boot] map-controller.updateMap');
            }
          })
          .catch((e: unknown) =>
            notify.error(
              `Failed to update map: ${e instanceof Error ? e.message : String(e)}`
            )
          );
      });
    } catch (error) {
      feedProgressIndicator.finishLoading('boot');
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] total');
      }
      console.error('Failed to initialize application:', error);
      notify.error(
        'Failed to initialize application. Please refresh the page and try again.'
      );
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
  private async bootFeed(): Promise<void> {
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
      return;
    }

    const deepLink = this.pageStateManager.peekURLPageState();
    if (deepLink.type !== 'home' || deepLink.modal) {
      console.log(
        `[boot] skipped modal: deep link to ${deepLink.modal?.type ?? deepLink.type}`
      );
      await this.restoreStoredFeed();
      return;
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
    if (shouldShowHelpPage('welcome')) {
      await showHelpModal('welcome');
    }
    const choice = await this.uiController.openBootLoadModal(
      summary ? { ...summary, edits: versions.currentVersion } : undefined
    );
    feedProgressIndicator.startLoading('boot', 'Opening feed...');
    console.log(`[boot] load modal: user chose ${choice}`);

    if (choice === 'continue') {
      await this.restoreStoredFeed();
    } else if (choice === 'empty') {
      await this.gtfsParser.initializeEmpty();
      feedProgressIndicator.finishLoading('boot');
      if (shouldShowHelpPage('getting-started')) {
        await showHelpModal('getting-started');
      }
      feedProgressIndicator.startLoading('boot', 'Opening feed...');
    }
    // 'loaded' has already parsed the chosen feed into place.
  }

  /** Hydrate the feed sitting in IndexedDB: rows first, then the patch log. */
  private async restoreStoredFeed(): Promise<void> {
    if (CONFIG.DEBUG_BOOT) {
      console.time('[boot] restore stored feed');
    }
    await this.gtfsParser.restoreDataFromDatabase();
    // Paired with the restore, never run on a feed the user declined: replaying
    // patches over the wrong rows is how a feed gets corrupted.
    await this.patchManager.initialize();
    // Only now are the rows final: the snapshot branch of patchManager.initialize
    // rebinds tables and replays the patch log on top of what the restore read.
    this.gtfsParser.markFeedReplaced();
    if (CONFIG.DEBUG_BOOT) {
      console.timeEnd('[boot] restore stored feed');
    }
    const routes = this.gtfsParser.getFileDataSync('routes.txt')?.length ?? 0;
    console.log(`[boot] continue with stored feed (${routes} routes)`);
  }

  // Runs on every whole-feed swap, via the parser's feed-replaced signal.
  // Publishes the grouped issues the home panel renders.
  public validateAndUpdateInfo(): void {
    // Feed import writes rows directly, bypassing the patch events the count
    // badges otherwise listen to.
    this.navbarCounts.refresh();

    const validationResults = this.validator.validateFeed();
    const issues = publishFeedIssues(validationResults, this.gtfsParser);
    console.log(
      `[GTFSEditor] validation: ${validationResults.errors.length} error(s), ${validationResults.warnings.length} warning(s), ${issues.length} issue group(s)`
    );
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
      if (shouldShowHelpPage('shapes')) {
        await showHelpModal('shapes', { continueLabel: 'Continue to Shapes' });
        if (cancelled()) {
          return;
        }
      }
      await shapesManager.open();
    });

    router.register('fares', async (_modal, _transient, cancelled) => {
      if (shouldShowHelpPage('fares')) {
        await showHelpModal('fares', { continueLabel: 'Continue to Fares' });
        if (cancelled()) {
          return;
        }
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
      if (shouldShowHelpPage('on-demand')) {
        await showHelpModal('on-demand', {
          continueLabel: 'Continue to On-Demand',
        });
        if (cancelled()) {
          return;
        }
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
   * The navbar and dock buttons name no timetable, so the controller picks
   * one: the first route with trips, its first service, its busiest direction.
   */
  private async openDefaultTimetable(): Promise<void> {
    const target = await this.scheduleController.resolveTimetableTarget();
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
      onCreateZone: async (location_id, stop_name) => {
        // Empty coordinates is a real intermediate state: the zone page shows a
        // warning until geometry is drawn or pasted.
        const feature: ZoneFeature = {
          type: 'Feature',
          id: location_id,
          properties: stop_name ? { stop_name } : {},
          geometry: { type: 'Polygon', coordinates: [] },
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
