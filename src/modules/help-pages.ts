/**
 * The help page registry: what pages exist, their grouping, and their copy.
 *
 * Rendering lives in `help-modal.ts`. This module is data only, following
 * landing-zone's `src/content/copy.ts` convention of keeping copy separate
 * from the code that draws it.
 */

import { eyebrow, lede, footnote, glyphList } from './help-modal.js';
import {
  renderBlurb,
  renderVersionAndSource,
  renderProjectSection,
  renderResourcesSection,
  renderFeedbackSection,
  type AboutApp,
} from './about-links.js';
import {
  PATHWAY_CATEGORIES,
  PATHWAY_CATEGORY_ORDER,
  PATHWAY_MODES,
  modesInCategory,
} from '../utils/pathway-modes.js';

export type HelpGroup = 'Getting Started' | 'Reference';

export interface HelpPage {
  id: string;
  label: string;
  group: HelpGroup;
  title: string;
  render(): string;
  /**
   * localStorage key for a "don't show this again" checkbox. Pages without
   * one are reference-only: always available from the menu, never suppressed.
   */
  showOnceKey?: string;
}

function icon(paths: string): string {
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_LOAD = icon(
  '<path d="M16 4v16M9 13l7 7 7-7"/><path d="M6 24v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/>'
);
const ICON_TABLE = icon(
  '<rect x="5" y="6" width="22" height="20" rx="2"/><path d="M5 13h22M5 20h22M13 6v20M21 6v20"/>'
);
const ICON_MAP = icon(
  '<path d="M16 5c-4.4 0-8 3.4-8 7.6C8 18.4 16 27 16 27s8-8.6 8-14.4C24 8.4 20.4 5 16 5z"/><circle cx="16" cy="12.5" r="2.5"/>'
);
const ICON_CHECK = icon(
  '<path d="M16 4l9 4v7c0 6.6-4 11.4-9 13-5-1.6-9-6.4-9-13v-7z"/><path d="M12 16l3 3 5-6"/>'
);
const ICON_EXPORT = icon(
  '<rect x="5" y="14" width="22" height="13" rx="2"/><path d="M16 4v13M10 11l6-7 6 7"/>'
);
const ICON_DOC = icon(
  '<rect x="8" y="4" width="16" height="24" rx="2"/><path d="M12 11h8M12 16h8M12 21h5"/>'
);
const ICON_BUILDING = icon(
  '<rect x="8" y="6" width="16" height="22" rx="1"/><path d="M12 11h2M18 11h2M12 16h2M18 16h2M12 21h2M18 21h2"/>'
);
const ICON_CALENDAR = icon(
  '<rect x="5" y="8" width="22" height="19" rx="2"/><path d="M5 14h22M11 5v6M21 5v6"/>'
);
const ICON_ROUTE = icon(
  '<circle cx="7" cy="9" r="2.5"/><circle cx="25" cy="23" r="2.5"/><path d="M9.5 10.5c4.5 4.5 8.5 1.5 13 11"/>'
);
const ICON_CONNECT = icon(
  '<circle cx="10" cy="22" r="5"/><circle cx="22" cy="10" r="5"/><path d="M13.5 18.5l5-5"/>'
);
const ICON_STOP_TIME = icon(
  '<path d="M16 4c-4.4 0-8 3.4-8 7.6C8 17.4 16 26 16 26s8-8.6 8-14.4C24 7.4 20.4 4 16 4z"/><circle cx="16" cy="11.5" r="4"/><path d="M16 9.5v2.2l1.5 1"/>'
);
const ICON_WAYPOINTS = icon(
  '<circle cx="8" cy="9" r="2.5"/><circle cx="24" cy="23" r="2.5"/><path d="M10 11c6 3 6 8 12 11"/>'
);
const ICON_TICKET = icon(
  '<path d="M5 12a3 3 0 000 6v3a2 2 0 002 2h18a2 2 0 002-2v-3a3 3 0 000-6V9a2 2 0 00-2-2H7a2 2 0 00-2 2v3z"/><path d="M13 7v18" stroke-dasharray="2 3"/>'
);
const ICON_CARD = icon(
  '<rect x="4" y="8" width="24" height="16" rx="2"/><path d="M4 13h24"/><circle cx="10" cy="19" r="1.5" fill="currentColor"/>'
);
const ICON_LEG = icon(
  '<circle cx="6" cy="26" r="2"/><circle cx="24" cy="8" r="2"/><path d="M6.5 24c5.5-9 8-11 8-16 0 5 2.5 7 8 16"/>'
);

const welcomePage: HelpPage = {
  id: 'welcome',
  label: 'Welcome',
  group: 'Getting Started',
  title: 'Welcome to edit.gtfs.zone',
  showOnceKey: 'help.welcome.seen',
  render: () =>
    [
      eyebrow('GTFS.zone'),
      lede(
        'edit.gtfs.zone is a browser-based GTFS transit data editor. All data stays in your browser. No server, no account required.'
      ),
      glyphList([
        {
          icon: ICON_LOAD,
          term: 'Load a feed',
          description: 'From a URL or a local file.',
        },
        {
          icon: ICON_TABLE,
          term: 'Edit any table',
          description: 'Agencies, routes, stops, trips, and every other file.',
        },
        {
          icon: ICON_MAP,
          term: 'Place stops on the map',
          description: 'Add and position stops directly on the map.',
        },
        {
          icon: ICON_CHECK,
          term: 'Check the feed',
          description: 'Validate against the GTFS spec as you go.',
        },
        {
          icon: ICON_EXPORT,
          term: 'Export a zip',
          description: 'Download a ready-to-publish GTFS feed.',
        },
      ]),
      lede(
        'Hover any property to see its GTFS description; click the property name to open the official GTFS reference.'
      ),
    ].join(''),
};

const gettingStartedPage: HelpPage = {
  id: 'getting-started',
  label: 'Writing a New Feed',
  group: 'Getting Started',
  title: 'Building a feed from scratch',
  showOnceKey: 'help.getting-started.seen',
  render: () =>
    [
      lede(
        'Each object below references the one above it, so building in this order keeps everything connected.'
      ),
      glyphList([
        {
          icon: ICON_DOC,
          term: 'Fill in the feed information',
          description: '',
        },
        { icon: ICON_BUILDING, term: 'Add an agency', description: '' },
        {
          icon: ICON_CALENDAR,
          term: 'Add a few services',
          description: 'The days the service runs.',
        },
        {
          icon: ICON_ROUTE,
          term: 'Add routes under the agency',
          description: '',
        },
        {
          icon: ICON_CONNECT,
          term: 'Connect a route to a service',
          description: 'Do this by creating a trip.',
        },
        {
          icon: ICON_STOP_TIME,
          term: 'Add stops and times',
          description: 'Fill in that trip’s stop times.',
        },
      ]),
      footnote('You can revisit this at any time from the help menu.'),
    ].join(''),
};

const shapesPage: HelpPage = {
  id: 'shapes',
  label: 'Shapes',
  group: 'Getting Started',
  title: 'Creating route shapes',
  showOnceKey: 'help.shapes.seen',
  render: () =>
    [
      lede(
        'A shape is the path a vehicle follows on the map. It is separate from the sequence of stops a trip makes.'
      ),
      glyphList([
        {
          icon: ICON_MAP,
          term: 'Place your stops first',
          description: 'Get your route’s stops in the right spots.',
        },
        {
          icon: ICON_WAYPOINTS,
          term: 'Plan the path on brouter',
          description:
            'Open a trip in that route’s timetable and click "open in brouter".',
        },
        {
          icon: ICON_EXPORT,
          term: 'Export as GPX',
          description: 'Export the planned path from brouter as a GPX file.',
        },
        {
          icon: ICON_LOAD,
          term: 'Import the GPX',
          description: 'Import that GPX file here in the Shapes manager.',
        },
        {
          icon: ICON_CONNECT,
          term: 'Link the shape',
          description: 'Link the imported shape to your trips.',
        },
      ]),
      footnote('You can revisit this at any time from the help menu.'),
    ].join(''),
};

const faresPage: HelpPage = {
  id: 'fares',
  label: 'Fares',
  group: 'Getting Started',
  title: 'How GTFS-Fares V2 fits together',
  showOnceKey: 'help.fares.seen',
  render: () =>
    [
      lede(
        'This editor uses GTFS-Fares V2. A few entities work together to describe what a rider pays.'
      ),
      glyphList([
        {
          icon: ICON_TICKET,
          term: 'Define fare products',
          description:
            'The things a rider can buy, like a single ride or a day pass.',
        },
        {
          icon: ICON_CARD,
          term: 'Define fare media and rider categories',
          description:
            'How a product is carried (e.g. a card, cash, an app) and who qualifies for it (e.g. adult, senior, student).',
        },
        {
          icon: ICON_LEG,
          term: 'Add fare leg rules',
          description:
            'Apply your fare products to specific legs of a journey.',
        },
      ]),
      footnote('You can revisit this at any time from the help menu.'),
    ].join(''),
};

// ─── Reference: About, merged in from the old standalone About modal ──────

const ABOUT_APP: AboutApp = {
  name: 'edit.gtfs.zone',
  blurb: [
    'edit.gtfs.zone is a browser-based GTFS transit data editor. All data stays in your browser. No server, no account required.',
  ],
  contactSubject: 'edit.gtfs.zone feedback',
  repo: 'coloring-book',
  sibling: {
    name: 'viz.rt.gtfs.zone',
    href: 'https://viz.rt.gtfs.zone',
    note: 'watch a GTFS Realtime feed on a live map',
  },
};

/**
 * Version and keyboard-shortcuts data aren't known when this module loads
 * (they come from `__APP_VERSION__` and the live `KeyboardShortcuts`
 * instance), so `index.ts` pushes them in once during boot.
 */
let helpRuntimeData: {
  version: string;
  shortcuts: Array<{ key: string; description: string }>;
} = { version: '', shortcuts: [] };

export function setHelpRuntimeData(data: {
  version: string;
  shortcuts: Array<{ key: string; description: string }>;
}): void {
  helpRuntimeData = data;
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

const aboutPage: HelpPage = {
  id: 'about',
  label: 'About',
  group: 'Reference',
  title: 'About edit.gtfs.zone',
  render: () =>
    [
      renderBlurb(ABOUT_APP),
      renderVersionAndSource(ABOUT_APP, helpRuntimeData.version),
      renderProjectSection(ABOUT_APP),
      renderResourcesSection(),
      renderFeedbackSection(ABOUT_APP),
    ].join('\n'),
};

// ─── Reference: Map Key ────────────────────────────────────────────────────

function circle(fill: string, stroke: string, dot?: boolean): string {
  const inner = dot ? `<circle cx="7" cy="7" r="2.5" fill="#000000"/>` : '';
  return `<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0"><circle cx="7" cy="7" r="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${inner}</svg>`;
}

function swatchLine(color: string, dash: number[] | null): string {
  // The map's dasharray is in line widths; the swatch stroke is 3px wide.
  const dashAttr = dash
    ? ` stroke-dasharray="${dash.map((d) => d * 3).join(' ')}"`
    : ' stroke-linecap="round"';
  return `<svg width="20" height="14" viewBox="0 0 20 14" style="flex-shrink:0"><line x1="2" y1="7" x2="18" y2="7" stroke="${color}" stroke-width="3"${dashAttr}/></svg>`;
}

const mapKeyPage: HelpPage = {
  id: 'map-key',
  label: 'Map Key',
  group: 'Reference',
  title: 'Map Key',
  render: () => {
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

    // Built from the same table the map styles itself from, so the key
    // cannot drift from what is drawn.
    const pathways = PATHWAY_CATEGORY_ORDER.map((category) => {
      const { color, dash } = PATHWAY_CATEGORIES[category];
      return modesInCategory(category)
        .map((mode) => row(swatchLine(color, dash), PATHWAY_MODES[mode].label))
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
  },
};

// ─── Reference: Keyboard Shortcuts ─────────────────────────────────────────

const shortcutsPage: HelpPage = {
  id: 'shortcuts',
  label: 'Keyboard Shortcuts',
  group: 'Reference',
  title: 'Keyboard Shortcuts',
  render: () => buildShortcutsTable(helpRuntimeData.shortcuts),
};

export const HELP_PAGES: HelpPage[] = [
  welcomePage,
  gettingStartedPage,
  shapesPage,
  faresPage,
  aboutPage,
  mapKeyPage,
  shortcutsPage,
];

export function getHelpPage(id: string): HelpPage | undefined {
  return HELP_PAGES.find((page) => page.id === id);
}
