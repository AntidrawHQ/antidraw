import { useEffect } from "react";
import { Panel } from "@xyflow/react";
import type { WalkDirection } from "@antidrawapp/runtime/inspector";
import { clearSelection, walk } from "./bridge";
import { useInspectorStore } from "./store";

// The inspector's switch and keys, rendered inside the canvas. Placeholder UI.
//   I            inspect on / off
//   Esc          clear the selection, then stop inspecting
//   Enter        tag the selection for the next chat message
//   ↑ ↓ ← →      parent, first child, previous and next sibling

const ARROWS: Record<string, WalkDirection> = {
  ArrowUp: "parent",
  ArrowDown: "child",
  ArrowLeft: "prev",
  ArrowRight: "next",
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export const InspectorControls = () => {
  const active = useInspectorStore((s) => s.active);
  const setActive = useInspectorStore((s) => s.setActive);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const s = useInspectorStore.getState();
      if (e.key === "i") s.setActive(!s.active);
      else if (!s.active) return;
      else if (e.key === "Escape") {
        if (s.selection) clearSelection();
        else s.setActive(false);
      } else if (e.key === "Enter" && s.selection) s.addTag(s.selection);
      else if (ARROWS[e.key] && s.selection) void walk(ARROWS[e.key]!);
      else return;
      // Ahead of React Flow, which moves a focused node with the arrows.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Leaving the canvas (another workspace) ends inspecting.
      useInspectorStore.getState().setActive(false);
      useInspectorStore.getState().setSelection(null);
    };
  }, []);

  return (
    <Panel position="top-center">
      <button
        type="button"
        onClick={() => setActive(!active)}
        className="rounded-md border border-white/10 bg-neutral-900/90 px-2.5 py-1 text-xs text-white/70 hover:text-white"
      >
        {active ? "Inspecting · Esc to stop" : "Inspect · I"}
      </button>
    </Panel>
  );
};
