import { useEffect, useState, type CSSProperties } from "react";
import { RotateCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/renderer/components/ui/tooltip";
import { TOOLS, ToolButton } from "@/renderer/components/CanvasToolbar";
import { FrameInspector } from "@/renderer/inspector/FrameInspector";
import { InspectorControls } from "@/renderer/inspector/InspectorControls";
import { useInspectorStore } from "@/renderer/inspector/store";
import { elementName } from "@/renderer/inspector/tags";

// A frame's own window: its component at the window's size, under a titlebar
// like the main window's that carries the canvas's Pointer and Inspect tools
// and the same keys. This window keeps no tags: each one goes to the main
// window's composer (main.ts "inspector:tag"), and the titlebar says so.

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

// The tools that do something here; Comment isn't built yet.
const PREVIEW_TOOLS = TOOLS.filter((t) => t.id !== "comment");

const componentNameOf = (url: string) => {
  try {
    return new URL(url).searchParams.get("componentName") ?? "";
  } catch {
    return "";
  }
};

export const PreviewWindow = ({ url }: { url: string }) => {
  // The frame is named as on the canvas, so its tags name the same frame there.
  const componentName = componentNameOf(url);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [reloads, setReloads] = useState(0);
  const [tagged, setTagged] = useState<string | null>(null);
  const inspecting = useInspectorStore((s) => s.active);
  const setInspecting = useInspectorStore((s) => s.setActive);

  useEffect(() => {
    document.title = componentName || "Preview";
  }, [componentName]);

  useEffect(
    () =>
      useInspectorStore.subscribe((s) => {
        if (!s.tags.length) return;
        for (const tag of s.tags) void window.electronAPI.tagElement(tag, url);
        setTagged(elementName(s.tags.at(-1)!.info));
        useInspectorStore.setState({ tags: [] });
      }),
    [url],
  );

  useEffect(() => {
    if (!tagged) return;
    const timer = setTimeout(() => setTagged(null), 2500);
    return () => clearTimeout(timer);
  }, [tagged]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full flex-col bg-[#0a0a0a]">
        <div className="relative flex h-[38px] w-full shrink-0 items-center gap-2 border-b border-[#333] bg-[#2A2A2A] pl-20 pr-2 drag-region">
          {/* Centered on the window, as the main window's "Antidraw". */}
          <span className="pointer-events-none absolute inset-x-0 truncate px-48 text-center text-[13px] font-medium text-neutral-400 max-[560px]:hidden">
            {componentName}
          </span>
          <div className="relative flex items-center gap-0.5" style={noDrag}>
            {PREVIEW_TOOLS.map((t) => (
              <ToolButton
                key={t.id}
                label={t.label}
                Icon={t.Icon}
                active={(t.id === "inspect") === inspecting}
                onClick={() => setInspecting(t.id === "inspect")}
                size={26}
                tooltipSide="bottom"
              />
            ))}
          </div>
          <div className="relative ml-auto flex min-w-0 items-center gap-2">
            {tagged && (
              <span role="status" className="truncate font-mono text-[11px] text-neutral-400">
                Tagged {tagged} for Claude
              </span>
            )}
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
              ref={setIframe}
              src={url}
              title={componentName}
              className="absolute inset-0 h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin"
            />
          )}
          <FrameInspector frame={componentName} iframe={iframe} />
        </div>
        <InspectorControls />
      </div>
    </TooltipProvider>
  );
};
