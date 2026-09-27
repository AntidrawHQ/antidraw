import type { Bindings } from "./lib/env";
import { makeGcDeps, runGc } from "./services/gc.service";

// Cron trigger ("17 3 * * *" in wrangler.jsonc): the nightly publish GC.
export const scheduled: ExportedHandlerScheduledHandler<Bindings> = (_controller, env, ctx) =>
  ctx.waitUntil(runGc(makeGcDeps(env), new Date()).then((report) => console.log("gc", report)));
