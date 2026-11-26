import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusComponent } from "@/renderer/canvas/Canvas";
import { useDesignStore } from "@/renderer/design/store";
import { cn } from "@/renderer/lib/utils";
import { ComponentSearch } from "./ComponentSearch";

// ⌘F (Ctrl+F off macOS) finds a component on the canvas and goes to it, as a
// Components tab row does, but at once: no flight. Rendered inside the Canvas.
//
// Open, it stays open (like a browser's find) until Esc, × or a click outside
// it; ⌘F again puts the focus back in it with its text selected. Closed and reopened, it has
// the last query.

const isMac = navigator.userAgent.includes("Mac");

export const CanvasFind = ({ components }: { components: { name: string }[] }) => {
  const focusComponent = useFocusComponent();
  const [open, setOpen] = useState(false);
  const lastQuery = useRef("");
  const card = useRef<HTMLDivElement>(null);
  const names = useMemo(() => components.map((c) => c.name), [components]);
  // The right panel hidden, its Show button has the corner.
  const panelOpen = useDesignStore((s) => s.panelOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (e.code !== "KeyF" || !mod || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const input = card.current?.querySelector("input");
      if (input) {
        input.focus();
        input.select();
      } else setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    lastQuery.current = card.current?.querySelector("input")?.value ?? "";
    setOpen(false);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // A click outside it closes it: anywhere in the window, or into a frame
  // (a frame is its own document, so that click only shows as the window's blur).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!card.current?.contains(e.target as Node)) closeRef.current();
    };
    const onBlur = () =>
      setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) closeRef.current();
      });
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={card}
      className={cn(
        "nodrag nopan nowheel absolute z-40",
        panelOpen ? "right-3 top-3" : "right-[60px] top-4",
      )}
    >
      <ComponentSearch
        components={names}
        initialQuery={lastQuery.current}
        onGoTo={(name) => focusComponent(name, { duration: 0 })}
        onClose={close}
      />
    </div>
  );
};
