import { notifications } from './notification-system';
import {
  getAgencyFieldDescription,
  getRouteFieldDescription,
  getCalendarFieldDescription,
  createTooltip,
  getSchemaFieldName,
} from '../utils/zod-tooltip-helper.js';
import { navigateToTimetable, navigateToHome } from './navigation-actions.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import { MapMode } from './map-controller.js';

export class UIController {
  constructor() {
    this.gtfsParser = null;
    this.editor = null;
    this.mapController = null;
    this.browseNavigation = null;
    this.scheduleController = null;
    this.validateCallback = null;
  }

  initialize(
    gtfsParser,
    editor,
    mapController,
    browseNavigation,
    scheduleController = null,
    validateCallback = null
  ) {
    this.gtfsParser = gtfsParser;
    this.editor = editor;
    this.mapController = mapController;
    this.browseNavigation = browseNavigation;
    this.scheduleController = scheduleController;
    this.validateCallback = validateCallback;
    this.setupEventListeners();
    this.initializeTabs();
    this.setupMapCallbacks();
  }

  setupEventListeners() {
    // DaisyUI handles dropdown toggle automatically via tabindex and focus

    // Helper to close dropdown
    const closeLoadDropdown = () => {
      // Close examples details if open
      const examplesDetails = document.querySelector(
        '#load-dropdown details'
      ) as HTMLDetailsElement;
      if (examplesDetails) {
        examplesDetails.open = false;
      }
      // Remove focus to close dropdown
      document.activeElement?.blur();
    };

    // Empty button (same as New)
    document.getElementById('empty-btn')?.addEventListener('click', () => {
      this.createNewFeed();
      closeLoadDropdown();
    });

    // Upload button
    document.getElementById('upload-btn').addEventListener('click', () => {
      document.getElementById('file-input').click();
      closeLoadDropdown();
    });

    // Example buttons
    document
      .getElementById('example-columbia')
      ?.addEventListener('click', (e) => {
        // Use currentTarget so clicks on child elements (text/icons) still find the data-url
        const url = (e.currentTarget as HTMLElement).dataset.url;
        console.log('[UI] Example feed clicked, url:', url);
        if (url) {
          this.loadGTFSFromURL(url);
        }
        closeLoadDropdown();
      });

    document.getElementById('example-west')?.addEventListener('click', (e) => {
      const url = (e.currentTarget as HTMLElement).dataset.url;
      console.log('[UI] Example feed clicked, url:', url);
      if (url) {
        this.loadGTFSFromURL(url);
      }
      closeLoadDropdown();
    });

    // File input
    document.getElementById('file-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.loadGTFSFile(e.target.files[0]);
      }
    });

    // Export button
    document.getElementById('export-btn').addEventListener('click', () => {
      this.exportGTFS();
    });

    // Add Stop button
    document.getElementById('add-stop-btn')?.addEventListener('click', () => {
      this.toggleAddStopMode();
    });

    // Edit Stops button
    document.getElementById('edit-stops-btn')?.addEventListener('click', () => {
      this.toggleEditStopsMode();
    });

    // Back to files button
    const backToFilesBtn = document.getElementById('back-to-files');
    if (backToFilesBtn) {
      backToFilesBtn.addEventListener('click', () => {
        this.showFileList();
      });
    }

    // Breadcrumb navigation is now handled dynamically in renderBreadcrumbs()

    // Panel toggle buttons
    const toggleLeftBtn = document.getElementById('toggle-left-panel');
    if (toggleLeftBtn) {
      toggleLeftBtn.addEventListener('click', () => {
        this.toggleLeftPanel();
      });
    }

    const closeLeftBtn = document.getElementById('close-left-panel');
    if (closeLeftBtn) {
      closeLeftBtn.addEventListener('click', () => {
        this.hideLeftPanel();
      });
    }

    const closeRightBtn = document.getElementById('close-right-panel');
    if (closeRightBtn) {
      closeRightBtn.addEventListener('click', () => {
        this.hideRightPanel();
      });
    }

    // Drag and drop
    const body = document.body;
    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    body.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.zip')) {
        this.loadGTFSFile(files[0]);
      }
    });
  }

  initializeTabs() {
    // Initialize DaisyUI tab functionality
    // Listen for tab changes to handle special behaviors
    const radioInputs = document.querySelectorAll('input[name="main_tabs"]');
    radioInputs.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
          const tabName = target.id.replace('-tab-radio', '');
          this.handleTabChange(tabName);
        }
      });
    });
  }

  handleTabChange(tabName: string) {
    // If switching to Objects tab, refresh the navigation
    if (tabName === 'browse' && this.browseNavigation) {
      this.browseNavigation.refresh();
    }
  }

  async loadGTFSFile(file) {
    let loadingNotificationId = null;

    try {
      console.log('Loading GTFS file:', file.name);
      // eslint-disable-next-line no-console
      console.time('[GTFS] loadGTFSFile total');

      // Show loading notification
      loadingNotificationId = notifications.showLoading(
        `Loading GTFS file: ${file.name}`
      );

      // Show loading state on map
      this.mapController.showLoading();

      // Validate file type
      if (!file.name.toLowerCase().endsWith('.zip')) {
        throw new Error('Please upload a ZIP file containing GTFS data');
      }

      // Check file size (warn if > 50MB)
      if (file.size > 50 * 1024 * 1024) {
        notifications.showWarning(
          'Large file detected. Processing may take a moment...'
        );
      }

      // Parse the file
      await this.gtfsParser.parseFile(file);

      // Update UI
      // eslint-disable-next-line no-console
      console.time('[GTFS] updateFileList');
      this.updateFileList();
      // eslint-disable-next-line no-console
      console.timeEnd('[GTFS] updateFileList');
      // eslint-disable-next-line no-console
      console.time('[GTFS] updateMap');
      await this.mapController.updateMap();
      // eslint-disable-next-line no-console
      console.timeEnd('[GTFS] updateMap');
      this.mapController.hideMapOverlay();

      // Show files tab
      this.showFileList();

      // Refresh Objects navigation if available
      if (this.browseNavigation) {
        // eslint-disable-next-line no-console
        console.time('[GTFS] navigateToHome + refresh');
        await navigateToHome();
        this.browseNavigation.refresh();
        // eslint-disable-next-line no-console
        console.timeEnd('[GTFS] navigateToHome + refresh');
      }

      // Run validation if callback is available
      if (this.validateCallback) {
        // eslint-disable-next-line no-console
        console.time('[GTFS] validate');
        this.validateCallback();
        // eslint-disable-next-line no-console
        console.timeEnd('[GTFS] validate');
      }

      // Enable export button
      document.getElementById('export-btn').disabled = false;
      // Update map tool button states
      this.updateAddStopButtonState();
      this.updateEditStopsButtonState();

      // Remove loading notification and show success
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }
      notifications.showSuccess(`Successfully loaded GTFS file: ${file.name}`);
      // eslint-disable-next-line no-console
      console.timeEnd('[GTFS] loadGTFSFile total');
    } catch (error) {
      console.error('Error loading GTFS file:', error);

      // Remove loading notification
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }

      // Show error notification with helpful message
      let errorMessage = 'Failed to load GTFS file';
      if (error.message) {
        errorMessage += `: ${error.message}`;
      }

      notifications.showError(errorMessage, {
        actions: [
          {
            id: 'retry',
            label: 'Try Again',
            primary: true,
            handler: () => {
              document.getElementById('file-input').click();
            },
          },
        ],
      });

      this.mapController.hideMapOverlay();
    }
  }

  async loadGTFSFromURL(url) {
    let loadingNotificationId = null;

    try {
      console.log('Loading GTFS from URL:', url);

      // Show loading notification
      loadingNotificationId = notifications.showLoading(
        `Loading GTFS from URL: ${url}`
      );

      this.mapController.showLoading();

      await this.gtfsParser.parseFromURL(url);

      // Update UI
      this.updateFileList();
      await this.mapController.updateMap();
      this.mapController.hideMapOverlay();

      // Refresh Objects navigation if available
      if (this.browseNavigation) {
        await navigateToHome();
        this.browseNavigation.refresh();
      }

      // Run validation if callback is available
      if (this.validateCallback) {
        this.validateCallback();
      }

      // Enable export button
      document.getElementById('export-btn').disabled = false;
      // Update map tool button states
      this.updateAddStopButtonState();
      this.updateEditStopsButtonState();

      // Remove loading notification and show success
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }
      notifications.showSuccess('Successfully loaded GTFS from URL');
    } catch (error) {
      console.error('Error loading GTFS from URL:', error);

      // Remove loading notification
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }

      // Show error notification with helpful message
      let errorMessage = 'Failed to load GTFS from URL';
      if (error.message) {
        errorMessage += `: ${error.message}`;
      }

      notifications.showError(errorMessage, {
        actions: [
          {
            id: 'help',
            label: 'Need Help?',
            handler: () => {
              // Switch to help tab
              const helpTab = document.querySelector('[data-tab="help"]');
              if (helpTab) {
                helpTab.click();
              }
            },
          },
        ],
      });

      this.mapController.hideMapOverlay();
    }
  }

  updateFileList() {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    // Get categorized files
    const { required, optional, other } = this.gtfsParser.categorizeFiles();
    // Create DaisyUI menu structure
    const menu = document.createElement('ul');
    menu.className = 'menu w-full';

    // Add required files section
    if (required.length > 0) {
      const requiredSection = document.createElement('li');
      const requiredHeader = document.createElement('div');
      requiredHeader.className = 'menu-title';
      requiredHeader.textContent = 'Required Files';
      requiredSection.appendChild(requiredHeader);

      const requiredList = document.createElement('ul');
      required.forEach((fileName) => {
        this.addFileItem(requiredList, fileName, true);
      });
      requiredSection.appendChild(requiredList);
      menu.appendChild(requiredSection);
    }

    // Add optional files section
    if (optional.length > 0) {
      const optionalSection = document.createElement('li');
      const optionalHeader = document.createElement('div');
      optionalHeader.className = 'menu-title';
      optionalHeader.textContent = 'Optional Files';
      optionalSection.appendChild(optionalHeader);

      const optionalList = document.createElement('ul');
      optional.forEach((fileName) => {
        this.addFileItem(optionalList, fileName, false);
      });
      optionalSection.appendChild(optionalList);
      menu.appendChild(optionalSection);
    }

    // Add other files section
    if (other.length > 0) {
      const otherSection = document.createElement('li');
      const otherHeader = document.createElement('div');
      otherHeader.className = 'menu-title';
      otherHeader.textContent = 'Other Files';
      otherSection.appendChild(otherHeader);

      const otherList = document.createElement('ul');
      other.forEach((fileName) => {
        this.addFileItem(otherList, fileName, false);
      });
      otherSection.appendChild(otherList);
      menu.appendChild(otherSection);
    }

    fileList.appendChild(menu);

    // Enable export button if we have files
    const hasFiles =
      required.length > 0 || optional.length > 0 || other.length > 0;
    document.getElementById('export-btn').disabled = !hasFiles;
  }

  addFileItem(container, fileName, isRequired) {
    const listItem = document.createElement('li');

    const link = document.createElement('a');
    link.className = `flex justify-between items-center ${isRequired ? 'file-required' : ''}`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = fileName;
    link.appendChild(nameSpan);

    // Add record count if available
    const data = this.gtfsParser.getFileDataSync(fileName);
    if (data) {
      const count = Array.isArray(data) ? data.length : 1;
      const countSpan = document.createElement('span');
      countSpan.className = 'badge badge-neutral badge-sm';
      countSpan.textContent = `${count}`;
      link.appendChild(countSpan);
    }

    link.addEventListener('click', async (event) => {
      event.preventDefault();
      await this.openFile(fileName, event.currentTarget);
    });

    listItem.appendChild(link);
    container.appendChild(listItem);
  }

  async openFile(fileName, clickedElement = null) {
    if (!this.gtfsParser.getAllFileNames().includes(fileName)) {
      return;
    }

    // Update active file styling
    document.querySelectorAll('.menu a').forEach((item) => {
      item.classList.remove('menu-active');
    });
    if (clickedElement) {
      clickedElement.classList.add('menu-active');
    }

    // Show file editor view
    await this.showFileEditor(fileName);

    // Update map if it's a spatial file
    if (fileName === GTFS_TABLES.STOPS || fileName === GTFS_TABLES.SHAPES) {
      this.mapController.highlightFileData(fileName);
    }
  }

  // Method expected by Objects Navigation interface
  showFileInEditor(filename: string, rowId?: string): void {
    // Switch to Files tab if not already active
    const filesTab = document.querySelector('[data-tab-name="files"]');
    if (filesTab) {
      filesTab.click();
    }

    // Open the file in the editor
    this.openFile(filename);

    // If rowId is provided, we could potentially navigate to that specific row
    // For now, just open the file
    console.log(
      `Opened ${filename} in editor${rowId ? ` for row ${rowId}` : ''}`
    );
  }

  showFileList() {
    const listView = document.getElementById('file-list-view');
    const editorView = document.getElementById('file-editor-view');
    if (listView && editorView) {
      listView.classList.remove('hidden');
      editorView.classList.add('hidden');
    }
  }

  async showFileEditor(fileName) {
    const listView = document.getElementById('file-list-view');
    const editorView = document.getElementById('file-editor-view');
    if (listView && editorView) {
      listView.classList.add('hidden');
      editorView.classList.remove('hidden');

      // Update file name display
      const currentFileNameEl = document.getElementById('current-file-name');
      if (currentFileNameEl) {
        currentFileNameEl.textContent = fileName;
      }

      // Open file in editor
      await this.editor.openFile(fileName);
    }
  }

  showObjectsList() {
    const listView = document.getElementById('browse-list-view');
    const detailsView = document.getElementById('object-details-view');
    if (listView && detailsView) {
      listView.classList.remove('hidden');
      detailsView.classList.add('hidden');
    }
    // Clear breadcrumb trail when returning to objects list
  }

  showObjectDetails(
    objectType,
    objectData,
    relatedObjects = [],
    _skipBreadcrumbUpdate = false
  ) {
    const listView = document.getElementById('browse-list-view');
    const detailsView = document.getElementById('object-details-view');
    if (listView && detailsView) {
      listView.classList.add('hidden');
      detailsView.classList.remove('hidden');

      // Ensure the proper object details structure exists
      // (schedule controller may have replaced it completely)
      this.ensureObjectDetailsStructure(detailsView);

      // Update object info
      const objectTypeEl = document.getElementById('object-type');
      const objectNameEl = document.getElementById('object-name');
      let objectName = 'Unknown';

      // Get the appropriate name based on object type
      if (objectType === 'Agency') {
        objectName =
          objectData.name ||
          objectData.agency_name ||
          objectData.agency_id ||
          'Unknown';
      } else if (objectType === 'Route') {
        // Try shortName first, then longName, then id
        if (objectData.shortName) {
          objectName = objectData.shortName;
          if (objectData.longName) {
            objectName += ' - ' + objectData.longName;
          }
        } else {
          objectName =
            objectData.longName ||
            objectData.id ||
            objectData.route_short_name ||
            objectData.route_long_name ||
            objectData.route_id ||
            'Unknown';
        }
      } else if (objectType === 'Stop') {
        objectName =
          objectData.name ||
          objectData.stop_name ||
          objectData.id ||
          objectData.stop_id ||
          'Unknown';
      } else if (objectType === 'Trip') {
        objectName = objectData.id || objectData.trip_id || 'Unknown';
      } else {
        // Fallback for other types
        objectName =
          objectData.name ||
          objectData.id ||
          objectData.agency_name ||
          objectData.route_short_name ||
          objectData.stop_name ||
          objectData.trip_id ||
          'Unknown';
      }

      if (objectTypeEl && objectNameEl) {
        objectTypeEl.textContent = objectType;
        objectNameEl.textContent = objectName;
      }

      // Populate properties
      this.populateObjectProperties(objectData);

      // Populate related objects
      this.populateRelatedObjects(relatedObjects);
    }
  }

  ensureObjectDetailsStructure(detailsView) {
    // Check if the proper structure exists (object-type, object-name, etc.)
    if (
      !document.getElementById('object-type') ||
      !document.getElementById('object-name')
    ) {
      // Restore the original object details structure
      detailsView.innerHTML = `
        <div class="h-full flex flex-col">
          <!-- Object Header with Breadcrumbs -->
          <div class="border-b border-base-300">
            <div id="object-breadcrumbs" class="p-3 bg-base-200">
              <div class="breadcrumbs text-sm">
                <ul id="breadcrumb-list">
                  <li>
                    <a id="breadcrumb-browse">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="h-4 w-4 stroke-current">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
                      </svg>
                    </a>
                  </li>
                </ul>
              </div>
            </div>
            <div class="flex items-center gap-2 p-4">
              <span id="object-type" class="text-sm font-medium opacity-70">Agency</span>
              <span id="object-name" class="text-sm font-medium">None</span>
            </div>
          </div>

          <!-- Object Properties -->
          <div class="flex-1 overflow-y-auto">
            <div class="p-4">
              <h3 class="text-sm font-semibold mb-3">Properties</h3>
              <div id="object-properties" class="space-y-3">
                <!-- Properties will be populated here -->
              </div>
            </div>

            <!-- Related Objects -->
            <div class="border-t border-base-300 p-4">
              <h3 class="text-sm font-semibold mb-3">Related Objects</h3>
              <div id="related-browse" class="space-y-2">
                <!-- Related objects will be populated here -->
              </div>
            </div>
          </div>
        </div>
      `;

      // Re-attach the breadcrumb event listener
      const breadcrumbObjectsBtn = document.getElementById('breadcrumb-browse');
      if (breadcrumbObjectsBtn) {
        breadcrumbObjectsBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.showObjectsList();
        });
      }
    }
  }

  populateObjectProperties(objectData) {
    const container = document.getElementById('object-properties');
    if (!container) {
      return;
    }

    container.innerHTML = '';

    Object.entries(objectData).forEach(([key, value]) => {
      const propertyEl = document.createElement('div');
      propertyEl.className = 'flex flex-col gap-1';

      // Debug logging
      console.log('Processing property:', key, 'value:', value);

      // Get tooltip description based on the field
      let tooltipDescription = '';
      const schemaFieldName = getSchemaFieldName(key);
      console.log('Schema field name:', schemaFieldName);

      // Try to get description from different schemas
      // Check the current object type to determine which schema to use
      const objectTypeEl = document.getElementById('object-type');
      const objectType = objectTypeEl ? objectTypeEl.textContent : '';

      if (
        objectType === 'Agency' ||
        key.startsWith('agency_') ||
        key === 'agency_id'
      ) {
        tooltipDescription = getAgencyFieldDescription(schemaFieldName);
        console.log('Agency tooltip for', key, ':', tooltipDescription);
      } else if (
        objectType === 'Route' ||
        key.startsWith('route_') ||
        key === 'route_id'
      ) {
        tooltipDescription = getRouteFieldDescription(schemaFieldName);
        console.log('Route tooltip for', key, ':', tooltipDescription);
      } else if (
        objectType === 'Service' ||
        key.startsWith('service_') ||
        key === 'service_id' ||
        key.includes('date') ||
        key.includes('day')
      ) {
        tooltipDescription = getCalendarFieldDescription(schemaFieldName);
        console.log('Calendar tooltip for', key, ':', tooltipDescription);
      }

      const labelText = key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());

      const labelEl = document.createElement('label');
      labelEl.className = 'text-xs font-medium text-secondary';

      if (tooltipDescription) {
        console.log(
          'Creating tooltip for',
          key,
          'with description:',
          tooltipDescription
        );
        labelEl.innerHTML = createTooltip(labelText, tooltipDescription);
      } else {
        console.log('No tooltip for', key);
        labelEl.textContent = labelText;
      }

      const inputEl = document.createElement('input');
      inputEl.className =
        'text-sm px-2 py-1 border border-primary rounded focus:outline-none focus:ring-1 focus:ring-blue-500';
      inputEl.type = 'text';
      inputEl.value = value || '';
      inputEl.dataset.property = key;

      propertyEl.appendChild(labelEl);
      propertyEl.appendChild(inputEl);
      container.appendChild(propertyEl);
    });
  }

  populateRelatedObjects(relatedObjects) {
    const container = document.getElementById('related-browse');
    const headerEl =
      document.querySelector('#related-objects').previousElementSibling;

    if (!container) {
      return;
    }

    // Update the header text based on the types of related objects
    if (headerEl && relatedObjects.length > 0) {
      const objectTypes = [...new Set(relatedObjects.map((obj) => obj.type))];
      let headerText = 'Related Objects';

      if (objectTypes.length === 1) {
        const type = objectTypes[0];
        switch (type) {
          case 'Route':
            headerText = 'Routes';
            break;
          case 'Service':
            headerText = 'Services';
            break;
          case 'Trip':
            headerText = 'Trips';
            break;
          case 'Stop':
            headerText = 'Stops';
            break;
          case 'Agency':
            headerText = 'Agencies';
            break;
          default:
            headerText = `${type}s`;
        }
      } else {
        headerText = 'Related Objects';
      }

      headerEl.textContent = headerText;
    }

    container.innerHTML = '';

    if (relatedObjects.length === 0) {
      const noRelatedEl = document.createElement('div');
      noRelatedEl.className = 'text-sm opacity-60';
      noRelatedEl.textContent = 'No related objects';
      container.appendChild(noRelatedEl);
      return;
    }

    relatedObjects.forEach((obj) => {
      const itemEl = document.createElement('div');

      // Check if this is an agency with routes or a route with trips/services
      if (
        obj.type === 'Agency' &&
        obj.relatedObjects &&
        obj.relatedObjects.length > 0
      ) {
        // Create collapsible agency section
        itemEl.className = 'bg-base-200 rounded mb-2';
        // Agency header
        const headerEl = document.createElement('div');
        headerEl.className =
          'flex items-center gap-2 p-3 cursor-pointer hover:bg-base-300 rounded';

        // Agency icon
        const iconEl = document.createElement('div');
        iconEl.className = 'text-lg flex-shrink-0';
        iconEl.textContent = '🏢';

        const nameEl = document.createElement('span');
        nameEl.className = 'text-sm font-medium flex-1';
        nameEl.textContent = obj.name;

        const chevronEl = document.createElement('span');
        chevronEl.className = 'text-xs opacity-60';
        chevronEl.textContent = '▼';

        headerEl.appendChild(iconEl);
        headerEl.appendChild(nameEl);
        headerEl.appendChild(chevronEl);

        // Routes container (initially hidden)
        const routesEl = document.createElement('div');
        routesEl.className = 'px-3 pb-2 space-y-1 hidden';

        // Add routes with their services
        obj.relatedObjects.forEach((route) => {
          const routeEl = document.createElement('div');
          routeEl.className = 'bg-base-100 rounded mb-1';

          // Route header
          const routeHeaderEl = document.createElement('div');
          routeHeaderEl.className =
            'flex items-center gap-2 p-2 cursor-pointer hover:bg-base-300 rounded';

          // Route color indicator
          const colorEl = document.createElement('div');
          colorEl.className = 'w-2 h-2 rounded-full flex-shrink-0';
          colorEl.style.backgroundColor = route.route_color || '#2563eb';

          const routeNameEl = document.createElement('span');
          routeNameEl.className = 'text-xs font-medium flex-1';
          routeNameEl.textContent = route.name;

          const routeChevronEl = document.createElement('span');
          routeChevronEl.className = 'text-xs opacity-60';
          routeChevronEl.textContent = '▼';

          routeHeaderEl.appendChild(colorEl);
          routeHeaderEl.appendChild(routeNameEl);
          routeHeaderEl.appendChild(routeChevronEl);

          // Services container (initially hidden)
          const servicesEl = document.createElement('div');
          servicesEl.className = 'px-2 pb-1 space-y-1 hidden';

          // Add services if route has them
          if (route.relatedObjects && route.relatedObjects.length > 0) {
            route.relatedObjects.forEach((service) => {
              const serviceEl = document.createElement('div');
              serviceEl.className =
                'flex items-center gap-2 p-1 bg-base-200 rounded text-xs cursor-pointer hover:bg-base-300';

              const serviceNameEl = document.createElement('span');
              serviceNameEl.className = 'font-mono text-xs';
              serviceNameEl.textContent = service.name;

              serviceEl.appendChild(serviceNameEl);

              // Make service clickable
              serviceEl.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (
                  service.scheduleAction &&
                  service.route_id &&
                  service.data?.service_id
                ) {
                  // Navigate to timetable view using the new navigation system
                  navigateToTimetable(
                    service.route_id,
                    service.data.service_id,
                    service.direction_id || service.data.direction_id
                  );
                }
              });

              servicesEl.appendChild(serviceEl);
            });
          }

          // Route toggle functionality
          let isRouteExpanded = false;
          routeHeaderEl.addEventListener('click', (e) => {
            e.stopPropagation();
            isRouteExpanded = !isRouteExpanded;
            if (isRouteExpanded) {
              servicesEl.classList.remove('hidden');
              routeChevronEl.textContent = '▲';
            } else {
              servicesEl.classList.add('hidden');
              routeChevronEl.textContent = '▼';
            }
          });

          // Route double-click action
          routeHeaderEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (route.routeAction && this.browseNavigation) {
              this.browseNavigation.navigateToRoute(
                route.data.id || route.data.route_id
              );
            }
          });

          routeEl.appendChild(routeHeaderEl);
          routeEl.appendChild(servicesEl);
          routesEl.appendChild(routeEl);
        });

        // Agency toggle functionality
        let isExpanded = false;
        headerEl.addEventListener('click', () => {
          isExpanded = !isExpanded;
          if (isExpanded) {
            routesEl.classList.remove('hidden');
            chevronEl.textContent = '▲';
          } else {
            routesEl.classList.add('hidden');
            chevronEl.textContent = '▼';
          }
        });

        // Agency double-click action
        headerEl.addEventListener('dblclick', () => {
          if (obj.agencyAction && this.browseNavigation) {
            const agency_id = obj.data.id || obj.data.agency_id;
            if (agency_id) {
              this.browseNavigation.navigateToAgency(agency_id);
            }
          }
        });

        itemEl.appendChild(headerEl);
        itemEl.appendChild(routesEl);
      } else if (
        obj.type === 'Route' &&
        obj.relatedObjects &&
        obj.relatedObjects.length > 0
      ) {
        // Create collapsible route section
        itemEl.className = 'bg-base-200 rounded mb-2';

        // Route header with color indicator
        const headerEl = document.createElement('div');
        headerEl.className =
          'flex items-center gap-2 p-3 cursor-pointer hover:bg-base-300 rounded';

        // Route color indicator
        const colorEl = document.createElement('div');
        colorEl.className = 'w-3 h-3 rounded-full flex-shrink-0';
        colorEl.style.backgroundColor = obj.route_color || '#2563eb';

        const nameEl = document.createElement('span');
        nameEl.className = 'text-sm font-medium flex-1';
        nameEl.textContent = obj.name;

        const chevronEl = document.createElement('span');
        chevronEl.className = 'text-xs opacity-60';
        chevronEl.textContent = '▼';

        headerEl.appendChild(colorEl);
        headerEl.appendChild(nameEl);
        headerEl.appendChild(chevronEl);

        // Trips container (initially hidden)
        const tripsEl = document.createElement('div');
        tripsEl.className = 'px-3 pb-2 space-y-1 hidden';

        // Add trips
        obj.relatedObjects.forEach((trip) => {
          const tripEl = document.createElement('div');
          tripEl.className =
            'flex items-center gap-2 p-2 bg-base-100 rounded text-xs cursor-pointer hover:bg-base-300';

          const tripNameEl = document.createElement('span');
          tripNameEl.className = 'font-mono';
          tripNameEl.textContent = trip.name;

          tripEl.appendChild(tripNameEl);

          // Make trip clickable
          tripEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (trip.tripAction && this.browseNavigation) {
              this.browseNavigation.navigateToTrip(
                trip.data.trip_id || trip.data.id
              );
            }
          });

          tripsEl.appendChild(tripEl);
        });

        // Toggle functionality
        let isExpanded = false;
        headerEl.addEventListener('click', () => {
          isExpanded = !isExpanded;
          if (isExpanded) {
            tripsEl.classList.remove('hidden');
            chevronEl.textContent = '▲';
          } else {
            tripsEl.classList.add('hidden');
            chevronEl.textContent = '▼';
          }
        });

        // Route click action
        headerEl.addEventListener('dblclick', () => {
          if (obj.routeAction && this.browseNavigation) {
            this.browseNavigation.navigateToRoute(
              obj.data.route_id || obj.data.id
            );
          }
        });

        itemEl.appendChild(headerEl);
        itemEl.appendChild(tripsEl);
      } else {
        // Standard object display
        itemEl.className =
          'flex items-center justify-between p-2 bg-base-200 rounded cursor-pointer hover:bg-base-300';

        const nameEl = document.createElement('span');
        nameEl.className = 'text-sm';
        nameEl.textContent = obj.name;

        const typeEl = document.createElement('span');
        typeEl.className = 'text-xs opacity-60';
        typeEl.textContent = obj.type;

        itemEl.appendChild(nameEl);
        itemEl.appendChild(typeEl);

        itemEl.addEventListener('click', async () => {
          if (obj.scheduleAction && obj.route_id && obj.data?.service_id) {
            // Navigate to timetable view using the new navigation system
            navigateToTimetable(
              obj.route_id,
              obj.data.service_id,
              obj.direction_id || obj.data.direction_id
            );
          } else if (obj.agencyAction && this.browseNavigation) {
            // Navigate to agency view to show routes
            const agency_id = obj.data.id || obj.data.agency_id;
            if (agency_id) {
              this.browseNavigation.navigateToAgency(agency_id);
            }
          } else if (obj.routeAction && obj.route_id) {
            // Navigate to route view to show services
            if (this.browseNavigation) {
              this.browseNavigation.navigateToRoute(obj.route_id);
            }
          } else {
            this.showObjectDetails(
              obj.type,
              obj.data,
              obj.relatedObjects || []
            );
          }
        });
      }

      container.appendChild(itemEl);
    });
  }

  async createNewFeed() {
    try {
      // Reset to empty GTFS feed
      await this.gtfsParser.initializeEmpty();
      this.updateFileList();
      await this.mapController.updateMap();
      this.mapController.hideMapOverlay();

      // Show files tab
      this.showFileList();

      // Clear editor
      this.editor.clearEditor();

      // Refresh Objects navigation if available
      if (this.browseNavigation) {
        await navigateToHome();
        this.browseNavigation.refresh();
      }

      // Run validation if callback is available
      if (this.validateCallback) {
        this.validateCallback();
      }

      notifications.showSuccess('New empty GTFS feed created.');
    } catch (error) {
      console.error('Error creating new GTFS feed:', error);
      notifications.showError(
        `Failed to create new GTFS feed: ${error.message}`
      );
    }
  }

  async exportGTFS() {
    let loadingNotificationId = null;

    try {
      if (
        !this.gtfsParser ||
        !this.gtfsParser
          .getAllFileNames()
          .some((f) => (this.gtfsParser.getFileDataSync(f)?.length ?? 0) > 0)
      ) {
        notifications.showWarning(
          'No GTFS data to export. Please add some data first.'
        );
        return;
      }

      console.log('Exporting GTFS data...');

      // Show loading notification
      loadingNotificationId = notifications.showLoading(
        'Preparing GTFS export...'
      );

      // Save current file changes
      this.editor.saveCurrentFileChanges();

      // Generate ZIP blob
      const blob = await this.gtfsParser.exportAsZip();

      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gtfs-modified.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Remove loading notification and show success
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }
      notifications.showSuccess('GTFS data exported successfully!');
    } catch (error) {
      console.error('Error exporting GTFS:', error);

      // Remove loading notification
      if (loadingNotificationId) {
        notifications.removeNotification(loadingNotificationId);
      }

      notifications.showError(`Failed to export GTFS data: ${error.message}`);
    }
  }

  async checkURLParams() {
    // Check for URL parameters to load GTFS data

    // Check query parameter first: ?url=...
    const searchParams = new URLSearchParams(window.location.search);
    const urlParam = searchParams.get('url');
    if (urlParam) {
      await this.loadGTFSFromURL(urlParam);
      return;
    }

    // Check hash parameter: #data=url:...
    const hash = window.location.hash.substring(1);
    if (hash.startsWith('data=')) {
      const dataParam = hash.substring(5);

      if (dataParam.startsWith('url:')) {
        // Load from URL
        const url = dataParam.substring(4);
        await this.loadGTFSFromURL(url);
      }
      // Future: support for base64, github, etc.
    }
    // Production: No default feed loading - page starts empty
  }

  /**
   * Set up map controller callbacks
   */
  setupMapCallbacks() {
    if (this.mapController) {
      // Set up mode change callback to update UI
      this.mapController.setModeChangeCallback(() => {
        this.updateAddStopButtonState();
        this.updateEditStopsButtonState();
      });
    }
  }

  /**
   * Toggle add stop mode on the map
   */
  toggleAddStopMode() {
    if (!this.mapController) {
      console.warn('Map controller not initialized');
      return;
    }

    // Check if GTFS data is loaded
    if (!this.gtfsParser || !this.gtfsParser.getFileDataSync('stops.txt')) {
      notifications.show('Load GTFS data first before adding stops', 'warning');
      return;
    }

    // Toggle the mode
    this.mapController.toggleAddStopMode();

    // Update button state
    this.updateAddStopButtonState();
  }

  /**
   * Update the Add Stop button state based on current map mode
   */
  updateAddStopButtonState() {
    if (!this.mapController) {
      return;
    }

    const addStopBtn = document.getElementById('add-stop-btn');
    if (!addStopBtn) {
      return;
    }

    const currentMode = this.mapController.getCurrentMode();
    const isAddMode = currentMode === MapMode.ADD_STOP;

    // Update button appearance
    if (isAddMode) {
      addStopBtn.classList.add('btn-active');
      addStopBtn.querySelector('svg').style.transform = 'rotate(45deg)';
      addStopBtn.setAttribute('data-tip', 'Exit add stop mode');
    } else {
      addStopBtn.classList.remove('btn-active');
      addStopBtn.querySelector('svg').style.transform = '';
      addStopBtn.setAttribute('data-tip', 'Add stop');
    }
  }

  /**
   * Toggle edit stops mode on the map
   */
  toggleEditStopsMode() {
    if (!this.mapController) {
      console.warn('Map controller not initialized');
      return;
    }

    // Check if GTFS data is loaded
    if (!this.gtfsParser || !this.gtfsParser.getFileDataSync('stops.txt')) {
      notifications.show(
        'Load GTFS data first before editing stops',
        'warning'
      );
      return;
    }

    // Toggle the mode
    this.mapController.toggleEditStopsMode();

    // Update button state
    this.updateEditStopsButtonState();
  }

  /**
   * Update the Edit Stops button state based on current map mode
   */
  updateEditStopsButtonState() {
    if (!this.mapController) {
      return;
    }

    const editStopsBtn = document.getElementById('edit-stops-btn');
    if (!editStopsBtn) {
      return;
    }

    const currentMode = this.mapController.getCurrentMode();
    const isEditMode = currentMode === MapMode.EDIT_STOPS;

    // Update button appearance
    if (isEditMode) {
      editStopsBtn.classList.add('btn-active');
      editStopsBtn.querySelector('svg').style.transform = 'scale(1.1)';
      editStopsBtn.setAttribute('data-tip', 'Exit edit stops mode');
    } else {
      editStopsBtn.classList.remove('btn-active');
      editStopsBtn.querySelector('svg').style.transform = '';
      editStopsBtn.setAttribute('data-tip', 'Edit stops');
    }
  }
}
