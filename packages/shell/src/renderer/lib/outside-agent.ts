import { useEffect, useRef } from "react";
import type { CanvasMirror } from "@/shared/canvas-mirror";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useSwitchWorkspace } from "./workspace-ops";

// The main window, for coding agents outside the app (main/mcp): only this
// renderer knows which workspace is open and what the inspector has picked,
// so it tells main, and does what they ask of the view (open_workspace,
// focus_component) the way its own controls do.

// A burst of picks (a walk up the tree, a tag after a select) goes as one.
const MIRROR_DEBOUNCE_MS = 100;

const mirror = (): CanvasMirror => {
  const { selection, tags } = useInspectorStore.getState();
  return { activeWorkspaceId: useWorkspaceStore.getState().activeWorkspaceId, selection, tags };
};

// Now, then on every change. Returns the stop.
const startMirror = () => {
  // Optional: a renderer hot-reloaded over an older preload lacks it.
  const send = window.electronAPI?.mirrorCanvas;
  if (!send) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => send(mirror()), MIRROR_DEBOUNCE_MS);
  };
  const stops = [
    useWorkspaceStore.subscribe((s, prev) => {
      if (s.activeWorkspaceId !== prev.activeWorkspaceId) later();
    }),
    useInspectorStore.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.tags !== prev.tags) later();
    }),
  ];
  send(mirror());
  return () => {
    clearTimeout(timer);
    stops.forEach((stop) => stop());
  };
};

export const useOutsideAgent = () => {
  const switchWorkspace = useSwitchWorkspace();
  const latest = useRef(switchWorkspace);
  latest.current = switchWorkspace;

  useEffect(startMirror, []);

  useEffect(() => {
    const stops = [
      window.electronAPI?.onOpenWorkspace?.((id) => void latest.current(id).catch(console.error)),
      window.electronAPI?.onFocusComponent?.((name) => useWorkspaceStore.getState().setFocusComponentName(name)),
    ];
    return () => stops.forEach((stop) => stop?.());
  }, []);
};
