/**
 * ONBOARDING: the step after the first workspace is made. Two ways to work
 * on its canvas: the chat built into Antidraw, and the agents the user
 * already has, connected over MCP. Every agent is a row with its own "Add",
 * so the list shows which are added or connected at a glance, and a row opens
 * to its manual steps. With that many small buttons, "Add" is the quiet one
 * and "Open workspace" is the page's one solid button.
 */
import { ArrowRight } from "lucide-react";
import { FOCUS, cx } from "./McpParts";
import { TwoWaysRows } from "./TwoWaysRows";

export const OnboardingTwoWays = ({ onOpenWorkspace }: { onOpenWorkspace: () => void }) => (
  // The page scrolls under the titlebar: an open row is taller than the window.
  // font-[450]: a touch heavier than the app's 400, so small grey text on the
  // dark background reads without effort.
  <div
    className="h-full w-full overflow-y-auto font-[450] [color-scheme:dark]"
    style={{ scrollbarWidth: "thin", scrollbarColor: "#525252 transparent" }}
  >
    <div className="flex min-h-full w-full cursor-default items-start justify-center bg-neutral-800 px-6 py-16 antialiased">
      <div className="flex w-full max-w-[600px] flex-col">
        <h1 className="m-0 text-[28px] font-medium leading-8 tracking-[-0.035em] text-neutral-50">Two ways to work</h1>
        <p className="mt-3 text-[14px] leading-[22px] text-neutral-400">
          Use the chat built into Antidraw, or connect the agents you already use.
          <br />
          They work on the same canvas, so you can use both.
        </p>
        <div className="mt-8 flex animate-[onb-fadein_0.3s_ease] flex-col gap-3">
          <TwoWaysRows />
        </div>
        <div className="mt-8">
          <button
            type="button"
            onClick={onOpenWorkspace}
            className={cx(
              "group flex h-9 w-fit items-center gap-1.5 rounded-[10px] pl-3.5 pr-3 text-[14px] font-medium transition-colors",
              "bg-neutral-100 text-neutral-900 hover:bg-white",
              FOCUS,
            )}
          >
            Open workspace
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  </div>
);
