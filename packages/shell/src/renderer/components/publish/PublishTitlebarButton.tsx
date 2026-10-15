/**
 * The titlebar's Publish button, sized and coloured as before (26px, light
 * pill). While publishing it echoes the panel: a progress ring and the step
 * in words. A failure shows in the panel, which stays open, so the button
 * just goes back to Publish.
 */
import type { CSSProperties, Ref } from "react";
import { Check, Globe } from "lucide-react";
import { STEPS, progressOf, type PublishState } from "./shared";

export type ButtonMode = "idle" | "running" | "live";

const Ring = ({ p }: { p: number }) => {
  const r = 5.25;
  const len = 2 * Math.PI * r;
  return (
    <svg width={13} height={13} viewBox="0 0 14 14" aria-hidden className="-rotate-90">
      <circle cx={7} cy={7} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.75} />
      <circle
        cx={7}
        cy={7}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - Math.max(0.04, p))}
        style={{ transition: "stroke-dashoffset 240ms cubic-bezier(0.23, 1, 0.32, 1)" }}
      />
    </svg>
  );
};

const short: Record<string, string> = {
  account: "Publishing",
  runtime: "Publishing",
  build: "Building",
  upload: "Uploading",
  live: "Going live",
};

export default function PublishTitlebarButton({
  mode,
  state,
  onClick,
  pressed,
  ref,
}: {
  mode: ButtonMode;
  state?: PublishState;
  onClick?: () => void;
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const running = mode === "running" && state;
  const label = running ? (short[state.step] ?? "Publishing") : mode === "live" ? "Published" : "Publish";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-expanded={pressed}
      aria-busy={!!running}
      aria-label={
        running
          ? `${STEPS.find((s) => s.key === state.step)?.label ?? "Publishing"}, ${Math.round(progressOf(state) * 100)}%`
          : undefined
      }
      className="flex h-[26px] min-w-[84px] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#e0e0e0] px-2.5 text-[13px] font-medium text-neutral-900 transition-colors hover:bg-white"
      style={
        {
          WebkitAppRegion: "no-drag",
          boxShadow: pressed ? "0 0 0 2px #1e1e1e, 0 0 0 3.5px rgba(255,255,255,0.28)" : undefined,
        } as CSSProperties
      }
    >
      {running ? (
        <Ring p={progressOf(state)} />
      ) : mode === "live" ? (
        <Check size={13} strokeWidth={2.5} />
      ) : (
        <Globe size={13} strokeWidth={2.2} />
      )}
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
