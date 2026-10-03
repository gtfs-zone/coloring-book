import { renderRouteWaypointsIcon } from 'gtfs-zone-web-common/ui/modal-utils';
import {
  renderMoonIcon,
  renderNavIcon,
  renderSunIcon,
  type NavIconName,
} from 'gtfs-zone-web-common/ui/nav-icons';
import type { NavbarAction } from 'gtfs-zone-web-common/ui/navbar-actions';
import { t } from '../i18n/messages';

/** Database icon for the Feed Data modal, which has no shared nav icon. */
const FEED_DATA_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75" /></svg>';

/**
 * This app's navbar action row and dock artwork.
 *
 * `navbar-actions.ts` is shared across apps and holds no list of its own; each
 * app supplies one. Element ids are the contract with the click wiring in
 * `src/index.ts`, `src/modules/ui.ts` and `src/modules/navbar-counts.ts`.
 */
export const NAVBAR_ACTIONS: NavbarAction[] = [
  {
    kind: 'icon',
    id: 'timetable-btn',
    label: t('nav.timetables'),
    icon: renderNavIcon('timetable'),
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'shapes-btn',
    label: t('nav.shapes'),
    // Same icon as the "open in brouter" affordance, at navbar icon size.
    icon: renderRouteWaypointsIcon('h-5 w-5'),
    badgeId: 'shapes-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'calendar-btn',
    label: t('nav.calendar'),
    icon: renderNavIcon('calendar'),
    badgeId: 'calendar-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'fares-btn',
    label: t('nav.fares'),
    icon: renderNavIcon('fares'),
    badgeId: 'fares-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'on-demand-btn',
    label: t('nav.onDemand'),
    icon: renderNavIcon('onDemand'),
    badgeId: 'on-demand-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'feed-data-btn',
    label: t('nav.feedData'),
    icon: FEED_DATA_ICON,
    badgeId: 'feed-data-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'levels-btn',
    label: t('nav.levels'),
    icon: renderNavIcon('levels'),
    badgeId: 'levels-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'files-btn',
    label: t('nav.files'),
    icon: renderNavIcon('files'),
    desktopOnly: true,
  },
  {
    kind: 'toggle',
    id: 'theme-toggle',
    label: t('nav.theme'),
    iconOn: renderSunIcon('swap-on h-5 w-5'),
    iconOff: renderMoonIcon('swap-off h-5 w-5'),
    inputClass: 'theme-controller',
    value: 'light',
  },
  { kind: 'locale', id: 'locale-toggle' },
  {
    kind: 'icon',
    id: 'help-btn',
    label: t('nav.guide'),
    icon: renderNavIcon('guide'),
  },
  {
    kind: 'icon',
    id: 'undo-btn',
    label: t('nav.nothingToUndo'),
    icon: renderNavIcon('undo'),
    tooltipId: 'undo-tooltip',
    onclick: 'window.gtfsEditor?.undoEdit()',
    disabled: true,
    group: 'history',
  },
  {
    kind: 'icon',
    id: 'history-btn',
    label: t('nav.history'),
    icon: renderNavIcon('history'),
    badgeId: 'history-count-badge',
    desktopOnly: true,
    group: 'history',
  },
  {
    kind: 'icon',
    id: 'redo-btn',
    label: t('nav.nothingToRedo'),
    icon: renderNavIcon('redo'),
    tooltipId: 'redo-tooltip',
    onclick: 'window.gtfsEditor?.redoEdit()',
    disabled: true,
    group: 'history',
  },
  {
    kind: 'labeled',
    id: 'load-btn',
    // Opens the one modal covering every feed source.
    label: t('nav.load'),
    icon: renderNavIcon('load', { sizeClass: 'h-4 w-4' }),
    btnClass: 'btn-primary',
  },
  {
    kind: 'labeled',
    id: 'export-btn',
    label: t('nav.export'),
    icon: renderNavIcon('export', { sizeClass: 'h-4 w-4' }),
    btnClass: 'btn-outline',
    disabled: true,
  },
];

/** Icons the mobile dock shares with the navbar, by dock button id. */
export const DOCK_ICONS: [string, NavIconName][] = [
  ['dock-browse', 'browse'],
  ['dock-files', 'files'],
  ['dock-timetable', 'timetable'],
  ['dock-changes', 'history'],
];
