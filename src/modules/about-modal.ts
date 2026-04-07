import { showModal } from './modal-utils';

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
    <p>edit.gtfs.zone is a browser-based GTFS transit data editor inspired by geojson.io. All data stays in your browser — no server, no account required.</p>

    <div class="divider text-sm font-semibold opacity-60">Version &amp; Source</div>
    <ul class="list-none space-y-1 text-sm">
      <li>Version: <code class="font-mono">${version}</code></li>
      <li><a href="https://git.kcfam.us/gtfs.zone/coloring-book" target="_blank" rel="noopener noreferrer" class="link">Source code</a></li>
      <li><a href="https://git.kcfam.us/gtfs.zone/coloring-book/raw/branch/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer" class="link">Changelog</a></li>
    </ul>

    <div class="divider text-sm font-semibold opacity-60">Keyboard Shortcuts</div>
    ${buildShortcutsTable(shortcuts)}

    <div class="divider text-sm font-semibold opacity-60">Resources</div>
    <ul class="list-none space-y-1 text-sm">
      <li><a href="https://gtfs.org/reference/" target="_blank" rel="noopener noreferrer" class="link">GTFS Spec Reference</a> — Official file format and field reference</li>
      <li><a href="https://www.transit.land/" target="_blank" rel="noopener noreferrer" class="link">TransitLand Atlas</a> — Real-world GTFS feeds (used by the Load → From TransitLand Atlas feature)</li>
    </ul>
  `;

  return showModal({
    title: 'edit.gtfs.zone',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    dismissable: true,
  });
}
