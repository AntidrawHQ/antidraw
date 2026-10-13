import { useEffect, useState, type CSSProperties } from "react";
import { RotateCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/renderer/components/ui/tooltip";

// A frame's own window: its component at the window's size, under a titlebar
// like the main window's that names it and can refresh it.

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

const componentNameOf = (url: string) => {
  try {
    return new URL(url).searchParams.get("componentName") ?? "";
  } catch {
    return "";
  }
};

export const PreviewWindow = ({ url }: { url: string }) => {
  const componentName = componentNameOf(url);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    document.title = componentName || "Preview";
  }, [componentName]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full flex-col bg-[#0a0a0a]">
        <div className="relative flex h-[38px] w-full shrink-0 items-center gap-2 border-b border-[#333] bg-[#2A2A2A] pl-20 pr-2 drag-region">
          {/* Centered on the window, as the main window's "Antidraw". */}
          <span className="pointer-events-none absolute inset-x-0 truncate px-48 text-center text-[13px] font-medium text-neutral-400 max-[560px]:hidden">
            {componentName}
          </span>
          <div className="relative ml-auto flex min-w-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Refresh"
                  onClick={() => setReloads((n) => n + 1)}
                  className="grid size-[26px] shrink-0 place-items-center rounded-[8px] text-white/50 hover:bg-white/[0.05] hover:text-white/85"
                  style={noDrag}
                >
                  <RotateCw size={14} strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4} style={{ animation: "none" }}>
                Refresh
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden">
          {url && (
            <iframe
              key={reloads}
              src={url}
              title={componentName}
              className="absolute inset-0 h-full w-full border-0"
              // The component works here as it would on its own page: forms
              // submit, alerts show, links open (main sends them to the
              // browser) and it can copy. Only the window stays the shell's.
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};
