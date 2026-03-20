import { PatchManager } from './patch-manager.js';
import { GTFSPatch } from '../types/patch.js';

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  return `${Math.floor(diffHr / 24)}d ago`;
}

function labelFor(patch: GTFSPatch): string {
  const { source } = patch;
  const col = source.col ? ` (${source.col})` : '';
  return `${source.table} / ${source.id}${col}`;
}

function opBadgeClass(op: GTFSPatch['op']): string {
  if (op === 'insert') {
    return 'badge-success';
  }
  if (op === 'update') {
    return 'badge-warning';
  }
  return 'badge-error';
}

export class HistoryController {
  private patchManager!: PatchManager;

  initialize(patchManager: PatchManager): void {
    this.patchManager = patchManager;

    const rerender = () => {
      this.render().catch((e: unknown) =>
        console.error('HistoryController render failed:', e)
      );
    };

    patchManager.on('undo', rerender);
    patchManager.on('redo', rerender);
    patchManager.on('jump', rerender);
    patchManager.on('change', rerender);

    const radio = document.getElementById('changes-tab-radio');
    if (radio) {
      radio.addEventListener('change', rerender);
    }
  }

  async render(): Promise<void> {
    const panel = document.getElementById('changes-panel');
    if (!panel) {
      return;
    }

    const history = await this.patchManager.getHistory();
    const currentVersion = this.patchManager.version;

    if (history.length === 0) {
      panel.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 text-base-content/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-sm">No changes yet</span>
        </div>`;
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'divide-y divide-base-300';

    // Newest first
    for (let i = history.length - 1; i >= 0; i--) {
      const record = history[i];
      const { patch, timestamp, version, applied } = record;
      const isCurrent = version === currentVersion;

      const li = document.createElement('li');
      li.className = [
        'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-base-200 transition-colors',
        isCurrent ? 'bg-base-200 border-l-2 border-primary' : '',
      ].join(' ');

      const textClass = applied ? '' : 'opacity-50 line-through';

      li.innerHTML = `
        <div class="flex flex-col gap-1 min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="badge badge-sm ${opBadgeClass(patch.op)}">${patch.op}</span>
            <span class="text-xs truncate ${textClass}">${labelFor(patch)}</span>
          </div>
          <span class="text-xs text-base-content/40">${relativeTime(timestamp)}</span>
        </div>`;

      li.addEventListener('click', () => {
        if (version === undefined || version === null) {
          return;
        }
        this.patchManager
          .jumpToVersion(version)
          .catch((e: unknown) => console.error('jumpToVersion failed:', e));
      });

      ul.appendChild(li);
    }

    panel.replaceChildren(ul);
  }
}
