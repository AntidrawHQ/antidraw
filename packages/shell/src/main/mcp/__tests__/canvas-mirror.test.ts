import { EventEmitter } from "node:events";
import { afterEach, expect, test } from "vitest";
import type { WebContents } from "electron";
import { clearMirror, dropMirrorWith, getMirror, setMirror } from "@/main/mcp/canvas-mirror";

// The mirror's life: it's the page's that sent it, and goes when that page
// does. The page is an emitter standing in for Electron's WebContents.

afterEach(() => clearMirror());

const mirrored = () => {
  const page = new EventEmitter();
  dropMirrorWith(page as unknown as WebContents);
  const mirror = () => expect(setMirror({ activeWorkspaceId: "ws-1", selection: null, tags: [] })).toBe(true);
  mirror();
  return { page, mirror };
};

test("a mirror is held while its page lives", () => {
  mirrored();
  expect(getMirror()).toMatchInlineSnapshot(`
    {
      "activeWorkspaceId": "ws-1",
      "selection": null,
      "tags": [],
    }
  `);
});

test("it goes when the page's renderer dies, loads anew, or is destroyed, and not on a route change", () => {
  const { page, mirror } = mirrored();
  const after = (event: string, ...args: unknown[]) => {
    mirror();
    page.emit(event, ...args);
    return getMirror().activeWorkspaceId;
  };
  expect({
    "render-process-gone": after("render-process-gone", {}, { reason: "crashed" }),
    "did-start-navigation, a reload": after("did-start-navigation", { isMainFrame: true, isSameDocument: false }),
    "did-start-navigation, a route change": after("did-start-navigation", { isMainFrame: true, isSameDocument: true }),
    "did-start-navigation, a frame within": after("did-start-navigation", { isMainFrame: false, isSameDocument: false }),
    destroyed: after("destroyed"),
  }).toMatchInlineSnapshot(`
    {
      "destroyed": null,
      "did-start-navigation, a frame within": "ws-1",
      "did-start-navigation, a reload": null,
      "did-start-navigation, a route change": "ws-1",
      "render-process-gone": null,
    }
  `);
});

test("the page that comes up after a reload mirrors again", () => {
  const { page, mirror } = mirrored();
  page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  expect(getMirror().activeWorkspaceId).toBeNull();
  mirror();
  expect(getMirror().activeWorkspaceId).toBe("ws-1");
  // And is dropped again on the next: the listeners stay with the page.
  page.emit("render-process-gone", {}, { reason: "crashed" });
  expect(getMirror().activeWorkspaceId).toBeNull();
});
