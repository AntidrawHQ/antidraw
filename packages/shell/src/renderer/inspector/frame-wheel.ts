import { useEffect, useRef } from "react";
import { scrollAt, wheelPixels } from "./bridge";

// A frame's own window passes the wheel on to its frame through the tools'
// overlay (FrameInspector, FrameCommentTarget). While it turns, the overlay
// only scrolls: `busy()` says so, and it asks the frame nothing else (a hover
// question restyles the whole page to find what's under the point, which a
// scroll can't afford every frame). The deltas go once per animation frame.
// `settled` runs once the wheel has stopped.
export const useFrameWheel = (frame: string, settled: () => void) => {
  const timer = useRef(0);
  const raf = useRef(0);
  const sum = useRef({ x: 0, y: 0, dx: 0, dy: 0 });
  const settledRef = useRef(settled);
  settledRef.current = settled;
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(raf.current);
    },
    [],
  );

  const onWheel = (at: { x: number; y: number }, e: { deltaX: number; deltaY: number; deltaMode: number }, page: number) => {
    const { dx, dy } = wheelPixels(e, page);
    const s = sum.current;
    s.x = at.x;
    s.y = at.y;
    s.dx += dx;
    s.dy += dy;
    raf.current ||= requestAnimationFrame(() => {
      raf.current = 0;
      const s = sum.current;
      scrollAt(frame, s.x, s.y, s.dx, s.dy);
      s.dx = s.dy = 0;
    });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      settledRef.current();
    }, 150);
  };

  return { onWheel, busy: () => timer.current !== 0 };
};
