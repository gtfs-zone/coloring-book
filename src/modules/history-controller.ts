import { PatchManager } from './patch-manager.js';
import { GTFSPatch } from '../types/patch.js';
import { humanLabel } from '../utils/patch-label.js';

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function opBadgeClass(op: GTFSPatch['op']): string {
  if (op === 'insert') {
    return 'badge-success';
  }
  if (op === 'update') {
    return 'badge-warning';
  }
  return 'badge-error';
}

function renderFieldDiffs(patch: GTFSPatch): string {
  if (patch.op === 'update') {
    const before = (patch.inverse as { changes: Record<string, unknown> })
      .changes;
    const after = (patch.forward as { changes: Record<string, unknown> })
      .changes;
    return Object.entries(before)
      .map(
        ([field, bVal]) =>
          `<div class="text-xs mt-0.5"><span class="opacity-60">${escHtml(field)}:</span> <span class="line-through opacity-50">"${escHtml(bVal)}"</span> → <span>"${escHtml(after[field])}"</span></div>`
      )
      .join('');
  }
  if (patch.op === 'insert') {
    const record = (patch.forward as { record: Record<string, unknown> })
      .record;
    const entries = Object.entries(record).slice(0, 4);
    const more =
      Object.keys(record).length > 4
        ? `<div class="text-xs opacity-50 mt-0.5">…</div>`
        : '';
    return (
      entries
        .map(
          ([field, val]) =>
            `<div class="text-xs mt-0.5"><span class="opacity-60">${escHtml(field)}:</span> "${escHtml(val)}"</div>`
        )
        .join('') + more
    );
  }
  if (patch.op === 'delete') {
    const record = (patch.inverse as { record: Record<string, unknown> })
      .record;
    const entries = Object.entries(record).slice(0, 4);
    const more =
      Object.keys(record).length > 4
        ? `<div class="text-xs opacity-50 mt-0.5">…</div>`
        : '';
    return (
      entries
        .map(
          ([field, val]) =>
            `<div class="text-xs mt-0.5"><span class="opacity-60">${escHtml(field)}:</span> "${escHtml(val)}"</div>`
        )
        .join('') + more
    );
  }
  return '';
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

    panel.innerHTML = '';

    if (history.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className =
        'flex flex-col items-center justify-center py-16 text-base-content/40';
      emptyDiv.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span class="text-sm">No changes yet</span>`;
      panel.appendChild(emptyDiv);
    } else {
      // Patch list — newest first
      const ul = document.createElement('ul');
      ul.className = 'divide-y divide-base-300';

      for (let i = history.length - 1; i >= 0; i--) {
        const record = history[i];
        const { patch, timestamp, version, applied } = record;
        const isCurrent = version === currentVersion;

        const li = document.createElement('li');
        li.className = [
          'flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-base-200 transition-colors',
          isCurrent ? 'bg-base-200 border-l-2 border-primary' : '',
        ].join(' ');

        const textClass = applied ? '' : 'opacity-50 line-through';

        li.innerHTML = `
          <div class="flex flex-col gap-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="badge badge-sm ${opBadgeClass(patch.op)}">${patch.op}</span>
              <span class="text-xs truncate ${textClass}">${escHtml(humanLabel(patch))}</span>
            </div>
            <div class="text-base-content/70">${renderFieldDiffs(patch)}</div>
            <span class="text-xs text-base-content/40">${relativeTime(timestamp)}</span>
          </div>`;

        if (applied) {
          const revertBtn = document.createElement('button');
          revertBtn.className = 'btn btn-xs btn-ghost self-center shrink-0';
          revertBtn.textContent = 'Revert';
          revertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (version === undefined || version === null) {
              return;
            }
            this.patchManager
              .revertPatch(version)
              .catch((e: unknown) => console.error('revertPatch failed:', e));
          });
          li.appendChild(revertBtn);
        }

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

      panel.appendChild(ul);
    }

    // Feed loaded baseline — always shown at the bottom
    const baselineUl = document.createElement('ul');
    const baselineLi = document.createElement('li');
    baselineLi.className =
      'flex items-center gap-2 px-3 py-2 opacity-50 border-t border-base-300';
    baselineLi.innerHTML = `
      <span class="badge badge-ghost badge-sm">origin</span>
      <span class="flex-1 text-sm">Feed loaded</span>`;
    const revertBtn = document.createElement('button');
    revertBtn.id = 'revert-all-btn';
    revertBtn.className = 'btn btn-xs btn-ghost';
    revertBtn.textContent = 'Revert all';
    revertBtn.addEventListener('click', () => {
      this.patchManager
        .jumpToVersion(0)
        .catch((e: unknown) => console.error('jumpToVersion(0) failed:', e));
    });
    baselineLi.appendChild(revertBtn);
    baselineUl.appendChild(baselineLi);
    panel.appendChild(baselineUl);
  }
}
