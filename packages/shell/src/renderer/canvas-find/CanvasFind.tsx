import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useFocusComponent } from "@/renderer/canvas/Canvas";
import { useDesignStore } from "@/renderer/design/store";
import { CoversCanvas } from "@/renderer/lib/thumbnail";
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
  // Out of sight (under the dashboard), or no frames to find: ⌘F isn't the
  // canvas's, and an open find closes (keeping its query).
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
    // Only when open: closed (keysOff coming on), the query stays as it was.
    const input = card.current?.querySelector("input");
    if (input) lastQuery.current = input.value;
    setOpen(false);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (keysOff) closeRef.current();
  }, [keysOff]);

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
    // A right-click in it is its own, not the canvas's menu (Paste here,
    // Select all), which listens on the canvas around it.
    const onContextMenu = (e: MouseEvent) => e.stopPropagation();
    const el = card.current;
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    el?.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
      el?.removeEventListener("contextmenu", onContextMenu);
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
      {/* Over the canvas: not in its thumbnail. */}
      <CoversCanvas />
      <ComponentSearch
        components={names}
        initialQuery={lastQuery.current}
        onGoTo={(name) => focusComponent(name, { duration: 0 })}
        onClose={close}
      />
    </div>
  );
};
