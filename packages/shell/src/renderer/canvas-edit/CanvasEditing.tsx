import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
import { useFormatForDisplay, useHotkeys } from "@tanstack/react-hotkeys";
import { DropdownMenu } from "radix-ui";
import { useCanvasControls, type FrameNode } from "@/renderer/canvas/Canvas";
import { CoversCanvas } from "@/renderer/lib/thumbnail";
import { cn } from "@/renderer/lib/utils";
import { MENU, menuItem } from "@/renderer/dashboard/kit";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useCommentStore } from "@/renderer/comments/store";
import { CLIP_TYPE, useFrameEdits, type FrameEdits } from "./use-frame-edits";

// The canvas's editing: its shortcuts, the clipboard, and its right-click
// menu. Rendered inside the Canvas.
//
// The keys are the canvas's only while it's the part of the window in use:
// since the last press (or focus) landed in it. Typing anywhere is left
// alone, and so is a key the canvas has nothing to do with (Mod+A with no
// frames to select still selects the page's text).
//
// Copy, cut and paste come as the page's clipboard events, not as keys:
// the window's Edit menu has the keys, and either way the page gets the
// event. Inside a frame (one that's interactive) the keys are the frame's
// page's, so its text copies as text.

const isMac = navigator.userAgent.includes("Mac");

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || el.matches("input, textarea, select"));
};
const textSelected = () => {
  const selection = document.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().length > 0;
};

// The menu's own, outside the canvas, but a press there is still the canvas's.
const MENU_ATTR = "data-canvas-menu";

// The menu as it opened: where, on which frames (null: on the canvas around
// them), and whether there were frames to paste. Kept from the click, as the
// selection it makes isn't the canvas's until after the menu is drawn.
type Menu = {
  x: number;
  y: number;
  frames: { componentName: string; url: string }[] | null;
  canPaste: boolean;
};

// Inspect or Comment is on: Escape is the tool's (its pick, then the tool).
const toolOn = () => useInspectorStore.getState().active || useCommentStore.getState().active;

