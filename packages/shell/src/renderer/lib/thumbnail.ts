import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

// The workspace's thumbnail, for the workspace viewer: main saves what the
// main window shows of the canvas (main.ts's "thumbnail:capture"). Taken once
// the frames settle after loading, after an edit HMR shows, and at a switch
// if one of those is still waiting. Never while a layer covers the canvas:
// main takes the window's pixels, so it would be in the thumbnail too.

// After a frame's last load or resize: its load comes before its component
// renders (about 300ms before, measured).
const SETTLE_MS = 1000;
// After an edit: its HMR update, and the edits behind it in the same turn.
const EDIT_SETTLE_MS = 3000;
// A frame that never stops resizing (an animation) must not put it off forever.
const MAX_WAIT_MS = 5000;
// The most a workspace switch waits on one.
const SWITCH_TIMEOUT_MS = 500;
// After the last layer over the canvas goes: a frame painted without it.
const UNCOVERED_MS = 100;

type ShownCanvas = {
  workspaceId: string;
  captureSoon: (delay: number) => void;
  flush: () => Promise<void>;
  uncovered: () => void;
};

// The canvas on screen, for the requests that come from outside it.
let shown: ShownCanvas | null = null;

// The layers on screen that can be drawn over the canvas.
let covers = 0;

// For a layer that can be drawn over the canvas (a menu, a dialog, a side
// panel, a toast), while `covering`. A capture due meanwhile waits for the
// last one to go. Counted at the commit that shows it, before it's painted.
export const useCoversCanvas = (covering = true) => {
  useLayoutEffect(() => {
    if (!covering) return;
    covers++;
    return () => {
      covers--;
      if (covers === 0) shown?.uncovered();
    };
  }, [covering]);
};

// The same, rendered in content that's mounted exactly while it's on screen,
// exit animation included (Radix's, motion's AnimatePresence, a toast's).
export const CoversCanvas = () => {
  useCoversCanvas();
  return null;
};

// An edit to one of the workspace's components: a capture once it settles,
// if the workspace is on screen.
export const requestThumbnail = (workspaceId: string) => {
  if (shown?.workspaceId === workspaceId) shown.captureSoon(EDIT_SETTLE_MS);
};

// Before a switch takes the canvas away: the capture it was waiting to take,
// now, or once what covers the canvas (the switcher closing) is gone. With
// none waiting there's nothing to do; the last one is current. Past the
// timeout the switch goes ahead, and the capture is dropped with the canvas.
export const flushThumbnail = () =>
  shown
    ? Promise.race([
        shown.flush(),
        new Promise<void>((resolve) => setTimeout(resolve, SWITCH_TIMEOUT_MS)),
      ])
    : Promise.resolve();

// For the canvas's onFrameActivity. Must be rendered inside the canvas's
// ReactFlowProvider.
export const useCanvasThumbnail = (workspaceId: string) => {
  const store = useStoreApi();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // When the waiting capture is taken at the latest.
  const deadline = useRef(0);
  // A capture that came due while the canvas was covered.
  const held = useRef(false);
  // The switch waiting on that capture.
  const flushed = useRef<() => void>(undefined);

  const capture = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (covers > 0) {
      held.current = true;
      return;
    }
    held.current = false;
    const canvas = store.getState().domNode;
    if (canvas) {
      const { x, y, width, height } = canvas.getBoundingClientRect();
      try {
        await window.electronAPI.captureThumbnail(workspaceId, { x, y, width, height });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
      } catch (error) {
        console.error("[thumbnail]", error);
      }
    }
    flushed.current?.();
    flushed.current = undefined;
  }, [store, workspaceId, queryClient]);

  const captureSoon = useCallback(
    (delay: number) => {
      const now = performance.now();
      if (timer.current === undefined) deadline.current = now + MAX_WAIT_MS;
      clearTimeout(timer.current);
      timer.current = setTimeout(capture, Math.min(delay, deadline.current - now));
    },
    [capture],
  );

  useEffect(() => {
    const canvas: ShownCanvas = {
      workspaceId,
      captureSoon,
      flush: () => {
        if (timer.current === undefined && !held.current) return Promise.resolve();
        if (covers === 0) return capture();
        clearTimeout(timer.current);
        timer.current = undefined;
        held.current = true;
        return new Promise<void>((resolve) => {
          flushed.current = resolve;
        });
      },
      uncovered: () => {
        // A capture still settling is taken when it's due.
        if (!held.current || timer.current !== undefined) return;
        timer.current = setTimeout(capture, UNCOVERED_MS);
      },
    };
    shown = canvas;
    return () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      held.current = false;
      flushed.current = undefined;
      if (shown === canvas) shown = null;
    };
  }, [workspaceId, captureSoon, capture]);

  return useCallback(() => captureSoon(SETTLE_MS), [captureSoon]);
};
