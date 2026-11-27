import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
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

export const CanvasFind = ({
  components,
  keysOff = false,
}: {
  components: { name: string }[];
  // Out of sight (under the dashboard): ⌘F isn't the canvas's.
  keysOff?: boolean;
}) => {
  const focusComponent = useFocusComponent();
  const [open, setOpen] = useState(false);
  const lastQuery = useRef("");
  const card = useRef<HTMLDivElement>(null);
  const names = useMemo(() => components.map((c) => c.name), [components]);
  // The right panel hidden, its Show button has the corner.
  const panelOpen = useDesignStore((s) => s.panelOpen);

  // Mod is ⌘ on macOS, Ctrl elsewhere; the letter F, whatever key types it.
  // Typing in a field (this one too) doesn't stop it.
  useHotkey(
    "Mod+F",
    () => {
      const input = card.current?.querySelector("input");
      if (input) {
        input.focus();
        input.select();
      } else setOpen(true);
    },
    { enabled: !keysOff },
  );

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
        // nokey: a key here is never React Flow's (Backspace deleting a frame).
        "nodrag nopan nowheel nokey absolute z-40",
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
