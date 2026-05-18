import { spawn, type IPty } from "@lydell/node-pty";
import { EventEmitter } from "node:events";
import os from "node:os";
import { getWorkspaceSourcePath } from "@/main/api/init";

export type TerminalSessionInfo = {
  sessionId: string;
  pid: number;
  shell: string;
  workspaceId: string;
  title: string;
};

export type SpawnTerminalOptions = {
  workspaceId: string;
  cols: number;
  rows: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
};

type Session = {
  info: TerminalSessionInfo;
  pty: IPty;
};

const sessions = new Map<string, Session>();

type TerminalEvents = {
  output: [sessionId: string, data: string];
  exit: [sessionId: string, payload: { exitCode: number; signal?: number }];
  title: [sessionId: string, title: string];
};

export const terminalEvents = new EventEmitter<TerminalEvents>();

const defaultShell = () => {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "cmd.exe";
  }
  return process.env.SHELL ?? "/bin/zsh";
};

// Derive a human-readable title from the shell's reported process name. node-pty
// exposes pty.process which mirrors what `ps` would print for the foreground
// job in the pty — switches between "zsh", "vim", "node", etc.
const titleFromPty = (pty: IPty, fallback: string) => {
  const proc = pty.process?.trim();
  if (proc && proc.length > 0) return proc;
  return fallback;
};

export const createTerminalSession = (opts: SpawnTerminalOptions): TerminalSessionInfo => {
  const sessionId = crypto.randomUUID();
  const shell = opts.shell ?? defaultShell();
  const cwd = opts.cwd ?? getWorkspaceSourcePath(opts.workspaceId) ?? os.homedir();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...(opts.env ?? {}),
  };

  const pty = spawn(shell, [], {
    name: "xterm-256color",
    cols: Math.max(1, opts.cols | 0),
    rows: Math.max(1, opts.rows | 0),
    cwd,
    env,
  });

  const info: TerminalSessionInfo = {
    sessionId,
    pid: pty.pid,
    shell,
    workspaceId: opts.workspaceId,
    title: titleFromPty(pty, shell),
  };

  sessions.set(sessionId, { info, pty });

  let lastTitle = info.title;
  pty.onData((data) => {
    terminalEvents.emit("output", sessionId, data);
    // pty.process updates as the foreground program changes. Poll-on-output is
    // cheap and avoids needing a separate timer or OSC parser.
    const next = titleFromPty(pty, shell);
    if (next !== lastTitle) {
      lastTitle = next;
      const session = sessions.get(sessionId);
      if (session) session.info.title = next;
      terminalEvents.emit("title", sessionId, next);
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    terminalEvents.emit("exit", sessionId, { exitCode, signal });
    sessions.delete(sessionId);
  });

  return info;
};

export const writeToTerminal = (sessionId: string, data: string) => {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.pty.write(data);
  return true;
};

export const resizeTerminal = (sessionId: string, cols: number, rows: number) => {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.pty.resize(Math.max(1, cols | 0), Math.max(1, rows | 0));
  } catch {
    return false;
  }
  return true;
};

export const disposeTerminal = (sessionId: string) => {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.pty.kill();
  } catch {
    /* already dead */
  }
  sessions.delete(sessionId);
  return true;
};

export const listTerminalSessions = (workspaceId?: string): TerminalSessionInfo[] => {
  const all = Array.from(sessions.values()).map((s) => s.info);
  if (!workspaceId) return all;
  return all.filter((s) => s.workspaceId === workspaceId);
};

export const disposeAllTerminals = () => {
  for (const { pty } of sessions.values()) {
    try {
      pty.kill();
    } catch {
      /* noop */
    }
  }
  sessions.clear();
};
