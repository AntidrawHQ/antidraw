import { useEffect } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import { READY_ATTRIBUTE, pictureOf, readyIn, type Rect } from "../shot";

// Inside the canvas while its preview image is taken (../shot.ts): keeps the
// view on what the picture shows as the frames load and grow, and marks the
// page once the frames in it have rendered.

// Two frames on: the canvas has rendered what the last message changed.
const afterPaint = (fn: () => void) => {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(fn);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
};

const touches = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const Shot = ({ origin }: { origin: string }) => {
  const { getNodes, fitBounds } = useReactFlow();
  const store = useStoreApi();

  useEffect(() => {
    const started = performance.now();
    const rendered = new Set<string>();
    let last = started;
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    let cancelPaint = () => {};

    // The frames as the canvas has them now: where, how big, and whose.
    const frames = () =>
      getNodes().map((node) => ({
        name: (node.data as { componentName: string }).componentName,
        x: node.position.x,
        y: node.position.y,
        // As measured, or before that as the canvas asked for it.
        width: node.measured?.width ?? (Number(node.style?.width) || 0),
        height: node.measured?.height ?? (Number(node.style?.height) || 0),
      }));

    // Puts the view on what the picture shows, and says which frames are in
    // it. A frame out of view isn't rendered (Chromium holds it back), and
    // isn't waited for.
    const frame = () => {
      const all = frames();
      const { width, height } = store.getState();
      const view = pictureOf(all, { width, height });
      if (!view) return [];
      void fitBounds(view, { padding: 0 });
      return all.filter((f) => touches(f, view));
    };

    const finish = () => {
      done = true;
      cancelPaint();
      frame();
      // Marked when that last move has been painted.
      cancelPaint = afterPaint(() => document.documentElement.setAttribute(READY_ATTRIBUTE, ""));
    };

    const look = () => {
      const shown = frame();
      clearTimeout(timer);
      const now = performance.now();
      const wait = readyIn({
        total: shown.length,
        rendered: shown.filter((f) => rendered.has(f.name)).length,
        sinceStart: now - started,
        sinceLast: now - last,
      });
      timer = setTimeout(finish, wait);
    };

    // What the canvas listens for too (Canvas.tsx): a frame's component
    // rendered, at this size, or never will.
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (done || event.origin !== origin) return;
      if (type !== "component-size" && type !== "component-failed") return;
      const name: unknown = event.data.componentName;
      // Its first word is the news; a frame that keeps resizing (an
      // animation) mustn't put the picture off.
      if (typeof name !== "string" || rendered.has(name)) return;
      rendered.add(name);
      last = performance.now();
      // Once the canvas has given it its size, and moved the frames after it.
      cancelPaint();
      cancelPaint = afterPaint(look);
    };

    window.addEventListener("message", onMessage);
    // The canvas has measured its frames by then.
    cancelPaint = afterPaint(look);
    // Whatever happens, the picture is taken of what there is by the cap.
    timer = setTimeout(finish, readyIn({ total: 1, rendered: 0, sinceStart: 0, sinceLast: 0 }));
    return () => {
      done = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      cancelPaint();
      document.documentElement.removeAttribute(READY_ATTRIBUTE);
    };
  }, [origin, getNodes, fitBounds, store]);

  return null;
};
