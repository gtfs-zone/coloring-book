import { showModal } from './modal-utils';

function circle(fill: string, stroke: string, dot?: boolean): string {
  const inner = dot ? `<circle cx="7" cy="7" r="2.5" fill="#000000"/>` : '';
  return `<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0"><circle cx="7" cy="7" r="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${inner}</svg>`;
}

function line(color: string): string {
  return `<svg width="20" height="14" viewBox="0 0 20 14" style="flex-shrink:0"><line x1="2" y1="7" x2="18" y2="7" stroke="${color}" stroke-width="3" stroke-linecap="round"/></svg>`;
}

function buildMapKey(): string {
  const row = (swatch: string, label: string) =>
    `<div class="flex items-center gap-2">${swatch}<span>${label}</span></div>`;

  const stops = [
    row(circle('#ffffff', '#000000'), 'Stop'),
    row(circle('#ffffff', '#000000', true), 'Station'),
    row(circle('#f59e0b', '#000000'), 'Entrance'),
    row(circle('#8b5cf6', '#000000'), 'Generic node'),
    row(circle('#10b981', '#000000'), 'Boarding area'),
    row(circle('#ffffff', '#9ca3af'), 'Node with no location'),
  ].join('');

  const pathways = [
    row(line('#22c55e'), 'Walkway'),
    row(line('#f97316'), 'Stairs'),
    row(line('#06b6d4'), 'Moving sidewalk'),
    row(line('#a855f7'), 'Escalator'),
    row(line('#3b82f6'), 'Elevator'),
    row(line('#ef4444'), 'Fare gate'),
    row(line('#6b7280'), 'Exit gate'),
  ].join('');

  return `
    <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
      <div class="col-span-2 grid grid-cols-2 gap-x-6">
        <div class="font-semibold text-xs opacity-60 mb-1">Stops</div>
        <div class="font-semibold text-xs opacity-60 mb-1">Pathways</div>
      </div>
      <div class="flex flex-col gap-1">${stops}</div>
      <div class="flex flex-col gap-1">${pathways}</div>
    </div>
  `;
}

function buildShortcutsTable(
  shortcuts: Array<{ key: string; description: string }>
): string {
  const rows = shortcuts
    .map((s) => {
      const keyHtml = s.key
        .split('+')
        .map((token) => `<kbd class="kbd kbd-xs">${token}</kbd>`)
        .join('+');
      return `<tr><td class="whitespace-nowrap">${keyHtml}</td><td>${s.description}</td></tr>`;
    })
    .join('');
  return `
    <table class="table table-xs w-full">
      <thead><tr><th>Key</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function showAboutModal(
  version: string,
  shortcuts: Array<{ key: string; description: string }>
): Promise<void> {
  const body = `
    <p>edit.gtfs.zone is a browser-based GTFS transit data editor inspired by geojson.io. All data stays in your browser. No server, no account required.</p>

    <div class="divider text-sm font-semibold opacity-60">Version &amp; Source</div>
    <ul class="list-none space-y-1 text-sm">
      <li>Version: <code class="font-mono">${version}</code></li>
      <li><a href="https://git.kcfam.us/gtfs.zone/coloring-book" target="_blank" rel="noopener noreferrer" class="link">Source code</a></li>
      <li><a href="https://git.kcfam.us/gtfs.zone/coloring-book/raw/branch/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer" class="link">Changelog</a></li>
    </ul>

    <div class="divider text-sm font-semibold opacity-60">Keyboard Shortcuts</div>
    ${buildShortcutsTable(shortcuts)}

    <div class="divider text-sm font-semibold opacity-60">Map Key</div>
    ${buildMapKey()}

    <div class="divider text-sm font-semibold opacity-60">Resources</div>
    <ul class="list-none space-y-1 text-sm">
      <li><a href="https://gtfs.org/reference/" target="_blank" rel="noopener noreferrer" class="link">GTFS Spec Reference</a>: Official file format and field reference</li>
      <li><a href="https://www.transit.land/" target="_blank" rel="noopener noreferrer" class="link">TransitLand Atlas</a>, real-world GTFS feeds (used by the Load -> From TransitLand Atlas feature)</li>
    </ul>
  `;

  return showModal({
    title: 'edit.gtfs.zone',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
  });
}
