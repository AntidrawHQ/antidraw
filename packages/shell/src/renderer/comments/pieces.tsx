import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { ElementInfo } from "@antidrawapp/runtime/inspector";
import { cn } from "@/renderer/lib/utils";
import { elementAt } from "@/renderer/inspector/bridge";
import { samePick, useInspectorStore } from "@/renderer/inspector/store";
import { Box, BoxModel, COLORS } from "@/renderer/inspector/FrameInspector";
import { useCommentStore, type Pos } from "./store";

// The Comment tool's pieces that work over any frame, on the canvas
// (CommentFlow) or in a frame's own window (PreviewComments): the box, the
// click target over a frame, and closing on a click away. Nothing here knows
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
        className="absolute z-20 size-5 -translate-y-full rounded-full rounded-bl-none bg-[#3b82f6] shadow-[0_2px_6px_rgba(0,0,0,.35)] ring-2 ring-white/90"
        style={{ left: x, top: y }}
      />
      <div
        className={cn("absolute z-20 flex items-end gap-1.5 px-3 py-2 ring-1 ring-white/20", FLOAT)}
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

// Over each frame while the Comment tool is on: a crosshair, the element
// under the pointer drawn as Inspect draws it, and a click opens the box
// there, on that element, which stays outlined while the box is open. A click
// while a comment is open only closes it, like Figma.
export const FrameCommentTarget = ({ frame, zoom = 1 }: { frame: string; zoom?: number }) => {
  const active = useCommentStore((s) => s.active);
  const boxed = useCommentStore((s) => (s.box?.frame === frame ? s.box.element : null));
  const [hover, setHover] = useState<ElementInfo | null>(null);

  // At most one hover question per animation frame, and only the latest
  // answer counts.
  const point = useRef<Pos | null>(null);
  const raf = useRef(0);
  const asked = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    if (!active) setHover(null);
  }, [active]);

  if (!active) return null;

  const ready = () => !!useInspectorStore.getState().frames[frame]?.ready;
  const toFrame = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const scale = el.offsetWidth / r.width;
    return { x: Math.round((e.clientX - r.left) * scale), y: Math.round((e.clientY - r.top) * scale) };
  };

  const click = (e: MouseEvent<HTMLDivElement>) => {
    const s = useCommentStore.getState();
    if (s.box || s.opened) {
      s.setBox(null);
      s.setOpened(null);
      return;
    }
    const pos = toFrame(e);
    const box = { frame, pos, element: null };
    s.setBox(box);
    // The element comes after: the box doesn't wait on the frame.
    if (ready())
      void elementAt(frame, pos.x, pos.y).then((element) => {
        if (useCommentStore.getState().box === box) useCommentStore.getState().setBox({ ...box, element });
      });
  };

  return (
    <div
      data-comment-target
      className="nodrag nopan absolute inset-0 z-20 cursor-crosshair"
      onPointerMove={(e) => {
        point.current = toFrame(e);
        raf.current ||= requestAnimationFrame(() => {
          raf.current = 0;
          const p = point.current;
          if (!p || !ready()) return;
          const id = ++asked.current;
          void elementAt(frame, p.x, p.y).then((info) => {
            if (asked.current === id) setHover(info);
          });
        });
      }}
      onPointerLeave={() => {
        point.current = null;
        asked.current++;
        setHover(null);
      }}
      onClick={click}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {hover && !(boxed && samePick({ frame, info: hover }, { frame, info: boxed })) && <BoxModel info={hover} />}
        {boxed && (
          <Box
            x={boxed.rect.x}
            y={boxed.rect.y}
            w={boxed.rect.width}
            h={boxed.rect.height}
            style={{ outline: `${2 / zoom}px solid ${COLORS.selected}` }}
          />
        )}
      </div>
    </div>
  );
};


// A click away from the comment UI closes it. A frame's own click does that
// itself (FrameCommentTarget).
export const useCloseOnClickAway = () => {
  const open = useCommentStore((s) => !!(s.box || s.opened));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-comment-ui], [data-comment-target]")) return;
      useCommentStore.getState().setBox(null);
      useCommentStore.getState().setOpened(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
};

