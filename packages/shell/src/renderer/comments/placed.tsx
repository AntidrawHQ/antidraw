import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Pencil } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { beside as besideAt, BOX, FLOAT, floatShadow, Kbd, TextBtn } from "./pieces";
import { LABEL, type Actions, type Cmt, type Flow } from "./model";
import type { Pos } from "./store";

// The pins and the open comment, where their frames are: on the canvas
// (CommentFlow) and in a frame's own window (PreviewComments).

// Where a point in a frame is on screen here, null where the frame isn't
// shown; and the width there is to place a card in. The canvas's goes by its
// pan and zoom; a frame's own window's is the frame as it is.
export type Placement = {
  at: (frame: string, pos: Pos) => { x: number; y: number } | null;
  width: number;
};
export const PlacementContext = createContext<Placement>({ at: () => null, width: 0 });

// A point in a frame, on screen.
const usePoint = (frame: string, pos: Pos) => {
  const { at, width } = useContext(PlacementContext);
  const p = at(frame, pos);
  return p && { ...p, w: width };
};

// A pin: a speech bubble whose tail sits on the point. Numbered while not
// sent, matching the list; grey once sent; gone once completed.
// Click one to open its comment; the open one turns blue.
const PinMark = ({ c, i, lit, a }: { c: Cmt; i?: number; lit: boolean; a: Actions }) => {
  const p = usePoint(c.frame, c.pos);
  if (!p) return null;
  const draft = c.state === "draft";
  const open = a.opened === c.id;
  return (
    <button
      type="button"
      data-comment-ui
      onClick={(e) => {
        e.stopPropagation();
        a.open(c.id);
      }}
      className={cn(
        "pointer-events-auto absolute z-10 grid -translate-y-full cursor-pointer place-items-center rounded-full rounded-bl-none text-[10px] font-semibold leading-none shadow-[0_2px_6px_rgba(0,0,0,.35)] transition-transform",
        open
          ? "size-5 bg-[#3b82f6] text-white ring-2 ring-white/90"
          : draft
            ? "size-5 bg-neutral-100 text-neutral-900"
            : "size-4 bg-[#4a4a4a] text-neutral-300 ring-1 ring-white/15",
        lit && !open && "scale-125 ring-2 ring-[#3b82f6]",
      )}
      style={{ left: p.x, top: p.y, transformOrigin: "bottom left" }}
    >
      {draft ? i : ""}
    </button>
  );
};

// Completed ones lose their pin, unless open.
export const Pins = ({ f, lit, a }: { f: Flow; lit: number | null; a: Actions }) => (
  <>
    {f.sends.flatMap((s) => s.comments.filter((c) => c.state !== "done" || a.opened === c.id).map((c) => <PinMark key={c.id} c={c} lit={lit === c.id} a={a} />))}
    {f.draft.map((c, i) => (
      <PinMark key={c.id} c={c} i={i + 1} lit={lit === c.id} a={a} />
    ))}
  </>
);


// Beside the pin, here.
export const useBeside = (frame: string, pos: Pos) => {
  const p = usePoint(frame, pos);
  return p && besideAt(p.x, p.y, p.w);
};


// An existing comment, opened from its row or its pin. Reading:
// the text, and where it's at. Editing (not sent only): the text in a field,
// ↵ or Save to keep it, Esc or Cancel to leave it as it was.
export const CommentCard = ({ f, id, editing, a, onClose }: { f: Flow; id: number; editing: boolean; a: Actions; onClose?: () => void }) => {
  const i = f.draft.findIndex((c) => c.id === id);
  const s = f.sends.find((x) => x.comments.some((c) => c.id === id));
  const c = i >= 0 ? f.draft[i] : s?.comments.find((x) => x.id === id);
  const [v, setV] = useState(c?.text ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [v, editing]);
  const at = useBeside(c?.frame ?? "", c?.pos ?? { x: 0, y: 0 });
  const { width: w } = useContext(PlacementContext);
  if (!c) return null;
  // Its frame isn't on the canvas (the component's gone, often by the
  // comment's own doing): at the canvas's top right instead, by the panel
  // that lists it.
  const { left, top } = at ?? { left: Math.max(16, w - 16 - BOX), top: 16 };
  const save = () => {
    // Emptied, it's gone, and so is its card.
    if (!v.trim()) return a.remove(c.id);
    a.edit(c.id, v);
    a.open(c.id, false);
  };
  const cancel = () => {
    setV(c.text);
    a.open(c.id, false);
  };
  return (
    <div
      data-comment-ui
      onClick={(e) => e.stopPropagation()}
      className={cn("pointer-events-auto absolute z-40 flex flex-col gap-2 p-3 ring-1 ring-white/20", FLOAT)}
      style={{ ...floatShadow, left, top, width: BOX }}
    >
      {!at && <p className="m-0 text-[12px] text-neutral-500">{c.frame} isn't on the canvas</p>}
      {editing ? (
        <textarea
          ref={ref}
          rows={1}
          autoFocus
          onFocus={(e) => e.currentTarget.setSelectionRange(v.length, v.length)}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              return cancel();
            }
            if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            save();
          }}
          className="-mx-1.5 -my-1 resize-none rounded bg-white/[0.05] px-1.5 py-1 text-[13px] leading-[19px] text-neutral-100 outline-none ring-1 ring-white/15 focus:ring-[#3b82f6]"
        />
      ) : (
        <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[19px] text-neutral-100">{c.text}</p>
      )}
      <div className="flex items-center gap-3 text-[12px]">
        {c.state === "draft" ? (
          editing ? (
            <>
              <span className="flex-1 text-neutral-500">
                <Kbd>↵</Kbd> save · <Kbd>esc</Kbd>
              </span>
              <TextBtn onClick={cancel}>Cancel</TextBtn>
              <button type="button" onClick={save} className="flex h-[24px] cursor-pointer items-center rounded-lg bg-[#e0e0e0] px-2.5 text-[12px] font-medium text-neutral-900 transition-colors hover:bg-white">
                Save
              </button>
            </>
          ) : (
            <>
              <span className="flex-1" />
              <TextBtn onClick={() => a.open(c.id, true)} className="flex items-center gap-1 font-medium text-neutral-200">
                <Pencil className="size-3" />
                Edit
              </TextBtn>
              <TextBtn
                onClick={() => {
                  a.remove(c.id);
                  onClose?.();
                }}
              >
                Delete
              </TextBtn>
            </>
          )
        ) : (
          <>
            {/* Only Completed is said: a sent one's row says Sent. */}
            <span className="flex-1 text-neutral-500">{c.state === "done" ? LABEL.done : ""}</span>
            <TextBtn onClick={() => s && a.chat(s.conversationId)} className="flex items-center gap-1 font-medium">
              <ArrowUpRight className="size-3.5" />
              Open chat
            </TextBtn>
            {s?.phase === "ended" && c.state === "sent" && (
              <TextBtn
                onClick={() => {
                  a.dismiss(s.n, c.id);
                  onClose?.();
                }}
              >
                Remove
              </TextBtn>
            )}
          </>
        )}
      </div>
    </div>
  );
};

