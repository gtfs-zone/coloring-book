/**
 * Feed issue actions and the full issue list.
 *
 * `runFeedIssueAction` is the one dispatch for an issue row's buttons, on the
 * home card and in the modal alike: it looks the action up in the registry,
 * confirms with the count, and runs it on that row's group only.
 *
 * `showFeedIssuesModal` lists every entity of every group, one group per
 * sidebar entry. An item click navigates, and the modal router closes the
 * modal because the new page state no longer names it.
 */

import { showModal } from 'gtfs-zone-web-common/ui/modal-utils';
import { showSidebarModal } from 'gtfs-zone-web-common/ui/sidebar-modal';
import type { IssueItem } from 'gtfs-zone-web-common/ui/issue-card';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import type { EditableTableDeps } from './editable-table';
import {
  feedIssueGroupLabel,
  getFeedIssueGroup,
  getFeedIssueGroups,
  getFeedIssueItems,
  getIssueAction,
  getIssueActions,
  groupKey,
  refreshFeedIssuesIfStale,
  type IssueGroup,
} from './feed-issues';
import {
  navigateToAgency,
  navigateToPathway,
  navigateToRoute,
  navigateToService,
  navigateToStop,
  openTimetable,
} from './navigation-actions';
import { t } from '../i18n/messages';

/**
 * Confirm and run one action on one group. Re-reads the group after a
 * revalidation first, so the count in the confirm and the rows the action
 * touches are those of the feed as it is now.
 *
 * Returns true when the action ran.
 */
export async function runFeedIssueAction(
  key: string,
  actionId: string,
  deps: EditableTableDeps
): Promise<boolean> {
  await refreshFeedIssuesIfStale();
  const group = getFeedIssueGroup(key);
  if (!group || group.entities.length === 0) {
    console.warn(`[FeedIssues] ${key} is no longer an issue`);
    notify.warning(t('issues.gone'));
    return false;
  }
  const action = getIssueAction(group, actionId);
  if (!action) {
    console.error(`[FeedIssues] no action ${actionId} for ${key}`);
    notify.error(t('issues.unknownAction', { id: actionId }));
    return false;
  }

  let confirmed = false;
  await showModal({
    title: t('issues.confirmTitle', { label: escapeHtml(action.label) }),
    body: `<p>${escapeHtml(action.confirm(group.entities))}</p>`,
    actions: [
      { label: t('common.cancel'), className: 'btn-ghost', onClick: () => {} },
      {
        label: escapeHtml(action.label),
        className: action.destructive ? 'btn-error' : 'btn-primary',
        onClick: () => {
          confirmed = true;
        },
      },
    ],
    escapeAction: 0,
    enterAction: 1,
    boxClassName: 'max-w-md',
  });
  if (!confirmed) {
    console.log(`[FeedIssues] ${actionId} on ${key} cancelled`);
    return false;
  }

  console.log(
    `[FeedIssues] running ${actionId} on ${key} (${group.entities.length} entities)`
  );
  try {
    notify.success(await action.run(group.entities, deps));
  } catch (error) {
    console.error(`[FeedIssues] ${actionId} on ${key} failed:`, error);
    notify.error(`${action.label} failed, see the console`);
    return false;
  }
  return true;
}

/** Navigate to the object an issue item's data attributes name. */
export function navigateToIssueItem(item: Element): void {
  const nav = item.getAttribute('data-issue-nav');
  // A trip opens its route+service timetable, not a page of its own.
  if (nav === 'timetable') {
    const route_id = item.getAttribute('data-issue-route-id');
    const service_id = item.getAttribute('data-issue-service-id');
    if (route_id && service_id) {
      void openTimetable(
        route_id,
        service_id,
        item.getAttribute('data-issue-direction-id') ?? undefined
      );
    }
    return;
  }
  const id = item.getAttribute('data-issue-id');
  if (!id) {
    return;
  }
  if (nav === 'agency') {
    void navigateToAgency(id);
  } else if (nav === 'route') {
    void navigateToRoute(id);
  } else if (nav === 'stop') {
    void navigateToStop(id);
  } else if (nav === 'service') {
    void navigateToService(id);
  } else if (nav === 'pathway') {
    void navigateToPathway(id);
  } else {
    console.warn(`[FeedIssues] unknown issue nav ${nav}`);
  }
}

/** The same item markup the issue card draws. */
function renderItem(item: IssueItem): string {
  const attrs = Object.entries(item.data ?? {})
    .map(([name, value]) => ` data-${name}="${escapeHtml(value)}"`)
    .join('');
  const clickable = item.data && Object.keys(item.data).length > 0;
  const classes = clickable
    ? 'link link-hover cursor-pointer'
    : 'opacity-70 cursor-default';
  const detail = item.detail
    ? ` <span class="opacity-50">${escapeHtml(item.detail)}</span>`
    : '';
  return `<li><span class="${classes}"${attrs}>${escapeHtml(item.label)}</span>${detail}</li>`;
}

function renderPane(key: string, group: IssueGroup): string {
  const actions = getIssueActions(group);
  const buttons =
    actions.length > 0
      ? `<div class="flex flex-wrap gap-2 mb-3">${actions
          .map(
            (action) =>
              `<button type="button" class="btn btn-sm btn-warning btn-outline" data-issue-key="${escapeHtml(key)}" data-issue-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
          )
          .join('')}</div>`
      : '';
  const items = getFeedIssueItems(group).map(renderItem).join('');
  return `${buttons}<ul class="space-y-0.5 text-sm list-disc list-inside">${items}</ul>`;
}

/**
 * Every entity of every group that has any, opened on the group `initialKey`
 * names. Resolves once the modal closes.
 */
export async function showFeedIssuesModal(
  deps: EditableTableDeps | undefined,
  initialKey?: string
): Promise<void> {
  const groups = getFeedIssueGroups().filter(
    (group) => group.entities.length > 0
  );
  if (initialKey && !groups.some((group) => groupKey(group) === initialKey)) {
    console.warn(`[FeedIssues] ${initialKey} is not an issue any more`);
  }

  await showSidebarModal({
    title: t('issues.title'),
    initialId: initialKey,
    entries: groups.map((group) => {
      const key = groupKey(group);
      const { label, note } = feedIssueGroupLabel(group);
      return {
        id: key,
        label,
        count: () => Promise.resolve(group.count),
        paneTitle: label,
        note: note ? escapeHtml(note) : undefined,
        renderPane: () => Promise.resolve(renderPane(key, group)),
      };
    }),
    onPaneRendered: (pane, close) => {
      pane.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        const button = target.closest<HTMLButtonElement>('[data-issue-action]');
        if (button) {
          const key = button.getAttribute('data-issue-key') ?? '';
          const actionId = button.getAttribute('data-issue-action') ?? '';
          if (!deps) {
            notify.error(t('page.readOnly'));
            return;
          }
          button.disabled = true;
          void runFeedIssueAction(key, actionId, deps).then((ran) => {
            // The groups this modal lists are from before the run.
            if (ran) {
              close();
            } else {
              button.disabled = false;
            }
          });
          return;
        }
        const item = target.closest('[data-issue-nav]');
        if (item) {
          navigateToIssueItem(item);
        }
      });
    },
  });
}
