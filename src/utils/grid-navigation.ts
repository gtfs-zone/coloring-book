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

/**
 * The cell movement an arrow key asks for, with no editor open.
 *
 * The counterpart to `keyToGridDirection`: once a cell is merely selected there
 * is no caret to protect, so the horizontal arrows move between cells too.
 * Enter and Tab are absent because they mean something else in this mode -
 * Enter opens the editor, Tab leaves the grid entirely.
 */
export function arrowToGridDirection(e: KeyboardEvent): GridDirection | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
    return null;
  }

  switch (e.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

/** True for the directions only a grid with a vertical axis should act on. */
export function isVerticalArrow(e: KeyboardEvent): boolean {
  return e.key === 'ArrowUp' || e.key === 'ArrowDown';
}
