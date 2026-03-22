import { Blocks } from "lucide-react";
import { useWorkspaceStore } from "./store/workspace";
import { useUserComponents } from "./store/userComponents";

export const ComponentPanel = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setFocusComponentName = useWorkspaceStore((s) => s.setFocusComponentName);

  const {
    data: components,
    isPending,
    isError,
  } = useUserComponents(activeWorkspaceId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-2 border-b border-[#2d2d2d] flex items-center">
        <span className="text-[13px] font-medium text-neutral-200 px-2.5 py-0.5">
          Components
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isPending ? (
          <div className="text-[12px] text-neutral-500 px-2.5 py-2">
            Loading components...
          </div>
        ) : isError || !components ? (
          <div className="text-[12px] text-neutral-500 px-2.5 py-2">
            Failed to load components
          </div>
        ) : components.length === 0 ? (
          <div className="text-[12px] text-neutral-500 px-2.5 py-2">
            No components found
          </div>
        ) : (
          components.map((component) => (
            <button
              key={component.name}
              onClick={() => setFocusComponentName(component.name)}
              className="w-full flex items-center gap-2 py-2 px-2.5 border-none rounded-md cursor-pointer text-left bg-transparent hover:bg-white/[0.06] mb-0.5"
            >
              <Blocks className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="text-[13px] text-neutral-400 overflow-hidden text-ellipsis whitespace-nowrap">
                {component.name}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
