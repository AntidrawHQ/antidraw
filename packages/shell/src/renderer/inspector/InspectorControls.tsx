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

// Keys are the inspector's only when nothing else has focus, or the canvas
// does: in a menu, a dialog or a panel they're that one's.
const isCanvasKey = (e: KeyboardEvent) =>
  !e.metaKey &&
  !e.ctrlKey &&
  !e.altKey &&
  !isTyping(e.target) &&
  (e.target === document.body || (e.target instanceof Element && !!e.target.closest(".react-flow")));

export const InspectorControls = () => {
  const active = useInspectorStore((s) => s.active);
  const setActive = useInspectorStore((s) => s.setActive);

  useEffect(() => {
    // Ahead of React Flow, which moves a focused node with the arrows.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || !isCanvasKey(e)) return;
      const s = useInspectorStore.getState();
      if (e.key === "i") s.setActive(!s.active);
      else if (!s.active) return;
      else if (e.key === "Enter" && s.selection) s.addTag(s.selection);
      else if (ARROWS[e.key] && s.selection) void walk(ARROWS[e.key]!);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // After everything else: an open menu, dialog or panel closes first, and
    // marks the Escape handled.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !isCanvasKey(e)) return;
      const s = useInspectorStore.getState();
      if (!s.active) return;
      if (s.selection) clearSelection();
      else s.setActive(false);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEscape);
      // Leaving the canvas ends inspecting, and the frame's selection.
      useInspectorStore.getState().setActive(false);
      clearSelection();
    };
  }, []);

  return (
    <Panel position="top-center">
      <button
        type="button"
        aria-pressed={active}
        onClick={() => setActive(!active)}
        className="rounded-md border border-white/10 bg-neutral-900/90 px-2.5 py-1 text-xs text-white/70 hover:text-white"
      >
        {active ? "Inspecting · Esc to stop" : "Inspect · I"}
      </button>
    </Panel>
  );
};
