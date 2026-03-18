export class KeyboardShortcuts {
  private gtfsEditor: {
    uiController: {
      createNewFeed: () => void;
      exportGTFS: () => void;
    };
    editor: {
      saveCurrentFileChanges: () => void;
    };
    mapController?: {
      clearHighlights: () => void;
    };
    searchController?: {
      clearSearch: () => void;
    };
    browseNavigation?: {
      searchQuery: string;
      render: () => void;
    };
    tabManager?: {
      switchToTab: (tabName: string) => void;
    };
  };
  private shortcuts: Map<
    string,
    { handler: (e?: Event) => void; description: string }
  >;
  private initialized: boolean;

  constructor(gtfsEditor: {
    uiController: {
      createNewFeed: () => void;
      exportGTFS: () => void;
    };
    editor: {
      saveCurrentFileChanges: () => void;
    };
    mapController?: {
      clearHighlights: () => void;
    };
    searchController?: {
      clearSearch: () => void;
    };
    browseNavigation?: {
      searchQuery: string;
      render: () => void;
    };
    tabManager?: {
      switchToTab: (tabName: string) => void;
    };
  }) {
    this.gtfsEditor = gtfsEditor;
    this.shortcuts = new Map();
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) {
      return;
    }

    this.setupShortcuts();
    this.bindEventListeners();
    this.initialized = true;
  }

  setupShortcuts() {
    // File operations
    this.addShortcut(
      'ctrl+n',
      () => {
        this.gtfsEditor.uiController.createNewFeed();
      },
      'Create new GTFS feed'
    );

    this.addShortcut(
      'ctrl+o',
      () => {
        document.getElementById('file-input')?.click();
      },
      'Upload GTFS file'
    );

    this.addShortcut(
      'ctrl+s',
      (e) => {
        e.preventDefault();
        this.gtfsEditor.editor.saveCurrentFileChanges();
      },
      'Save current file'
    );

    this.addShortcut(
      'ctrl+e',
      () => {
        this.gtfsEditor.uiController.exportGTFS();
      },
      'Export GTFS feed'
    );

    // Navigation
    this.addShortcut(
      'f1',
      (e) => {
        e.preventDefault();
        this.showHelp();
      },
      'Show help'
    );

    this.addShortcut(
      'ctrl+f',
      (e) => {
        e.preventDefault();
        this.focusMapSearch();
      },
      'Focus map search'
    );

    this.addShortcut(
      'escape',
      () => {
        this.clearSearches();
      },
      'Clear searches and close dialogs'
    );

    // Tab navigation
    this.addShortcut(
      'ctrl+1',
      () => {
        this.switchToTab('files');
      },
      'Switch to Files tab'
    );

    this.addShortcut(
      'ctrl+2',
      () => {
        this.switchToTab('browse');
      },
      'Switch to Browse tab'
    );

    this.addShortcut(
      'ctrl+3',
      () => {
        this.switchToTab('editor');
      },
      'Switch to Editor tab'
    );

    this.addShortcut(
      'ctrl+4',
      () => {
        this.switchToTab('info');
      },
      'Switch to Info tab'
    );

    this.addShortcut(
      'ctrl+5',
      () => {
        this.switchToTab('help');
      },
      'Switch to Help tab'
    );
  }

  addShortcut(keys: string, handler: (e?: Event) => void, description: string) {
    this.shortcuts.set(keys, { handler, description });
  }

  bindEventListeners() {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const key = this.getKeyString(e);
      const shortcut = this.shortcuts.get(key);

      if (shortcut) {
        // Don't trigger shortcuts if user is typing in an input field
        const activeElement = document.activeElement;
        const isInputField =
          activeElement &&
          (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            (activeElement as HTMLElement).contentEditable === 'true' ||
            activeElement.classList.contains('cm-content')); // CodeMirror editor

        // Allow some shortcuts even in input fields
        const allowInInputFields = ['escape', 'f1', 'ctrl+s'];

        if (!isInputField || allowInInputFields.includes(key)) {
          shortcut.handler(e);
        }
      }
    });
  }

  getKeyString(e: KeyboardEvent): string {
    const parts: string[] = [];

    if (e.ctrlKey || e.metaKey) {
      parts.push('ctrl');
    }
    if (e.altKey) {
      parts.push('alt');
    }
    if (e.shiftKey) {
      parts.push('shift');
    }

    const key = e.key.toLowerCase();

    // Handle special keys
    const specialKeys: Record<string, string> = {
      ' ': 'space',
      enter: 'enter',
      tab: 'tab',
      escape: 'escape',
      backspace: 'backspace',
      delete: 'delete',
      arrowup: 'up',
      arrowdown: 'down',
      arrowleft: 'left',
      arrowright: 'right',
    };

    parts.push(specialKeys[key] || key);

    return parts.join('+');
  }

  showHelp() {
    // Switch to help tab
    const helpTab = document.querySelector('[data-tab="help"]');
    if (helpTab && !helpTab.classList.contains('active')) {
      (helpTab as HTMLElement).click();
    }
  }

  focusMapSearch() {
    const mapSearch = document.getElementById('map-search');
    if (mapSearch) {
      mapSearch.focus();
      (mapSearch as HTMLInputElement).select();
    }
  }

  clearSearches() {
    // Clear map search
    const mapSearch = document.getElementById('map-search');
    if (mapSearch) {
      (mapSearch as HTMLInputElement).value = '';
      mapSearch.blur();
    }

    // Clear objects search
    const objectsSearch = document.getElementById('browse-search');
    if (objectsSearch) {
      (objectsSearch as HTMLInputElement).value = '';
    }

    // Clear map highlights
    if (this.gtfsEditor.mapController) {
      this.gtfsEditor.mapController.clearHighlights();
    }

    // Clear search controller
    if (this.gtfsEditor.searchController) {
      this.gtfsEditor.searchController.clearSearch();
    }

    // Clear objects navigation search
    if (this.gtfsEditor.browseNavigation) {
      this.gtfsEditor.browseNavigation.searchQuery = '';
      this.gtfsEditor.browseNavigation.render();
    }
  }

  switchToTab(tabName: string) {
    // Use TabManager for DaisyUI radio tabs
    if (this.gtfsEditor.tabManager) {
      this.gtfsEditor.tabManager.switchToTab(tabName);
    }
  }

  getShortcutsList() {
    const shortcuts: Array<{ key: string; description: string }> = [];
    for (const [key, { description }] of this.shortcuts) {
      shortcuts.push({ key: this.formatKeyForDisplay(key), description });
    }
    return shortcuts.sort((a, b) => a.description.localeCompare(b.description));
  }

  formatKeyForDisplay(keyString: string): string {
    return keyString
      .split('+')
      .map((part: string) => {
        const capitalizeMap: Record<string, string> = {
          ctrl: 'Ctrl',
          alt: 'Alt',
          shift: 'Shift',
          meta: 'Cmd',
          escape: 'Esc',
          enter: 'Enter',
          tab: 'Tab',
          space: 'Space',
          backspace: 'Backspace',
          delete: 'Delete',
        };
        return capitalizeMap[part] || part.toUpperCase();
      })
      .join('+');
  }

  destroy() {
    // Clean up event listeners if needed
    this.initialized = false;
  }
}
