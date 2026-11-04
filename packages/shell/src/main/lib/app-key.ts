import { randomBytes, timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";

// A secret for this launch, handed only to the app's windows' preload (as a
// command-line argument, which only their renderer processes see). The app's
// own pages send it back on every API request: workspace previews share the
// session and the antidraw:// API, but never run the preload, and Electron
// passes the API neither an Origin nor, for the app's own requests, a
// referrer to tell them apart by. Nor does CORS keep them out: a preview
// frame's fetch to antidraw:// goes through, and reads the answer.
export const APP_KEY = randomBytes(32).toString("base64url");

export const APP_KEY_ARG = "--antidraw-app-key=";
export const APP_KEY_HEADER = "x-antidraw-app-key";

export const isAppKey = (value: string | undefined) => {
  const given = Buffer.from(value ?? "");
  const key = Buffer.from(APP_KEY);
  return given.length === key.length && timingSafeEqual(given, key);
};

// The app's own pages only. Without it a preview could run the agent, which
// runs with every permission, publish or delete a workspace, or read the
// account and every conversation.
export const requireAppKey = createMiddleware(async (ctx, next) => {
  if (!isAppKey(ctx.req.header(APP_KEY_HEADER))) {
    return ctx.json(
      { error: { code: "FORBIDDEN", message: "Not available to this page" } },
      403,
    );
  }
  await next();
});
