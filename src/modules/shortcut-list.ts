import { showHelpModal } from 'gtfs-zone-web-common/ui/help-modal';
import type { ShortcutCommand } from 'gtfs-zone-web-common/ui/keyboard-shortcuts';
import { t } from '../i18n/messages';

/**
 * This app's keyboard commands.
 *
 * `keyboard-shortcuts.ts` is shared across apps and holds no list of its own;
 * each app supplies one. The editor is read through on every keypress rather
 * than captured, because the list is built before the later modules exist.
 */
interface ShortcutHost {
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
}

export function editorShortcuts(host: ShortcutHost): ShortcutCommand[] {
  return [
    // File operations
    {
      keys: 'ctrl+o',
      description: t('shortcut.openLoad'),
      handler: (e) => {
        e?.preventDefault();
        return host.uiController.openLoadModal();
      },
    },
    {
      keys: 'ctrl+e',
      description: t('shortcut.export'),
      handler: (e) => {
        e?.preventDefault();
        host.uiController.exportGTFS();
      },
    },

    // Navigation
    {
      keys: 'f1',
      description: t('shortcut.guide'),
      allowInInputFields: true,
      handler: (e) => {
        e?.preventDefault();
        return showHelpModal('about');
      },
    },
    {
      keys: 'ctrl+f',
      description: t('shortcut.focusSearch'),
      handler: (e) => {
        e?.preventDefault();
        focusMapSearch();
      },
    },
    {
      keys: 'escape',
      description: t('shortcut.clearSearch'),
      allowInInputFields: true,
      handler: () => {
        clearSearches(host);
      },
    },

    // Undo / redo. Not allowed in input fields: inside a text field or
    // CodeMirror the native undo stack is what the user means.
    {
      keys: 'ctrl+z',
      description: t('shortcut.undo'),
      handler: (e) => {
        e?.preventDefault();
        return host.patchManager?.undo();
      },
    },
    {
      keys: 'ctrl+shift+z',
      description: t('shortcut.redo'),
      handler: (e) => {
        e?.preventDefault();
        return host.patchManager?.redo();
      },
    },
  ];
}

function focusMapSearch(): void {
  const mapSearch = document.getElementById('map-search');
  if (mapSearch) {
    mapSearch.focus();
    (mapSearch as HTMLInputElement).select();
  }
}

function clearSearches(host: ShortcutHost): void {
  const mapSearch = document.getElementById('map-search');
  if (mapSearch) {
    (mapSearch as HTMLInputElement).value = '';
    mapSearch.blur();
  }

  host.mapController?.clearHighlights();
  host.searchController?.clearSearch();
}
