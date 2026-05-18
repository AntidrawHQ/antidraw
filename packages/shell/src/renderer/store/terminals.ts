import { create } from "zustand";

export type TerminalSession = {
  sessionId: string;
  workspaceId: string;
  title: string;
};

// 256 KB per session — enough to redraw the current screen plus a few pages
// of scrollback on attach. Past this, the head of the ring is dropped; the
// shell's next prompt will repaint anything visible.
const BUFFER_CAP = 256 * 1024;

// ─── Plain module state ──────────────────────────────────────────────────────
// Lives outside zustand on purpose: we don't want each PTY byte to drive a
// React re-render. Components opt in via subscribeLive() and write directly
// to their xterm instance.

const buffers = new Map<string, string>();
const liveSubscribers = new Map<string, Set<(data: string) => void>>();
const ipcUnsubs = new Map<string, () => void>();

const appendBuffer = (sessionId: string, data: string) => {
  const next = (buffers.get(sessionId) ?? "") + data;
  buffers.set(sessionId, next.length > BUFFER_CAP ? next.slice(-BUFFER_CAP) : next);
};

const emitLive = (sessionId: string, data: string) => {
  const set = liveSubscribers.get(sessionId);
  if (!set) return;
  for (const cb of set) cb(data);
};

export const getBuffer = (sessionId: string): string => buffers.get(sessionId) ?? "";

export const subscribeLive = (
  sessionId: string,
  handler: (data: string) => void,
): (() => void) => {
  let set = liveSubscribers.get(sessionId);
  if (!set) {
    set = new Set();
    liveSubscribers.set(sessionId, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
  };
};

// Wires up IPC for a freshly-created session: pushes output into the buffer +
// fans out to live subscribers, forwards title changes into the store, and
// appends an exit banner so it's visible on next attach.
const wireSession = (sessionId: string, onTitle: (title: string) => void) => {
  buffers.set(sessionId, "");

  const offOutput = window.electronAPI.terminal.onOutput(sessionId, (data) => {
    appendBuffer(sessionId, data);
    emitLive(sessionId, data);
  });

  const offTitle = window.electronAPI.terminal.onTitle(sessionId, onTitle);

  const offExit = window.electronAPI.terminal.onExit(sessionId, ({ exitCode, signal }) => {
    const msg = `\r\n\x1b[90m[process exited with code ${exitCode}${
      signal ? ` signal ${signal}` : ""
    }]\x1b[0m\r\n`;
    appendBuffer(sessionId, msg);
    emitLive(sessionId, msg);
  });

  ipcUnsubs.set(sessionId, () => {
    offOutput();
    offTitle();
    offExit();
  });
};

const unwireSession = (sessionId: string) => {
  ipcUnsubs.get(sessionId)?.();
  ipcUnsubs.delete(sessionId);
  buffers.delete(sessionId);
  liveSubscribers.delete(sessionId);
};

// ─── Zustand store: session metadata only ────────────────────────────────────

type TerminalStore = {
  sessions: TerminalSession[];
  activeSessionIdByWorkspace: Record<string, string | null>;
  setActiveSessionId: (workspaceId: string, sessionId: string | null) => void;
  createSession: (workspaceId: string) => Promise<TerminalSession>;
  closeSession: (sessionId: string) => Promise<void>;
};

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  activeSessionIdByWorkspace: {},

  setActiveSessionId: (workspaceId, sessionId) =>
    set((s) => ({
      activeSessionIdByWorkspace: {
        ...s.activeSessionIdByWorkspace,
        [workspaceId]: sessionId,
      },
    })),

  createSession: async (workspaceId) => {
    const info = await window.electronAPI.terminal.create({
      workspaceId,
      cols: 80,
      rows: 24,
    });
    const session: TerminalSession = {
      sessionId: info.sessionId,
      workspaceId: info.workspaceId,
      title: info.title,
    };

    wireSession(info.sessionId, (title) => {
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.sessionId === info.sessionId ? { ...x, title } : x,
        ),
      }));
    });

    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionIdByWorkspace: {
        ...s.activeSessionIdByWorkspace,
        [workspaceId]: session.sessionId,
      },
    }));
    return session;
  },

  closeSession: async (sessionId) => {
    await window.electronAPI.terminal.dispose(sessionId);
    unwireSession(sessionId);
    set((s) => {
      const closed = s.sessions.find((x) => x.sessionId === sessionId);
      const sessions = s.sessions.filter((x) => x.sessionId !== sessionId);
      if (!closed) return { sessions };
      const wsId = closed.workspaceId;
      if (s.activeSessionIdByWorkspace[wsId] !== sessionId) return { sessions };
      const remaining = sessions.filter((x) => x.workspaceId === wsId);
      const nextActive = remaining[remaining.length - 1]?.sessionId ?? null;
      return {
        sessions,
        activeSessionIdByWorkspace: {
          ...s.activeSessionIdByWorkspace,
          [wsId]: nextActive,
        },
      };
    });
  },
}));
