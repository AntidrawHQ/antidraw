import { useEffect } from "react";
import { MessageSquare, Blocks } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "./store/workspace";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";

const tabs = [
  { id: "chat" as const, icon: MessageSquare, label: "Chat" },
  { id: "components" as const, icon: Blocks, label: "Components" },
];

const isMac = navigator.userAgent.includes("Mac");

export const IconStrip = () => {
  const activeSidePanel = useWorkspaceStore((s) => s.activeSidePanel);
  const setActiveSidePanel = useWorkspaceStore((s) => s.setActiveSidePanel);
  const open = useWorkspaceStore((s) => s.sidePanelOpen);

  // Mod+B folds the side panel, as in VS Code: Cmd on macOS, Ctrl elsewhere.
  // Typing too, since nothing here takes it for bold.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (e.key !== "b" || !mod || e.shiftKey || e.altKey) return;
      e.preventDefault();
      useWorkspaceStore.getState().toggleSidePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="w-12 shrink-0 bg-[#2A2A2A] flex flex-col items-stretch border-r border-[#333]">
      {tabs.map((tab) => {
        const isActive = open && activeSidePanel === tab.id;
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveSidePanel(tab.id)}
                className={cn(
                  "h-12 flex items-center justify-center border-none cursor-pointer transition-colors",
                  isActive
                    ? "bg-white/[0.1] text-neutral-200"
                    : "bg-transparent text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06]"
                )}
              >
                <tab.icon className="w-[18px] h-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={4}>
              {tab.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};
