import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { ArrowLeft, Plus, Search } from "lucide-react";
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
import { SortMenu, type Sort } from "./dashboard/LocalList";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
} from "./components/ui/command";
import { ResizablePanel } from "./components/ui/resizable-panel";

// --- Conversation List (search + sort + filtered list + new button) ---

type Conversations = NonNullable<ReturnType<typeof useWorkspaceConversations>["data"]>;

// The dashboard's three orders, for chats: when one last had a message, when
// it was started, and its title.
const SORTERS: Record<Sort, (a: Conversations[number], b: Conversations[number]) => number> = {
  active: (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  created: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  name: (a, b) => (a.title ?? "Untitled Conversation").localeCompare(b.title ?? "Untitled Conversation"),
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

  const [search, setSearch] = useState("");
  // By last active to begin with: it's the time each row shows.
  const [sort, setSort] = useState<Sort>("active");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // While there's a search, cmdk puts the best matches first; this is the
  // order among equals, and the whole order without one.
  const sorted = useMemo(() => [...conversations].sort(SORTERS[sort]), [conversations, sort]);

  const handleSelect = (convId: string) => {
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;
    setActiveConversationId(conv.id);
    onClose();
  };

  const handleNewConversation = async () => {
    if (!activeWorkspaceId) return;
    const conv = await createConversation.mutateAsync({
      workspaceId: activeWorkspaceId,
    });
    setActiveConversationId(conv.id);
    onClose();
  };

  return (
    <Command
      className="flex-1 flex flex-col overflow-hidden"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      {/* Header, matching the components panel */}
      <div className="p-2 border-b border-[#333] flex items-center justify-between">
        <span className="text-[13px] font-medium text-neutral-200 px-2.5 py-0.5">
          Chats
        </span>
        <button
          onClick={handleNewConversation}
          disabled={createConversation.isPending}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-white/[0.06] text-[12px] text-neutral-400 hover:text-neutral-100 disabled:opacity-50 shrink-0"
          title="New conversation"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 pt-2.5 pb-3">
        <Search
          className={cn(
            "w-3.5 h-3.5 shrink-0 transition-colors",
            search ? "text-neutral-200" : "text-neutral-400"
          )}
        />
        <CommandInput
          ref={inputRef}
          placeholder="Search..."
          value={search}
          onValueChange={setSearch}
          className="placeholder:text-neutral-400"
        />
        {/* Its keys are its own: the list around it takes Enter for the chat that's lit, and Esc to close. */}
        <div className="flex shrink-0" onKeyDown={(e) => e.stopPropagation()}>
          <SortMenu
            sort={sort}
            onSort={setSort}
            // -my-1.5: the row stays the height the search alone gives it.
            className="-my-1.5"
            // Back to the search, where the arrows move through the list.
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
          />
        </div>
      </div>

      <CommandList className="flex-1 px-2 pb-2">
        {sorted.map((conv) => (
          <CommandItem
            key={conv.id}
            value={conv.id}
            keywords={[conv.title ?? "Untitled Conversation"]}
            onSelect={() => handleSelect(conv.id)}
            className="group w-full flex flex-col items-start gap-0.5 py-2 px-2.5 border-none rounded-md text-left mb-0.5"
          >
            <div className="w-full flex items-center justify-between gap-2">
              <span className="flex-1 text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap text-neutral-200 group-data-[selected=true]:text-neutral-50">
                {conv.title ?? "Untitled Conversation"}
              </span>
              <span className="text-[11px] tabular-nums text-neutral-400 shrink-0">
                {formatRelativeTime(new Date(conv.updatedAt))}
              </span>
            </div>
            {conv.summary && (
              <span className="text-[11px] text-neutral-400 overflow-hidden text-ellipsis whitespace-nowrap w-full">
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
    const conv = await createConversation.mutateAsync({
      workspaceId: activeWorkspaceId,
    });
    setActiveConversationId(conv.id);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb Header: Chats / <title> */}
      <div className="p-2 border-b border-[#333] flex items-center gap-1">
        <nav className="flex-1 flex items-center gap-1 min-w-0 text-[13px] font-medium">
          <button
            onClick={onShowList}
            className="flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-md hover:bg-white/[0.06] text-neutral-400 hover:text-neutral-100 cursor-pointer shrink-0"
            title="All conversations"
          >
            <ArrowLeft className="w-4 h-4" />
            Chats
          </button>
          <span className="text-neutral-400 shrink-0">/</span>
          {/* pl-2 mirrors the button's pr-2 so the slash sits centered */}
          <span
            className="pl-2 text-neutral-200 overflow-hidden text-ellipsis whitespace-nowrap"
            title={activeConversation?.title ?? undefined}
          >
            {activeConversation?.title ?? "Untitled Conversation"}
          </span>
        </nav>
        <button
          onClick={handleNewConversation}
          disabled={createConversation.isPending}
          className="p-1 rounded-md hover:bg-white/[0.06] text-neutral-400 hover:text-neutral-100 disabled:opacity-50 shrink-0"
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
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const { data: conversations = [], isLoading } =
    useWorkspaceConversations(activeWorkspaceId);
  const [showList, setShowList] = useState(false);
  const conversationShown = useWorkspaceStore((s) => s.conversationShown);

  // A conversation shown from outside (showConversation) replaces the list.
  useEffect(() => setShowList(false), [conversationShown]);

  // Wait for the conversation list before deciding which view to land on,
  // otherwise we briefly flash the empty chat before flipping to the list.
  if (isLoading) return null;

  // Show the list when explicitly opened, or on entry when the workspace
  // already has conversations but none is active yet (so the user can pick
  // one). With no conversations, fall through to the conversation view — its
  // empty state is the new-conversation entry point.
  if (showList || (!activeConversationId && conversations.length > 0)) {
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
  const open = useWorkspaceStore((s) => s.sidePanelOpen);
  const ActivePanel = panelMap[activeSidePanel];

  // Hidden, not unmounted: the panel keeps its width and the composer its draft.
  return (
    <ResizablePanel
      className={cn("bg-[#2A2A2A]", !open && "hidden", className)}
      defaultWidth={500}
      minWidth={320}
      maxWidth={800}
    >
      <ActivePanel />
    </ResizablePanel>
  );
};
