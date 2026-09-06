import { escapeHtml } from '../utils/escape-html.js';
import { renderRouteWaypointsIcon } from './modal-utils.js';
import {
  renderMoonIcon,
  renderNavIcon,
  renderSunIcon,
  type NavIconName,
} from './nav-icons.js';

/**
 * The navbar's action row, as data.
 *
 * Every entry renders through one of three shapes below, so an action cannot
 * end up with a different box, a different icon size, a missing tooltip or a
 * missing accessible label than its neighbours: the `label` field feeds both
 * `data-tip` and `aria-label`, and the button classes come from the renderer,
 * not the entry.
 *
 * Element ids are the contract with the click wiring in `src/index.ts`,
 * `src/modules/ui.ts` and the badge writer in `src/modules/navbar-counts.ts`.
 */

interface CommonAction {
  /** Element id of the control itself. */
  id: string;
  /** Tooltip text and accessible name. */
  label: string;
  /** Consecutive entries sharing a group render in one tighter cluster. */
  group?: string;
}

interface IconAction extends CommonAction {
  kind: 'icon';
  icon: string;
  /** Id for the count badge span; omitted means no badge. */
  badgeId?: string;
  /** Hidden below the `md` breakpoint, where the dock takes over. */
  desktopOnly?: boolean;
  disabled?: boolean;
  /** Id on the tooltip wrapper, for actions whose tip changes at runtime. */
  tooltipId?: string;
  onclick?: string;
}

interface ToggleAction extends CommonAction {
  kind: 'toggle';
  /** Shown when the checkbox is checked / unchecked. */
  iconOn: string;
  iconOff: string;
  /** Class the controlling module delegates on (e.g. `theme-controller`). */
  inputClass: string;
  value?: string;
}

interface LabeledAction extends CommonAction {
  kind: 'labeled';
  icon: string;
  /** Button style, e.g. `btn-primary`. */
  btnClass: string;
  disabled?: boolean;
}

type NavbarAction = IconAction | ToggleAction | LabeledAction;

const ICON_BTN_CLASS = 'btn btn-ghost btn-sm btn-square';

const NAVBAR_ACTIONS: NavbarAction[] = [
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
const DOCK_ICONS: [string, NavIconName][] = [
  ['dock-browse', 'browse'],
  ['dock-files', 'files'],
  ['dock-timetable', 'timetable'],
  ['dock-changes', 'history'],
];

function renderAction(action: NavbarAction): string {
  const label = escapeHtml(action.label);

  if (action.kind === 'labeled') {
    const disabled = action.disabled ? ' disabled' : '';
    return `<button id="${action.id}" class="btn btn-sm ${action.btnClass}" aria-label="${label}"${disabled}>${action.icon}<span class="hidden md:inline">${label}</span></button>`;
  }

  const control =
    action.kind === 'toggle'
      ? `<label id="${action.id}" class="${ICON_BTN_CLASS} swap swap-rotate" aria-label="${label}">` +
        `<input type="checkbox" class="${action.inputClass}"${action.value ? ` value="${action.value}"` : ''} />` +
        `${action.iconOn}${action.iconOff}</label>`
      : `<button id="${action.id}" class="${ICON_BTN_CLASS}" aria-label="${label}"` +
        `${action.onclick ? ` onclick="${action.onclick}"` : ''}` +
        `${action.disabled ? ' disabled' : ''}>${action.icon}</button>`;

  const tooltipId =
    action.kind === 'icon' && action.tooltipId
      ? ` id="${action.tooltipId}"`
      : '';
  const tooltip = `<div class="tooltip tooltip-bottom"${tooltipId} data-tip="${label}">${control}</div>`;

  const badgeId = action.kind === 'icon' ? action.badgeId : undefined;
  const desktopOnly = action.kind === 'icon' && action.desktopOnly;

  // The indicator only exists to anchor a badge; without one the tooltip
  // wrapper carries the responsive class itself.
  if (!badgeId) {
    return desktopOnly
      ? `<div class="indicator hidden md:inline-flex">${tooltip}</div>`
      : tooltip;
  }
  const indicatorClass = desktopOnly
    ? 'indicator hidden md:inline-flex'
    : 'indicator';
  return `<div class="${indicatorClass}"><span id="${badgeId}" class="indicator-item badge badge-xs badge-primary hidden"></span>${tooltip}</div>`;
}

/** Render every navbar action into the container, grouped clusters included. */
export function renderNavbarActions(container: HTMLElement): void {
  const parts: string[] = [];
  let index = 0;

  while (index < NAVBAR_ACTIONS.length) {
    const action = NAVBAR_ACTIONS[index];
    if (!action.group) {
      parts.push(renderAction(action));
      index += 1;
      continue;
    }

    const cluster: string[] = [];
    const { group } = action;
    while (
      index < NAVBAR_ACTIONS.length &&
      NAVBAR_ACTIONS[index].group === group
    ) {
      cluster.push(renderAction(NAVBAR_ACTIONS[index]));
      index += 1;
    }
    parts.push(
      `<div class="flex items-center gap-1">${cluster.join('')}</div>`
    );
  }

  container.innerHTML = parts.join('');
  console.log(`[NavbarActions] Rendered ${NAVBAR_ACTIONS.length} actions`);
}

/**
 * Fill the dock buttons' icon slots from the shared icon map. The dock keeps
 * its own markup (labels, active state); only the artwork is shared.
 */
export function renderDockIcons(): void {
  for (const [id, icon] of DOCK_ICONS) {
    const button = document.getElementById(id);
    if (!button) {
      console.warn(`[NavbarActions] Dock button missing: ${id}`);
      continue;
    }
    button.insertAdjacentHTML(
      'afterbegin',
      renderNavIcon(icon, { sizeClass: 'size-5', strokeWidth: 1.5 })
    );
  }
}
