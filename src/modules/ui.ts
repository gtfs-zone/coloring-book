import { notify } from './notification-system';
import { showModal } from './modal-utils.js';
import { showAtlasSearchModal } from './atlas-search.js';
import {
  getAgencyFieldDescription,
  getRouteFieldDescription,
  getCalendarFieldDescription,
  createTooltip,
  getSchemaFieldName,
} from '../utils/zod-tooltip-helper.js';
import {
  navigateToTimetable,
  navigateToHome,
  navigateToAgency,
  navigateToRoute,
} from './navigation-actions.js';
import { GTFS_TABLES } from '../types/gtfs.js';
import { MapMode, MapController } from './map-controller.js';
import { GTFSParser } from './gtfs-parser.js';
import { Editor } from './editor.js';
import { BrowseNavigation } from './browse-navigation.js';
import { ScheduleController } from './schedule-controller.js';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showURLErrorModal(url: string, error: Error) {
  showModal({
    title: 'Failed to load feed',
    body: `
      <p><code class="break-all whitespace-pre-wrap">${escapeHtml(error.message)}</code></p>
      <p>Attempted URL: <a href="${url}" target="_blank" rel="noopener" class="link">${escapeHtml(url)}</a></p>
      <p class="text-sm text-base-content/60">Some feeds block direct browser requests (CORS). You can try opening the link above to download the file, then upload it directly using Load -> Upload.</p>
    `,
    enterAction: 0,
    escapeAction: 0,
    actions: [{ label: 'Close', onClick: () => {} }],
  });
}

export class UIController {
  gtfsParser: GTFSParser | null;
  editor: Editor | null;
  mapController: MapController | null;
  browseNavigation: BrowseNavigation | null;
  scheduleController: ScheduleController | null;
  validateCallback: (() => void) | null;

  constructor() {
    this.gtfsParser = null;
    this.editor = null;
    this.mapController = null;
    this.browseNavigation = null;
    this.scheduleController = null;
    this.validateCallback = null;
  }

  initialize(
    gtfsParser: GTFSParser,
    editor: Editor,
    mapController: MapController,
    browseNavigation: BrowseNavigation,
    scheduleController: ScheduleController | null = null,
    validateCallback: (() => void) | null = null
  ) {
    this.gtfsParser = gtfsParser;
    this.editor = editor;
    this.mapController = mapController;
    this.browseNavigation = browseNavigation;
    this.scheduleController = scheduleController;
    this.validateCallback = validateCallback;
    this.setupEventListeners();
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
      (document.activeElement as HTMLElement)?.blur();
    };

    // Empty button (same as New)
    document.getElementById('empty-btn')?.addEventListener('click', () => {
      this.createNewFeed();
      closeLoadDropdown();
    });

    // Upload button
    document.getElementById('upload-btn')!.addEventListener('click', () => {
      document.getElementById('file-input')!.click();
      closeLoadDropdown();
    });

    // From URL button
    document.getElementById('from-url-btn')?.addEventListener('click', () => {
      closeLoadDropdown();
      this.showFromURLModal();
    });

