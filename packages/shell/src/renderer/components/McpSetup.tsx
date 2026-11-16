import { useState } from "react";
import type { CSSProperties } from "react";
import { Plug } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/renderer/components/ui/popover";
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

  // The app's popover, as the switcher beside it has: it stays in the window,
  // and its Escape and outside click are handled, so the canvas doesn't take
  // them too.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cx(
            "flex h-[26px] shrink-0 items-center rounded-lg text-[13px] font-medium transition-colors",
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
      </PopoverTrigger>
      {/* The popover is the onboarding page's MCP card too, a size down. */}
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        aria-label={LABEL}
        // Focus goes to the card, not its first row, which would show a ring.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        className="max-h-[min(calc(100vh-60px),var(--radix-popover-content-available-height))] w-[min(392px,calc(100vw-16px))] overflow-y-auto rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-0 text-left font-[450] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] [color-scheme:dark] data-[state=open]:animate-[onb-pop_0.18s_cubic-bezier(0.23,1,0.32,1)]"
        style={NO_DRAG}
      >
        <McpRows bare compact source="titlebar" />
      </PopoverContent>
    </Popover>
  );
};
