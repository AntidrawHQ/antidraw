import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/renderer/lib/utils";
import { markElement, onCommentClick } from "@/renderer/inspector/bridge";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useCommentStore } from "./store";

// The Comment tool's pieces that work over any frame, on the canvas
// (CommentFlow) or in a frame's own window (PreviewComments): the box, each
// frame's part (its clicks), and closing on a click away. Nothing here knows
// the canvas.


// The comment box's surface.
export const FLOAT = "rounded-[12px] bg-[#353535]";
export const floatShadow = { boxShadow: "0 5px 20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.1), inset 0 1px 0 rgba(255,255,255,.05)" };

export const Kbd = ({ children }: { children: ReactNode }) => (
  <span className="rounded-sm bg-white/[0.06] px-1 py-px font-mono text-[10.5px] leading-none text-neutral-500">{children}</span>
);

// Beside the pin, unless that runs off the canvas.
export const BOX = 260;
export type At = { x: number; y: number; left: number; top: number };
export const beside = (x: number, y: number, w: number): At => ({ x, y, left: x + 26 + BOX > w - 8 ? x - BOX - 8 : x + 26, top: y - 34 });

// The box, opened by a click on a frame: a pin where you clicked, and the
// field beside it. ↵ adds, ⇧↵ breaks the line, ⌘↵ adds and sends, Esc closes.
// `at` is where, on screen; the canvas places it by its frame (CommentBox),
// a frame's own window by its own (PreviewComments).
export const CommentBoxAt = ({ at, add, send, preset = "", onClose }: { at: At; add: (t: string) => void; send: () => void; preset?: string; onClose?: () => void }) => {
  const [v, setV] = useState(preset);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [v]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") return onClose?.();
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    add(v);
    if (e.metaKey || e.ctrlKey) send();
    setV("");
  };
  const { x, y, left, top } = at;
  return (
    <div data-comment-ui className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
      <span
        className="absolute z-40 size-5 -translate-y-full rounded-full rounded-bl-none bg-[#3b82f6] shadow-[0_2px_6px_rgba(0,0,0,.35)] ring-2 ring-white/90"
        style={{ left: x, top: y }}
      />
      <div
        className={cn("absolute z-40 flex items-end gap-1.5 px-3 py-2 ring-1 ring-white/20", FLOAT)}
        style={{ ...floatShadow, left, top, width: BOX }}
      >
        <textarea
          ref={ref}
          rows={1}
          autoFocus={!preset}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={onKey}
          placeholder="Leave a comment for Claude…"
          className="min-w-0 flex-1 resize-none bg-transparent py-0.5 text-[13px] leading-[20px] text-neutral-100 outline-none placeholder:text-neutral-500"
        />
        <Kbd>↵</Kbd>
      </div>
    </div>
  );
};

// Each frame's part in the Comment tool, while it's on: the frame draws the
// element under the pointer as Inspect does (@/agent), and a click there
// opens the box at that point, on that element, which the frame outlines
// while the box is open. A click while a comment is open only closes it,
// like Figma.
export const FrameCommentTarget = ({ frame }: { frame: string }) => {
  const boxed = useCommentStore((s) => (s.box?.frame === frame ? s.box.element : null));
  const ready = useInspectorStore((s) => !!s.frames[frame]?.ready);

  useEffect(
    () =>
      onCommentClick(frame, (pos, element) => {
        const s = useCommentStore.getState();
        if (!s.active) return;
        if (s.box || s.opened) {
          s.setBox(null);
          s.setOpened(null);
          return;
        }
        s.setBox({ frame, pos, element });
      }),
    [frame],
  );

  useEffect(() => {
    if (ready) markElement(frame, boxed?.ref ?? null);
  }, [frame, ready, boxed]);

  return null;
};


// A click away from the comment UI closes it. A click in a frame does that
// itself (FrameCommentTarget): the frame has it.
export const useCloseOnClickAway = () => {
  const open = useCommentStore((s) => !!(s.box || s.opened));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-comment-ui]")) return;
      useCommentStore.getState().setBox(null);
      useCommentStore.getState().setOpened(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
};

// A sent comment that Claude hasn't marked yet: a dashed ring.
export const Pending = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray="2.6 3.2" strokeLinecap="round">
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".6" />
  </svg>
);

export const TextBtn = ({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick?.();
    }}
    className={cn("cursor-pointer text-[12px] text-neutral-400 hover:text-neutral-100", className)}
  >
    {children}
  </button>
);
