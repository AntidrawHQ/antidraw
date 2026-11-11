import type { Result } from "neverthrow";
import type { DevServerToolInfo } from "@/main/api/tools/dev-server";
import type { CanvasMirror } from "@/shared/canvas-mirror";
import type { EditedElement } from "@/shared/utils/canvas-edits";

// What the MCP tools (./tools) reach the app through. Here they're the
// local app's (./local.ts); a workspace hosted elsewhere would put the same
// tools behind its own. So nothing the tools return may assume the agent
// shares this disk, except a workspace's `sourcePath`, said once.

export type HostError = { message: string };

export type WorkspaceSummary = { id: string; name: string };

// The workspaces and what's on their disk and dev servers.
export type WorkspaceHost = {
  listWorkspaces: () => Promise<Result<WorkspaceSummary[], HostError>>;
  getWorkspace: (id: string) => Promise<Result<WorkspaceSummary, HostError>>;
  // Where its source is: an agent's working directory.
  sourcePath: (id: string) => string;
  // Its frames' component names.
  listComponents: (id: string) => Promise<Result<string[], HostError>>;
  devServer: (id: string) => DevServerToolInfo;
};

// A comment as it's stored: `element` is the inspector's ElementInfo for
// the element under its pin, as JSON, null when the frame couldn't say.
export type CanvasComment = {
  id: number;
  componentName: string;
  text: string;
  x: number;
  y: number;
  element: Record<string, unknown> | null;
};

// The canvas: what the user has open, picked, commented and edited there,
// and moving its view.
export type CanvasState = {
  // The view as the app's window shows it: its workspace, selection and tags.
  view: () => CanvasMirror;
  // The comments left for an outside agent: drafts not sent to any chat.
  openComments: (workspaceId: string) => Promise<Result<CanvasComment[], HostError>>;
  // `rev`: the comment as it was read (shared/utils/canvas-comments.ts' commentRev).
  completeComment: (workspaceId: string, id: number, rev: string, note: string) => Promise<Result<unknown, HostError>>;
  dismissComment: (workspaceId: string, id: number, rev: string, reason: string) => Promise<Result<unknown, HostError>>;
  // The Design panel's edits not yet in the code.
  pendingEdits: (workspaceId: string) => EditedElement[];
  // Each as it was read (shared/utils/canvas-edits.ts' editRev): all or none.
  markEditsApplied: (workspaceId: string, read: { id: number; rev: string }[]) => Result<number[], HostError>;
  // Switches the app to the workspace, resolving once it's open.
  openWorkspace: (workspaceId: string) => Promise<Result<void, HostError>>;
  // Scrolls the canvas to a frame of the open workspace.
  focusComponent: (name: string) => Promise<Result<void, HostError>>;
};

export type ToolDeps = { host: WorkspaceHost; canvas: CanvasState };
