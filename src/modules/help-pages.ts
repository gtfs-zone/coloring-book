/**
 * The help page registry: what pages exist, their grouping, and their copy.
 *
 * Rendering lives in `help-modal.ts`. This module is data only, following
 * gtfs-zone-homepage's `src/content/copy.ts` convention of keeping copy separate
 * from the code that draws it.
 */

import {
  eyebrow,
  lede,
  footnote,
  glyphList,
} from 'gtfs-zone-web-common/ui/help-modal';
import {
  renderExternalLink,
  TRANSITLAND_URL,
  type AboutApp,
} from 'gtfs-zone-web-common/ui/about-links';
import {
  aboutPage,
  helpIcon as icon,
  shortcutsPage,
  ICON_CHECK,
  ICON_LEG,
  ICON_LOAD,
  ICON_MAP,
  type HelpPage,
} from 'gtfs-zone-web-common/ui/help-pages';
import {
  mapKeyLine,
  mapKeyRow,
  renderMapKey,
} from 'gtfs-zone-web-common/gtfs/map-key';
import {
  PATHWAY_CATEGORIES,
  PATHWAY_CATEGORY_ORDER,
  PATHWAY_MODES,
  modesInCategory,
} from '../utils/pathway-modes';
import { getSpecUrl } from '../utils/field-component';

/**
 * A link into the GTFS reference for one file, dropped after a `lede()` or
 * `footnote()` block (both interpolate raw HTML). `glyphList()` escapes its
 * text, so this never goes inside one.
 */
function specLink(tableName: string, label: string): string {
  return `<a href="${getSpecUrl(tableName)}" target="_blank" rel="noopener noreferrer" class="link link-primary">${label}</a>`;
}

const ICON_TABLE = icon(
  '<rect x="5" y="6" width="22" height="20" rx="2"/><path d="M5 13h22M5 20h22M13 6v20M21 6v20"/>'
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
const ICON_BELL = icon(
  '<path d="M10 24c-3 0-4-1.5-4-3 2-2 2-4 2-8 0-4.5 3.5-8 8-8s8 3.5 8 8c0 4 0 6 2 8 0 1.5-1 3-4 3z"/><path d="M13 27a3 3 0 006 0"/>'
);

const ICON_ZONE = icon(
  '<path d="M6 10l10-4 10 4v12l-10 4-10-4z" stroke-dasharray="3 2"/><circle cx="16" cy="16" r="2" fill="currentColor"/>'
);
const ICON_GROUP = icon(
  '<circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="12" r="2.5"/><circle cx="15" cy="23" r="2.5"/><path d="M11 11.5l10 1M21.5 14.5l-5 6.5M13 21l-3-8.5"/>'
);
const ICON_CLOCK = icon(
  '<circle cx="16" cy="16" r="11"/><path d="M16 9v7l5 3"/>'
);

const welcomePage: HelpPage = {
  id: 'welcome',
  label: 'Welcome',
  group: 'Getting Started',
  title: 'Load, edit, and export a GTFS feed',
  showOnce: true,
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
  showOnce: true,
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
      lede(
        `Spec reference: ${specLink('feed_info.txt', 'Feed Info')}, ${specLink('agency.txt', 'Agencies')}, ${specLink('calendar.txt', 'Calendar')}, ${specLink('routes.txt', 'Routes')}, ${specLink('trips.txt', 'Trips')}, ${specLink('stop_times.txt', 'Stop Times')}.`
      ),
      footnote('You can revisit this at any time from the Guide menu.'),
    ].join(''),
};

const shapesPage: HelpPage = {
  id: 'shapes',
  label: 'Shapes',
  group: 'Getting Started',
  title: 'Creating route shapes',
  showOnce: true,
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
          term: 'Import the shape',
          description:
            'Import that GPX file here in the Shapes manager. The same button also takes a GTFS feed, to copy one shape out of an existing feed.',
        },
        {
          icon: ICON_CONNECT,
          term: 'Link the shape',
          description: 'Link the imported shape to your trips.',
        },
      ]),
      lede(`Spec reference: ${specLink('shapes.txt', 'Shapes')}.`),
      footnote('You can revisit this at any time from the Guide menu.'),
    ].join(''),
};

const faresPage: HelpPage = {
  id: 'fares',
  label: 'Fares',
  group: 'Getting Started',
  title: 'How to specify fares in your GTFS feed',
  showOnce: true,
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
      lede(
        `Spec reference: ${specLink('fare_products.txt', 'Fare Products')}, ${specLink('fare_media.txt', 'Fare Media')}, ${specLink('fare_leg_rules.txt', 'Fare Leg Rules')}.`
      ),
      footnote('You can revisit this at any time from the Guide menu.'),
    ].join(''),
};

