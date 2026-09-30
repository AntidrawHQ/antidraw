import { randomBytes, timingSafeEqual } from "node:crypto";

// A secret for this launch, handed only to the main window's preload (as a
// command-line argument, which only that renderer process sees). The app's
// own pages send it back on requests that must not come from anywhere else:
// workspace previews share the session and the antidraw:// API, but never
// run the preload, and Electron passes the API neither an Origin nor, for
// the app's own requests, a referrer to tell them apart by.
export const APP_KEY = randomBytes(32).toString("base64url");

export const APP_KEY_ARG = "--antidraw-app-key=";
export const APP_KEY_HEADER = "x-antidraw-app-key";

export const isAppKey = (value: string | undefined) => {
  const given = Buffer.from(value ?? "");
  const key = Buffer.from(APP_KEY);
  return given.length === key.length && timingSafeEqual(given, key);
};
