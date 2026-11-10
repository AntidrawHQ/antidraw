import type { ElementContext, ElementInfo } from "../agent/protocol";

// What only the main window's renderer knows, mirrored to main for agents
// outside the app (main/mcp): the workspace it has open, and the inspector's
// selected and tagged elements (renderer/inspector/store.ts' Picked: `frame`
// is the component whose frame it was picked in, `seen` what that frame
// said about it when tagged).
export type MirroredPick = { frame: string; info: ElementInfo; seen?: ElementContext | null };

export type CanvasMirror = {
  activeWorkspaceId: string | null;
  selection: MirroredPick | null;
  tags: MirroredPick[];
};

export const EMPTY_MIRROR: CanvasMirror = { activeWorkspaceId: null, selection: null, tags: [] };
