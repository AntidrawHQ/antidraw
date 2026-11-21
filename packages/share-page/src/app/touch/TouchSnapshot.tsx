import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import logoUrl from "@/renderer/assets/antidraw-icon.svg";
import { framesInReadingOrder, openName, searchWith, type Frame } from "../../frames";
import { ChevronLeft, ChevronRight } from "./icons";
import { Stage } from "./Stage";

// A snapshot on a phone or tablet. The canvas runs every component at once,
// which is more memory than a page gets there, so this shows them as a list
// and runs one at a time: a tap opens a component, and Previous / Next walk
// through the rest without going back to the list.

// Marks the history entry a tap on the list made, so "All" can go back to
// the list's own entry; a link that opened on a component has no list behind
// it to go back to.
const FROM_LIST = { fromList: true };

const cameFromList = () => Boolean((window.history.state as typeof FROM_LIST | null)?.fromList);

const urlWith = (name: string | null) =>
  `${window.location.pathname}${searchWith(window.location.search, name)}${window.location.hash}`;

// How long "All" waits for the browser to go back before it settles the URL
// itself. Going back takes a few milliseconds when it works.
const BACK_WAIT_MS = 250;

const useOpenFrame = (frames: Frame[]) => {
  // The open component by name, not by its place in the list: canvas.json is
  // read again when the page comes back into view, and a snapshot published
  // again in the meantime can have its components in another order.
  const [name, setName] = useState(() => openName(window.location.search));
  // Whether the component slides in. One the page loaded on (a link to it, a
  // reload) is simply there.
  const [slides, setSlides] = useState(false);
  const settle = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onPop = () => {
      window.clearTimeout(settle.current);
      setName(openName(window.location.search));
      setSlides(true);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.clearTimeout(settle.current);
    };
  }, []);

  /**
   * From the list: a new history entry, so the browser's back is "All". If
   * the entry is already one the list made, it is reused, so that back from
   * it is still the list.
   */
  const open = useCallback(
    (index: number) => {
      window.clearTimeout(settle.current);
      const url = urlWith(frames[index].name);
      if (cameFromList()) window.history.replaceState(FROM_LIST, "", url);
      else window.history.pushState(FROM_LIST, "", url);
      setName(frames[index].name);
      setSlides(true);
    },
    [frames],
  );

  /** Previous / Next: the same entry, so back still returns to the list. */
  const step = useCallback(
    (index: number) => {
      window.history.replaceState(window.history.state, "", urlWith(frames[index].name));
      setName(frames[index].name);
    },
    [frames],
  );

  const close = useCallback(() => {
    // The list shows at once, whatever the history does next: a second tap
    // has no "All" left to land on and go back twice.
    setName(null);
    if (!cameFromList()) {
      window.history.replaceState(null, "", urlWith(null));
      return;
    }
    window.history.back();
    // Back isn't always the list. A link followed inside the component is a
    // history entry too, and going back only undoes that one, leaving this
    // URL as it was. Then the URL is made the list's here.
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      if (openName(window.location.search) !== null) window.history.replaceState(null, "", urlWith(null));
    }, BACK_WAIT_MS);
  }, []);

  const found = name === null ? -1 : frames.findIndex((frame) => frame.name === name);
  return { at: found === -1 ? null : found, slides, open, step, close };
};

// The frame's proportions, in place of a thumbnail there is no image for.
const Shape = ({ frame }: { frame: Frame }) => {
  const max = 22;
  const ratio = frame.width / frame.height;
  const width = ratio >= 1 ? max : Math.max(8, max * ratio);
  const height = ratio >= 1 ? Math.max(7, max / ratio) : max;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.05]">
      <span className="rounded-[3px] border-[1.5px] border-white/45" style={{ width, height }} />
    </span>
  );
};

