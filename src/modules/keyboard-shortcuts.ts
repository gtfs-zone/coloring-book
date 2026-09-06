import { notify } from './notification-system.js';
import { isOutsideTopModal } from './modal-utils.js';

export class KeyboardShortcuts {
  private gtfsEditor: {
    uiController: {
      exportGTFS: () => void;
      openLoadModal: (initialUrl?: string) => Promise<void>;
    };
    mapController?: {
      clearHighlights: () => void;
    };
    searchController?: {
      clearSearch: () => void;
    };
    patchManager?: {
      undo: () => Promise<void>;
      redo: () => Promise<void>;
    };
    tabLock?: {
      isActive(): boolean;
    };
  };
  private shortcuts: Map<
    string,
    { handler: (e?: Event) => void; description: string }
  >;
  private initialized: boolean;
  private showHelpHandler?: () => void;

  constructor(gtfsEditor: {
    uiController: {
      exportGTFS: () => void;
      openLoadModal: (initialUrl?: string) => Promise<void>;
    };
    mapController?: {
      clearHighlights: () => void;
    };
    searchController?: {
      clearSearch: () => void;
    };
    patchManager?: {
      undo: () => Promise<void>;
      redo: () => Promise<void>;
    };
    tabLock?: {
      isActive(): boolean;
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
      'ctrl+o',
      (e) => {
        e?.preventDefault();
        void this.gtfsEditor.uiController.openLoadModal();
      },
      'Open the load feed dialog'
    );

    this.addShortcut(
      'ctrl+e',
      (e) => {
        e?.preventDefault();
        this.gtfsEditor.uiController.exportGTFS();
      },
      'Export GTFS feed'
    );

    // Navigation
    this.addShortcut(
      'f1',
      (e) => {
        e?.preventDefault();
        this.showHelp();
      },
      'Show guide'
    );

    this.addShortcut(
      'ctrl+f',
      (e) => {
        e?.preventDefault();
        this.focusMapSearch();
      },
      'Focus map search'
    );

    this.addShortcut(
      'escape',
      () => {
        this.clearSearches();
      },
      'Clear searches'
    );

    // Undo / redo
    this.addShortcut(
      'ctrl+z',
      (e) => {
        e?.preventDefault();
        this.gtfsEditor.patchManager
          ?.undo()
          .catch((e: unknown) =>
            notify.error(
              `Undo failed: ${e instanceof Error ? e.message : String(e)}`
            )
          );
      },
      'Undo last edit'
    );

    this.addShortcut(
      'ctrl+shift+z',
      (e) => {
        e?.preventDefault();
        this.gtfsEditor.patchManager
          ?.redo()
          .catch((e: unknown) =>
            notify.error(
              `Redo failed: ${e instanceof Error ? e.message : String(e)}`
            )
          );
      },
      'Redo last undone edit'
    );
  }

  addShortcut(keys: string, handler: (e?: Event) => void, description: string) {
    this.shortcuts.set(keys, { handler, description });
  }

  bindEventListeners() {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.gtfsEditor.tabLock && !this.gtfsEditor.tabLock.isActive()) {
        return;
      }
      // A modal on top owns the keyboard. Keyed on the target rather than on
      // "any modal is open" so the shortcuts still work inside a modal that
      // hosts real content, like the timetable.
      if (isOutsideTopModal(e.target)) {
        return;
      }
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

        // Allow some shortcuts even in input fields. Undo and redo are not on
        // this list: inside a text field or CodeMirror the native undo stack is
        // what the user means.
        const allowInInputFields = ['escape', 'f1'];

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

  setShowHelpHandler(fn: () => void): void {
    this.showHelpHandler = fn;
  }

  showHelp() {
    this.showHelpHandler?.();
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

    // Clear map highlights
    if (this.gtfsEditor.mapController) {
      this.gtfsEditor.mapController.clearHighlights();
    }

    // Clear search controller
    if (this.gtfsEditor.searchController) {
      this.gtfsEditor.searchController.clearSearch();
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
