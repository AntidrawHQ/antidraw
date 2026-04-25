import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { ChevronsUpDown, Plus, Search } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "./store/workspace";
import type { SidePanel as SidePanelId } from "./store/workspace";
import {
  useWorkspaceConversations,
  useCreateConversation,
} from "./lib/claude-code-ops";
import { formatRelativeTime } from "./lib/time-utils";
import { AppChat } from "./Chat";
import { ComponentPanel } from "./ComponentPanel";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
} from "./components/ui/command";
import { ResizablePanel } from "./components/ui/resizable-panel";

// --- Conversation List (search + filtered list + new button) ---

type ConversationListProps = {
  onClose: () => void;
};

const ConversationList = ({ onClose }: ConversationListProps) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveConversationId = useWorkspaceStore(
    (s) => s.setActiveConversationId
  );

  const { data: conversations = [] } =
    useWorkspaceConversations(activeWorkspaceId);
  const createConversation = useCreateConversation();

  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSelect = (convId: string) => {
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;
    setActiveConversationId(conv.id);
    onClose();
  };

  const handleNewConversation = async () => {
    if (!activeWorkspaceId) return;
    const conv = await createConversation.mutateAsync(activeWorkspaceId);
    setActiveConversationId(conv.id);
    onClose();
  };

  return (
    <Command
      className="flex-1 flex flex-col overflow-hidden"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
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
        <button
          onClick={handleNewConversation}
          disabled={createConversation.isPending}
          className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/[0.06] text-[12px] text-neutral-500 hover:text-neutral-200 disabled:opacity-50 shrink-0"
          title="New conversation"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      <CommandList className="flex-1 px-2 pb-2">
        {conversations.map((conv) => (
          <CommandItem
            key={conv.id}
            value={conv.id}
            keywords={[conv.title ?? "Untitled Conversation"]}
            onSelect={() => handleSelect(conv.id)}
            className="group w-full flex flex-col items-start gap-0.5 py-2 px-2.5 border-none rounded-md text-left mb-0.5"
          >
            <div className="w-full flex items-center justify-between gap-2">
              <span className="flex-1 text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap text-neutral-400 group-data-[selected=true]:text-neutral-200">
                {conv.title ?? "Untitled Conversation"}
              </span>
              <span className="text-[10px] text-neutral-600 shrink-0">
                {formatRelativeTime(new Date(conv.updatedAt))}
              </span>
            </div>
            {conv.summary && (
              <span className="text-[11px] text-[#71717a] overflow-hidden text-ellipsis whitespace-nowrap w-full">
                {conv.summary}
              </span>
            )}
          </CommandItem>
        ))}
      </CommandList>

    </Command>
  );
};

// --- Conversation View (header + chat) ---

type ConversationViewProps = {
  onShowList: () => void;
};

const ConversationView = ({ onShowList }: ConversationViewProps) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeConversationId = useWorkspaceStore(
    (s) => s.activeConversationId
  );
  const setActiveConversationId = useWorkspaceStore(
    (s) => s.setActiveConversationId
  );

  const { data: conversations = [] } =
    useWorkspaceConversations(activeWorkspaceId);
  const createConversation = useCreateConversation();

  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );

  const handleNewConversation = async () => {
    if (!activeWorkspaceId) return;
    const conv = await createConversation.mutateAsync(activeWorkspaceId);
    setActiveConversationId(conv.id);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Conversation Selector Header */}
      <div className="p-2 border-b border-[#2d2d2d] flex items-center gap-1">
        <button
          onClick={onShowList}
          className="flex-1 flex items-center justify-between gap-1.5 py-1.5 px-2.5 bg-transparent border-none rounded-md cursor-pointer hover:bg-white/[0.06] min-w-0"
        >
          <span className="text-[13px] font-medium text-neutral-200 overflow-hidden text-ellipsis whitespace-nowrap">
            {activeConversation?.title ?? "Untitled Conversation"}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
        </button>
        <button
          onClick={handleNewConversation}
          disabled={createConversation.isPending}
          className="p-1.5 rounded-md hover:bg-white/[0.06] text-[#71717a] hover:text-neutral-200 disabled:opacity-50 shrink-0"
          title="New conversation"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Chat Content */}
      <AppChat className="flex-1 min-h-0" />
    </div>
  );
};

// --- Chat Panel (thin wrapper picking the active variant) ---

const ChatPanel = () => {
  const activeConversationId = useWorkspaceStore(
    (s) => s.activeConversationId
  );
  const [showList, setShowList] = useState(false);

  if (showList || !activeConversationId) {
    return <ConversationList onClose={() => setShowList(false)} />;
  }

  return <ConversationView onShowList={() => setShowList(true)} />;
};

// --- Side Panel (resizable shell + panel map) ---

const panelMap = {
  chat: ChatPanel,
  components: ComponentPanel,
} satisfies Record<SidePanelId, ComponentType>;

type SidePanelProps = {
  className?: string;
};

export const SidePanel = ({ className }: SidePanelProps) => {
  const activeSidePanel = useWorkspaceStore((s) => s.activeSidePanel);
  const ActivePanel = panelMap[activeSidePanel];

  return (
    <ResizablePanel className={cn("bg-neutral-800", className)}>
      <ActivePanel />
    </ResizablePanel>
  );
};
