import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Plug } from "lucide-react";
import { useAgentStates } from "@/renderer/onboarding/agent-states";
import { AGENTS } from "@/renderer/onboarding/agents";
import { McpMenu } from "@/renderer/onboarding/McpMenu";
import { cx } from "@/renderer/onboarding/McpParts";

// The MCP setup in the titlebar, beside the workspace switcher: a button that
// opens the agents (onboarding/McpMenu) as a small menu under it. The button
// also says which agents are connected, so it stays useful after setup.

const LABEL = "Set up MCP server";

// The titlebar drags the window; what's clicked in it doesn't.
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

export const McpSetup = () => {
  const [open, setOpen] = useState(false);
  const { state } = useAgentStates();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  // The agents' states are the button's too, so a row's "Connected" shows up here.
  const connected = AGENTS.filter((a) => state(a.id) === "connected");
  const pending = AGENTS.some((a) => ["adding", "waiting"].includes(state(a.id)));
  const n = connected.length;
  const [only] = connected;
  const named = only && n === 1 ? only.name : `${n} agents`;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          "flex h-[26px] items-center rounded-lg text-[13px] font-medium transition-colors",
          open
            ? "bg-white/[0.12] text-neutral-100"
            : "bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1] hover:text-neutral-100",
          "gap-1.5 whitespace-nowrap px-2.5",
        )}
        style={NO_DRAG}
      >
        <Plug className="size-3.5" strokeWidth={2} />
        {n ? `${named} connected` : LABEL}
        {pending && !n && <span className="ml-0.5 size-1.5 shrink-0 rounded-full bg-[#d6b98a]" />}
      </button>
      {/* The popover is a menu of the agents, as small as it goes. */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden style={NO_DRAG} />
          <div
            role="dialog"
            aria-label={LABEL}
            className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[calc(100vh-60px)] w-[336px] origin-top-right animate-[onb-pop_0.18s_cubic-bezier(0.23,1,0.32,1)] overflow-y-auto rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-1.5 text-left font-[450] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] [color-scheme:dark]"
            style={NO_DRAG}
          >
            <McpMenu />
          </div>
        </>
      )}
    </div>
  );
};
