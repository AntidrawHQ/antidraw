import { useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useWorkspaces, useStopDevServer } from "@/renderer/lib/workspace-ops";
import { renderHighlighted } from "@/renderer/lib/search-utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/renderer/components/ui/popover";
import {
  SearchableList,
  SearchableListInput,
  useSearchableList,
} from "@/renderer/components/ui/searchable-list";

type Workspace = {
  id: string;
  name: string;
};

type WorkspaceItemsProps = {
  onSelect: (ws: Workspace) => void;
};

const WorkspaceItems = ({ onSelect }: WorkspaceItemsProps) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { filtered, selectedIndex } = useSearchableList<Workspace>();

  return (
    <div className="max-h-[240px] overflow-y-auto px-2 pb-2">
      {filtered.length === 0 ? (
        <div className="py-4 text-center text-[12px] text-neutral-500">
          No workspaces found
        </div>
      ) : (
        filtered.map((item, idx) => (
          <button
            key={item.data.id}
            onClick={() => onSelect(item.data)}
            className={cn(
              "w-full flex items-center gap-2 py-2 px-2.5 border-none rounded-md cursor-pointer text-left mb-0.5",
              idx === selectedIndex
                ? "bg-white/[0.06]"
                : "bg-transparent hover:bg-white/[0.06]"
            )}
          >
            <span
              className={cn(
                "flex-1 text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap",
                idx === selectedIndex ? "text-neutral-200" : "text-neutral-400"
              )}
            >
              {renderHighlighted(item.label, item.indices)}
            </span>
            {item.data.id === activeWorkspaceId && (
              <Check className="w-3.5 h-3.5 text-neutral-200 shrink-0" />
            )}
          </button>
        ))
      )}
    </div>
  );
};

export const WorkspaceSwitcher = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore(
    (s) => s.setActiveWorkspaceId
  );
  const setActiveConversationId = useWorkspaceStore(
    (s) => s.setActiveConversationId
  );

  const [isOpen, setIsOpen] = useState(false);

  const { data: workspaces } = useWorkspaces();
  const activeWorkspace = workspaces?.find(
    (ws) => ws.id === activeWorkspaceId
  );
  const stopDevServer = useStopDevServer();

  const close = () => setIsOpen(false);

  const handleSelect = (ws: Workspace) => {
    if (ws.id === activeWorkspaceId) {
      close();
      return;
    }

    // Stop previous workspace's dev server
    if (activeWorkspaceId) {
      stopDevServer.mutate(activeWorkspaceId, {
        onError: (error) => {
          console.error("Failed to stop dev server:", error);
        },
      });
    }

    setActiveWorkspaceId(ws.id);
    setActiveConversationId(null);
    close();
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => setIsOpen(open)}
    >
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 py-1 px-2.5 bg-transparent border-none rounded-md cursor-pointer hover:bg-white/[0.06] min-w-0 max-w-[180px]"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <span className="text-[13px] font-medium text-neutral-200 overflow-hidden text-ellipsis whitespace-nowrap">
            {activeWorkspace?.name ?? "Select workspace"}
          </span>
          <ChevronsUpDown className="w-3 h-3 text-[#71717a] shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[240px] p-0 bg-neutral-800 border-[#2d2d2d] rounded-lg shadow-xl overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SearchableList
          items={workspaces ?? []}
          getLabel={(ws) => ws.name}
          onSelect={handleSelect}
          onClose={close}
          autoFocus
        >
          <SearchableListInput onClose={close} />
          <WorkspaceItems onSelect={handleSelect} />
        </SearchableList>
      </PopoverContent>
    </Popover>
  );
};
