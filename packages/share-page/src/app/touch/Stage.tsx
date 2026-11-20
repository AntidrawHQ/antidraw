import { useEffect, useRef, useState } from "react";
import { fitScale, type Frame } from "../../frames";
import { ZoomIn, ZoomOut } from "./icons";

// Matches Canvas.tsx's clampNodeSize: a frame never collapses to nothing.
const MIN_SIZE = 10;

/**
 * The one live component: a single frame on the site's Preview page, the URL
 * the canvas's frames load. It is laid out at its size on the canvas and
 * scaled down to the screen's width, so it looks as it does there; the pill
 * switches to full size, which scrolls both ways. A frame narrower than the
 * screen is shown as is.
 *
 * Give it a key per component: another component is another Stage, so the
 * frame before it is dropped, not kept alongside.
 */
export const Stage = ({ frame, url }: { frame: Frame; url: string }) => {
  const box = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [size, setSize] = useState({ width: frame.width, height: frame.height });
  const [actual, setActual] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The component says how big it is once it has rendered, as it does to the
  // canvas, which grows the frame to it. Only this frame's own page may:
  // any window can post to this one.
  useEffect(() => {
    const origin = new URL(url).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== origin) return;
      const { type, componentName, width, height } = (event.data ?? {}) as Record<string, unknown>;
      if (type !== "component-size" || componentName !== frame.name) return;
      if (typeof width !== "number" || typeof height !== "number") return;
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      setSize({ width: Math.max(width, MIN_SIZE), height: Math.max(height, MIN_SIZE) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [url, frame.name]);

  // At full size the frame opens on its middle, where a page's content is,
  // not on its left edge.
  useEffect(() => {
    const el = box.current;
    if (el && actual) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [actual]);

  const fit = fitScale(size.width, boxWidth);
  const scale = actual ? 1 : fit;
  // A frame a few pixels wider than the screen has nothing to gain from 100%.
  const canZoom = fit < 0.9;

  return (
    <div className="relative min-h-0 flex-1 bg-[#1f1f1f]">
      <div ref={box} className="flex h-full w-full overflow-auto overscroll-contain">
        {/* m-auto, not centring on the container: a frame taller than the stage scrolls from its top. */}
        <div
          className="relative m-auto shrink-0 overflow-hidden"
          style={{ width: size.width * scale, height: size.height * scale }}
        >
          <iframe
            ref={iframe}
            title={frame.name}
            src={url}
            // As the canvas's frames (Canvas.tsx).
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => setLoaded(true)}
            className="block origin-top-left border-0 transition-opacity duration-300"
            style={{
              width: size.width,
              height: size.height,
              transform: `scale(${scale})`,
              opacity: loaded ? 1 : 0,
            }}
          />
          {!loaded && <div className="absolute inset-0 animate-pulse bg-white/[0.05]" />}
        </div>
      </div>
      {canZoom && (
        <button
          type="button"
          onClick={() => setActual((on) => !on)}
          aria-label={actual ? "Fit to screen" : "Show at full size"}
          className="absolute bottom-3 right-3 flex h-8 items-center gap-1.5 rounded-full bg-black/65 px-3 text-[12px] font-medium tabular-nums text-white ring-1 ring-white/15 backdrop-blur"
        >
          {actual ? <ZoomOut size={13} /> : <ZoomIn size={13} />}
          {actual ? "100%" : `${Math.round(fit * 100)}%`}
        </button>
      )}
    </div>
  );
};
