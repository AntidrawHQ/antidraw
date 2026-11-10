import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DevServerToolInfo } from "@/main/api/tools/dev-server";
import { componentFile } from "@/shared/utils/canvas-comments";
import type { ToolDeps, WorkspaceSummary } from "../types";

// What the tools have in common: their results as JSON text, an error as
// what went wrong said plainly, and the workspace a call is about.

export const json = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

export const fail = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

export const reply = async (result: Promise<Result<unknown, string>> | Result<unknown, string>) =>
  (await result).match(json, fail);

export const COMPONENTS_FOLDER = path.posix.dirname(componentFile("_"));

export const NO_WORKSPACE = "No workspace is open in Antidraw. list_workspaces lists them; pass a workspaceId, or open_workspace one.";

export const workspaceIdArg = z
  .string()
  .optional()
  .describe("A workspace's id, from list_workspaces. Defaults to the workspace open in Antidraw.");

// The workspace a call names, or the one open in the app.
export const resolveWorkspace = async (
  { host, canvas }: ToolDeps,
  given: string | undefined,
): Promise<Result<WorkspaceSummary, string>> => {
  const id = given ?? canvas.view().activeWorkspaceId;
  if (!id) return err(NO_WORKSPACE);
  return (await host.getWorkspace(id)).mapErr((e) => e.message);
};

// The selection, the tags and the Design panel's previews live in the app's
// window, which shows one workspace: another's has none to give.
export const resolveOpenWorkspace = async (deps: ToolDeps, given: string | undefined) =>
  (await resolveWorkspace(deps, given)).andThen((ws) =>
    ws.id === deps.canvas.view().activeWorkspaceId
      ? ok(ws)
      : err(`Workspace ${ws.id} isn't the one open in Antidraw: open_workspace it first`),
  );

export const previewUrl = (dev: DevServerToolInfo, name: string) =>
  dev.running && "url" in dev ? `${dev.url}/preview?componentName=${encodeURIComponent(name)}` : null;

// An element as the inspector described it (agent/protocol.ts' ElementInfo),
// read from what may be stored JSON, so any field can be missing.
export const elementFields = (info: unknown) => {
  const e = (info ?? {}) as Record<string, unknown>;
  const ref = (e.ref ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    loc: str(ref.loc),
    index: typeof ref.index === "number" ? ref.index : null,
    callsite: str(e.callsite),
    tag: str(e.tag) ?? str(ref.tag),
    id: str(e.id) || null,
    classes: Array.isArray(e.classes) ? e.classes.filter((c): c is string => typeof c === "string") : [],
    text: str(e.text) ?? str(ref.text),
  };
};
