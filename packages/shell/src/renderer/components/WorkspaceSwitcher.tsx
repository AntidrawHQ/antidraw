import { useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Check, Plus, Search } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
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
import BoringAvatar from "boring-avatars";
import type { WorkspaceWithComponentCount } from "@/main/api";

const AVATAR_COLORS = ["#c084a0", "#84a0c0", "#a0c084", "#c0a084", "#84c0a0"];

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
  const router = useRouter();

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
    router.navigate({ to: "/onboarding/create-workspace" });
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => setIsOpen(open)}
    >
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 py-1.5 px-2.5 bg-white/[0.06] border-none rounded-lg cursor-pointer hover:bg-white/[0.10] min-w-0 max-w-[200px] transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* {activeWorkspace && (
            <div className="rounded shrink-0 overflow-hidden" style={{ width: 18, height: 18 }}>
              <BoringAvatar size={18} name={activeWorkspace.name} variant="beam" colors={AVATAR_COLORS} square />
            </div>
          )} */}
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
        className="w-[280px] p-0 bg-[#2c2c2c] border border-[#2d2d2d] shadow-2xl overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
        >
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-3">
            <Search
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-colors",
                search ? "text-neutral-300" : "text-neutral-600"
              )}
            />
            <CommandInput
              ref={inputRef}
              placeholder="Search..."
              value={search}
              onValueChange={setSearch}
              className="placeholder:text-neutral-600"
            />
          </div>
          <CommandList className="max-h-[280px] px-2 pb-2">
            <CommandEmpty>No workspaces found</CommandEmpty>
            {(workspaces ?? []).map((ws) => (
              <CommandItem
                key={ws.id}
                value={ws.id}
                keywords={[ws.name]}
                onSelect={() => handleSelect(ws.id)}
                className="w-full flex items-center gap-3 py-2.5 px-2.5 border-none text-left mb-0.5"
              >
                {/* <AvatarIcon name={ws.name} size={38} /> */}
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "text-[13px] font-medium truncate",
                      ws.id === activeWorkspaceId
                        ? "text-neutral-100"
                        : "text-neutral-300"
                    )}
                  >
                    {ws.name}
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate mt-0.5">
                    {ws.componentCount} {ws.componentCount === 1 ? "component" : "components"}
                  </div>
                </div>
                {ws.id === activeWorkspaceId && (
                  <Check className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>

        <div className="mx-3 border-t border-[#2d2d2d]" />

        <div className="p-2">
          <button
            onClick={handleNewWorkspace}
            className="w-full flex items-center gap-3 py-2.5 px-2.5 rounded-xl cursor-pointer bg-transparent border-none hover:bg-white/[0.06] transition-colors"
          >
            <div
              className="rounded-xl shrink-0 flex items-center justify-center"
              style={{ width: 38, height: 38, backgroundColor: "#383838" }}
            >
              <Plus className="w-4 h-4 text-neutral-400" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[13px] font-medium text-neutral-300">
                New Workspace
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                Start a fresh project
              </div>
            </div>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
