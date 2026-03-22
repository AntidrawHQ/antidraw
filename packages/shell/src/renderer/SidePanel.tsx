import { useState } from "react";
import type { ComponentType } from "react";
import { ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "./store/workspace";
import type { SidePanel as SidePanelId } from "./store/workspace";
import {
  useWorkspaceConversations,
  useCreateConversation,
} from "./lib/claude-code-ops";
import type { Conversation } from "@/main/api";
import { formatRelativeTime } from "./lib/time-utils";
import { renderHighlighted } from "./lib/search-utils";
import { AppChat } from "./Chat";
import { ComponentPanel } from "./ComponentPanel";
import {
  SearchableList,
  SearchableListInput,
  useSearchableList,
} from "./components/ui/searchable-list";
import { ResizablePanel } from "./components/ui/resizable-panel";

// --- Conversation List (search + filtered list + new button) ---

type ConversationItemsProps = {
  onSelect: (conv: Conversation) => void;
};

const ConversationItems = ({ onSelect }: ConversationItemsProps) => {
  const { filtered, selectedIndex } = useSearchableList<Conversation>();

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      {filtered.map((item, idx) => {
        const conv = item.data;
        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv)}
            className={cn(
              "w-full flex flex-col items-start gap-0.5 py-2 px-2.5 border-none rounded-md cursor-pointer text-left mb-0.5",
              idx === selectedIndex
                ? "bg-white/[0.06]"
                : "bg-transparent hover:bg-white/[0.06]"
            )}
          >
            <div className="w-full flex items-center justify-between gap-2">
              <span
                className={cn(
                  "flex-1 text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap",
                  idx === selectedIndex
                    ? "text-neutral-200"
                    : "text-neutral-400"
                )}
              >
                {renderHighlighted(item.label, item.indices)}
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
          </button>
        );
      })}
    </div>
  );
};

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

  const handleSelect = (conv: Conversation) => {
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
    <SearchableList
      items={conversations}
      getLabel={(c) => c.title ?? "Untitled Conversation"}
      onSelect={handleSelect}
      onClose={onClose}
      autoFocus
      className="flex-1 flex flex-col overflow-hidden"
    >
      <SearchableListInput onClose={onClose} />
      <ConversationItems onSelect={handleSelect} />

      {/* New Conversation */}
      <div className="p-2 border-t border-[#2d2d2d]">
        <button
          onClick={handleNewConversation}
          disabled={createConversation.isPending}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-neutral-700 border border-[#2d2d2d] rounded-md cursor-pointer text-xs text-neutral-400 hover:bg-white/[0.1] disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          New Conversation
        </button>
      </div>
    </SearchableList>
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
