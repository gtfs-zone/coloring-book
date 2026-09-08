/**
 * Await a macrotask so the event loop drains between chunks of a long job.
 *
 * A macrotask rather than a microtask: a resolved promise runs before the
 * browser paints, so it would not let the progress bar animate.
 *
 * MessageChannel rather than setTimeout: a hidden tab clamps timers to about
 * one second, so a job that yields per pass or per chunk of rows stops being
 * slow and starts being a hang. Measured in Firefox with the tab hidden, ten
 * `setTimeout(0)` round trips took 10059ms and ten MessageChannel round trips
 * took 1ms. A posted message is still a macrotask, so painting is unaffected.
 */
const yieldChannel =
  typeof MessageChannel === 'function' ? new MessageChannel() : null;
const yieldWaiters: Array<() => void> = [];

if (yieldChannel) {
  yieldChannel.port1.onmessage = () => {
    yieldWaiters.shift()?.();
  };
}

export function yieldToEventLoop(): Promise<void> {
  if (!yieldChannel) {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    yieldWaiters.push(resolve);
    yieldChannel.port2.postMessage(0);
  });
}
