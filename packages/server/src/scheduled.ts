import type { Bindings } from "./lib/env";
import { gcModeFor, makeGcDeps, runGc } from "./services/gc.service";

// Cron triggers (wrangler.jsonc): the hourly publish GC (GC_CRON), and site
// cleanup alone every five minutes (GC_SITE_CLEANUP_CRON).
export const scheduled: ExportedHandlerScheduledHandler<Bindings> = (controller, env, ctx) => {
  const mode = gcModeFor(controller.cron);
  ctx.waitUntil(
    runGc(makeGcDeps(env), new Date(), mode).then((report) => console.log("gc", mode, report)),
  );
};
