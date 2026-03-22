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

export const IconStrip = () => {
  const activeSidePanel = useWorkspaceStore((s) => s.activeSidePanel);
  const setActiveSidePanel = useWorkspaceStore((s) => s.setActiveSidePanel);

  return (
    <div className="w-12 shrink-0 bg-neutral-800 flex flex-col items-center pt-2 gap-1 border-r border-[#2d2d2d]">
      {tabs.map((tab) => {
        const isActive = activeSidePanel === tab.id;
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveSidePanel(tab.id)}
                className={cn(
                  "w-9 h-9 flex items-center justify-center rounded-md border-none cursor-pointer transition-colors",
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
