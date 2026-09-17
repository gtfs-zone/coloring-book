import { renderRouteWaypointsIcon } from 'interlocking/ui/modal-utils';
import {
  renderMoonIcon,
  renderNavIcon,
  renderSunIcon,
  type NavIconName,
} from 'interlocking/ui/nav-icons';
import type { NavbarAction } from 'interlocking/ui/navbar-actions';

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
    label: 'Timetable',
    icon: renderNavIcon('timetable'),
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'shapes-btn',
    label: 'Shapes',
    // Same icon as the "open in brouter" affordance, at navbar icon size.
    icon: renderRouteWaypointsIcon('h-5 w-5'),
    badgeId: 'shapes-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'calendar-btn',
    label: 'Service Calendar',
    icon: renderNavIcon('calendar'),
    badgeId: 'calendar-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'fares-btn',
    label: 'Fares (V2)',
    icon: renderNavIcon('fares'),
    badgeId: 'fares-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'on-demand-btn',
    label: 'On-Demand (GTFS Flex)',
    icon: renderNavIcon('onDemand'),
    badgeId: 'on-demand-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'feed-data-btn',
    label: 'Feed Data (transfers, attributions, translations)',
    icon: renderNavIcon('feedData'),
    badgeId: 'feed-data-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'levels-btn',
    label: 'Manage Levels',
    icon: renderNavIcon('levels'),
    badgeId: 'levels-count-badge',
    desktopOnly: true,
  },
  {
    kind: 'icon',
    id: 'files-btn',
    label: 'Files',
    icon: renderNavIcon('files'),
    desktopOnly: true,
  },
  {
    kind: 'toggle',
    id: 'theme-toggle',
    label: 'Toggle theme',
    iconOn: renderSunIcon('swap-on h-5 w-5'),
    iconOff: renderMoonIcon('swap-off h-5 w-5'),
    inputClass: 'theme-controller',
    value: 'light',
  },
  {
    kind: 'icon',
    id: 'help-btn',
    label: 'Guide',
    icon: renderNavIcon('guide'),
  },
  {
    kind: 'icon',
    id: 'undo-btn',
    label: 'Nothing to undo',
    icon: renderNavIcon('undo'),
    tooltipId: 'undo-tooltip',
    onclick: 'window.gtfsEditor?.undoEdit()',
    disabled: true,
    group: 'history',
  },
  {
    kind: 'icon',
    id: 'history-btn',
    label: 'History',
    icon: renderNavIcon('history'),
    badgeId: 'history-count-badge',
    desktopOnly: true,
    group: 'history',
  },
  {
    kind: 'icon',
    id: 'redo-btn',
    label: 'Nothing to redo',
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
    label: 'Load',
    icon: renderNavIcon('load', { sizeClass: 'h-4 w-4' }),
    btnClass: 'btn-primary',
  },
  {
    kind: 'labeled',
    id: 'export-btn',
    label: 'Export',
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
