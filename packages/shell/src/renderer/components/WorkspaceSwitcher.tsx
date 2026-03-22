import { useState, useRef, useMemo } from "react";
import { ChevronsUpDown, Check, Search } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useWorkspaces, useStopDevServer } from "@/renderer/lib/workspace-ops";
import { fuzzyMatch } from "@/renderer/lib/fuzzy-search";
import { renderHighlighted } from "@/renderer/lib/render-highlighted";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/renderer/components/ui/popover";

export const WorkspaceSwitcher = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const setActiveConversationId = useWorkspaceStore(
    (s) => s.setActiveConversationId
  );

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: workspaces } = useWorkspaces();
  const activeWorkspace = workspaces?.find((ws) => ws.id === activeWorkspaceId);
  const stopDevServer = useStopDevServer();

  // Filter workspaces by search
  const filtered = useMemo(() => {
    return (workspaces ?? [])
      .map((ws) => ({
        ...ws,
        ...fuzzyMatch(ws.name, search),
      }))
      .filter((ws) => ws.match);
  }, [workspaces, search]);

  const close = () => {
    setIsOpen(false);
    setSearch("");
  };

  const handleSelect = (id: string) => {
    if (id === activeWorkspaceId) {
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

    setActiveWorkspaceId(id);
    setActiveConversationId(null);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      handleSelect(filtered[selectedIndex].id);
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) setSelectedIndex(0);
        if (!open) setSearch("");
      }}
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
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus();
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search */}
        <div className="p-2">
          <div className="flex items-center gap-2 bg-neutral-700 rounded-lg px-2.5 py-2 border border-[#2d2d2d]">
            <Search
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                search ? "text-neutral-200" : "text-[#71717a]"
              )}
            />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedIndex(0);
              }}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-neutral-200 placeholder:text-neutral-500"
            />
            <button
              onClick={close}
              className="px-1.5 py-0.5 bg-[#2d2d2d] border-none rounded text-[10px] text-neutral-400 cursor-pointer hover:bg-neutral-600"
            >
              ESC
            </button>
          </div>
        </div>

        {/* Workspace list */}
        <div className="max-h-[240px] overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-neutral-500">
              No workspaces found
            </div>
          ) : (
            filtered.map((ws, idx) => (
              <button
                key={ws.id}
                onClick={() => handleSelect(ws.id)}
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
                    idx === selectedIndex
                      ? "text-neutral-200"
                      : "text-neutral-400"
                  )}
                >
                  {renderHighlighted(ws.name, ws.indices)}
                </span>
                {ws.id === activeWorkspaceId && (
                  <Check className="w-3.5 h-3.5 text-neutral-200 shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