export const CanvasEditing = ({
  workspaceId,
  keysOff,
  onFullscreen,
  onSeeCode,
}: {
  workspaceId: string;
  // Out of sight (under the dashboard).
  keysOff: boolean;
  onFullscreen: (url: string) => void;
  onSeeCode: (componentName: string) => void;
}) => {
  const edits = useFrameEdits(workspaceId);
  const controls = useCanvasControls();
  const store = useStoreApi<FrameNode>();
  const domNode = useStore((s) => s.domNode);

  const keysOffRef = useRef(keysOff);
  keysOffRef.current = keysOff;
  // The canvas's shortcuts work wherever the focus is, from the start; only
  // not while the dashboard covers the canvas. Typing (in the chat, a field)
  // keeps its own keys: see ignoreInputs, typing() and textSelected().
  const live = () => !keysOffRef.current;

  // Each move the user makes, to undo.
  useEffect(() => controls.onFramesMoved(edits.recordMoves), [controls, edits]);

  const [menu, setMenu] = useState<Menu | null>(null);
  // Where the pointer is on the canvas, for a paste.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!domNode) return;
    const onPress = (e: PointerEvent) => {
      // Text selected elsewhere in the window (a chat message) stays selected
      // through a press on a frame, and a copy would be of it, not the frame.
      const selection = document.getSelection();
      if (domNode.contains(e.target as Node) && selection && !selection.isCollapsed && !domNode.contains(selection.anchorNode)) {
        selection.removeAllRanges();
      }
    };
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pointerRef.current = null;
    };
    document.addEventListener("pointerdown", onPress, true);
    domNode.addEventListener("pointermove", onMove);
    domNode.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      domNode.removeEventListener("pointermove", onMove);
      domNode.removeEventListener("pointerleave", onLeave);
    };
  }, [domNode]);

  // The clipboard: the selected frames, when there are some and no text is
  // being copied, and the frames copied here, when the clipboard still has them.
  const editsRef = useRef(edits);
  editsRef.current = edits;
  useEffect(() => {
    const onCopyOrCut = (e: ClipboardEvent) => {
      if (!live() || typing() || textSelected() || !e.clipboardData) return;
      const clip = e.type === "cut" ? editsRef.current.cut("clipboard") : editsRef.current.copy("clipboard");
      if (!clip) return;
      e.preventDefault();
      e.clipboardData.setData(CLIP_TYPE, clip.id);
      e.clipboardData.setData("text/plain", clip.text);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!live() || typing() || !editsRef.current.holdsClip(e.clipboardData)) return;
      e.preventDefault();
      editsRef.current.paste(pointerRef.current, "clipboard");
    };
    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  // A key the canvas acts on, and only then (false: not this time): the
  // page keeps the rest.
  const when = (act: () => boolean | void) => (e: KeyboardEvent) => {
    if (!live() || act() === false) return;
    e.preventDefault();
  };
  const anySelected = () => edits.selectedFrames().length > 0;
  // Frame to frame, from the canvas: a button's Tab is the button's.
  const step = (direction: 1 | -1) => () => {
    if (document.activeElement?.closest("button, a, [role=button], [role=menuitem]")) return false;
    // No frames to step to: the page's own Tab (the onboarding's).
    if (store.getState().nodes.length === 0) return false;
    edits.step(direction);
  };

  useHotkeys(
    [
      { hotkey: "Mod+D", callback: when(() => anySelected() && (edits.duplicate("shortcut"), true)) },
      { hotkey: "Backspace", callback: when(() => anySelected() && (edits.deleteSelected("shortcut"), true)) },
      { hotkey: "Delete", callback: when(() => anySelected() && (edits.deleteSelected("shortcut"), true)) },
      { hotkey: "Mod+Z", callback: when(() => edits.undo("shortcut")) },
      { hotkey: "Mod+Shift+Z", callback: when(() => edits.redo("shortcut")) },
      ...(isMac ? [] : [{ hotkey: "Mod+Y" as const, callback: when(() => edits.redo("shortcut")) }]),
      { hotkey: "Mod+A", callback: when(() => store.getState().nodes.length > 0 && (edits.selectAll(), true)) },
      // After a frame's own Escape (leaving its interactive mode), the next.
      // And after a tool's: this runs before the tools' own Escape does.
      { hotkey: "Escape", callback: when(() => !toolOn() && edits.clearSelection()), options: { ignoreDefaultPrevented: true } },
      { hotkey: "Tab", callback: when(step(1)) },
      { hotkey: "Shift+Tab", callback: when(step(-1)) },
    ],
    {
      enabled: !keysOff,
      // "auto" lets Mod+Z and Mod+A through while typing: never, here.
      ignoreInputs: true,
      // Each acts (and prevents the default) only when it's the canvas's.
      preventDefault: false,
      stopPropagation: false,
    },
  );

  // The right-click menu, on a frame (selecting it, if it wasn't) or on the
  // canvas around them.
  useEffect(() => {
    if (!domNode) return;
    const open = (at: { x: number; y: number }) => {
      if (keysOffRef.current) return;
      setMenu({ ...at, frames: null, canPaste: editsRef.current.hasClip() });
    };
    // On the canvas around the frames a right press may begin a pan: React
    // Flow says once it's known to be a click (the canvas's controls).
    const offPane = controls.onPaneContextMenu(open);
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      // The minimap's and the toolbars' own.
      if (target.closest(".react-flow__minimap, .canvas-frame-toolbar, .react-flow__panel")) return;
      if (keysOffRef.current) return;
      const id = target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
      const onSelection = !!target.closest(".react-flow__nodesselection");
      // The right button on the canvas itself: React Flow's to tell. (Not
      // Ctrl+click or the menu key, which pan nothing and it never reports.)
      if (!id && !onSelection && e.button === 2 && target.closest(".react-flow__pane")) return;
      e.preventDefault();
      const frame = id ? store.getState().nodeLookup.get(id) : undefined;
      // A frame that wasn't selected is, alone; one that was keeps the rest.
      const picked = frame && !frame.selected ? [frame] : editsRef.current.selectedFrames();
      if (frame && !frame.selected) store.getState().addSelectedNodes([frame.id]);
      setMenu({
        x: e.clientX,
        y: e.clientY,
        frames: frame || onSelection ? picked.map((n) => ({ componentName: n.data.componentName, url: n.data.url })) : null,
        canPaste: editsRef.current.hasClip(),
      });
    };
    domNode.addEventListener("contextmenu", onContextMenu);
    return () => {
      offPane();
      domNode.removeEventListener("contextmenu", onContextMenu);
    };
  }, [domNode, store, controls]);

  return <CanvasMenu menu={menu} onClose={() => setMenu(null)} edits={edits} onFullscreen={onFullscreen} onSeeCode={onSeeCode} />;
};

