import { useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Check, Plus, Search } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useWorkspaces, useStopDevServer } from "@/renderer/lib/workspace-ops";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/renderer/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/renderer/components/ui/command";
import { AvatarIcon } from "@/renderer/components/AvatarIcon";

export const WorkspaceSwitcher = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore(
    (s) => s.setActiveWorkspaceId
  );
  const setActiveConversationId = useWorkspaceStore(
    (s) => s.setActiveConversationId
  );

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: workspaces } = useWorkspaces();
  const activeWorkspace = workspaces?.find(
    (ws) => ws.id === activeWorkspaceId
  );
  const stopDevServer = useStopDevServer();

  // Auto-focus search input when popover opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setSearch("");
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  const handleSelect = (wsId: string) => {
    const ws = workspaces?.find((w) => w.id === wsId);
    if (!ws) return;

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

  const handleNewWorkspace = () => {
    close();
    // TODO: wire up to onboarding create-workspace flow once that PR lands
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => setIsOpen(open)}
    >
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 py-1 px-2.5 bg-white/[0.06] border-none rounded-lg cursor-pointer hover:bg-white/[0.10] min-w-0 max-w-[200px] transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {activeWorkspace && (
            <AvatarIcon name={activeWorkspace.name} size={18} />
          )}
          <span className="text-[13px] font-medium text-neutral-200 truncate flex-1">
            {activeWorkspace?.name ?? "Select workspace"}
          </span>
          {isOpen ? (
            <ChevronUp className="w-3 h-3 text-neutral-500 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[240px] p-1 bg-[#2c2c2c] border border-[#2d2d2d] rounded-lg shadow-lg overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
        >
          <div className="flex items-center gap-2 py-1.5 px-2">
            <Search
              className={cn(
                "w-3 h-3 shrink-0 transition-colors",
                search ? "text-neutral-300" : "text-neutral-600"
              )}
            />
            <CommandInput
              ref={inputRef}
              placeholder="Search..."
              value={search}
              onValueChange={setSearch}
              className="text-[13px] placeholder:text-neutral-600"
            />
          </div>
          <CommandList className="max-h-[240px] px-1 pb-1">
            <CommandEmpty>No workspaces found</CommandEmpty>
            {(workspaces ?? []).map((ws) => (
              <CommandItem
                key={ws.id}
                value={ws.id}
                keywords={[ws.name]}
                onSelect={() => handleSelect(ws.id)}
                className="group w-full flex items-center gap-2 py-1.5 px-2 border-none rounded-md text-left"
              >
                <AvatarIcon name={ws.name} size={18} />
                <span className="text-[13px] font-medium truncate flex-1 text-neutral-400 group-data-[selected=true]:text-neutral-200">
                  {ws.name}
                </span>
                {ws.id === activeWorkspaceId && (
                  <Check className="w-3 h-3 text-neutral-500 shrink-0" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>

        <div className="-mx-1 border-t border-white/[0.06]" />
        <div className="pt-1">
          <button
            onClick={handleNewWorkspace}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border-none bg-transparent hover:bg-white/[0.06] text-[13px] font-medium text-neutral-500 hover:text-neutral-200 cursor-pointer transition-colors duration-[120ms]"
          >
            <Plus className="w-3 h-3" />
            New Workspace
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
