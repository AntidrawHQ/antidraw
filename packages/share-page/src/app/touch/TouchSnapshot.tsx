import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import logoUrl from "@/renderer/assets/antidraw-icon.svg";
import { framesInReadingOrder, openFrame, searchWith, type Frame } from "../../frames";
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

const useOpenFrame = (frames: Frame[]) => {
  const [at, setAt] = useState(() => openFrame(window.location.search, frames));

  useEffect(() => {
    const onPop = () => setAt(openFrame(window.location.search, frames));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [frames]);

  const urlWith = (name: string | null) =>
    `${window.location.pathname}${searchWith(window.location.search, name)}${window.location.hash}`;

  /** From the list: a new history entry, so the browser's back is "All". */
  const open = useCallback(
    (index: number) => {
      window.history.pushState(FROM_LIST, "", urlWith(frames[index].name));
      setAt(index);
    },
    [frames],
  );

  /** Previous / Next: the same entry, so back still returns to the list. */
  const step = useCallback(
    (index: number) => {
      window.history.replaceState(window.history.state, "", urlWith(frames[index].name));
      setAt(index);
    },
    [frames],
  );

  const close = useCallback(() => {
    if ((window.history.state as typeof FROM_LIST | null)?.fromList) return window.history.back();
    window.history.replaceState(null, "", urlWith(null));
    setAt(null);
  }, []);

  return { at, open, step, close };
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

export const TouchSnapshot = ({ file, frameUrl }: { file: CanvasFile; frameUrl: (name: string) => string }) => {
  const frames = useMemo(() => framesInReadingOrder(file), [file]);
  const { at, open, step, close } = useOpenFrame(frames);
  const frame = at === null ? null : frames[at];

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#282828] text-[#e0e0e0] antialiased">
      {/* The list scrolls; the bar under it stays at the foot of the screen. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-5 pb-3 pt-8">
          <h1 className="m-0 truncate text-[17px] font-semibold tracking-[-0.015em]">{file.name}</h1>
          <div className="text-[12.5px] text-[#9a9a9a]">
            {frames.length} {frames.length === 1 ? "component" : "components"}
          </div>
        </div>
        <ul className="m-0 list-none p-0">
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
        <p className="m-0 px-5 pb-8 pt-6 text-[12.5px] leading-[1.5] text-[#8a8a8a]">
          The canvas isn't available on mobile for performance reasons. Open this link on a desktop to see it.
        </p>
      </div>
      <div className="shrink-0 border-t border-white/[0.07] px-5 pb-5 pt-4">
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

      {/* One component, over the list */}
      {frame && at !== null && (
        <div className="snapshot-open absolute inset-0 flex flex-col bg-[#282828]">
          <header className="flex h-12 shrink-0 items-center border-b border-white/[0.07] px-2">
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

          <Stage key={frame.name} frame={frame} url={frameUrl(frame.name)} />

          <footer className="flex shrink-0 items-center border-t border-white/[0.07] px-3 pb-3 pt-3">
            <StepButton side="previous" disabled={at === 0} onClick={() => step(at - 1)} />
            <div className="flex-1 text-center text-[13px] tabular-nums text-[#9a9a9a]">
              {at + 1} of {frames.length}
            </div>
            <StepButton side="next" disabled={at === frames.length - 1} onClick={() => step(at + 1)} />
          </footer>
        </div>
      )}
    </div>
  );
};
