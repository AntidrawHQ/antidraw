import { useCallback, useEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

// The workspace's thumbnail, for the workspace viewer: main saves what the
// main window shows of the canvas (main.ts's "thumbnail:capture"). Taken once
// the frames settle after loading, after an edit HMR shows, and at a switch
// if one of those is still waiting.

// After a frame's last load or resize: its load comes before its component
// renders (about 300ms before, measured).
const SETTLE_MS = 1000;
// After an edit: its HMR update, and the edits behind it in the same turn.
const EDIT_SETTLE_MS = 3000;
// A frame that never stops resizing (an animation) must not put it off forever.
const MAX_WAIT_MS = 5000;
// The most a workspace switch waits on one.
const SWITCH_TIMEOUT_MS = 500;

type ShownCanvas = {
  workspaceId: string;
  captureSoon: (delay: number) => void;
  flush: () => Promise<void>;
};

// The canvas on screen, for the requests that come from outside it.
let shown: ShownCanvas | null = null;

// An edit to one of the workspace's components: a capture once it settles,
// if the workspace is on screen.
export const requestThumbnail = (workspaceId: string) => {
  if (shown?.workspaceId === workspaceId) shown.captureSoon(EDIT_SETTLE_MS);
};

// Before a switch takes the canvas away: the capture it was waiting to take,
// now. With none waiting there's nothing to do; the last one is current.
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

  const capture = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const canvas = store.getState().domNode;
    if (!canvas) return;
    const { x, y, width, height } = canvas.getBoundingClientRect();
    try {
      await window.electronAPI.captureThumbnail(workspaceId, { x, y, width, height });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
    } catch (error) {
      console.error("[thumbnail]", error);
    }
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
      flush: () => (timer.current === undefined ? Promise.resolve() : capture()),
    };
    shown = canvas;
    return () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      if (shown === canvas) shown = null;
    };
  }, [workspaceId, captureSoon, capture]);

  return useCallback(() => captureSoon(SETTLE_MS), [captureSoon]);
};
