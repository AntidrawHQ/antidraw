import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronsUpDown, Plus, Search } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "./store/workspace";
import {
  useWorkspaceConversations,
  useCreateConversation,
} from "./lib/claude-code-ops";
import { formatRelativeTime } from "./lib/time-utils";
import { fuzzyMatch } from "./lib/fuzzy-search";
import { AppChat } from "./Chat";

// Sidebar resize constraints
const MIN_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 400;

// Placeholder titles and descriptions for conversations without real data
const placeholderTitles = [
  "Design System Components",
  "API Integration Help",
  "Bug: Canvas not rendering",
  "Performance optimization",
  "Authentication flow",
  "Mobile responsive fixes",
  "Database schema design",
  "Unit test coverage",
  "Refactoring legacy code",
  "New feature brainstorm",
];

const placeholderDescriptions = [
  "Button variants, color tokens, and typography scale",
  "REST endpoints, error handling, and response types",
  "Debugging React lifecycle and cleanup issues",
  "Memoization strategies and render optimization",
  "OAuth2 implementation with token refresh",
  "Breakpoints and touch interactions",
  "Normalizing relations and indexing strategy",
  "Testing edge cases and error boundaries",
  "Breaking down monolithic components",
  "Exploring user requirements and constraints",
];

const getPlaceholderTitle = (convId: string): string => {
  const hash = convId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return placeholderTitles[hash % placeholderTitles.length];
};

const getPlaceholderDescription = (convId: string): string => {
  const hash = convId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return placeholderDescriptions[hash % placeholderDescriptions.length];
};

type SidebarProps = {
  className?: string;
};

export const Sidebar = ({ className }: SidebarProps) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const setActiveConversationId = useWorkspaceStore((s) => s.setActiveConversationId);

  // UI state
  const [showList, setShowList] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Data hooks
  const { data: conversations = [] } = useWorkspaceConversations(activeWorkspaceId);
  const createConversation = useCreateConversation();

  // Find active conversation
  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // Filter conversations by search (using displayed title for matching)
  const filtered = useMemo(() => {
    return conversations
      .map((conv) => {
        const displayTitle = conv.title ?? getPlaceholderTitle(conv.id);
        return {
          ...conv,
          displayTitle,
          ...fuzzyMatch(displayTitle, search),
        };
      })
      .filter((c) => c.match);
  }, [conversations, search]);

  // Sidebar resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth >= MIN_SIDEBAR_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    if (isResizing) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Focus search input when list opens
  useEffect(() => {
    if (showList && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showList]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      setActiveConversationId(filtered[selectedIndex].id);
      setShowList(false);
      setSearch("");
    } else if (e.key === "Escape") {
      setShowList(false);
      setSearch("");
    }
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    setShowList(false);
    setSearch("");
  };

  const handleNewConversation = async () => {
    if (!activeWorkspaceId) return;
    const conv = await createConversation.mutateAsync(activeWorkspaceId);
    setActiveConversationId(conv.id);
    setShowList(false);
    setSearch("");
  };

  const renderHighlighted = (text: string, indices: number[]) => {
    if (!indices.length) return text;
    return text.split("").map((char, i) => (
      <span
        key={i}
        className={cn(indices.includes(i) && "text-white font-semibold")}
      >
        {char}
      </span>
    ));
  };

  return (
    <div
      ref={sidebarRef}
      className={cn("relative flex flex-col overflow-hidden bg-neutral-800", className)}
      style={{ width: sidebarWidth }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={() => setIsResizing(true)}
        className={cn(
          "absolute top-0 right-0 w-1 h-full z-10 cursor-col-resize transition-colors",
          isResizing ? "bg-[#71717a]" : "hover:bg-[#2d2d2d]"
        )}
      />

      {showList ? (
        /* Conversation List View */
        <div className="flex-1 flex flex-col overflow-hidden" onKeyDown={handleKeyDown}>
          {/* Search */}
          <div className="p-2">
            <div className="flex items-center gap-2 bg-neutral-700 rounded-lg px-2.5 py-2 border border-[#2d2d2d]">
              <Search className={cn("w-3.5 h-3.5", search ? "text-neutral-200" : "text-[#71717a]")} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[13px] text-neutral-200 placeholder:text-neutral-500"
              />
              <button
                onClick={() => {
                  setShowList(false);
                  setSearch("");
                }}
                className="px-1.5 py-0.5 bg-[#2d2d2d] border-none rounded text-[10px] text-neutral-400 cursor-pointer hover:bg-neutral-600"
              >
                ESC
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {filtered.map((conv, idx) => {
              const description = getPlaceholderDescription(conv.id);
              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "w-full flex flex-col items-start gap-0.5 py-2 px-2.5 border-none rounded-md cursor-pointer text-left mb-0.5",
                    idx === selectedIndex ? "bg-white/[0.12]" : "bg-transparent hover:bg-white/[0.08]"
                  )}
                >
                  <div className="w-full flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "flex-1 text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap",
                        idx === selectedIndex ? "text-neutral-200" : "text-neutral-400"
                      )}
                    >
                      {renderHighlighted(conv.displayTitle, conv.indices)}
                    </span>
                    <span className="text-[10px] text-neutral-600 shrink-0">
                      {formatRelativeTime(new Date(conv.updatedAt))}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#71717a] overflow-hidden text-ellipsis whitespace-nowrap w-full">
                    {description}
                  </span>
                </button>
              );
            })}
          </div>

          {/* New Button */}
          <div className="p-2 border-t border-[#2d2d2d]">
            <button
              onClick={handleNewConversation}
              disabled={createConversation.isPending}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-neutral-700 border border-[#2d2d2d] rounded-md cursor-pointer text-xs text-neutral-400 hover:bg-neutral-600 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              New Conversation
            </button>
          </div>
        </div>
      ) : (
        /* Chat View */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Conversation Selector Header */}
          <div className="p-2 border-b border-[#2d2d2d]">
            <button
              onClick={() => setShowList(true)}
              className="w-full flex items-center justify-between gap-1.5 py-1.5 px-2.5 bg-transparent border-none rounded-md cursor-pointer hover:bg-white/10"
            >
              <span className="text-[13px] font-medium text-neutral-200 overflow-hidden text-ellipsis whitespace-nowrap">
                {activeConversation?.title ?? (activeConversationId ? getPlaceholderTitle(activeConversationId) : "New Conversation")}
              </span>
              <ChevronsUpDown className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
            </button>
          </div>

          {/* Chat Content */}
          <AppChat className="flex-1 min-h-0" />
        </div>
      )}
    </div>
  );
};