// The menu's Copy and Cut have no clipboard event to write to: the system
// clipboard gets the names as text, which a paste knows them by.
const writeText = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

const CanvasMenu = ({
  menu,
  onClose,
  edits,
  onFullscreen,
  onSeeCode,
}: {
  menu: Menu | null;
  onClose: () => void;
  edits: FrameEdits;
  onFullscreen: (url: string) => void;
  onSeeCode: (componentName: string) => void;
}) => {
  const format = useFormatForDisplay();
  const frames = menu?.frames ?? [];
  const one = frames.length === 1 ? frames[0]! : null;

  return (
    <DropdownMenu.Root open={!!menu} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenu.Trigger asChild>
        {/* Where the menu opens: the click. */}
        <div aria-hidden style={{ position: "fixed", left: menu?.x ?? 0, top: menu?.y ?? 0, width: 0, height: 0 }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...{ [MENU_ATTR]: "" }}
          align="start"
          side="bottom"
          sideOffset={2}
          collisionPadding={8}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn("z-50 w-56", MENU)}
        >
          {menu?.frames ? (
            <>
              <Item
                label="Copy"
                shortcut={format("Mod+C")}
                onSelect={() => {
                  const clip = edits.copy("menu");
                  if (clip) writeText(clip.text);
                }}
              />
              <Item
                label="Cut"
                shortcut={format("Mod+X")}
                onSelect={() => {
                  const clip = edits.cut("menu");
                  if (clip) writeText(clip.text);
                }}
              />
              <Item label="Paste" shortcut={format("Mod+V")} disabled={!menu.canPaste} onSelect={() => edits.paste(null, "menu")} />
              <Item label="Duplicate" shortcut={format("Mod+D")} onSelect={() => edits.duplicate("menu")} />
              {one && (
                <>
                  <Separator />
                  <Item label="Open in window" onSelect={() => onFullscreen(one.url)} />
                  <Item label="See code" onSelect={() => onSeeCode(one.componentName)} />
                </>
              )}
              <Separator />
              <Item
                label={frames.length > 1 ? `Delete ${frames.length} frames` : "Delete"}
                shortcut={format("Backspace")}
                danger
                onSelect={() => edits.deleteSelected("menu")}
              />
            </>
          ) : (
            <>
              <Item
                label="Paste here"
                shortcut={format("Mod+V")}
                disabled={!menu?.canPaste}
                onSelect={() => menu && edits.paste({ x: menu.x, y: menu.y }, "menu")}
              />
              <Item label="Select all" shortcut={format("Mod+A")} onSelect={() => edits.selectAll()} />
            </>
          )}
          <CoversCanvas />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

const Item = ({
  label,
  shortcut,
  onSelect,
  disabled,
  danger,
}: {
  label: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}) => (
  <DropdownMenu.Item
    disabled={disabled}
    onSelect={onSelect}
    className={cn(
      menuItem,
      "cursor-default justify-between gap-6 outline-none data-[highlighted]:bg-[#373737] data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      danger ? "text-[#f08a8a]" : "text-[#E9E9E9]",
    )}
  >
    <span>{label}</span>
    {shortcut && <span className="text-[12px] text-[#9B9B9B]">{shortcut}</span>}
  </DropdownMenu.Item>
);

const Separator = () => <DropdownMenu.Separator className="mx-1 my-1 h-px bg-[#373737]" />;
