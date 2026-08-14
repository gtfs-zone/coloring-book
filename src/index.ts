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
import { deriveFeedIssues, setFeedIssues } from './modules/feed-issues';
import { KeyboardShortcuts } from './modules/keyboard-shortcuts';
import { FieldDescriptionsDisplay } from './modules/field-descriptions';
import { ScheduleController } from './modules/schedule-controller';
import { ServiceDaysController } from './modules/service-days-controller';
import { ThemeController } from './modules/theme-controller';
import { notify } from './modules/notification-system';
import {
  initializePageStateWithGTFS,
  processURLCommands,
  updateBreadcrumbLookup,
} from './modules/page-state-integration';
import { PageStateManager } from './modules/page-state-manager';
import { navigateToTimetable } from './modules/navigation-actions';
import type { PageState } from './types/page-state';
import { PatchManager } from './modules/patch-manager';
import { HistoryController } from './modules/history-controller';
import { TabLockController } from './modules/tab-lock';
import { humanLabel } from './utils/patch-label';
import { showAboutModal } from './modules/about-modal';
import { showFaresModal } from './modules/fares-modal';
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
      this.scheduleController,
      this.serviceDaysController
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
    this.historyController = new HistoryController();
    this.navbarCounts = new NavbarCounts({
      gtfsParser: this.gtfsParser,
      patchManager: this.patchManager,
    });
    this.tabLock = new TabLockController();
    this.levelsController = new LevelsController(this.gtfsParser.gtfsDatabase);

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
      feedProgressIndicator.updateProgress('boot', 60, 'Restoring patches...');

      const exportBtn = document.getElementById(
        'export-btn'
      ) as HTMLButtonElement;
      if (exportBtn) {
        exportBtn.disabled = false;
      }

      // Restore state from patch history (snapshot + subsequent patches)
      if (CONFIG.DEBUG_BOOT) {
        console.time('[boot] patch-manager.initialize');
      }
      await this.patchManager.initialize();
      if (CONFIG.DEBUG_BOOT) {
        console.timeEnd('[boot] patch-manager.initialize');
      }
      feedProgressIndicator.updateProgress('boot', 80, 'Building map...');
      this.historyController.initialize(this.patchManager);
      this.navbarCounts.initialize();
      this.updateUndoRedoState();

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
        this.browseNavigation,
        this.scheduleController,
        this.validateAndUpdateInfo.bind(this)
      );

      // Initialize Browse navigation
      this.browseNavigation.initialize('browse-navigation');

      // Set up circular references
      this.browseNavigation.uiController = this.uiController;
      this.browseNavigation.scheduleController = this.scheduleController;

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

      // Initialize keyboard shortcuts
      this.keyboardShortcuts.initialize();

      // Wire shapes button to open Shapes manager
      const shapesManager = new ShapesManager(
        this.gtfsParser,
        this.patchManager
      );
      const shapesBtn = document.getElementById('shapes-btn');
      if (shapesBtn) {
        // Same icon as the "open in brouter" affordance, at navbar icon size.
        shapesBtn.innerHTML = renderRouteWaypointsIcon('h-5 w-5');
      }
      shapesBtn?.addEventListener('click', () => {
        void shapesManager.open();
      });

      // Wire fares button to open Fares modal
      document.getElementById('fares-btn')?.addEventListener('click', () => {
        showFaresModal({
          gtfsDatabase: this.gtfsParser.gtfsDatabase as Parameters<
            typeof showFaresModal
          >[0]['gtfsDatabase'],
          patchManager: this.patchManager,
        });
      });

      // Wire calendar button to open Calendar modal
      document.getElementById('calendar-btn')?.addEventListener('click', () => {
        void showCalendarModal({
          gtfsDatabase: this.gtfsParser
            .gtfsDatabase as CalendarModalDeps['gtfsDatabase'],
          onServiceClick: (service_id) => {
            void this.pageStateManager.setPageState({
              type: 'service',
              service_id,
            });
          },
        });
      });

      // Wire up about modal
      const openAbout = () =>
        showAboutModal(
          __APP_VERSION__,
          this.keyboardShortcuts.getShortcutsList()
        );
      this.keyboardShortcuts.setShowHelpHandler(openAbout);
      document
        .getElementById('about-btn')
        ?.addEventListener('click', openAbout);

      // Wire levels button
      document.getElementById('levels-btn')?.addEventListener('click', () => {
        this.levelsController
          .showLevelsModal()
          .catch((e: unknown) => console.error('[levels] modal failed:', e));
      });

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

      // Welcome overlay will be shown by default for empty state
      // It will be hidden when a feed is loaded via map-controller

      // Initialize PageStateManager from URL
      await this.pageStateManager.initializeFromURL();

      // Process URL commands (e.g. #load=<url>)
      processURLCommands(this.uiController);

      // If no existing data, initialize an empty feed so the invariant "there is always a feed" holds.
      const hasExistingRows = this.gtfsParser
        .getAllFileNames()
        .some((f) => (this.gtfsParser.getFileDataSync(f)?.length ?? 0) > 0);

      if (!hasExistingRows) {
        await this.gtfsParser.initializeEmpty();
      }

      // Validate the restored feed so the home panel can show its issues.
      this.validateAndUpdateInfo();

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

  // Runs on boot and after every import/replace/new-feed action (see ui.ts validateCallback).
  // Publishes the grouped issues the home panel renders.
  public validateAndUpdateInfo(): void {
    // Feed import writes rows directly, bypassing the patch events the count
    // badges otherwise listen to.
    this.navbarCounts.refresh();

    const validationResults = this.validator.validateFeed();
    const issues = deriveFeedIssues(validationResults);
    setFeedIssues(issues);
    console.log(
      `[GTFSEditor] validation: ${validationResults.errors.length} error(s), ${validationResults.warnings.length} warning(s), ${issues.length} issue group(s)`
    );
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

      // Open the bottom sheet on mobile for route, stop, and timetable navigation
      if (
        to.type === 'route' ||
        to.type === 'stop' ||
        to.type === 'timetable'
      ) {
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

  /**
   * Call this method when GTFS data is reloaded to update breadcrumb lookup cache
   */
  public onGTFSDataReloaded(): void {
    updateBreadcrumbLookup(this.gtfsParser);
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

  // Navigation helper methods for global access
  async navigateToTimetable(
    route_id: string,
    service_id: string,
    direction_id?: string
  ): Promise<void> {
    await navigateToTimetable(route_id, service_id, direction_id);
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
