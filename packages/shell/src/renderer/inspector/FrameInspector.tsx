import { useEffect } from "react";
import { useStore } from "@xyflow/react";
import type { WheelMode } from "@/agent/protocol";
import { onFrameWheel, registerFrame, setFrameTool } from "./bridge";
import { useInspectorStore } from "./store";
import { useCanvasTool } from "../comments/store";

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

const CanvasFrameInspector = ({ frame, iframe }: { frame: string; iframe: HTMLIFrameElement | null }) => {
  const zoom = useStore((s) => s.transform[2]);
  return <FrameInspector frame={frame} iframe={iframe} zoom={zoom} />;
};

export const renderFrameInspector = ({ componentName, iframe }: { componentName: string; iframe: HTMLIFrameElement | null }) => (
  <CanvasFrameInspector frame={componentName} iframe={iframe} />
);
