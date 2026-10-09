import { useEffect } from "react";
import { setCanvasTool, useCommentStore } from "./store";

// The Comment tool's keys, mounted inside the canvas, as InspectorControls'.
//   C     start commenting (it stays on: Esc or V stops it)
//   V     back to the pointer
//   Esc   close the open comment, then stop commenting
// The box's own field takes its keys first (↵, ⌘↵, Esc).

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const isCanvasKey = (e: KeyboardEvent) =>
  !e.metaKey &&
  !e.ctrlKey &&
  !e.altKey &&
  !isTyping(e.target) &&
  (e.target === document.body || (e.target instanceof Element && !!e.target.closest(".react-flow")));

export const CommentControls = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || !isCanvasKey(e)) return;
      const s = useCommentStore.getState();
      if (e.key === "c") setCanvasTool("comment");
      else if (!s.active) return;
      else if (e.key === "v") setCanvasTool("pointer");
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // After everything else: an open menu, dialog or panel closes first.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !isCanvasKey(e)) return;
      const s = useCommentStore.getState();
      if (!s.active) return;
      if (s.box || s.opened) {
        s.setBox(null);
        s.setOpened(null);
      } else s.setActive(false);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEscape);
      // Leaving the canvas ends commenting.
      useCommentStore.getState().setActive(false);
    };
  }, []);

  return null;
};
