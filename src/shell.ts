/**
 * Mounts the shared app shell. Imported first by `index.ts`, so the markup
 * exists before any other module is evaluated and looks up an element id.
 */

import { mountAppShell } from 'gtfs-zone-web-common/ui/app-shell';
import { t } from './i18n/messages';
import { introHtml } from './intro';

// Pointer, add-stop and add-pathway tools, beside the auto-zoom toggle.
const MAP_TOOLS = `
  <div class="card card-bordered bg-base-100 shadow-lg p-1 flex-shrink-0 pointer-events-auto">
    <div class="join">
      <button id="pointer-btn" class="btn btn-sm btn-square join-item btn-primary tooltip tooltip-bottom" data-tip="${t('shell.pointer')}">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 2l12 10-6 1-3 6L6 2z" />
        </svg>
      </button>
      <button id="add-stop-btn" class="btn btn-sm btn-square join-item tooltip tooltip-bottom" data-tip="${t('shell.addStop')}">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </button>
      <div class="tooltip tooltip-bottom join-item" id="add-pathway-tooltip" data-tip="${t('shell.addPathwayExpand')}">
        <button id="add-pathway-btn" class="btn btn-sm btn-square" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <circle cx="13.5" cy="4.5" r="1.75" stroke-width="2" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 7.5 11 12m0 0-2.5 8M11 12l4 4 .5 4m-2.7-10.8L8.5 10.5m4.7-2 3.8 2.5" />
          </svg>
        </button>
      </div>
    </div>
  </div>`;

document.title = t('app.title');

mountAppShell({
  brandPrefix: 'edit',
  brandSuffix: '.gtfs.zone',
  mapControlsExtra: MAP_TOOLS,
  panelPlaceholder: t('shell.noData'),
  dock: [
    { id: 'dock-browse', label: t('shell.browse'), active: true },
    { id: 'dock-files', label: t('shell.files') },
    { id: 'dock-timetable', label: t('shell.timetables') },
    { id: 'dock-changes', label: t('shell.history') },
  ],
});

// The static intro is the panel's content until the home page renders, and the
// only content when the map or the app fails to start.
const intro = document.getElementById('app-intro');
if (intro) {
  intro.innerHTML = introHtml();
  document.getElementById('panel-content')?.replaceChildren(intro);
}
