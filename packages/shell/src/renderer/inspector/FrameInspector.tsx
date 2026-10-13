import { useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { useStore } from "@xyflow/react";
import type { ElementInfo, Sides } from "@antidrawapp/runtime/inspector";
import { clearHover, hoverAt, registerFrame, selectAt } from "./bridge";
import { samePick, useInspectorStore } from "./store";

// The inspector over one frame: catches the pointer while inspecting, asks
// the frame what's under it, and draws the answer. It lives in the frame's
// node, so frame pixels are its own pixels and the canvas zoom applies.
// Placeholder visuals: the DevTools box model, and an outline for the selection.

const COLORS = {
  margin: "rgba(246, 178, 107, 0.5)",
  border: "rgba(255, 229, 153, 0.5)",
  padding: "rgba(147, 196, 125, 0.5)",
  content: "rgba(111, 168, 220, 0.5)",
  selected: "#3b82f6",
};

const widths = (s: Sides) => s.map((v) => `${Math.max(0, v)}px`).join(" ");

const Box = ({ x, y, w, h, style }: { x: number; y: number; w: number; h: number; style?: CSSProperties }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: Math.max(0, w),
      height: Math.max(0, h),
      boxSizing: "border-box",
      ...style,
    }}
  />
);

const BoxModel = ({ info }: { info: ElementInfo }) => {
  const { x, y, width: w, height: h } = info.rect;
  const m = info.margin.map((v) => Math.max(0, v)) as Sides;
  const [b, p] = [info.border, info.padding];
  return (
    <>
      <Box x={x - m[3]} y={y - m[0]} w={w + m[1] + m[3]} h={h + m[0] + m[2]} style={{ borderStyle: "solid", borderColor: COLORS.margin, borderWidth: widths(m) }} />
      <Box x={x} y={y} w={w} h={h} style={{ borderStyle: "solid", borderColor: COLORS.border, borderWidth: widths(b) }} />
      <Box x={x + b[3]} y={y + b[0]} w={w - b[1] - b[3]} h={h - b[0] - b[2]} style={{ borderStyle: "solid", borderColor: COLORS.padding, borderWidth: widths(p) }} />
      <Box x={x + b[3] + p[3]} y={y + b[0] + p[0]} w={w - b[1] - b[3] - p[1] - p[3]} h={h - b[0] - b[2] - p[0] - p[2]} style={{ background: COLORS.content }} />
    </>
  );
};

export const FrameInspector = ({ frame, iframe }: { frame: string; iframe: HTMLIFrameElement | null }) => {
  useEffect(() => (iframe ? registerFrame(frame, iframe) : undefined), [frame, iframe]);

  const active = useInspectorStore((s) => s.active && !!s.frames[frame]?.ready);
  const hover = useInspectorStore((s) => (s.hover?.frame === frame ? s.hover : null));
  const selection = useInspectorStore((s) => (s.selection?.frame === frame ? s.selection : null));
  const zoom = useStore((s) => s.transform[2]);

  // At most one hover question per animation frame.
  const point = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  if (!active) return null;

  const toFrame = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const scale = el.offsetWidth / r.width;
    return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale };
  };

  return (
    <div
      className="nodrag nopan absolute inset-0 z-20 cursor-crosshair"
      onPointerMove={(e) => {
        point.current = toFrame(e);
        raf.current ||= requestAnimationFrame(() => {
          raf.current = 0;
          if (point.current) void hoverAt(frame, point.current.x, point.current.y);
        });
      }}
      onPointerLeave={() => {
        point.current = null;
        clearHover(frame);
      }}
      onClick={(e) => {
        const { x, y } = toFrame(e);
        void selectAt(frame, x, y);
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {hover && !(selection && samePick(hover, selection)) && <BoxModel info={hover.info} />}
        {selection && (
          <Box
            x={selection.info.rect.x}
            y={selection.info.rect.y}
            w={selection.info.rect.width}
            h={selection.info.rect.height}
            style={{ outline: `${2 / zoom}px solid ${COLORS.selected}` }}
          />
        )}
      </div>
    </div>
  );
};

export const renderFrameInspector = ({ componentName, iframe }: { componentName: string; iframe: HTMLIFrameElement | null }) => (
  <FrameInspector frame={componentName} iframe={iframe} />
);
