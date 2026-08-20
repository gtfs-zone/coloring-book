import { showModal } from './modal-utils';
import {
  AboutApp,
  renderBlurb,
  renderFeedbackSection,
  renderProjectSection,
  renderResourcesSection,
  renderVersionAndSource,
} from './about-links';
import {
  PATHWAY_CATEGORIES,
  PATHWAY_CATEGORY_ORDER,
  PATHWAY_MODES,
  modesInCategory,
} from '../utils/pathway-modes.js';

function circle(fill: string, stroke: string, dot?: boolean): string {
  const inner = dot ? `<circle cx="7" cy="7" r="2.5" fill="#000000"/>` : '';
  return `<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0"><circle cx="7" cy="7" r="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${inner}</svg>`;
}

function line(color: string, dash: number[] | null): string {
  // The map's dasharray is in line widths; the swatch stroke is 3px wide.
  const dashAttr = dash
    ? ` stroke-dasharray="${dash.map((d) => d * 3).join(' ')}"`
    : ' stroke-linecap="round"';
  return `<svg width="20" height="14" viewBox="0 0 20 14" style="flex-shrink:0"><line x1="2" y1="7" x2="18" y2="7" stroke="${color}" stroke-width="3"${dashAttr}/></svg>`;
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

  // Built from the same table the map styles itself from, so the key cannot
  // drift from what is drawn.
  const pathways = PATHWAY_CATEGORY_ORDER.map((category) => {
    const { color, dash } = PATHWAY_CATEGORIES[category];
    return modesInCategory(category)
      .map((mode) => row(line(color, dash), PATHWAY_MODES[mode].label))
      .join('');
  }).join('');

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

const APP: AboutApp = {
  name: 'edit.gtfs.zone',
  blurb: [
    'edit.gtfs.zone is a browser-based GTFS transit data editor inspired by geojson.io. All data stays in your browser. No server, no account required.',
  ],
  contactSubject: 'edit.gtfs.zone feedback',
  repo: 'coloring-book',
  sibling: {
    name: 'viz.rt.gtfs.zone',
    href: 'https://viz.rt.gtfs.zone',
    note: 'watch a GTFS Realtime feed on a live map',
  },
};

export function showAboutModal(
  version: string,
  shortcuts: Array<{ key: string; description: string }>
): Promise<void> {
  const body = [
    renderBlurb(APP),
    renderVersionAndSource(APP, version),
    renderProjectSection(APP),
    '<div class="divider text-sm font-semibold opacity-60">Keyboard Shortcuts</div>',
    buildShortcutsTable(shortcuts),
    '<div class="divider text-sm font-semibold opacity-60">Map Key</div>',
    buildMapKey(),
    renderResourcesSection(),
    renderFeedbackSection(APP),
  ].join('\n');

  return showModal({
    title: APP.name,
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
  });
}
