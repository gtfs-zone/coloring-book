/**
 * Await a macrotask so the event loop drains between chunks of a long job.
 *
 * setTimeout rather than a microtask: a resolved promise runs before the
 * browser paints, so it would not let the progress bar animate.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