const onDemandPage: HelpPage = {
  id: 'on-demand',
  label: 'On-Demand',
  group: 'Getting Started',
  title: 'Describing on-demand service (GTFS Flex)',
  showOnce: true,
  render: () =>
    [
      lede(
        'On-demand service is service a rider books rather than catches at a fixed time. GTFS Flex describes it with a few pieces that plug into an ordinary trip.'
      ),
      glyphList([
        {
          icon: ICON_ZONE,
          term: 'A zone is an area, not a stop',
          description:
            'A polygon drawn on the map that a rider can be picked up in or dropped off anywhere inside. Zones live in locations.geojson, not in stops.txt.',
        },
        {
          icon: ICON_GROUP,
          term: 'A location group is a set of stops',
          description:
            'When the service serves a handful of named stops rather than a whole area, group those stops instead of drawing a zone.',
        },
        {
          icon: ICON_BELL,
          term: 'A booking rule says how to book',
          description:
            'How far in advance a rider has to call or tap, and where. Real time, same day, or by a cutoff on a prior day.',
        },
        {
          icon: ICON_CLOCK,
          term: 'A stop_time ties them to a trip',
          description:
            'Give a stop_time a pickup and drop-off window instead of an arrival and departure, point it at a zone or location group, and name the booking rule it uses.',
        },
      ]),
      lede(
        `Spec reference: ${specLink('locations.geojson', 'Locations')}, ${specLink('booking_rules.txt', 'Booking Rules')}, ${specLink('location_groups.txt', 'Location Groups')}.`
      ),
      footnote('You can revisit this at any time from the Guide menu.'),
    ].join(''),
};

// ─── Reference: About, merged in from the old standalone About modal ──────

const ABOUT_APP: AboutApp = {
  name: 'edit.gtfs.zone',
  blurb: [
    'edit.gtfs.zone is a browser-based GTFS transit data editor. All data stays in your browser. No server, no account required.',
  ],
  contactSubject: 'edit.gtfs.zone feedback',
  repo: 'gtfs-zone-editor',
  sibling: {
    name: 'viz.rt.gtfs.zone',
    href: 'https://viz.rt.gtfs.zone',
    note: 'watch a GTFS Realtime feed on a live map',
  },
};

// ─── Reference: Map Key ────────────────────────────────────────────────────

const mapKeyPage: HelpPage = {
  id: 'map-key',
  label: 'Map Key',
  group: 'Reference',
  title: 'Reading the map symbols',
  // Built from the same table the map styles itself from, so the key
  // cannot drift from what is drawn.
  render: () =>
    renderMapKey({
      unlocatedLabel: 'Node with no location',
      title: 'Pathways',
      rows: PATHWAY_CATEGORY_ORDER.map((category) => {
        const { color, dash } = PATHWAY_CATEGORIES[category];
        return modesInCategory(category)
          .map((mode) =>
            mapKeyRow(mapKeyLine(color, dash), PATHWAY_MODES[mode].label)
          )
          .join('');
      }).join(''),
    }),
};

// ─── Getting Started: Publishing, shown once after a successful export ────

const publishingPage: HelpPage = {
  id: 'publishing',
  label: 'Publishing your Feed',
  group: 'Getting Started',
  title: 'Publishing your feed',
  showOnce: true,
  render: () =>
    [
      lede(
        'A GTFS feed is only useful once riders and their apps can reach it. A few steps turn the file you just exported into a published feed.'
      ),
      glyphList([
        {
          icon: ICON_CHECK,
          term: 'Validate with the canonical GTFS validator',
          termHtml: `Validate with the ${renderExternalLink('https://gtfs-validator.mobilitydata.org/', 'canonical GTFS validator')}`,
          description: 'Catch anything this editor does not check.',
        },
        {
          icon: ICON_CHECK,
          term: "Keep the source feed's license",
          description:
            "If you started from someone else's feed, their license still covers what you publish. Credit them in attributions.txt.",
        },
        {
          icon: ICON_EXPORT,
          term: 'Host the zip at a stable URL',
          description:
            'Somewhere that does not move, so apps can keep fetching the latest version.',
        },
        {
          icon: ICON_CONNECT,
          term: 'Register so apps can find your feed',
          description:
            'Add it to the Mobility Database and TransitLand Atlas, and submit it to Google Transit.',
          descriptionHtml: `Add it to the ${renderExternalLink('https://mobilitydatabase.org/contribute', 'Mobility Database')} and ${renderExternalLink(TRANSITLAND_URL, 'TransitLand Atlas')}, and submit it to ${renderExternalLink('https://developers.google.com/transit/gtfs/', 'Google Transit')}.`,
        },
        {
          icon: ICON_BELL,
          term: 'Track your vehicles with GTFS Realtime',
          termHtml: `Track your vehicles with ${renderExternalLink('https://gtfs.org/documentation/realtime/reference/', 'GTFS Realtime')}`,
          description:
            'Once the schedule is published, live vehicle positions, trip updates and service alerts are the next step.',
        },
      ]),
      footnote(
        `You can revisit this at any time from the Guide menu. ${renderExternalLink('https://gtfs.org/getting-started/publish/', 'Publishing on gtfs.org')} covers the whole process.`
      ),
    ].join(''),
};

export const HELP_PAGES: HelpPage[] = [
  welcomePage,
  gettingStartedPage,
  shapesPage,
  faresPage,
  onDemandPage,
  publishingPage,
  aboutPage(ABOUT_APP),
  mapKeyPage,
  shortcutsPage,
];
