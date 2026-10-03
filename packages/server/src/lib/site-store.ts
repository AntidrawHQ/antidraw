import { SiteStore } from "@antidraw/site-upload/server";
import type { Bindings } from "./env";

// One store per isolate, as @antidraw/site-upload asks: its plan cache then
// lasts across a publish's uploads. Built on first use, since the bucket is
// only reachable from a request's env.
let store: SiteStore | undefined;

export const siteStore = (env: Bindings) => (store ??= new SiteStore({ bucket: env.SITES }));
