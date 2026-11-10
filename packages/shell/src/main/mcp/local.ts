import { err, ok } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";
import { getDevServerInfo } from "@/main/api/tools/dev-server";
import { getWorkspace, listWorkspaces } from "@/main/api/services/workspace.service";
import { listComponents } from "@/main/api/services/component.service";
import {
  completeCommentOutside,
  dismissCommentOutside,
  listComments,
} from "@/main/api/services/comment.service";
import { listEdits, markEditsWritten } from "@/main/api/services/edit.service";
import { getMirror, waitForMirror } from "./canvas-mirror";
import type { CanvasState, WorkspaceHost } from "./types";

// The tools' host and canvas, as this app has them: its services, and its
// main window's mirrored view.

const message = <E extends { message: string }>(e: E) => ({ message: e.message });

export const localWorkspaceHost: WorkspaceHost = {
  listWorkspaces: async () =>
    (await listWorkspaces()).map((all) => all.map(({ id, name }) => ({ id, name }))).mapErr(message),
  getWorkspace: async (id) =>
    (await getWorkspace(id))
      .map(({ id, name }) => ({ id, name }))
      .mapErr((e) => ({ message: e.code === "NOT_FOUND" ? `No workspace ${id}` : e.message })),
  sourcePath: getWorkspaceSourcePath,
  listComponents: async (id) => (await listComponents(id)).map((all) => all.map((c) => c.name)).mapErr(message),
  devServer: getDevServerInfo,
};

// The main window, as far as asking its renderer goes: main.ts's, null
// while it's closed.
export type AppWindow = { isDestroyed: () => boolean; webContents: { send: (channel: string, ...args: unknown[]) => void } };

// Long enough for a switch's thumbnail capture and the mirror's debounce;
// the dev server starting after isn't waited on.
const OPEN_TIMEOUT_MS = 10_000;

export const localCanvasState = (getWindow: () => AppWindow | null, openTimeoutMs = OPEN_TIMEOUT_MS): CanvasState => {
  const window = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  };
  return {
    view: getMirror,
    openComments: async (workspaceId) =>
      (await listComments(workspaceId))
        .map(({ comments }) => comments.filter((c) => c.state === "draft" && !c.conversationId && !c.clearedAt))
        .mapErr(message),
    completeComment: async (workspaceId, id, note) => (await completeCommentOutside(workspaceId, id, note)).mapErr(message),
    dismissComment: async (workspaceId, id, reason) => (await dismissCommentOutside(workspaceId, id, reason)).mapErr(message),
    pendingEdits: (workspaceId) => listEdits(workspaceId).map((l) => l.edits).unwrapOr([]),
    markEditsApplied: (workspaceId, ids) => markEditsWritten(workspaceId, ids).mapErr(message),
    openWorkspace: async (workspaceId) => {
      const win = window();
      if (!win) return err({ message: "Antidraw's main window is closed" });
      if (getMirror().activeWorkspaceId === workspaceId) return ok(undefined);
      win.webContents.send("mcp:open-workspace", workspaceId);
      const opened = await waitForMirror((m) => m.activeWorkspaceId === workspaceId, openTimeoutMs);
      return opened ? ok(undefined) : err({ message: `Antidraw didn't switch to workspace ${workspaceId} in time` });
    },
    focusComponent: async (name) => {
      const win = window();
      if (!win) return err({ message: "Antidraw's main window is closed" });
      win.webContents.send("mcp:focus-component", name);
      return ok(undefined);
    },
  };
};
