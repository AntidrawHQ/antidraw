import { useEffect, useState, type CSSProperties } from "react";
import { RotateCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/renderer/components/ui/tooltip";
import { TOOLS, ToolButton } from "@/renderer/components/CanvasToolbar";
import { FrameInspector } from "@/renderer/inspector/FrameInspector";
import { PreviewComments } from "@/renderer/comments/PreviewComments";
import { CommentControls } from "@/renderer/comments/CommentControls";
import { pickCanvasTool, useCanvasTool } from "@/renderer/comments/store";

// A frame's own window: its component at the window's size, under a titlebar
// like the main window's that carries the canvas's Pointer and Comment tools
// and their keys. No Inspect: tagging for the main window's chat can wait.
// No comments list: a comment left here joins the main window's, and Show
// goes there.

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;


const componentNameOf = (url: string) => {
  try {
    return new URL(url).searchParams.get("componentName") ?? "";
  } catch {
    return "";
  }
};

export const PreviewWindow = ({ url, workspaceId = null }: { url: string; workspaceId?: string | null }) => {
  // The frame is named as on the canvas, so its comments name the same frame there.
  const componentName = componentNameOf(url);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [reloads, setReloads] = useState(0);
  // The comment just added here, for Show.
  const [commented, setCommented] = useState<number | null>(null);
  const tool = useCanvasTool();
  // Comments are a workspace's: without one, no tools.
  const tools = workspaceId ? TOOLS.filter((t) => t.id !== "inspect") : [];

  useEffect(() => {
    document.title = componentName || "Preview";
  }, [componentName]);

  useEffect(() => {
    if (commented === null) return;
    const timer = setTimeout(() => setCommented(null), 6000);
    return () => clearTimeout(timer);
  }, [commented]);

  return (
    <TooltipProvider>
      <div data-inspector-keys className="flex h-screen w-full flex-col bg-[#0a0a0a]">
        <div className="relative flex h-[38px] w-full shrink-0 items-center gap-2 border-b border-[#333] bg-[#2A2A2A] pl-20 pr-2 drag-region">
          {/* Centered on the window, as the main window's "Antidraw". */}
          <span className="pointer-events-none absolute inset-x-0 truncate px-48 text-center text-[13px] font-medium text-neutral-400 max-[560px]:hidden">
            {componentName}
          </span>
          <div className="relative flex items-center gap-0.5" style={noDrag}>
            {tools.map((t) => (
              <ToolButton
                key={t.id}
                label={t.label}
                Icon={t.Icon}
                active={t.id === tool}
                onClick={() => pickCanvasTool(t.id, "click")}
                size={26}
                tooltipSide="bottom"
              />
            ))}
          </div>
          <div className="relative ml-auto flex min-w-0 items-center gap-2">
            {commented !== null && (
              <span role="status" className="flex min-w-0 items-center gap-2 text-[11px] text-neutral-400">
                <span className="truncate">Comment added for Claude</span>
                <button
                  type="button"
                  onClick={() => {
                    if (workspaceId) void window.electronAPI.showComments({ workspaceId, commentId: commented, send: false });
                    setCommented(null);
                  }}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-neutral-200 hover:bg-white/[0.06] hover:text-white"
                  style={noDrag}
                >
                  Show
                </button>
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Refresh"
                  // As the tools': a click doesn't take focus (ToolButton).
                  onMouseDown={(e) => e.preventDefault()}
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
              // Keys go to the component, as on its own page, from when it
              // loads and after each Refresh.
              onLoad={(e) => e.currentTarget.focus()}
              // The component works here as it would on its own page: forms
              // submit, alerts show, links open (main sends any off its dev
              // server to the browser) and it can copy. Only the window stays
              // the shell's.
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          )}
          <FrameInspector frame={componentName} iframe={iframe} wheel="scroll" />
          {workspaceId && (
            <PreviewComments
              frame={componentName}
              workspaceId={workspaceId}
              onAdded={(c) => {
                setCommented(c.id);
              }}
            />
          )}
        </div>
        {workspaceId && <CommentControls />}
      </div>
    </TooltipProvider>
  );
};
