import { useEffect, useMemo, useState } from "react";
import type { Rect } from "@antidrawapp/runtime/inspector";
import { trackElements } from "@/renderer/inspector/bridge";
import type { Cmt, Flow } from "./model";
import type { Pos } from "./store";

// A pin stays on its element: at the same spot in it as where it was dropped,
// wherever the element is now in its frame (scrolled, at another width, moved
// by an edit). The frames follow the elements and say where they've gone.
// Where a frame doesn't say (its element is gone, or its runtime is from
// before), the pin stays where it was dropped.

// The pin's spot in its element when dropped, as a share of its size, put
// on the element's box now.
export const pinIn = (c: Cmt, now: Rect | null | undefined): Pos => {
  const was = c.element?.rect;
  if (!was || !now) return c.pos;
  const share = (at: number, from: number, size: number) => (size ? (at - from) / size : 0);
  return {
    x: now.x + share(c.pos.x, was.x, was.width) * now.width,
    y: now.y + share(c.pos.y, was.y, was.height) * now.height,
  };
};

// The flow with each pin where its element is now, for the frames `shown`
// says are on screen here.
export const useAnchoredFlow = (f: Flow, shown: (frame: string) => boolean = () => true): Flow => {
  const all = [...f.draft, ...f.sends.flatMap((s) => s.comments)].filter((c) => c.element && shown(c.frame));
  // What to follow in each frame, as a key that changes only when that does.
  const byFrame = new Map<string, Cmt[]>();
  for (const c of all) byFrame.set(c.frame, [...(byFrame.get(c.frame) ?? []), c]);
  const key = JSON.stringify([...byFrame].map(([frame, cs]) => [frame, cs.map((c) => [c.id, c.element!.ref])]));

  const [rects, setRects] = useState<ReadonlyMap<number, Rect | null>>(new Map());
  useEffect(() => {
    const groups = JSON.parse(key) as [string, [number, NonNullable<Cmt["element"]>["ref"]][]][];
    const stops = groups.map(([frame, cs]) =>
      trackElements(
        frame,
        cs.map(([, ref]) => ref),
        (now) =>
          setRects((prev) => {
            const next = new Map(prev);
            cs.forEach(([id], i) => next.set(id, now[i] ?? null));
            return next;
          }),
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [key]);

  return useMemo(() => {
    const place = (c: Cmt) => (rects.has(c.id) ? { ...c, pos: pinIn(c, rects.get(c.id)) } : c);
    return { draft: f.draft.map(place), sends: f.sends.map((s) => ({ ...s, comments: s.comments.map(place) })) };
  }, [f, rects]);
};
