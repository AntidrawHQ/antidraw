type TerminalSessionInfo = {
  sessionId: string;
  pid: number;
  shell: string;
  workspaceId: string;
  title: string;
};

type SpawnTerminalOptions = {
  workspaceId: string;
  cols: number;
  rows: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
};

type TerminalExitPayload = { exitCode: number; signal?: number };

type TerminalAPI = {
  create: (opts: SpawnTerminalOptions) => Promise<TerminalSessionInfo>;
  input: (sessionId: string, data: string) => void;
  resize: (sessionId: string, cols: number, rows: number) => void;
  dispose: (sessionId: string) => Promise<boolean>;
  list: (workspaceId?: string) => Promise<TerminalSessionInfo[]>;
  onOutput: (sessionId: string, handler: (data: string) => void) => () => void;
  onExit: (sessionId: string, handler: (payload: TerminalExitPayload) => void) => () => void;
  onTitle: (sessionId: string, handler: (title: string) => void) => () => void;
};

declare global {
  interface Window {
    electronAPI: {
      openPreviewWindow: (url: string) => Promise<void>;
      terminal: TerminalAPI;
    };
  }
}

export {};
