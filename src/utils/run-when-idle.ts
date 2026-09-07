/**
 * Run a job once the browser is idle, so it cannot extend the task that
 * scheduled it. Used for post-load work the user does not have to wait for:
 * validation, the map's route build.
 *
 * Returns a canceller, so a job scheduled for one feed can be dropped when the
 * next feed arrives before it has run.
 *
 * Falls back to a macrotask where requestIdleCallback is missing (Safari).
 */
export function runWhenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback !== 'undefined') {
    const id = requestIdleCallback(fn);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}
