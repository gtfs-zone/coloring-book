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
import { GTFSValidator } from './modules/gtfs-validator';
import { KeyboardShortcuts } from './modules/keyboard-shortcuts';
import { FieldDescriptionsDisplay } from './modules/field-descriptions';
import { ScheduleController } from './modules/schedule-controller';
import { ServiceDaysController } from './modules/service-days-controller';
import { ThemeController } from './modules/theme-controller';
import { notifications } from './modules/notification-system';
import {
  initializePageStateWithGTFS,
  processURLCommands,
  updateBreadcrumbLookup,
} from './modules/page-state-integration';
import { PageStateManager } from './modules/page-state-manager';
import { navigateToTimetable } from './modules/navigation-actions';
import { PatchManager } from './modules/patch-manager';
import { HistoryController } from './modules/history-controller';
import { TabLockController } from './modules/tab-lock';
import { humanLabel } from './utils/patch-label';
import { showAboutModal } from './modules/about-modal';
import { PanelResizer } from './modules/panel-resizer';
import './styles/main.css';

declare global {
  interface Window {
    gtfsEditor: GTFSEditor;
  }
  const __APP_VERSION__: string;
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
  public searchController: SearchController;
  public validator: GTFSValidator;
  public keyboardShortcuts: KeyboardShortcuts;
  public fieldDescriptions: FieldDescriptionsDisplay;
  public scheduleController: ScheduleController;
  public serviceDaysController: ServiceDaysController;
  public themeController: ThemeController;
  public pageStateManager: PageStateManager;
  public patchManager: PatchManager;
  public historyController: HistoryController;
  public tabLock: TabLockController;

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
    this.searchController = new SearchController(
      this.gtfsParser,
      this.mapController
    );
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
    this.tabLock = new TabLockController();

    const appContainer = document.querySelector<HTMLElement>('.app-container')!;
    new PanelResizer(appContainer, this.mapController);

    // Inject patchManager so edit operations are recorded
    this.gtfsParser.setPatchManager(this.patchManager);
    this.editor.setPatchManager(this.patchManager);
    this.browseNavigation.setPatchManager(this.patchManager);
    this.scheduleController.setPatchManager(this.patchManager);
    this.serviceDaysController.setPatchManager(this.patchManager);

    this.init().catch((error) => {
      console.error('Failed to initialize GTFSEditor:', error);
      notifications.showError(
        'Failed to initialize application. Please refresh the page and try again.'
      );
    });
  }

  private async init(): Promise<void> {
    try {
      // Claim tab lock before any module initialization
      this.tabLock.init();

      // Display version in header
      this.displayVersion();

      // Initialize notification system
      notifications.initialize();

      // Initialize GTFSParser database
      await this.gtfsParser.initialize();

      // Restore state from patch history (snapshot + subsequent patches)
      await this.patchManager.initialize();
      this.historyController.initialize(this.patchManager);

      // Initialize all modules
      await this.mapController.initialize(this.gtfsParser);
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

      // Wire undo/redo events to refresh editor and map
      const refreshAfterUndoRedo = async () => {
        const openFile = this.editor.getCurrentFile();
        if (openFile) {
          await this.editor.buildTableEditor();
        }
        await this.mapController.updateMap();
        await this.browseNavigation.refresh();
      };
      const onUndoRedoJump = () => {
        refreshAfterUndoRedo().catch((e: unknown) =>
          notifications.showError(
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
        notifications.showInfo(humanLabel(r?.patch), { duration: 3000 });
        this.browseNavigation
          .refresh()
          .catch((e: unknown) =>
            notifications.showError(
              `Failed to refresh after edit: ${e instanceof Error ? e.message : String(e)}`
            )
          );
      });
      this.patchManager.on('undo', (r) => {
        console.log('[patch:undo]', r);
        notifications.showInfo(`Undone: ${humanLabel(r?.patch)}`, {
          duration: 3000,
        });
      });
      this.patchManager.on('redo', (r) => {
        console.log('[patch:redo]', r);
        notifications.showInfo(`Redone: ${humanLabel(r?.patch)}`, {
          duration: 3000,
        });
      });

      // Initialize keyboard shortcuts
      this.keyboardShortcuts.initialize();

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

      // Initialize theme controller
      this.themeController.initialize();

      // Initialize tab manager
      this.tabManager.initialize();

      // Initialize bottom sheet controller (mobile only)
      const rightPanel = document.getElementById('right-panel');
      const bottomSheet = rightPanel
        ? new BottomSheetController(rightPanel, this.tabManager)
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

      // Run initial validation and update InfoDisplay
      this.validateAndUpdateInfo();

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

      this.uiController.updateFileList();
      await this.mapController.updateMap();

      if (this.browseNavigation) {
        this.browseNavigation.refresh();
      }

      const exportBtn = document.getElementById(
        'export-btn'
      ) as HTMLButtonElement;
      if (exportBtn) {
        exportBtn.disabled = false;
      }
    } catch (error) {
      console.error('Failed to initialize application:', error);
      notifications.showError(
        'Failed to initialize application. Please refresh the page and try again.'
      );
    }
  }

  public validateAndUpdateInfo(): void {
    // Run validation
    const validationResults = this.validator.validateFeed();

    // Note: InfoDisplay is not used in the new UI structure
    // Validation results are displayed in the object details view when relevant

    void validationResults;
  }

  /**
   * Set up navigation event listener to automatically switch tabs based on PageState changes
   */
  private setupNavigationTabSwitching(
    bottomSheet: BottomSheetController | null
  ): void {
    this.pageStateManager.addNavigationHandler((event) => {
      const { to } = event;

      // Switch to Objects tab for route, stop, and timetable navigation
      if (
        to.type === 'route' ||
        to.type === 'stop' ||
        to.type === 'timetable'
      ) {
        this.tabManager.switchToTab('browse');
        bottomSheet?.open('half');
      }
    });

    this.tabManager.onTabChange((tabName) => {
      if (tabName === 'files' || tabName === 'changes') {
        void this.pageStateManager.setPageState({ type: 'home' });
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

  public undoEdit(): void {
    const stackSize = this.patchManager.canUndo;
    if (!stackSize) {
      notifications.showInfo('Nothing to undo');
      return;
    }
    this.patchManager
      .undo()
      .catch((e: unknown) =>
        notifications.showError(
          `Undo failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
  }

  public redoEdit(): void {
    if (!this.patchManager.canRedo) {
      notifications.showInfo('Nothing to redo');
      return;
    }
    this.patchManager
      .redo()
      .catch((e: unknown) =>
        notifications.showError(
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
