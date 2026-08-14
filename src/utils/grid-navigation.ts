/**
 * Keyboard direction mapping for the app's editable grids.
 *
 * The timetable and the Files modal are two different table implementations,
 * so this exists only to keep them from drifting on what Enter and Tab mean.
 * It knows nothing about either grid's row model.
 */

export type GridDirection = 'up' | 'down' | 'left' | 'right';

/**
 * The cell movement a keypress asks for, or null if it asks for none.
 *
 * ArrowLeft/ArrowRight are deliberately absent: in a live text input they move
 * the caret, which matters for fixing a single digit of a time string. Vertical
 * arrows are free because the inputs are single-line, but callers opt into them
 * separately since not every editor sits in a grid.
 */
export function keyToGridDirection(e: KeyboardEvent): GridDirection | null {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return null;
  }

  switch (e.key) {
    case 'Enter':
      return e.shiftKey ? 'up' : 'down';
    case 'Tab':
      return e.shiftKey ? 'left' : 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}

/** True for the directions only a grid with a vertical axis should act on. */
export function isVerticalArrow(e: KeyboardEvent): boolean {
  return e.key === 'ArrowUp' || e.key === 'ArrowDown';
}
