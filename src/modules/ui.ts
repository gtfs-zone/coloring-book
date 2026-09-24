import { notify } from 'interlocking/ui/notification-system';
import { showModal, renderChevronIcon } from 'interlocking/ui/modal-utils';
import { showLoadModal } from 'interlocking/ui/load-modal';
import { showFilesModal } from './files-modal';
import type { ContinueOffer } from 'interlocking/ui/load-modal';
import type { FeedSelection } from 'interlocking/gtfs/feed-selection';
import { resolvedScheduledUrl } from 'interlocking/gtfs/feed-selection';
import {
  getAgencyFieldDescription,
  getRouteFieldDescription,
  getCalendarFieldDescription,
  createTooltip,
  getSchemaFieldName,
} from '../utils/zod-tooltip-helper';
import {
  openTimetable,
  navigateToHome,
  navigateToAgency,
  navigateToRoute,
} from './navigation-actions';
import { GTFS_TABLES } from '../types/gtfs';
import { MapMode, MapController } from './map-controller';
import {
  syncAutoZoomControl,
  wireAutoZoomControl,
} from 'interlocking/map/auto-zoom';
import { GTFSParser } from './gtfs-parser';
import { LoadCancelledError } from 'interlocking/gtfs/feed-download';
import { Editor } from './editor';
import { BrowseNavigation } from './browse-navigation';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display';
import { buildExportFilename } from '../utils/export-filename';
import { runWhenIdle } from '../utils/run-when-idle';
import { showHelpPageOnce } from 'interlocking/ui/help-modal';

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
  /**
   * What the load modal last produced. Kept only so reopening the modal seeds
   * from it; the feed itself lives in IndexedDB, not here.
   */
  currentSelection: FeedSelection | null;
  /** Cancels a map update scheduled for a feed that has since been replaced. */
  private cancelPendingMapUpdate: (() => void) | null = null;

  constructor() {
    this.gtfsParser = null;
    this.editor = null;
    this.mapController = null;
    this.browseNavigation = null;
    this.currentSelection = null;
  }

  initialize(
    gtfsParser: GTFSParser,
    editor: Editor,
    mapController: MapController,
    browseNavigation: BrowseNavigation
  ) {
    this.gtfsParser = gtfsParser;
    this.editor = editor;
    this.mapController = mapController;
    this.browseNavigation = browseNavigation;
    this.setupEventListeners();
    this.setupMapCallbacks();
    // Boot paths other than a fresh load never touch the tool buttons, so the
    // persisted auto-zoom state has to be applied here.
    this.updateMapToolButtonState();
  }

  setupEventListeners() {
    // Load button: one modal covering examples, the published feed catalogs, a
    // hand-typed URL, and file upload.
    document.getElementById('load-btn')?.addEventListener('click', () => {
      void this.openLoadModal();
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

    // Auto-zoom toggle
    if (this.mapController) {
      wireAutoZoomControl(this.mapController.getAutoZoom());
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
      void this.openFilesModal();
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

  /**
   * Build the map for the feed just loaded, off the load's critical path.
   *
   * The route build walks every shape point and every trip, so awaiting it
   * inline keeps the progress bar up long after the feed is usable. The
   * navigation refresh follows it because updateMap clears map focus.
   */
  private scheduleMapUpdate(): void {
    // A pending update belongs to the feed that scheduled it. Drop it rather
    // than let it wake up after the next feed has taken its place.
    this.cancelPendingMapUpdate?.();
    this.cancelPendingMapUpdate = runWhenIdle(() => {
      this.cancelPendingMapUpdate = null;
      console.time('[GTFS] updateMap');
      this.mapController!.updateMap()
        .then(async () => {
          await this.browseNavigation?.refresh();
          console.timeEnd('[GTFS] updateMap');
        })
        .catch((error: unknown) =>
          notify.error(
            `Failed to update map: ${error instanceof Error ? error.message : String(error)}`
          )
        );
    });
  }

  /**
   * Bring the UI onto the feed that was just installed.
   *
   * The one post-swap refresh: a file load, a URL load and the boot restore all
   * run it, so the three cannot drift apart. Boot passes `navigateHome: false`
   * because its page state comes from the URL and navigating home would discard
   * a deep link.
   */
  async refreshAfterFeedSwap(
    options: { navigateHome?: boolean } = {}
  ): Promise<void> {
    console.time('[GTFS] updateFileList');
    this.updateFileList();
    console.timeEnd('[GTFS] updateFileList');

    this.scheduleMapUpdate();

    if (this.browseNavigation) {
      if (options.navigateHome) {
        await navigateToHome();
      }
      await this.browseNavigation.refresh();
    }

    this.updateMapToolButtonState();
  }

  async loadGTFSFile(file: File) {
    try {
      console.log('Loading GTFS file:', file.name);

      console.time('[GTFS] loadGTFSFile total');

      // Validate file type
      if (!file.name.toLowerCase().endsWith('.zip')) {
        throw new Error('Please upload a ZIP file containing GTFS data');
      }

      // Parse the file
      const { unknownFiles } = await this.gtfsParser!.parseFile(file);
      if (unknownFiles.length > 0) {
        notify.warning(
          `Preserving ${unknownFiles.length} unrecognized file(s) for export: ${unknownFiles.join(', ')}`
        );
      }

      await this.refreshAfterFeedSwap({ navigateHome: true });

      // Populate the file list without opening the Files modal
      this.showFileList();

      notify.success(`Successfully loaded GTFS file: ${file.name}`);

      console.timeEnd('[GTFS] loadGTFSFile total');
    } catch (error) {
      // A cancelled load leaves whatever feed was already loaded untouched.
      if (error instanceof LoadCancelledError) {
        notify.info('Load cancelled');
        return;
      }
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

  /**
   * The single entry point into a feed.
   *
   * `initialUrl` seeds the scheduled field, which is how `#load=<url>` arrives:
   * the URL is offered for review rather than fetched behind the user's back.
   * Otherwise the modal opens on whatever is currently loaded, so reopening it
   * is also how you edit a feed's URL.
   */
  async openLoadModal(initialUrl?: string) {
    const seed: FeedSelection | null = initialUrl
      ? {
          scheduled: {
            kind: 'url',
            url: initialUrl,
            useCors: true,
            label: 'Linked feed',
          },
          realtime: null,
        }
      : this.currentSelection;

    const result = await showLoadModal(seed, {
      realtime: false,
      extraActions: [
        {
          label: 'New Empty Feed',
          className: 'btn-ghost',
          onClick: () => {
            void this.createNewFeed();
          },
        },
      ],
    });

    if (result?.kind === 'selection') {
      await this.loadSelection(result.selection);
    }
  }

  /**
   * The boot screen: the same modal, led by the stored feed.
   *
   * Returns what the caller has to do next, because only boot knows how to
   * hydrate the stored feed. Cancelling falls back to the stored feed when
   * there is one, and to a fresh empty feed when there is not: closing the
   * boot screen must never leave the app without a feed.
   */
  async openBootLoadModal(
    continueWith?: ContinueOffer
  ): Promise<'continue' | 'empty' | 'loaded'> {
    let emptyChosen = false;
    const result = await showLoadModal(null, {
      realtime: false,
      continueWith,
      extraActions: [
        {
          label: 'New Empty Feed',
          className: 'btn-ghost',
          onClick: () => {
            emptyChosen = true;
          },
        },
      ],
    });

    if (result?.kind === 'continue') {
      return 'continue';
    }
    if (emptyChosen) {
      return 'empty';
    }
    if (result?.kind === 'selection') {
      await this.loadSelection(result.selection);
      return 'loaded';
    }
    return continueWith ? 'continue' : 'empty';
  }

  /** Load whichever half of a selection this app cares about: the schedule. */
  async loadSelection(selection: FeedSelection) {
    this.currentSelection = selection;
    const src = selection.scheduled;
    if (!src) {
      return;
    }
    if (src.kind === 'file') {
      await this.loadGTFSFile(src.file);
    } else {
      await this.loadGTFSFromURL(resolvedScheduledUrl(src));
    }
  }

  async loadGTFSFromURL(url: string) {
    try {
      console.log('Loading GTFS from URL:', url);

      const { unknownFiles } = await this.gtfsParser!.parseFromURL(url);
      if (unknownFiles.length > 0) {
        notify.warning(
          `Preserving ${unknownFiles.length} unrecognized file(s) for export: ${unknownFiles.join(', ')}`
        );
      }

      await this.refreshAfterFeedSwap({ navigateHome: true });

      notify.success('Successfully loaded GTFS from URL');
    } catch (error) {
      // A cancelled load leaves whatever feed was already loaded untouched.
      if (error instanceof LoadCancelledError) {
        notify.info('Load cancelled');
        return;
      }
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

  /**
   * Open the Files modal on the list, optionally jumping straight to a file.
   *
   * The body is rebuilt on every open, so everything that hangs off it - the
   * list, the back button - is wired here rather than once at startup.
   */
  async openFilesModal(initialFile?: string): Promise<void> {
    await showFilesModal({
      onMount: () => {
        this.updateFileList();
        // Always open on the list, never a stale editor view from last time
        this.showFileList();

        document
          .getElementById('back-to-files')
          ?.addEventListener('click', () => {
            this.showFileList();
          });

        if (initialFile) {
          void this.openFile(initialFile);
        }
      },
      // The DOM the editor points at is gone by now: flush pending row writes
      // and drop the Clusterize instance.
      onClose: () => this.editor!.closeEditor(),
    });
  }

  updateFileList() {
    // Skipped while the Files modal is closed: a feed swap refreshes the list
    // too, and the list only exists inside the open modal.
    const fileList = document.getElementById('file-list');
    if (!fileList) {
      return;
    }
    fileList.innerHTML = '';

    // Get categorized files
    const { required, optional, additional } =
      this.gtfsParser!.categorizeFiles();
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

    // Non-spec files carried through from the imported ZIP, if any
    if (additional.length > 0) {
      const additionalSection = document.createElement('li');
      const additionalHeader = document.createElement('div');
      additionalHeader.className = 'menu-title';
      additionalHeader.textContent = 'Additional Files';
      additionalSection.appendChild(additionalHeader);

      const additionalList = document.createElement('ul');
      additional.forEach((fileName) => {
        this.addFileItem(additionalList, fileName, false);
      });
      additionalSection.appendChild(additionalList);
      menu.appendChild(additionalSection);
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

    // Passthrough files have no table, so count lines instead of records
    const passthrough = this.gtfsParser!.getPassthroughContent(fileName);
    if (passthrough !== undefined) {
      const lines = passthrough
        .split('\n')
        .filter((l) => l.trim() !== '').length;
      const lineSpan = document.createElement('span');
      lineSpan.className = 'badge badge-ghost badge-sm';
      lineSpan.textContent = `${lines} lines`;
      link.appendChild(lineSpan);
    } else {
      // Add record count if available
      const data = this.gtfsParser!.getFileDataSync(fileName);
      if (data) {
        const count = Array.isArray(data) ? data.length : 1;
        const countSpan = document.createElement('span');
        countSpan.className = 'badge badge-neutral badge-sm';
        countSpan.textContent = `${count}`;
        link.appendChild(countSpan);
      }
    }

    link.addEventListener('click', async (event) => {
      event.preventDefault();
      await this.openFile(fileName, event.currentTarget as HTMLElement);
    });

    listItem.appendChild(link);
    container.appendChild(listItem);
  }

  async openFile(fileName: string, clickedElement: HTMLElement | null = null) {
    const isPassthrough =
      this.gtfsParser!.getPassthroughContent(fileName) !== undefined;
    if (
      !isPassthrough &&
      !this.gtfsParser!.getAllFileNames().includes(fileName)
    ) {
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
    void this.openFilesModal(filename);

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

    // Drop the last-opened-file state so the list reads as a clean slate
    document
      .getElementById('file-list')
      ?.querySelectorAll('a.menu-active')
      .forEach((item) => item.classList.remove('menu-active'));

    const currentFileNameEl = document.getElementById('current-file-name');
    if (currentFileNameEl) {
      currentFileNameEl.textContent = 'None';
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
        chevronEl.className = 'inline-flex opacity-60 transition-transform';
        chevronEl.innerHTML = renderChevronIcon('h-3 w-3');

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
          routeChevronEl.className =
            'inline-flex opacity-60 transition-transform';
          routeChevronEl.innerHTML = renderChevronIcon('h-3 w-3');

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
                  openTimetable(
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
            } else {
              servicesEl.classList.add('hidden');
            }
            routeChevronEl.classList.toggle('rotate-180', isRouteExpanded);
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
          } else {
            routesEl.classList.add('hidden');
          }
          chevronEl.classList.toggle('rotate-180', isExpanded);
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
        chevronEl.className = 'inline-flex opacity-60 transition-transform';
        chevronEl.innerHTML = renderChevronIcon('h-3 w-3');

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
          } else {
            tripsEl.classList.add('hidden');
          }
          chevronEl.classList.toggle('rotate-180', isExpanded);
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
            openTimetable(
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

      notify.success('New empty GTFS feed created.');

      await showHelpPageOnce('getting-started');
    } catch (error) {
      console.error('Error creating new GTFS feed:', error);
      notify.error(
        `Failed to create new GTFS feed: ${(error as Error).message}`
      );
    }
  }

  /** Feed identity for the export filename: agency name, else feed publisher. */
  private getFeedName(): string | undefined {
    const agencies = this.gtfsParser?.getFileDataSync(GTFS_TABLES.AGENCY) ?? [];
    const agencyName = agencies[0]?.agency_name;
    if (typeof agencyName === 'string' && agencyName.trim()) {
      return agencyName;
    }

    const feedInfo =
      this.gtfsParser?.getFileDataSync(GTFS_TABLES.FEED_INFO) ?? [];
    const publisher = feedInfo[0]?.feed_publisher_name;
    return typeof publisher === 'string' && publisher.trim()
      ? publisher
      : undefined;
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
      a.download = buildExportFilename(this.getFeedName());
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Remove loading notification and show success
      if (loadingNotificationId) {
        notify.removeNotification(loadingNotificationId);
      }
      notify.success('GTFS data exported successfully!');

      await showHelpPageOnce('publishing');
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
    const addPathwayTooltip = document.getElementById('add-pathway-tooltip');
    pointerBtn?.classList.toggle('btn-primary', mode === MapMode.NAVIGATE);

    // Applies the persisted preference on boot as well as later toggles.
    syncAutoZoomControl(this.mapController.isAutoZoomEnabled());

    addStopBtn?.classList.toggle('btn-primary', mode === MapMode.ADD_STOP);
    if (addPathwayBtn) {
      const hasExpandedStation = !!this.mapController.getExpandedStationId();
      addPathwayBtn.disabled = !hasExpandedStation;
      addPathwayBtn.classList.toggle(
        'btn-primary',
        mode === MapMode.ADD_PATHWAY
      );
      if (addPathwayTooltip) {
        addPathwayTooltip.setAttribute(
          'data-tip',
          mode === MapMode.ADD_PATHWAY
            ? 'Click two stops to connect them'
            : hasExpandedStation
              ? 'Add pathway'
              : 'Add pathway (expand a station first)'
        );
      }
    }
  }
}