const StepButton = ({
  side,
  disabled,
  onClick,
}: {
  side: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="flex h-11 w-[124px] items-center justify-center gap-1 rounded-xl bg-white/[0.08] text-[14px] font-medium transition-colors active:bg-white/[0.14] disabled:opacity-35"
  >
    {side === "previous" && <ChevronLeft size={17} className="-ml-1.5" />}
    {side === "previous" ? "Previous" : "Next"}
    {side === "next" && <ChevronRight size={17} className="-mr-1.5" />}
  </button>
);

/**
 * A part of the page that stays the size it is on screen while the page is
 * zoomed out for a wide component (--page-zoom, Stage.tsx): laid out as on a
 * page that isn't, and enlarged by as much as the page is shrunk. `height` is
 * its height on such a page, in pixels, or "fill" for what its column leaves.
 * Enlarged with a transform: Safari on a phone leaves text out of CSS zoom.
 */
const OnScreen = ({
  height,
  inert,
  className = "",
  children,
}: {
  height: number | "fill";
  inert?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div
    inert={inert}
    // touch-manipulation: on a page wider than the screen a browser waits
    // after each tap for a second one, to zoom; these are buttons.
    className={`touch-manipulation overflow-hidden ${height === "fill" ? "min-h-0 flex-1" : "shrink-0"} ${className}`}
    style={height === "fill" ? undefined : { height: `calc(${height}px * var(--page-zoom, 1))` }}
  >
    <div className="h-[calc(100%/var(--page-zoom,1))] w-[calc(100%/var(--page-zoom,1))] origin-top-left [transform:scale(var(--page-zoom,1))]">
      {children}
    </div>
  </div>
);

export const TouchSnapshot = ({ file, frameUrl }: { file: CanvasFile; frameUrl: (name: string) => string }) => {
  const frames = useMemo(() => framesInReadingOrder(file), [file]);
  const { at, slides, open, step, close } = useOpenFrame(frames);
  const frame = at === null ? null : frames[at];

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#282828] text-[#e0e0e0] antialiased">
      {/* The list scrolls; the bar under it stays at the foot of the screen.
          Both are out of reach while a component is open over them. */}
      <OnScreen height="fill" inert={frame !== null}>
        <div className="h-full overflow-y-auto overscroll-contain">
          <div className="px-5 pb-3 pt-8">
            <h1 className="m-0 truncate text-[17px] font-semibold tracking-[-0.015em]">{file.name}</h1>
            <div className="text-[12.5px] text-[#9a9a9a]">
              {frames.length} {frames.length === 1 ? "component" : "components"}
            </div>
            <p className="m-0 pt-3 text-[12.5px] leading-[1.5] text-[#8a8a8a]">
              The canvas isn't available on mobile for performance reasons. Open this link on a desktop to see it.
            </p>
          </div>
          <ul className="m-0 list-none p-0 pb-6">
            {frames.map((item, index) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => open(index)}
                  className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors active:bg-white/[0.06]"
                >
                  <Shape frame={item} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">{item.name}</span>
                    {item.sized && (
                      <span className="block text-[12px] tabular-nums text-[#9a9a9a]">
                        {Math.round(item.width)} × {Math.round(item.height)}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-[#6b6b6b]" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </OnScreen>
      <OnScreen height={57} inert={frame !== null}>
        <div className="flex h-full items-center border-t border-white/[0.07] px-5">
          <a
            href="https://antidraw.com"
            target="_blank"
            rel="noreferrer"
            className="flex w-fit items-center gap-2 text-[13px] text-[#9a9a9a] no-underline"
          >
            <img src={logoUrl} alt="" width={20} height={20} />
            <span>
              Published on <span className="font-medium text-[#d0d0d0]">Antidraw</span>
            </span>
          </a>
        </div>
      </OnScreen>

      {/* One component, over the list */}
      {frame && at !== null && (
        <div className={`${slides ? "snapshot-open " : ""}absolute inset-0 flex flex-col bg-[#282828]`}>
          <OnScreen height={48}>
            <header className="flex h-full items-center border-b border-white/[0.07] px-2">
              <button
                type="button"
                onClick={close}
                className="flex h-9 w-[64px] items-center rounded-lg text-[14px] text-[#c9c9c9] active:bg-white/[0.06]"
              >
                <ChevronLeft size={18} />
                All
              </button>
              <div className="min-w-0 flex-1 truncate text-center text-[14px] font-medium">{frame.name}</div>
              <div className="w-[64px]" />
            </header>
          </OnScreen>

          {/* Before the stage here, after it on screen: what comes after a
              frame is drawn on a layer of its own, which Safari draws at the
              zoomed-out page's resolution and then enlarges, blurred. */}
          <OnScreen height={69} className="order-last">
            <footer className="flex h-full items-center border-t border-white/[0.07] px-3">
              <StepButton side="previous" disabled={at === 0} onClick={() => step(at - 1)} />
              <div className="flex-1 text-center text-[13px] tabular-nums text-[#9a9a9a]">
                {at + 1} of {frames.length}
              </div>
              <StepButton side="next" disabled={at === frames.length - 1} onClick={() => step(at + 1)} />
            </footer>
          </OnScreen>

          <Stage key={frame.name} frame={frame} url={frameUrl(frame.name)} />
        </div>
      )}
    </div>
  );
};
