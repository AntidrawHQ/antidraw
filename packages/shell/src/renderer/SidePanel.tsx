import type { ComponentType } from "react";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "./store/workspace";
import type { SidePanel as SidePanelId } from "./store/workspace";
import { useTerminalStore } from "./store/terminals";
import { Terminal } from "./Terminal";
import { ComponentPanel } from "./ComponentPanel";
import { ResizablePanel } from "./components/ui/resizable-panel";
import { useState } from "react";

// --- Terminal List (simple list + new button) ---

type TerminalListProps = {
  onClose: () => void;
};

const TerminalList = ({ onClose }: TerminalListProps) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const allSessions = useTerminalStore((s) => s.sessions);
  const setActiveSessionId = useTerminalStore((s) => s.setActiveSessionId);
  const createSession = useTerminalStore((s) => s.createSession);
  const closeSession = useTerminalStore((s) => s.closeSession);

  const sessions = activeWorkspaceId
    ? allSessions.filter((s) => s.workspaceId === activeWorkspaceId)
    : [];

  const handleSelect = (sessionId: string) => {
    if (!activeWorkspaceId) return;
    setActiveSessionId(activeWorkspaceId, sessionId);
    onClose();
  };

  const handleNew = async () => {
    if (!activeWorkspaceId) return;
    await createSession(activeWorkspaceId);
    onClose();
  };

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between px-3 pt-2.5 pb-3">
        <span className="text-[12px] text-neutral-500">Terminals</span>
        <button
          onClick={handleNew}
          disabled={!activeWorkspaceId}
          className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/[0.06] text-[12px] text-neutral-500 hover:text-neutral-200 disabled:opacity-50 shrink-0"
          title="New terminal"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      <div className="flex-1 px-2 pb-2 overflow-auto">
        {sessions.length === 0 ? (
          <div className="px-2.5 py-3 text-[12px] text-neutral-600">
            No terminals. Click New to start one.
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.sessionId}
              role="button"
              onClick={() => handleSelect(s.sessionId)}
              className="group w-full flex items-center justify-between gap-2 py-2 px-2.5 rounded-md hover:bg-white/[0.06] cursor-pointer mb-0.5"
            >
              <span className="flex-1 text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap text-neutral-400 group-hover:text-neutral-200">
                {s.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void closeSession(s.sessionId);
                }}
                className="p-1 rounded-md hover:bg-white/[0.08] text-neutral-600 hover:text-neutral-200 opacity-0 group-hover:opacity-100 shrink-0"
                title="Close terminal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// --- Terminal View (header + all-mounted terminals, one visible) ---

type TerminalViewProps = {
  onShowList: () => void;
};

const TerminalView = ({ onShowList }: TerminalViewProps) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const allSessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) =>
    activeWorkspaceId ? (s.activeSessionIdByWorkspace[activeWorkspaceId] ?? null) : null,
  );
  const createSession = useTerminalStore((s) => s.createSession);
  const closeSession = useTerminalStore((s) => s.closeSession);

  const activeSession = allSessions.find(
    (s) => s.workspaceId === activeWorkspaceId && s.sessionId === activeSessionId,
  );

  const handleNew = async () => {
    if (!activeWorkspaceId) return;
    await createSession(activeWorkspaceId);
  };

  const handleClose = async () => {
    if (!activeSessionId) return;
    await closeSession(activeSessionId);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-2 border-b border-[#2d2d2d] flex items-center gap-1">
        <button
          onClick={onShowList}
          className="flex-1 flex items-center justify-between gap-1.5 py-1.5 px-2.5 bg-transparent border-none rounded-md cursor-pointer hover:bg-white/[0.06] min-w-0"
        >
          <span className="text-[13px] font-medium text-neutral-200 overflow-hidden text-ellipsis whitespace-nowrap">
            {activeSession?.title ?? "Terminal"}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
        </button>
        <button
          onClick={handleNew}
          disabled={!activeWorkspaceId}
          className="p-1.5 rounded-md hover:bg-white/[0.06] text-[#71717a] hover:text-neutral-200 disabled:opacity-50 shrink-0"
          title="New terminal"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={handleClose}
          disabled={!activeSessionId}
          className="p-1.5 rounded-md hover:bg-white/[0.06] text-[#71717a] hover:text-neutral-200 disabled:opacity-50 shrink-0"
          title="Close terminal"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Only the active session renders an xterm. Switching sessions /
          workspaces / panels just unmounts and remounts; the buffer in the
          terminals store survives, and the new xterm replays it on attach. */}
      <div className="flex-1 relative bg-neutral-800 min-h-0">
        {activeSession && (
          <Terminal key={activeSession.sessionId} sessionId={activeSession.sessionId} />
        )}
      </div>
    </div>
  );
};

// --- Terminal Panel (thin wrapper picking the active variant) ---

const TerminalPanel = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const allSessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) =>
    activeWorkspaceId ? (s.activeSessionIdByWorkspace[activeWorkspaceId] ?? null) : null,
  );
  const [showList, setShowList] = useState(false);

  const hasSessionsInWorkspace = activeWorkspaceId
    ? allSessions.some((s) => s.workspaceId === activeWorkspaceId)
    : false;

  const showingList = showList || !activeSessionId || !hasSessionsInWorkspace;

  // Buffers + IPC subscriptions live in the terminals store, so unmounting
  // TerminalView when the list is shown is safe — the new xterm will replay
  // history on the next mount.
  if (showingList) {
    return <TerminalList onClose={() => setShowList(false)} />;
  }
  return <TerminalView onShowList={() => setShowList(true)} />;
};

// --- Side Panel (resizable shell + panel map) ---

const panelMap = {
  chat: TerminalPanel,
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
