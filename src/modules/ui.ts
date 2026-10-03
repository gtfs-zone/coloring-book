import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { showLoadModal } from 'gtfs-zone-web-common/ui/load-modal';
import { showFilesModal } from './files-modal';
import type { ContinueOffer } from 'gtfs-zone-web-common/ui/load-modal';
import type { FeedSelection } from 'gtfs-zone-web-common/gtfs/feed-selection';
import { resolvedScheduledUrl } from 'gtfs-zone-web-common/gtfs/feed-selection';
import { navigateToHome } from './navigation-actions';
import { GTFS_TABLES } from '../types/gtfs';
import { MapMode, MapController } from './map-controller';
import {
  syncAutoZoomControl,
  wireAutoZoomControl,
} from 'gtfs-zone-web-common/map/auto-zoom';
import { GTFSParser } from './gtfs-parser';
import { LoadCancelledError } from 'gtfs-zone-web-common/gtfs/feed-download';
import { Editor } from './editor';
import { BrowseNavigation } from './browse-navigation';
import { buildExportFilename } from '../utils/export-filename';
import { runWhenIdle } from '../utils/run-when-idle';
import { showHelpPageOnce } from 'gtfs-zone-web-common/ui/help-modal';
import type { PatchManager } from './patch-manager';
import { GTFSSchemas } from '../types/gtfs';
import { generateFieldConfigsFromSchema } from '../utils/field-component';
import {
  closeDraft,
  openDraft,
  openFieldForEdit,
  readDraft,
  renderInlineEditableField,
} from '../utils/inline-editable-field';
import { flushInlineEdits } from '../utils/inline-edit';
import { t } from '../i18n/messages';
import { formatNumber } from 'gtfs-zone-web-common/i18n/fmt';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showURLErrorModal(url: string, error: Error) {
  showModal({
    title: t('load.urlErrorTitle'),
    body: `
      <p><code class="break-all whitespace-pre-wrap">${escapeHtml(error.message)}</code></p>
      <p>${t('load.attemptedUrl', { link: `<a href="${url}" target="_blank" rel="noopener" class="link">${escapeHtml(url)}</a>` })}</p>
      <p class="text-sm text-base-content/60">${t('load.corsHint')}</p>
    `,
    enterAction: 0,
    escapeAction: 0,
    actions: [{ label: t('common.close'), onClick: () => {} }],
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
  private patchManager: PatchManager | null = null;

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

  setPatchManager(pm: PatchManager): void {
    this.patchManager = pm;
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
            t('load.mapUpdateFailed', {
              message: error instanceof Error ? error.message : String(error),
            })
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
        throw new Error(t('load.notZip'));
      }

      // Parse the file
      const { unknownFiles } = await this.gtfsParser!.parseFile(file);
      if (unknownFiles.length > 0) {
        notify.warning(
          t('load.preservingUnknown', {
            count: unknownFiles.length,
            files: unknownFiles.join(', '),
          })
        );
      }

      await this.refreshAfterFeedSwap({ navigateHome: true });

      // Populate the file list without opening the Files modal
      this.showFileList();

      notify.success(t('load.loadedFile', { name: file.name }));

      console.timeEnd('[GTFS] loadGTFSFile total');
    } catch (error) {
      // A cancelled load leaves whatever feed was already loaded untouched.
      if (error instanceof LoadCancelledError) {
        notify.info(t('common.loadCancelled'));
        return;
      }
      console.error('Error loading GTFS file:', error);

      // Show error notification with helpful message
      const errorMessage = (error as Error).message
        ? t('load.fileFailedReason', { message: (error as Error).message })
        : t('load.fileFailed');

      notify.error(errorMessage, {
        actions: [
          {
            id: 'retry',
            label: t('load.tryAgain'),
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
            label: t('load.linkedFeed'),
          },
          realtime: null,
        }
      : this.currentSelection;

    const result = await showLoadModal(seed, {
      realtime: false,
      extraActions: [
        {
          label: t('load.newEmpty'),
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
          label: t('load.newEmpty'),
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
          t('load.preservingUnknown', {
            count: unknownFiles.length,
            files: unknownFiles.join(', '),
          })
        );
      }

      await this.refreshAfterFeedSwap({ navigateHome: true });

      notify.success(t('load.loadedUrl'));
    } catch (error) {
      // A cancelled load leaves whatever feed was already loaded untouched.
      if (error instanceof LoadCancelledError) {
        notify.info(t('common.loadCancelled'));
        return;
      }
      console.error('Error loading GTFS from URL:', error);

      notify.error(t('load.urlErrorTitle'), {
        autoHide: false,
        actions: [
          {
            id: 'more-info',
            label: t('load.moreInfo'),
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
    requiredHeader.textContent = t('files.required');
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
    optionalHeader.textContent = t('files.optional');
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
      additionalHeader.textContent = t('files.additional');
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
      lineSpan.textContent = t('files.lines', { count: lines });
      link.appendChild(lineSpan);
    } else {
      // Add record count if available
      const data = this.gtfsParser!.getFileDataSync(fileName);
      if (data) {
        const count = Array.isArray(data) ? data.length : 1;
        const countSpan = document.createElement('span');
        countSpan.className = 'badge badge-neutral badge-sm';
        countSpan.textContent = formatNumber(count);
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
      currentFileNameEl.textContent = t('common.none');
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

      notify.success(t('load.emptyCreated'));

      await showHelpPageOnce('getting-started');
    } catch (error) {
      console.error('Error creating new GTFS feed:', error);
      notify.error(
        t('load.emptyFailed', { message: (error as Error).message })
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

  /**
   * Ask for a new feed_version when it still matches the imported one.
   *
   * Resolves true to go on with the export, false when cancelled. A feed with
   * no feed_info row exports without asking.
   */
  private async confirmFeedVersion(): Promise<boolean> {
    const db = this.gtfsParser!.gtfsDatabase;
    const feedInfo = await db.getAllRows('feed_info');
    if (feedInfo.length === 0) {
      return true;
    }
    const current = String(feedInfo[0].feed_version ?? '');
    const imported = await db.getImportFeedVersion();
    if (imported !== null && current !== imported) {
      return true;
    }

    const config = generateFieldConfigsFromSchema(
      GTFSSchemas[GTFS_TABLES.FEED_INFO],
      feedInfo[0],
      GTFS_TABLES.FEED_INFO
    ).find((c) => c.field === 'feed_version');
    if (!config) {
      throw new Error('[UI] feed_info has no feed_version field');
    }
    const draftId = 'export-feed-version';
    const errorId = 'export-feed-version-error';
    const field = await renderInlineEditableField({ ...config, draftId });
    openDraft(draftId, { feed_version: current });

    let proceed = false;
    const showError = (message: string) => {
      const el = document.getElementById(errorId);
      if (el) {
        el.textContent = message;
        el.classList.remove('hidden');
      }
    };
    await showModal({
      title: t('export.versionTitle'),
      body: `
        <div class="space-y-3" data-export-feed-version>
          <p class="text-sm">${t('export.versionBody')}</p>
          ${field}
          <p id="${errorId}" class="text-error text-sm hidden"></p>
        </div>
      `,
      enterAction: 0,
      escapeAction: 2,
      onMount: () => {
        const container = document.querySelector('[data-export-feed-version]');
        if (container) {
          openFieldForEdit(container, 'feed_version');
        }
      },
      actions: [
        {
          label: t('export.saveAndExport'),
          className: 'btn-primary',
          onClick: async () => {
            await flushInlineEdits();
            const draft = readDraft(draftId);
            if (draft.errors.feed_version) {
              showError(draft.errors.feed_version);
              return true;
            }
            const next = String(draft.values.feed_version ?? '');
            if (next === current) {
              showError(t('export.versionUnchanged'));
              return true;
            }
            if (!this.patchManager) {
              throw new Error('[UI] no patch manager to record feed_version');
            }
            await this.patchManager.recordUpdate(
              'feed_info',
              'feed_info',
              { feed_version: current },
              { feed_version: next }
            );
            console.log(
              `[UI] Export: feed_version "${current}" -> "${next}", exporting`
            );
            proceed = true;
            return false;
          },
        },
        {
          label: t('export.anyway'),
          onClick: () => {
            console.log(
              `[UI] Export: feed_version "${current}" kept, exporting anyway`
            );
            proceed = true;
          },
        },
        {
          label: t('common.cancel'),
          className: 'btn-ghost',
          onClick: () => {
            console.log('[UI] Export: cancelled at the feed_version prompt');
          },
        },
      ],
    });
    closeDraft(draftId);
    return proceed;
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
        notify.warning(t('export.noData'));
        return;
      }

      // Save current file changes
      this.editor!.saveCurrentFileChanges();

      if (!(await this.confirmFeedVersion())) {
        return;
      }

      console.log('Exporting GTFS data...');

      // Show loading notification
      loadingNotificationId = notify.loading(t('export.preparing'));

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
      notify.success(t('export.done'));

      await showHelpPageOnce('publishing');
    } catch (error) {
      console.error('Error exporting GTFS:', error);

      // Remove loading notification
      if (loadingNotificationId) {
        notify.removeNotification(loadingNotificationId);
      }

      notify.error(t('export.failed', { message: (error as Error).message }));
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
            ? t('shell.addPathwayActive')
            : hasExpandedStation
              ? t('shell.addPathway')
              : t('shell.addPathwayExpand')
        );
      }
    }
  }
}
