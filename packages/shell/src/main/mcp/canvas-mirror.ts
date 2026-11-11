import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { z } from "zod";
import { EMPTY_MIRROR, type CanvasMirror } from "@/shared/canvas-mirror";

// The main window's canvas as its renderer last mirrored it
// (renderer/lib/outside-agent.ts), in memory: gone with the window, and
// sent again by the next one as it starts.

let mirror: CanvasMirror = EMPTY_MIRROR;
const events = new EventEmitter<{ changed: [CanvasMirror] }>();

// The renderer's word is taken on the shape only: the picks are the frames'
// own descriptions, which tools hand on as they are.
const pick = z.object({
  frame: z.string(),
  info: z.looseObject({ ref: z.looseObject({ loc: z.string().nullable(), index: z.number() }) }),
  seen: z.unknown().optional(),
});
const mirrorSchema = z.object({
  activeWorkspaceId: z.string().nullable(),
  selection: pick.nullable(),
  tags: z.array(pick),
});

export const getMirror = () => mirror;

// False when it isn't a mirror.
export const setMirror = (value: unknown) => {
  const parsed = mirrorSchema.safeParse(value);
  if (!parsed.success) return false;
  mirror = parsed.data as CanvasMirror;
  events.emit("changed", mirror);
  return true;
};

export const clearMirror = () => {
  mirror = EMPTY_MIRROR;
  events.emit("changed", mirror);
};

// The mirror goes with the page that sent it: when its window closes, its
// renderer dies, or it loads anew (a reload keeps the WebContents, and the
// page that comes up mirrors again as it starts). A route change within the
// page is the same document, and keeps it.
export const dropMirrorWith = (page: WebContents) => {
  page.once("destroyed", clearMirror);
  page.on("render-process-gone", clearMirror);
  page.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) clearMirror();
  });
};

// Resolves true once the mirror is as `until` wants it, false after `ms`.
export const waitForMirror = (until: (m: CanvasMirror) => boolean, ms: number) =>
  new Promise<boolean>((resolve) => {
    if (until(mirror)) return resolve(true);
    const done = (result: boolean) => {
      clearTimeout(timer);
      events.off("changed", check);
      resolve(result);
    };
    const check = (m: CanvasMirror) => until(m) && done(true);
    const timer = setTimeout(() => done(false), ms);
    events.on("changed", check);
  });
