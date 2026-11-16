import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Plug } from "lucide-react";
import { cx } from "@/renderer/onboarding/McpParts";
import { McpRows } from "@/renderer/onboarding/TwoWaysRows";

// The MCP setup in the titlebar, beside the workspace switcher: a button that
// opens the onboarding page's MCP card (onboarding/TwoWaysRows) under it, a
// size down, not a simplified menu. The chat isn't in it: it's already in the
// sidebar.

const LABEL = "Set up MCP server";

// The titlebar drags the window; what's clicked in it doesn't.
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

export const McpSetup = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

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
        {LABEL}
      </button>
      {/* The popover is the onboarding page's MCP card too, a size down. */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden style={NO_DRAG} />
          <div
            role="dialog"
            aria-label={LABEL}
            className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[calc(100vh-60px)] w-[392px] origin-top-right animate-[onb-pop_0.18s_cubic-bezier(0.23,1,0.32,1)] overflow-y-auto rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-0 text-left font-[450] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] [color-scheme:dark]"
            style={NO_DRAG}
          >
            <McpRows bare compact />
          </div>
        </>
      )}
    </div>
  );
};
