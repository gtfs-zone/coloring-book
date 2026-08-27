/**
 * The help page registry: what pages exist, their grouping, and their copy.
 *
 * Rendering lives in `help-modal.ts`. This module is data only, following
 * landing-zone's `src/content/copy.ts` convention of keeping copy separate
 * from the code that draws it.
 */

import { eyebrow, lede, glyphList, numberedTimeline } from './help-modal.js';

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
        'edit.gtfs.zone is a browser-based GTFS transit data editor inspired by geojson.io. All data stays in your browser. No server, no account required.'
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
          term: 'Draw on the map',
          description: 'Place stops and routes directly on the map.',
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
      numberedTimeline([
        'Fill in the feed information.',
        'Add an agency.',
        'Add a few services (the days the service runs).',
        'Add routes under the agency.',
        'Connect a route to a service by creating a trip.',
        'Add stops and times to that trip.',
      ]),
      lede('You can revisit this at any time from the help menu.'),
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
      numberedTimeline([
        'Get your route’s stops placed in the right spots first.',
        'Open a trip in that route’s timetable and click the "open in brouter" link to route-plan the path on brouter.',
        'Export the planned path from brouter as a GPX file.',
        'Import that GPX file here in the Shapes manager.',
        'Link the imported shape to your trips.',
      ]),
      lede('You can revisit this at any time from the help menu.'),
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
      numberedTimeline([
        'Define fare products: the things a rider can buy, like a single ride or a day pass.',
        'Define fare media and rider categories: how a product is carried (e.g. a card, cash, an app) and who qualifies for it (e.g. adult, senior, student).',
        'Add fare leg rules to apply your fare products to specific legs of a journey.',
      ]),
      lede('You can revisit this at any time from the help menu.'),
    ].join(''),
};

export const HELP_PAGES: HelpPage[] = [
  welcomePage,
  gettingStartedPage,
  shapesPage,
  faresPage,
];

export function getHelpPage(id: string): HelpPage | undefined {
  return HELP_PAGES.find((page) => page.id === id);
}