    // Search Atlas button
    document
      .getElementById('atlas-search-btn')
      ?.addEventListener('click', async () => {
        closeLoadDropdown();
        const result = await showAtlasSearchModal();
        if (result) {
          const effectiveUrl =
            result.useCors && !result.url.startsWith('https://cors.gtfs.zone/')
              ? 'https://cors.gtfs.zone/' + result.url
              : result.url;
          this.loadGTFSFromURL(effectiveUrl);
        }
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
    document.getElementById('file-input')!.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        this.loadGTFSFile(target.files[0]);
      }
    });

    // Export button
    document.getElementById('export-btn')!.addEventListener('click', () => {
      this.exportGTFS();
    });

    // Pointer button
    document.getElementById('pointer-btn')?.addEventListener('click', () => {
      this.mapController?.setMapMode(MapMode.NAVIGATE);
      this.updateMapToolButtonState();
    });

    // Add Stop button
    document.getElementById('add-stop-btn')?.addEventListener('click', () => {
      this.toggleAddStopMode();
    });

    // Add Pathway button
    document
      .getElementById('add-pathway-btn')
      ?.addEventListener('click', () => {
        this.toggleAddPathwayMode();
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

    // Files modal button
    document.getElementById('files-btn')?.addEventListener('click', () => {
      this.updateFileList();
      (
        document.getElementById('files-modal') as HTMLDialogElement
      )?.showModal();
    });

    // Drag and drop
    const body = document.body;
    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    body.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer!.files;
      if (files.length > 0 && files[0].name.endsWith('.zip')) {
        this.loadGTFSFile(files[0]);
      }
    });
  }

  toggleLeftPanel() {
    const leftPanel = document.getElementById('left-panel');
    if (leftPanel) {
      leftPanel.classList.toggle('hidden');
    }
  }

  hideLeftPanel() {
    const leftPanel = document.getElementById('left-panel');
    if (leftPanel) {
      leftPanel.classList.add('hidden');
    }
  }

  hideRightPanel() {
    const rightPanel = document.getElementById('right-panel');
    if (rightPanel) {
      rightPanel.classList.add('hidden');
    }
  }

  async loadGTFSFile(file: File) {
    try {
      console.log('Loading GTFS file:', file.name);

      console.time('[GTFS] loadGTFSFile total');

      // Validate file type
      if (!file.name.toLowerCase().endsWith('.zip')) {
        throw new Error('Please upload a ZIP file containing GTFS data');
      }

      // Drop cached timetable state from whatever feed was loaded before:
      // it's keyed by route/service/direction ids, which can collide with
      // the new feed's ids and would otherwise redisplay stale stop times.
      this.scheduleController?.resetForNewFeed();

      // Parse the file
      const { unknownFiles } = await this.gtfsParser!.parseFile(file);
      if (unknownFiles.length > 0) {
        notify.warning(
          `Preserving ${unknownFiles.length} unrecognized file(s) for export: ${unknownFiles.join(', ')}`
        );
      }

      // Update UI

      console.time('[GTFS] updateFileList');
      this.updateFileList();

      console.timeEnd('[GTFS] updateFileList');

      console.time('[GTFS] updateMap');
      await this.mapController!.updateMap();

      console.timeEnd('[GTFS] updateMap');

      // Show file list and open Files modal
      this.showFileList();
      (
        document.getElementById('files-modal') as HTMLDialogElement
      )?.showModal();

      // Refresh Objects navigation if available
      if (this.browseNavigation) {
        console.time('[GTFS] navigateToHome + refresh');
        await navigateToHome();
        this.browseNavigation.refresh();

        console.timeEnd('[GTFS] navigateToHome + refresh');
      }

      // Run validation if callback is available
      if (this.validateCallback) {
        console.time('[GTFS] validate');
        this.validateCallback();

        console.timeEnd('[GTFS] validate');
      }

      // Update map tool button states
      this.updateMapToolButtonState();

      notify.success(`Successfully loaded GTFS file: ${file.name}`);

      console.timeEnd('[GTFS] loadGTFSFile total');
    } catch (error) {
      console.error('Error loading GTFS file:', error);

      // Show error notification with helpful message
      let errorMessage = 'Failed to load GTFS file';
      if ((error as Error).message) {
        errorMessage += `: ${(error as Error).message}`;
      }

      notify.error(errorMessage, {
        actions: [
          {
            id: 'retry',
            label: 'Try Again',
            primary: true,
            handler: () => {
              document.getElementById('file-input')!.click();
            },
          },
        ],
      });
    }
  }

  showFromURLModal(initialUrl?: string) {
    showModal({
      title: 'Load from URL',
      body: `<input id="gtfs-url-input" type="url" class="input input-bordered w-full" placeholder="https://example.com/gtfs.zip" />`,
      actionBarContent: `
        <input type="checkbox" id="cors-proxy-checkbox" class="checkbox checkbox-sm" checked />
        <span class="label-text text-sm">Use CORS proxy</span>
        <a
          href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS"
          target="_blank"
          rel="noopener noreferrer"
          class="tooltip tooltip-top btn btn-ghost btn-xs btn-circle"
          data-tip="For most feeds, this is required. Note that the proxy (running on my computer) will see your request. What is CORS and why does my request fail without this proxy? Click to learn more in a new tab."
        >?</a>
      `,
      enterAction: 1,
      escapeAction: 0,
      actions: [
        { label: 'Cancel', onClick: () => {} },
        {
          label: 'Load',
          className: 'btn-primary',
          onClick: async () => {
            const input = document.getElementById(
              'gtfs-url-input'
            ) as HTMLInputElement;
            const url = input.value.trim();
            if (!url) {
              return true;
            }
            const useCors = (
              document.getElementById('cors-proxy-checkbox') as HTMLInputElement
            ).checked;
            const effectiveUrl =
              useCors && !url.startsWith('https://cors.gtfs.zone/')
                ? 'https://cors.gtfs.zone/' + url
                : url;
            this.loadGTFSFromURL(effectiveUrl);
            return false;
          },
        },
      ],
      onMount: () => {
        const input = document.getElementById(
          'gtfs-url-input'
        ) as HTMLInputElement;
        if (initialUrl) {
          input.value = initialUrl;
        }
        input.focus();
      },
    });
  }

  async loadGTFSFromURL(url: string) {
    try {
      console.log('Loading GTFS from URL:', url);

      this.scheduleController?.resetForNewFeed();

      const { unknownFiles } = await this.gtfsParser!.parseFromURL(url);
      if (unknownFiles.length > 0) {
        notify.warning(
          `Preserving ${unknownFiles.length} unrecognized file(s) for export: ${unknownFiles.join(', ')}`
        );
      }

      // Update UI
      this.updateFileList();
      await this.mapController!.updateMap();

      // Refresh Objects navigation if available
      if (this.browseNavigation) {
        await navigateToHome();
        this.browseNavigation.refresh();
      }

      // Run validation if callback is available
      if (this.validateCallback) {
        this.validateCallback();
      }

      // Update map tool button states
      this.updateMapToolButtonState();

      notify.success('Successfully loaded GTFS from URL');
    } catch (error) {
      console.error('Error loading GTFS from URL:', error);

      notify.error('Failed to load feed', {
        autoHide: false,
        actions: [
          {
            id: 'more-info',
            label: 'More Info',
            handler: () => showURLErrorModal(url, error as Error),
          },
        ],
      });
    }
  }

  updateFileList() {
    const fileList = document.getElementById('file-list')!;
    fileList.innerHTML = '';

    // Get categorized files
    const { required, optional, other } = this.gtfsParser!.categorizeFiles();
    // Create DaisyUI menu structure
    const menu = document.createElement('ul');
    menu.className = 'menu w-full';

    // Add required files section
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

    // Add optional files section
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

    // Add other files section (only if populated, since empty feeds have no "other" files)
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
  }

  addFileItem(container: HTMLElement, fileName: string, isRequired: boolean) {
    const listItem = document.createElement('li');

    const link = document.createElement('a');
    link.className = `flex justify-between items-center ${isRequired ? 'file-required' : ''}`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = fileName;
    link.appendChild(nameSpan);

    // Add record count if available
    const data = this.gtfsParser!.getFileDataSync(fileName);
    if (data) {
      const count = Array.isArray(data) ? data.length : 1;
      const countSpan = document.createElement('span');
      countSpan.className = 'badge badge-neutral badge-sm';
      countSpan.textContent = `${count}`;
      link.appendChild(countSpan);
    }

    link.addEventListener('click', async (event) => {
      event.preventDefault();
      await this.openFile(fileName, event.currentTarget as HTMLElement);
    });

    listItem.appendChild(link);
    container.appendChild(listItem);
  }

  async openFile(fileName: string, clickedElement: HTMLElement | null = null) {
    if (!this.gtfsParser!.getAllFileNames().includes(fileName)) {
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
      this.mapController!.highlightFileData(fileName);
    }
  }

  // Method expected by Objects Navigation interface
  showFileInEditor(filename: string, rowId?: string): void {
    // Open the Files modal
    (document.getElementById('files-modal') as HTMLDialogElement)?.showModal();

    // Open the file in the editor
    this.openFile(filename);

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

  async showFileEditor(fileName: string) {
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
      await this.editor!.openFile(fileName);
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
    objectType: string,
    objectData: Record<string, string | undefined>,
    relatedObjects: Record<string, string | undefined>[] = [],
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
        if (objectData.stop_name || objectData.stop_id) {
          objectName = renderOptionLabel(
            getStopDisplay(objectData as Record<string, string>)
          );
        } else {
          objectName = objectData.name || objectData.id || 'Unknown';
        }
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

  ensureObjectDetailsStructure(detailsView: HTMLElement) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  populateObjectProperties(objectData: any) {
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
      inputEl.value = value !== null ? String(value) : '';
      inputEl.dataset.property = key;

      propertyEl.appendChild(labelEl);
      propertyEl.appendChild(inputEl);
      container.appendChild(propertyEl);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  populateRelatedObjects(relatedObjects: any[]) {
    const container = document.getElementById('related-browse');
    const headerEl =
      document.querySelector('#related-objects')?.previousElementSibling;

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
        iconEl.textContent = '';

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        obj.relatedObjects.forEach((route: any) => {
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            route.relatedObjects.forEach((service: any) => {
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
            if (route.routeAction) {
              const route_id = route.data.id || route.data.route_id;
              if (route_id) {
                navigateToRoute(route_id);
              }
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
          if (obj.agencyAction) {
            const agency_id = obj.data.id || obj.data.agency_id;
            if (agency_id) {
              navigateToAgency(agency_id);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        obj.relatedObjects.forEach((trip: any) => {
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
          if (obj.routeAction) {
            const route_id = obj.data.route_id || obj.data.id;
            if (route_id) {
              navigateToRoute(route_id);
            }
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
          } else if (obj.agencyAction) {
            // Navigate to agency view to show routes
            const agency_id = obj.data.id || obj.data.agency_id;
            if (agency_id) {
              navigateToAgency(agency_id);
            }
          } else if (obj.routeAction && obj.route_id) {
            // Navigate to route view to show services
            navigateToRoute(obj.route_id);
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
      this.scheduleController?.resetForNewFeed();
      await this.gtfsParser!.initializeEmpty();
      this.updateFileList();
      await this.mapController!.updateMap();

      // Show files tab
      this.showFileList();

      // Clear editor
      this.editor!.clearEditor();

      // Refresh Objects navigation if available
      if (this.browseNavigation) {
        await navigateToHome();
        this.browseNavigation.refresh();
      }

      // Run validation if callback is available
      if (this.validateCallback) {
        this.validateCallback();
      }

      notify.success('New empty GTFS feed created.');
    } catch (error) {
      console.error('Error creating new GTFS feed:', error);
      notify.error(
        `Failed to create new GTFS feed: ${(error as Error).message}`
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
          .some((f) => (this.gtfsParser!.getFileDataSync(f)?.length ?? 0) > 0)
      ) {
        notify.warning('No GTFS data to export. Please add some data first.');
        return;
      }

      console.log('Exporting GTFS data...');

      // Show loading notification
      loadingNotificationId = notify.loading('Preparing GTFS export...');

      // Save current file changes
      this.editor!.saveCurrentFileChanges();

      // Generate ZIP blob
      const blob = await this.gtfsParser!.exportAsZip();

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
        notify.removeNotification(loadingNotificationId);
      }
      notify.success('GTFS data exported successfully!');
    } catch (error) {
      console.error('Error exporting GTFS:', error);

      // Remove loading notification
      if (loadingNotificationId) {
        notify.removeNotification(loadingNotificationId);
      }

      notify.error(`Failed to export GTFS data: ${(error as Error).message}`);
    }
  }

  /**
   * Set up map controller callbacks
   */
  setupMapCallbacks() {
    if (this.mapController) {
      // Set up mode change callback to update UI
      this.mapController.setModeChangeCallback(() => {
        this.updateMapToolButtonState();
      });
      // Update pathway button when station expand state changes
      this.mapController.setCallbacks({
        onStationExpandChange: () => {
          this.updateMapToolButtonState();
        },
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

    // Toggle the mode
    this.mapController.toggleAddStopMode();

    // Update button state
    this.updateMapToolButtonState();
  }

  /**
   * Toggle add pathway mode on the map
   */
  toggleAddPathwayMode() {
    if (!this.mapController) {
      console.warn('Map controller not initialized');
      return;
    }
    this.mapController.toggleAddPathwayMode();
    this.updateMapToolButtonState();
  }

  /**
   * Update the map tool button states based on current map mode
   */
  updateMapToolButtonState() {
    if (!this.mapController) {
      return;
    }
    const mode = this.mapController.getCurrentMode();
    const pointerBtn = document.getElementById('pointer-btn');
    const addStopBtn = document.getElementById('add-stop-btn');
    const addPathwayBtn = document.getElementById(
      'add-pathway-btn'
    ) as HTMLButtonElement | null;
    pointerBtn?.classList.toggle('btn-primary', mode === MapMode.NAVIGATE);
    addStopBtn?.classList.toggle('btn-primary', mode === MapMode.ADD_STOP);
    if (addPathwayBtn) {
      const hasExpandedStation = !!this.mapController.getExpandedStationId();
      addPathwayBtn.disabled = !hasExpandedStation;
      addPathwayBtn.classList.toggle(
        'btn-primary',
        mode === MapMode.ADD_PATHWAY
      );
    }
  }
}
