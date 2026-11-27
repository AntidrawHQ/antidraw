import { useEffect } from "react";
import { MessageSquare, Blocks } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "./store/workspace";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { track } from "@/renderer/lib/analytics";

const tabs = [
  { id: "chat" as const, icon: MessageSquare, label: "Chat" },
  { id: "components" as const, icon: Blocks, label: "Components" },
];

const isMac = navigator.userAgent.includes("Mac");

export const IconStrip = () => {
  const activeSidePanel = useWorkspaceStore((s) => s.activeSidePanel);
  const setActiveSidePanel = useWorkspaceStore((s) => s.setActiveSidePanel);
  const open = useWorkspaceStore((s) => s.sidePanelOpen);
  const uiHidden = useWorkspaceStore((s) => s.uiHidden);

  // Mod+B folds the side panel, as in VS Code: Cmd on macOS, Ctrl elsewhere.
  // Typing too, since nothing here takes it for bold. Mod+\ hides all the
  // chrome around the canvas and shows it again, as in Figma.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      // By the key, not the character: on some layouts \ is typed with AltGr.
      if (e.code === "Backslash" && mod && !e.shiftKey && !e.altKey) {
        const s = useWorkspaceStore.getState();
        e.preventDefault();
        // Held down, it toggles once, not again on each repeat.
        if (e.repeat) return;
        track("panel_toggled", { panel: "all", open: s.uiHidden, via: "shortcut" });
        s.setUiHidden(!s.uiHidden);
        return;
      }
      if (e.key !== "b" || !mod || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const s = useWorkspaceStore.getState();
      track("panel_toggled", { panel: "side", open: s.uiHidden || !s.sidePanelOpen, via: "shortcut" });
      s.toggleSidePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cn("w-12 shrink-0 bg-[#2A2A2A] flex flex-col items-stretch border-r border-[#333]", uiHidden && "hidden")}>
      {tabs.map((tab) => {
        const isActive = open && activeSidePanel === tab.id;
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  track("side_panel_tab_selected", { tab: tab.id });
                  setActiveSidePanel(tab.id);
                }}
                className={cn(
                  "h-12 flex items-center justify-center border-none cursor-pointer transition-colors",
                  isActive
                    ? "bg-white/[0.1] text-neutral-50"
                    : "bg-transparent text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06]"
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
