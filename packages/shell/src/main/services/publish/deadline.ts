// Bounds on the publish API's JSON requests. Without one, a connection that
// stalls after connecting waits out undici's 300 s header/body timeouts, and a
// publish run (which holds its workspace) waits with it. Complete gets longer:
// it verifies up to ~500 stored objects before it commits. Tests shorten both.
export const cloudTiming = {
  requestTimeoutMs: 30_000,
  completeTimeoutMs: 60_000,
};

export const ABORTED = Symbol("aborted");

// Settles with the promise, or with ABORTED as soon as `signal` fires,
// whichever is first. The promise keeps running; a later rejection is
// swallowed. For work that takes no signal of its own, and as a backstop for
// work that might not honour one.
export const untilAborted = <T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof ABORTED> =>
  new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
