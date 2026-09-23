import { useState } from "react";
import { Blocks, Search } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "./store/workspace";
import { useUserComponents } from "./store/userComponents";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command";

export const ComponentPanel = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setFocusComponentName = useWorkspaceStore((s) => s.setFocusComponentName);

  const {
    data: components,
    isPending,
    isError,
  } = useUserComponents(activeWorkspaceId);

  const [search, setSearch] = useState("");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-2 border-b border-[#333] flex items-center">
        <span className="text-[13px] font-medium text-neutral-400 px-2.5 py-0.5">
          Components
        </span>
      </div>

      {/* Content */}
      {isPending ? (
        <div className="px-2 py-2">
          <div className="text-[12px] text-neutral-500 px-2.5 py-2">
            Loading components...
          </div>
        </div>
      ) : isError || !components ? (
        <div className="px-2 py-2">
          <div className="text-[12px] text-neutral-500 px-2.5 py-2">
            Failed to load components
          </div>
        </div>
      ) : components.length === 0 ? (
        <div className="px-2 py-2">
          <div className="text-[12px] text-neutral-500 px-2.5 py-2">
            No components found
          </div>
        </div>
      ) : (
        // Same search row as the conversation list in SidePanel.tsx
        <Command className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-3">
            <Search
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-colors",
                search ? "text-neutral-300" : "text-neutral-600"
              )}
            />
            <CommandInput
              placeholder="Search..."
              value={search}
              onValueChange={setSearch}
              className="placeholder:text-neutral-600"
            />
          </div>

          <CommandList className="flex-1 px-2 pb-2">
            <CommandEmpty>No matching components</CommandEmpty>
            {components.map((component) => (
              <CommandItem
                key={component.name}
                value={component.name}
                onSelect={() => setFocusComponentName(component.name)}
                className="group w-full flex items-center gap-2 py-2 px-2.5 border-none rounded-md text-left mb-0.5"
              >
                <Blocks className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="text-[13px] text-neutral-400 overflow-hidden text-ellipsis whitespace-nowrap group-data-[selected=true]:text-neutral-200">
                  {component.name}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
    </div>
  );
};
