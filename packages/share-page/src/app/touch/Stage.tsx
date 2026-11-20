import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pageViewport, type Frame } from "../../frames";

// Matches Canvas.tsx's clampNodeSize: a frame never collapses to nothing.
const MIN_SIZE = 10;

// index.html's viewport, which the page has whenever no wide component is open.
const DEVICE_VIEWPORT = "width=device-width, initial-scale=1.0";

/**
 * How much the page's own parts (the header, the footer, the list under them)
 * are enlarged while the page is zoomed out for a wide component, so they
 * stay the size they were (TouchSnapshot.tsx's OnScreen).
 */
const PAGE_ZOOM = "--page-zoom";

/**
 * The screen's width in CSS pixels, whatever the page's viewport is set to
 * and however far it is zoomed: what the visual viewport shows, times its
 * scale, is always the screen.
 */
const screenWidth = () => {
  const view = window.visualViewport;
  return Math.round(view ? view.width * view.scale : window.innerWidth);
};

/**
 * The one live component: a single frame on the site's Preview page, the URL
 * the canvas's frames load, as wide as it is on the canvas.
 *
 * A frame wider than the screen is not scaled down here. The page's viewport
 * is made as wide as the frame instead, and the browser shows the page zoomed
 * out, as it does a desktop site: it draws at the screen's resolution, where
 * a frame shrunk with a transform is drawn at full size first, many screens'
 * worth of pixels for each one shown, and a long page ran a phone out of
 * memory. Pinching zooms in, as on any page.
 *
 * The frame is never taller than the stage: a long component scrolls inside
 * its frame, and sees a screen-sized window, not one as tall as itself.
 *
 * Give it a key per component: another component is another Stage, so the
 * frame before it is dropped, not kept alongside.
 */
export const Stage = ({ frame, url }: { frame: Frame; url: string }) => {
  const box = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [boxHeight, setBoxHeight] = useState(0);
  const [size, setSize] = useState({ width: frame.width, height: frame.height });
  const [screen, setScreen] = useState(screenWidth);
  const [loaded, setLoaded] = useState(false);

  // Before the first paint, so a long frame is never laid out at its full height.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setBoxHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The screen changes width when it is turned. A pinch moves the measure by
  // a fraction of a pixel, which is not that.
  useEffect(() => {
    const measure = () => setScreen((was) => (Math.abs(screenWidth() - was) > 1 ? screenWidth() : was));
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
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

  // The page as wide as the frame, for as long as this component is open.
  useLayoutEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const viewport = pageViewport(size.width, screen);
    if (!meta || !viewport) return;
    meta.content = `width=${viewport.width}, initial-scale=${viewport.scale}, minimum-scale=${viewport.scale}`;
    document.documentElement.style.setProperty(PAGE_ZOOM, String(1 / viewport.scale));
    return () => {
      meta.content = DEVICE_VIEWPORT;
      document.documentElement.style.removeProperty(PAGE_ZOOM);
    };
  }, [size.width, screen]);

  // Until the stage is measured the frame has no height to go by.
  const height = boxHeight > 0 ? Math.min(size.height, boxHeight) : 0;

  return (
    <div className="relative min-h-0 flex-1 bg-[#1f1f1f]">
      <div ref={box} className="flex h-full w-full overflow-auto overscroll-contain">
        {/* m-auto: a frame smaller than the stage sits in its middle. */}
        <div className="relative m-auto shrink-0" style={{ width: size.width, height }}>
          <iframe
            ref={iframe}
            title={frame.name}
            src={url}
            // As the canvas's frames (Canvas.tsx).
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => setLoaded(true)}
            className="block h-full w-full border-0 transition-opacity duration-300"
            style={{ opacity: loaded ? 1 : 0 }}
          />
          {!loaded && <div className="absolute inset-0 animate-pulse bg-white/[0.05]" />}
        </div>
      </div>
    </div>
  );
};
