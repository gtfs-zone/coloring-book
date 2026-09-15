/**
 * Timetable Modal
 *
 * The timetable is a modal, not a page: it takes the screen over so a wide
 * grid has room, and closing it returns to whatever page the user opened it
 * from.
 *
 * Two things keep it in sync while it is open, neither of which reopens it:
 * - a navigation handler, for the selector bar repointing it at another route,
 *   service or direction (the router leaves a modal of the same type alone);
 * - a patch handler, for every recorded edit, since the browse panel behind
 *   the modal no longer renders the timetable.
 *
 * Both funnel into `refreshCurrentTimetable`, which replaces `#schedule-view`
 * in place and carries the scroll position, the open cell editor and the grid
 * selection across the rebuild.
 */

import type { ScheduleController } from './schedule-controller';
import type { PatchManager } from './patch-manager';
import { NavigationEvent, TimetableModalState } from '../types/page-state';
import { getPageStateManager } from './page-state-manager';
import { showModal } from 'interlocking/modules/modal-utils';
import { notify } from 'interlocking/modules/notification-system';

export interface TimetableModalDeps {
  scheduleController: ScheduleController;
  patchManager: PatchManager;
}

/** Room for a wide grid: the modal is the timetable, not a dialog about it. */
const BOX_CLASS = 'max-w-none w-[98vw] h-[95vh] max-h-none';

/** Patch events that change what the timetable shows. */
const PATCH_EVENTS = ['change', 'undo', 'redo', 'jump'] as const;

/**
 * Open the timetable modal and resolve once it closes.
 *
 * Resolves immediately, without opening anything, when the feed has no
 * timetable to show; the router then clears the modal out of the hash.
 */
export async function showTimetableModal(
  deps: TimetableModalDeps,
  modal: TimetableModalState
): Promise<void> {
  const { scheduleController, patchManager } = deps;

  const target = await scheduleController.resolveTimetableTarget(modal);
  if (!target) {
    notify.warning('This feed has no trips yet, so there is no timetable.');
    return;
  }

  const body = await scheduleController.renderSchedule(
    target.route_id,
    target.service_id,
    target.direction_id
  );

  const rebuild = (next?: TimetableModalState) => {
    scheduleController
      .refreshCurrentTimetable(
        next && {
          route_id: next.route_id,
          service_id: next.service_id,
          ...(next.direction_id !== undefined && {
            direction_id: next.direction_id,
          }),
        }
      )
      .catch((e: unknown) =>
        console.error('[TimetableModal] rebuild failed:', e)
      );
  };

  // A hash change that keeps the modal open but names another timetable: the
  // selector bar, a link, or a back/forward step between two timetables.
  const onNavigate = (event: NavigationEvent) => {
    const next = event.to.modal;
    if (next?.type === 'timetable') {
      rebuild(next);
    }
  };
  getPageStateManager().addNavigationHandler(onNavigate);

  const onPatch = () => rebuild();
  PATCH_EVENTS.forEach((event) => patchManager.on(event, onPatch));

  try {
    await showModal({
      title: 'Timetable',
      body,
      actions: [{ label: 'Close', onClick: () => {} }],
      escapeAction: 0,
      boxClassName: BOX_CLASS,
      onMount: () => scheduleController.applyTimetableSelection(),
    });
  } finally {
    getPageStateManager().removeNavigationHandler(onNavigate);
    PATCH_EVENTS.forEach((event) => patchManager.off(event, onPatch));
  }
}
