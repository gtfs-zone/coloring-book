import { GTFSParser } from './modules/gtfs-parser';
import { MapController } from './modules/map-controller';
import { Editor } from './modules/editor';
import { UIController } from './modules/ui';
import { TabManager } from './modules/tab-manager';
import { GTFSRelationships } from './modules/gtfs-relationships';
import { ObjectsNavigation } from './modules/objects-navigation';
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
  updateBreadcrumbLookup,
} from './modules/page-state-integration';
import { PageStateManager } from './modules/page-state-manager';
import { navigateToTimetable } from './modules/navigation-actions';
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
  public objectsNavigation: ObjectsNavigation;
  public searchController: SearchController;
  public validator: GTFSValidator;
  public keyboardShortcuts: KeyboardShortcuts;
  public fieldDescriptions: FieldDescriptionsDisplay;
  public scheduleController: ScheduleController;
  public serviceDaysController: ServiceDaysController;
  public themeController: ThemeController;
  public pageStateManager: PageStateManager;

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
    this.objectsNavigation = new ObjectsNavigation(
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
    this.pageStateManager = initializePageStateWithGTFS(this.gtfsParser);

    this.init().catch((error) => {
      console.error('Failed to initialize GTFSEditor:', error);
      notifications.showError(
        'Failed to initialize application. Please refresh the page and try again.'
      );
    });
  }

  private async init(): Promise<void> {
    try {
      // Display version in header
      this.displayVersion();

      // Initialize notification system
      notifications.initialize();

      // Initialize GTFSParser database
      await this.gtfsParser.initialize();

      // Check if there's existing data in IndexedDB, only create empty feed if none exists
      const existingMetadata =
        await this.gtfsParser.gtfsDatabase.getProjectMetadata();
      const hasExistingData =
        existingMetadata && this.gtfsParser.getAllFileNames().length > 0;

      if (!hasExistingData) {
        // Only initialize empty feed if no existing data found
        await this.gtfsParser.initializeEmpty();
      }
      // If existing data exists, the parser will automatically work with it

      // Initialize all modules
      await this.mapController.initialize(this.gtfsParser);
      this.mapController.setPageStateManager(this.pageStateManager);
      this.editor.initialize(this.gtfsParser);

      // Note: InfoDisplay is not used in the new UI structure
      this.uiController.initialize(
        this.gtfsParser,
        this.editor,
        this.mapController,
        this.objectsNavigation,
        this.scheduleController,
        this.validateAndUpdateInfo.bind(this)
      );

      // Initialize Objects navigation
      this.objectsNavigation.initialize('objects-navigation');

      // Set up circular references
      this.objectsNavigation.uiController = this.uiController;
      this.objectsNavigation.scheduleController = this.scheduleController;

      // Initialize search controller
      this.searchController.initialize();

      // Initialize keyboard shortcuts
      this.keyboardShortcuts.initialize();

      // Initialize theme controller
      this.themeController.initialize();

      // Initialize tab manager
      this.tabManager.initialize();

      // Set up navigation event listener for automatic tab switching
      this.setupNavigationTabSwitching();

      // Run initial validation and update InfoDisplay
      this.validateAndUpdateInfo();

      // Welcome overlay will be shown by default for empty state
      // It will be hidden when a feed is loaded via map-controller

      // Initialize PageStateManager from URL
      await this.pageStateManager.initializeFromURL();

      // Check for URL parameters (legacy support)
      await this.uiController.checkURLParams();

      // Show welcome notification only if no existing data
      if (!hasExistingData) {
        notifications.showInfo(
          'Welcome to edit.gtfs.zone! Create a new GTFS feed or upload an existing one to get started.'
        );
      } else {
        // If we have existing data, update UI components and hide welcome overlay
        this.uiController.updateFileList();
        await this.mapController.updateMap();
        this.mapController.hideMapOverlay();

        // Refresh Objects navigation if available
        if (this.objectsNavigation) {
          this.objectsNavigation.refresh();
        }

        // Enable export button
        const exportBtn = document.getElementById(
          'export-btn'
        ) as HTMLButtonElement;
        if (exportBtn) {
          exportBtn.disabled = false;
        }
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

    return validationResults;
  }

  /**
   * Set up navigation event listener to automatically switch tabs based on PageState changes
   */
  private setupNavigationTabSwitching(): void {
    this.pageStateManager.addNavigationHandler((event) => {
      const { to } = event;

      // Switch to Objects tab for route, stop, and timetable navigation
      if (
        to.type === 'route' ||
        to.type === 'stop' ||
        to.type === 'timetable'
      ) {
        this.tabManager.switchToTab('objects');
      }
      // Add other tab switching logic here if needed
      // For example:
      // - 'home' might switch to 'files' tab
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
