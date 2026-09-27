import type { Bindings } from "./lib/env";
import { makeGcDeps, runGc } from "./services/gc.service";

// The cron trigger (wrangler.jsonc): the hourly publish GC (GC_CRON).
export const scheduled: ExportedHandlerScheduledHandler<Bindings> = (_controller, env, ctx) => {
  ctx.waitUntil(runGc(makeGcDeps(env), new Date()).then((report) => console.log("gc", report)));
};
