import { useEffect, useState } from "react";
import { useStoreApi } from "@xyflow/react";
import type { WheelMode } from "@/agent/protocol";
import { onFrameWheel, registerFrame, setFrameTool } from "./bridge";
import { useInspectorStore } from "./store";
import { useCanvasTool, useCommentStore } from "../comments/store";

// The canvas's tools over one frame. The frame is told which one is on and
// then has the pointer: it finds what's under it and draws it itself, in the
// page (@/agent), and says what a click picked (bridge). On the canvas, the
// wheel it passes back pans and zooms the canvas, as over the rest of it; a
// frame's own window (PreviewWindow) has the frame scroll with it instead
// (`wheel`). Until the frame can pick (it's loading, or has no preview page),
// a tool keeps the pointer off it.
export const FrameInspector = ({
  frame,
  iframe,
  zoom = 1,
  wheel = "pass",
}: {
  frame: string;
  iframe: HTMLIFrameElement | null;
  zoom?: number;
  wheel?: WheelMode;
}) => {
  useEffect(() => (iframe ? registerFrame(frame, iframe) : undefined), [frame, iframe]);

  const ready = useInspectorStore((s) => !!s.frames[frame]?.ready);
  const tool = useCanvasTool();
  const on = tool === "pointer" ? null : tool;
  // Only a tool's lines follow the zoom.
  const at = on ? zoom : 1;

  useEffect(() => {
    if (ready) setFrameTool(frame, on, wheel, at);
  }, [frame, ready, on, wheel, at]);

  // As if the wheel had turned over the frame here: React Flow pans or (a
  // pinch) zooms with it.
  useEffect(() => {
    if (wheel !== "pass" || !iframe) return;
    return onFrameWheel(frame, (w) => {
      const r = iframe.getBoundingClientRect();
      const scale = iframe.offsetWidth ? r.width / iframe.offsetWidth : 1;
      const { deltaX, deltaY, deltaMode, ctrlKey, metaKey, shiftKey, altKey } = w;
      iframe.dispatchEvent(
        new WheelEvent("wheel", {
          clientX: r.left + w.x * scale,
          clientY: r.top + w.y * scale,
          deltaX,
          deltaY,
          deltaMode,
          ctrlKey,
          metaKey,
          shiftKey,
          altKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }, [frame, iframe, wheel]);

  return on && !ready ? <div className="nodrag nopan absolute inset-0 z-20" /> : null;
};

// How long the canvas's zoom stays put before the outlined frame hears it.
const SETTLED_MS = 150;

// The canvas's zoom, for the frame that draws an outline (the selection, or
// the element an open comment box is on): the only line that needs it, to
// stay a screen pixel or two wide. That frame hears it once the zoom has
// settled; every other frame hears nothing while the canvas zooms. Told on
// every step, every frame fell behind: the frames share a process, and a
// pinch over 188 of them queued 40,000 messages, seven seconds deep.
const useOutlineZoom = (frame: string) => {
  const selected = useInspectorStore((s) => s.selection?.frame === frame);
  const commented = useCommentStore((s) => s.box?.frame === frame);
  const outlined = selected || commented;
  const flow = useStoreApi();
  const [zoom, setZoom] = useState(() => flow.getState().transform[2]);
  useEffect(() => {
    if (!outlined) return;
    let last = flow.getState().transform[2];
    setZoom(last);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = flow.subscribe((s) => {
      const now = s.transform[2];
      if (now === last) return;
      last = now;
      clearTimeout(timer);
      timer = setTimeout(() => setZoom(now), SETTLED_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [outlined, flow]);
  return outlined ? zoom : 1;
};

const CanvasFrameInspector = ({ frame, iframe }: { frame: string; iframe: HTMLIFrameElement | null }) => {
  const zoom = useOutlineZoom(frame);
  return <FrameInspector frame={frame} iframe={iframe} zoom={zoom} />;
};

export const renderFrameInspector = ({ componentName, iframe }: { componentName: string; iframe: HTMLIFrameElement | null }) => (
  <CanvasFrameInspector frame={componentName} iframe={iframe} />
);
