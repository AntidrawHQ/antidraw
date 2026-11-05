import { WorkerEntrypoint } from "cloudflare:workers";

// The Flagship binding for tests (src/test/wrangler.jsonc binds FLAGS to this
// Worker here, and @antidraw/site-worker's tests do the same), so a test says
// what each flag serves instead of relying on wrangler's local flag store. A
// flag is on or off for everyone, or on for a list of users, as a rule on
// userId would be. Tests drive it through the harness (TestServer.flags).

type Flag = boolean | { users: string[] };

const flags = new Map<string, Flag>();
let failing = false;

export default class FlagsStub extends WorkerEntrypoint {
  // The binding's surface (src/lib/features.ts).

  getBooleanValue(key: string, fallback: boolean, context?: { userId?: string }) {
    if (failing) throw new Error("internal error");
    const flag = flags.get(key);
    if (flag === undefined) return fallback;
    if (typeof flag === "boolean") return flag;
    return context?.userId !== undefined && flag.users.includes(context.userId);
  }

  // For tests.

  /** What the flag serves from now on. */
  set(key: string, value: Flag) {
    flags.set(key, value);
  }

  /** As if the flag didn't exist: the caller's fallback is served. */
  clear(key: string) {
    flags.delete(key);
  }

  /** Makes every evaluation throw, as when Flagship can't be reached. */
  setFailing(value: boolean) {
    failing = value;
  }

  fetch() {
    return new Response(null, { status: 404 });
  }
}
