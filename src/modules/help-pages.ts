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
import { t } from '../i18n/messages';

/**
 * A link into the GTFS reference for one file, dropped after a `lede()` or
 * `footnote()` block (both interpolate raw HTML). `glyphList()` escapes its
 * text, so this never goes inside one.
 */
function specLink(tableName: string, label: string): string {
  return `<a href="${getSpecUrl(tableName)}" target="_blank" rel="noopener noreferrer" class="link link-primary">${label}</a>`;
}

/** "Spec reference: ..." over `[file, label]` pairs. */
function specReference(links: [string, string][]): string {
  return t('help.specReference', {
    links: links.map(([file, label]) => specLink(file, label)).join(', '),
  });
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
  label: t('help.welcome.label'),
  group: 'Getting Started',
  title: t('help.welcome.title'),
  showOnce: true,
  render: () =>
    [
      eyebrow('GTFS.zone'),
      lede(t('help.intro')),
      glyphList([
        {
          icon: ICON_LOAD,
          term: t('help.welcome.load'),
          description: t('help.welcome.loadText'),
        },
        {
          icon: ICON_TABLE,
          term: t('help.welcome.edit'),
          description: t('help.welcome.editText'),
        },
        {
          icon: ICON_MAP,
          term: t('help.welcome.place'),
          description: t('help.welcome.placeText'),
        },
        {
          icon: ICON_CHECK,
          term: t('help.welcome.check'),
          description: t('help.welcome.checkText'),
        },
        {
          icon: ICON_EXPORT,
          term: t('help.welcome.export'),
          description: t('help.welcome.exportText'),
        },
      ]),
      lede(t('help.welcome.hover')),
    ].join(''),
};

const gettingStartedPage: HelpPage = {
  id: 'getting-started',
  label: t('help.new.label'),
  group: 'Getting Started',
  title: t('help.new.title'),
  showOnce: true,
  render: () =>
    [
      lede(t('help.new.lede')),
      glyphList([
        {
          icon: ICON_DOC,
          term: t('help.new.feedInfo'),
          description: '',
        },
        { icon: ICON_BUILDING, term: t('help.new.agency'), description: '' },
        {
          icon: ICON_CALENDAR,
          term: t('help.new.services'),
          description: t('help.new.servicesText'),
        },
        {
          icon: ICON_ROUTE,
          term: t('help.new.routes'),
          description: '',
        },
        {
          icon: ICON_CONNECT,
          term: t('help.new.trip'),
          description: t('help.new.tripText'),
        },
        {
          icon: ICON_STOP_TIME,
          term: t('help.new.stopTimes'),
          description: t('help.new.stopTimesText'),
        },
      ]),
      lede(
        specReference([
          ['feed_info.txt', t('help.spec.feedInfo')],
          ['agency.txt', t('help.spec.agencies')],
          ['calendar.txt', t('help.spec.calendar')],
          ['routes.txt', t('help.spec.routes')],
          ['trips.txt', t('help.spec.trips')],
          ['stop_times.txt', t('help.spec.stopTimes')],
        ])
      ),
      footnote(t('help.revisit')),
    ].join(''),
};

const shapesPage: HelpPage = {
  id: 'shapes',
  label: t('help.shapes.label'),
  group: 'Getting Started',
  title: t('help.shapes.title'),
  showOnce: true,
  render: () =>
    [
      lede(t('help.shapes.lede')),
      glyphList([
        {
          icon: ICON_MAP,
          term: t('help.shapes.stops'),
          description: t('help.shapes.stopsText'),
        },
        {
          icon: ICON_WAYPOINTS,
          term: t('help.shapes.brouter'),
          description: t('help.shapes.brouterText'),
        },
        {
          icon: ICON_EXPORT,
          term: t('help.shapes.gpx'),
          description: t('help.shapes.gpxText'),
        },
        {
          icon: ICON_LOAD,
          term: t('help.shapes.import'),
          description: t('help.shapes.importText'),
        },
        {
          icon: ICON_CONNECT,
          term: t('help.shapes.link'),
          description: t('help.shapes.linkText'),
        },
      ]),
      lede(specReference([['shapes.txt', t('help.spec.shapes')]])),
      footnote(t('help.revisit')),
    ].join(''),
};

