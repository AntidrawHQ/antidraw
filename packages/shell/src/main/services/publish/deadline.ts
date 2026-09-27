// Bounds on the publish API's JSON requests. Without one, a connection that
// stalls after connecting waits out undici's 300 s header/body timeouts, and a
// publish run (which holds its workspace) waits with it. Complete gets longer,
// and longer still the more objects its publish has: before it commits it
// HEAD-checks every object of the plan no commit has verified (a first
// publish of a large site, up to ~6 000), about 6 at a time at ~30 ms each.
// Begin HEADs almost nothing (only what an earlier unfinished publish left
// unverified). Tests shorten these.
export const cloudTiming = {
  requestTimeoutMs: 30_000,
  completeTimeoutMs: 60_000,
  completePerObjectMs: 5,
};

// Complete's time limit for a publish of `objects` distinct objects (source,
// blobs and site contents); the base alone when the count is unknown.
export const completeTimeoutFor = (objects = 0) =>
  cloudTiming.completeTimeoutMs + Math.max(0, objects) * cloudTiming.completePerObjectMs;

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
