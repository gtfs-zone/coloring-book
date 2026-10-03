/**
 * The Files browser: the raw table-by-table view of the feed.
 *
 * The body markup used to live in `index.html` as a static `<dialog>`. It is
 * built here instead so the modal goes through `showModal` like every other
 * modal, gaining the focus trap, the modal stack's Escape ordering and
 * backdrop-click close. Element ids are unchanged: `ui.ts` and `editor.ts`
 * drive the panes by id.
 */

import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';

const filesModalBody = (): string => `
  <div class="flex flex-col h-full min-h-0">
    <div class="alert alert-warning text-sm mb-3 shrink-0">
      <span>${t('files.warning')}</span>
    </div>

    <!-- File List View -->
    <div id="file-list-view" class="flex-1 min-h-0">
      <div id="file-list" class="overflow-y-auto h-full"></div>
    </div>

    <!-- File Editor View -->
    <div id="file-editor-view" class="flex-1 min-h-0 hidden">
      <div class="h-full flex flex-col">
        <!-- Editor Header -->
        <div class="flex items-center gap-4 pb-3 border-b border-base-300 shrink-0">
          <button id="back-to-files" class="btn btn-ghost btn-sm">${escapeHtml(t('files.back'))}</button>
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium opacity-70">${t('files.editing')}</span>
            <span id="current-file-name" class="text-sm font-medium">${t('common.none')}</span>
          </div>
        </div>

        <!-- Editor Content -->
        <div class="flex-1 min-h-0 overflow-hidden">
          <div id="table-editor-view" class="h-full hidden">
            <div id="table-container" class="h-full overflow-auto">
              <div id="table-editor" class="h-full"></div>
            </div>
          </div>
          <!-- Raw text editor for non-spec passthrough files -->
          <!-- The flex column is a child, so the wrapper's hidden class is not
               fighting a display:flex on the same element. -->
          <div id="raw-editor-view" class="h-full hidden">
            <div class="h-full flex flex-col">
              <div class="py-2 text-xs opacity-70 border-b border-base-300 shrink-0">
                ${t('files.rawNote')}
              </div>
              <textarea
                id="raw-editor"
                class="textarea textarea-bordered flex-1 my-3 font-mono text-xs leading-relaxed"
                spellcheck="false"
              ></textarea>
              <div class="flex items-center gap-3 shrink-0">
                <button id="raw-editor-save" class="btn btn-primary btn-sm">${t('common.save')}</button>
                <span id="raw-editor-status" class="text-xs opacity-70"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

/**
 * `onMount` fills the panes; `onClose` runs once the modal is gone, for the
 * editor cleanup that must not outlive the DOM it points at.
 */
export async function showFilesModal(handlers: {
  onMount: () => void;
  onClose: () => void | Promise<void>;
}): Promise<void> {
  await showModal({
    title: t('files.title'),
    body: filesModalBody(),
    actions: [{ label: t('common.close'), onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-4xl w-11/12 h-[85vh]',
    onMount: handlers.onMount,
  });
  await handlers.onClose();
}
