/**
 * IndexedDB request helpers.
 *
 * An IndexedDB request can sit unanswered forever: one queued behind a blocked
 * version-change operation fires no event at all, not success, not error, not
 * even blocked. Anything on the boot path that waits on a raw request goes
 * through here so a wedged database surfaces instead of hanging.
 */
import { CONFIG } from '../config';

/**
 * Resolve with the promise's value, or null if it has not settled in `ms`.
 * Only use this where a null result is distinguishable from a real one.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number = CONFIG.DB_REQUEST_TIMEOUT_MS
): Promise<T | null> {
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) {
          // Gave up on this one already: close it rather than leave a
          // connection open, which would block the next upgrade exactly the
          // way the abandoned request did.
          (value as { close?: () => void } | null)?.close?.();
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!timedOut) {
          console.warn('[idb] request failed:', error);
          resolve(null);
        }
      }
    );
  });
}

/**
 * Delete a database, reporting what actually happened.
 *
 * `blocked` is not success: the request stays queued until every connection to
 * the database closes, and until then it stalls every later request on that
 * database. Callers must keep the user in the loop rather than reload into a
 * wedge.
 */
export function deleteDatabaseWithTimeout(
  name: string,
  ms: number = CONFIG.DB_REQUEST_TIMEOUT_MS
): Promise<'deleted' | 'blocked' | 'error'> {
  return new Promise((resolve) => {
    let blocked = false;
    let settled = false;
    const finish = (outcome: 'deleted' | 'blocked' | 'error') => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => finish('deleted');
    req.onerror = () => {
      console.error('[idb] deleteDatabase failed:', req.error);
      finish('error');
    };
    req.onblocked = () => {
      blocked = true;
      console.warn(
        '[idb] deleteDatabase blocked: another connection is still open'
      );
    };
    // A blocked delete completes on its own once the last connection closes, so
    // the request is deliberately left running; only the wait ends here.
    setTimeout(() => finish(blocked ? 'blocked' : 'error'), ms);
  });
}