const faresPage: HelpPage = {
  id: 'fares',
  label: t('help.fares.label'),
  group: 'Getting Started',
  title: t('help.fares.title'),
  showOnce: true,
  render: () =>
    [
      lede(t('help.fares.lede')),
      glyphList([
        {
          icon: ICON_TICKET,
          term: t('help.fares.products'),
          description: t('help.fares.productsText'),
        },
        {
          icon: ICON_CARD,
          term: t('help.fares.media'),
          description: t('help.fares.mediaText'),
        },
        {
          icon: ICON_LEG,
          term: t('help.fares.legs'),
          description: t('help.fares.legsText'),
        },
      ]),
      lede(
        specReference([
          ['fare_products.txt', t('help.spec.fareProducts')],
          ['fare_media.txt', t('help.spec.fareMedia')],
          ['fare_leg_rules.txt', t('help.spec.fareLegRules')],
        ])
      ),
      footnote(t('help.revisit')),
    ].join(''),
};

const onDemandPage: HelpPage = {
  id: 'on-demand',
  label: t('help.onDemand.label'),
  group: 'Getting Started',
  title: t('help.onDemand.title'),
  showOnce: true,
  render: () =>
    [
      lede(t('help.onDemand.lede')),
      glyphList([
        {
          icon: ICON_ZONE,
          term: t('help.onDemand.zone'),
          description: t('help.onDemand.zoneText'),
        },
        {
          icon: ICON_GROUP,
          term: t('help.onDemand.group'),
          description: t('help.onDemand.groupText'),
        },
        {
          icon: ICON_BELL,
          term: t('help.onDemand.booking'),
          description: t('help.onDemand.bookingText'),
        },
        {
          icon: ICON_CLOCK,
          term: t('help.onDemand.stopTime'),
          description: t('help.onDemand.stopTimeText'),
        },
      ]),
      lede(
        specReference([
          ['locations.geojson', t('help.spec.locations')],
          ['booking_rules.txt', t('help.spec.bookingRules')],
          ['location_groups.txt', t('help.spec.locationGroups')],
        ])
      ),
      footnote(t('help.revisit')),
    ].join(''),
};

// ─── Reference: About, merged in from the old standalone About modal ──────

const ABOUT_APP: AboutApp = {
  name: 'edit.gtfs.zone',
  blurb: [t('help.intro')],
  contactSubject: t('help.about.subject'),
  repo: 'gtfs-zone-editor',
  sibling: {
    name: 'viz.rt.gtfs.zone',
    href: 'https://viz.rt.gtfs.zone',
    note: t('help.about.sibling'),
  },
};

// ─── Reference: Map Key ────────────────────────────────────────────────────

const mapKeyPage: HelpPage = {
  id: 'map-key',
  label: t('help.mapKey.label'),
  group: 'Reference',
  title: t('help.mapKey.title'),
  // Built from the same table the map styles itself from, so the key
  // cannot drift from what is drawn.
  render: () =>
    renderMapKey({
      unlocatedLabel: t('help.mapKey.unlocated'),
      title: t('help.mapKey.pathways'),
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
  label: t('help.publish.label'),
  group: 'Getting Started',
  title: t('help.publish.title'),
  showOnce: true,
  render: () =>
    [
      lede(t('help.publish.lede')),
      glyphList([
        {
          icon: ICON_CHECK,
          term: t('help.publish.validator', {
            link: t('help.publish.validatorLink'),
          }),
          termHtml: t('help.publish.validator', {
            link: renderExternalLink(
              'https://gtfs-validator.mobilitydata.org/',
              t('help.publish.validatorLink')
            ),
          }),
          description: t('help.publish.validatorText'),
        },
        {
          icon: ICON_CHECK,
          term: t('help.publish.license'),
          description: t('help.publish.licenseText'),
        },
        {
          icon: ICON_EXPORT,
          term: t('help.publish.host'),
          description: t('help.publish.hostText'),
        },
        {
          icon: ICON_CONNECT,
          term: t('help.publish.register'),
          description: t('help.publish.registerText', {
            mdb: 'Mobility Database',
            atlas: 'TransitLand Atlas',
            google: 'Google Transit',
          }),
          descriptionHtml: t('help.publish.registerText', {
            mdb: renderExternalLink(
              'https://mobilitydatabase.org/contribute',
              'Mobility Database'
            ),
            atlas: renderExternalLink(TRANSITLAND_URL, 'TransitLand Atlas'),
            google: renderExternalLink(
              'https://developers.google.com/transit/gtfs/',
              'Google Transit'
            ),
          }),
        },
        {
          icon: ICON_BELL,
          term: t('help.publish.realtime', { link: 'GTFS Realtime' }),
          termHtml: t('help.publish.realtime', {
            link: renderExternalLink(
              'https://gtfs.org/documentation/realtime/reference/',
              'GTFS Realtime'
            ),
          }),
          description: t('help.publish.realtimeText'),
        },
      ]),
      footnote(
        t('help.publish.footnote', {
          link: renderExternalLink(
            'https://gtfs.org/getting-started/publish/',
            t('help.publish.footnoteLink')
          ),
        })
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
