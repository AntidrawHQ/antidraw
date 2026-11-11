import "@/main/api/__tests__/e2e-env"; // must stay the first import: a tmp ANTIDRAW_ROOT
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ok } from "neverthrow";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// The dev server's state lives in electron-store, which needs Electron.
vi.mock("@/main/services/dev-server.service", () => ({ getDevServerStatus: vi.fn() }));

import { getDevServerStatus } from "@/main/services/dev-server.service";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import { getWorkspaceSourcePath } from "@/main/api/init";
import { addComment, clearCompleted, editComment, listComments, markCommentsSent } from "@/main/api/services/comment.service";
import { createConversation } from "@/main/api/services/chat.service";
import { listEdits, putEdit } from "@/main/api/services/edit.service";
import { commentEvents } from "@/main/lib/comment-events";
import { editEvents } from "@/main/lib/edit-events";
import { clearMirror, setMirror } from "@/main/mcp/canvas-mirror";
import { localCanvasState, localWorkspaceHost, type AppWindow } from "@/main/mcp/local";
import { createMcpServer } from "@/main/mcp/server";
import type { ElementContext, ElementInfo } from "@/agent/protocol";
import type { Style } from "@/shared/design";
import type { MirroredPick } from "@/shared/canvas-mirror";

// Each tool over MCP, against the app's own services in a tmp root. Only
// the window is a fake: it stands in for the main window's renderer.

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const ws = crypto.randomUUID();
const other = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values([
    { id: ws, name: "Pricing" },
    { id: other, name: "Landing" },
  ]);
  const folder = path.join(getWorkspaceSourcePath(ws), "src/components/user-components");
  fs.mkdirSync(folder, { recursive: true });
  for (const name of ["Card", "Hero"]) fs.writeFileSync(path.join(folder, `${name}.tsx`), "export default () => null;\n");
});

const sent: [string, ...unknown[]][] = [];
let onSend: (channel: string, ...args: unknown[]) => void = () => {};
let windowOpen = true;
const fakeWindow: AppWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, ...args) => {
      sent.push([channel, ...args]);
      onSend(channel, ...args);
    },
  },
};

const connect = async (openTimeoutMs?: number) => {
  const server = createMcpServer({
    host: localWorkspaceHost,
    canvas: localCanvasState(() => (windowOpen ? fakeWindow : null), openTimeoutMs),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
};

let client: Client;
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]!.text;
  return result.isError ? { error: text } : JSON.parse(text);
};

const view = (activeWorkspaceId: string | null, selection: MirroredPick | null = null, tags: MirroredPick[] = []) =>
  expect(setMirror({ activeWorkspaceId, selection, tags })).toBe(true);

const info = (loc: string, extra: Partial<ElementInfo> = {}) =>
  ({
    ref: { loc, index: 1, path: [0, 2], tag: "button" },
    callsite: loc,
    tag: "button",
    id: "buy",
    classes: ["btn", "primary"],
    text: "Buy now",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    margin: [0, 0, 0, 0],
    border: [0, 0, 0, 0],
    padding: [0, 0, 0, 0],
    ...extra,
  }) as ElementInfo;
const LOC = "src/components/user-components/Card.tsx:12:5";

beforeEach(async () => {
  sent.length = 0;
  onSend = () => {};
  windowOpen = true;
  vi.mocked(getDevServerStatus).mockReturnValue(
    ok({ workspaceId: ws, pid: 1, port: 5199, startedAt: 0, running: true }),
  );
  client = await connect();
});

afterEach(() => clearMirror());

describe("the server", () => {
  test("lists the eleven tools, the reads marked read-only, with instructions and descriptions a client keeps whole", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "complete_comment",
        "dismiss_comment",
        "focus_component",
        "get_active_workspace",
        "get_comments",
        "get_design_edits",
        "get_dev_server_info",
        "get_selection",
        "list_workspaces",
        "mark_design_edits_applied",
        "open_workspace",
      ].sort(),
    );
    const reads = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(reads.sort()).toEqual(
      ["get_active_workspace", "get_comments", "get_design_edits", "get_dev_server_info", "get_selection", "list_workspaces"].sort(),
    );
    for (const t of tools) expect(t.description!.length).toBeLessThan(2000);
    expect(client.getInstructions()!.length).toBeLessThan(2000);
  });
});

describe("orientation", () => {
  test("with no workspace open, says so; the tools that need one say how to name one", async () => {
    view(null);
    expect(await call("get_active_workspace")).toEqual({ workspace: null, message: "No workspace is open in Antidraw." });
    expect((await call("get_comments")).error).toMatch(/No workspace is open in Antidraw/);
    expect((await call("get_comments", { workspaceId: crypto.randomUUID() })).error).toMatch(/^No workspace /);
  });

  test("an empty workspaceId is none given: the open workspace's", async () => {
    view(ws);
    const named = async (tool: string) => {
      const result = await call(tool, { workspaceId: "" });
      return result.error ?? (result.workspaceId ?? result.id) === ws;
    };
    expect({
      get_comments: await named("get_comments"),
      get_design_edits: await named("get_design_edits"),
      get_selection: await named("get_selection"),
      get_dev_server_info: (await call("get_dev_server_info", { workspaceId: "" })).running,
    }).toMatchInlineSnapshot(`
      {
        "get_comments": true,
        "get_design_edits": true,
        "get_dev_server_info": true,
        "get_selection": true,
      }
    `);
    // With none open there's still none to fall back to.
    view(null);
    expect(await call("get_comments", { workspaceId: "" })).toMatchInlineSnapshot(`
      {
        "error": "No workspace is open in Antidraw. list_workspaces lists them; pass a workspaceId, or open_workspace one.",
      }
    `);
  });

  test("the open workspace: where its source is, its frames with their previews, its dev server", async () => {
    view(ws);
    const active = await call("get_active_workspace");
    expect(active).toEqual({
      id: ws,
      name: "Pricing",
      sourcePath: getWorkspaceSourcePath(ws),
      componentsFolder: "src/components/user-components",
      components: [
        { name: "Card", file: "src/components/user-components/Card.tsx", previewUrl: "https://localhost:5199/preview?componentName=Card" },
        { name: "Hero", file: "src/components/user-components/Hero.tsx", previewUrl: "https://localhost:5199/preview?componentName=Hero" },
      ],
      devServer: { running: true, url: "https://localhost:5199", logPath: null },
    });

    // A stale entry (pid gone): no previews to point at.
    vi.mocked(getDevServerStatus).mockReturnValue(ok({ workspaceId: ws, pid: 1, port: 5199, startedAt: 0, running: false }));
    const stale = await call("get_active_workspace");
    expect(stale.components[0].previewUrl).toBeNull();
    expect(stale.devServer).toEqual({ running: false, url: null, logPath: null });
    // get_dev_server_info is the built-in chat's, as it is.
    expect(await call("get_dev_server_info")).toEqual({
      workspaceId: ws,
      pid: 1,
      port: 5199,
      startedAt: 0,
      running: false,
      url: "https://localhost:5199",
      logPath: null,
    });
  });

  test("list_workspaces: each with its source", async () => {
    const { workspaces: all } = await call("list_workspaces");
    expect(all).toEqual(
      expect.arrayContaining([
        { id: ws, name: "Pricing", sourcePath: getWorkspaceSourcePath(ws) },
        { id: other, name: "Landing", sourcePath: getWorkspaceSourcePath(other) },
      ]),
    );
  });

  test("get_selection: the selected and tagged elements as the chat's <canvas-selection> has them", async () => {
    const seen = { viewport: [1280, 800], element: "button#buy.btn.primary", html: "<button>Buy now</button>" } as ElementContext;
    view(ws, { frame: "Card", info: info(LOC) }, [{ frame: "Hero", info: info(LOC, { classes: [] }), seen }]);
    expect(await call("get_selection")).toEqual({
      workspaceId: ws,
      selection: {
        component: "Card",
        file: "src/components/user-components/Card.tsx",
        loc: LOC,
        callsite: LOC,
        tag: "button",
        id: "buy",
        classes: ["btn", "primary"],
        text: "Buy now",
        index: 1,
        seen: null,
      },
      tags: [expect.objectContaining({ component: "Hero", file: "src/components/user-components/Hero.tsx", classes: [], seen })],
    });
    // Another workspace's isn't on the canvas.
    expect((await call("get_selection", { workspaceId: other })).error).toMatch(/isn't the one open in Antidraw/);
  });
});

describe("comments", () => {
  test("drafts are the outside agent's to complete or dismiss; a sent one is its chat's", async () => {
    view(ws);
    const add = async (text: string, element: Record<string, unknown> | null = null) =>
      (await addComment(ws, { componentName: "Card", x: 132.4, y: 64.6, text, element }))._unsafeUnwrap();
    const tighten = await add("Tighten the gap", info(LOC) as unknown as Record<string, unknown>);
    const pop = await add("Make it pop");
    const chatOne = await add("Sent to a chat");
    const conversation = (await createConversation(ws))._unsafeUnwrap();
    (await markCommentsSent(ws, conversation.id, [chatOne.id]))._unsafeUnwrap();

    const { comments } = await call("get_comments");
    expect(comments).toEqual([
      {
        id: tighten.id,
        rev: expect.any(String),
        component: "Card",
        file: "src/components/user-components/Card.tsx",
        text: "Tighten the gap",
        pin: { x: 132, y: 65 },
        loc: LOC,
        index: 1,
        tag: "button",
        elementText: "Buy now",
        callsite: LOC,
      },
      expect.objectContaining({ id: pop.id, loc: null, index: null, tag: null, elementText: null, callsite: null }),
    ]);

    const changed: string[] = [];
    const listen = (id: string) => changed.push(id);
    commentEvents.on("changed", listen);
    const [tightenRev, popRev] = comments.map((c: { rev: string }) => c.rev);
    expect(await call("complete_comment", { id: tighten.id, rev: tightenRev, note: " Gap 24 → 12px " })).toEqual({ id: tighten.id, state: "done" });
    expect(await call("dismiss_comment", { id: pop.id, rev: popRev, reason: "Already bold" })).toEqual({ id: pop.id, state: "dismissed" });
    expect((await call("complete_comment", { id: chatOne.id, rev: "x", note: "x" })).error).toMatch(/sent to a chat/);
    expect((await call("complete_comment", { id: 99999, rev: "x", note: "x" })).error).toMatch(/No open comment 99999/);
    commentEvents.off("changed", listen);
    expect(changed).toEqual([ws, ws]);

    const rows = (await listComments(ws))._unsafeUnwrap().comments;
    expect(rows.find((c) => c.id === tighten.id)).toMatchObject({ state: "done", note: "Gap 24 → 12px", conversationId: null });
    expect(rows.find((c) => c.id === tighten.id)!.completedAt).toBeInstanceOf(Date);
    expect(rows.find((c) => c.id === pop.id)).toMatchObject({ state: "dismissed", note: "Already bold", conversationId: null });
    expect((await call("get_comments")).comments).toEqual([]);

    // Clear completed takes them off: no chat of theirs to wait for.
    (await clearCompleted(ws))._unsafeUnwrap();
    const left = (await listComments(ws))._unsafeUnwrap().comments.map((c) => c.id);
    expect(left).toEqual([chatOne.id]);
  });
});

describe("a comment reworded after it was read", () => {
  // The comment's id in a message, as it differs run to run.
  const said = (id: number, result: { error?: string }) => result.error?.replace(`Comment ${id} `, "Comment <id> ");

  test("stays open, by either tool, until it's read again", async () => {
    view(ws);
    const draft = (await addComment(ws, { componentName: "Card", x: 10, y: 10, text: "Make it pop", element: null }))._unsafeUnwrap();
    const read = (await call("get_comments")).comments.find((c: { id: number }) => c.id === draft.id);
    expect({ text: read.text, rev: read.rev }).toMatchInlineSnapshot(`
      {
        "rev": "c0929077",
        "text": "Make it pop",
      }
    `);

    (await editComment(ws, draft.id, "Make it pop and move it left"))._unsafeUnwrap();
    const changed: string[] = [];
    const listen = (id: string) => changed.push(id);
    commentEvents.on("changed", listen);
    expect(said(draft.id, await call("complete_comment", { id: draft.id, rev: read.rev, note: "Bolder title" }))).toMatchInlineSnapshot(`"Comment <id> was reworded after it was read: get_comments has it as it is now"`);
    expect(said(draft.id, await call("dismiss_comment", { id: draft.id, rev: read.rev, reason: "Already bold" }))).toMatchInlineSnapshot(`"Comment <id> was reworded after it was read: get_comments has it as it is now"`);
    commentEvents.off("changed", listen);
    // Nothing closed, so nothing to tell the list.
    expect(changed).toEqual([]);
    const row = () => listComments(ws).then((r) => r._unsafeUnwrap().comments.find((c) => c.id === draft.id)!);
    expect(await row()).toMatchObject({ state: "draft", note: null, text: "Make it pop and move it left" });

    const again = (await call("get_comments")).comments.find((c: { id: number }) => c.id === draft.id);
    expect({ text: again.text, rev: again.rev }).toMatchInlineSnapshot(`
      {
        "rev": "d36f8a19",
        "text": "Make it pop and move it left",
      }
    `);
    expect(await call("complete_comment", { id: draft.id, rev: again.rev, note: "Bolder, and moved left" })).toEqual({ id: draft.id, state: "done" });
    expect(await row()).toMatchObject({ state: "done", note: "Bolder, and moved left" });

    // Closed, its text can't change: the rev it was closed with replaces its note.
    expect(await call("complete_comment", { id: draft.id, rev: again.rev, note: "Bolder only" })).toEqual({ id: draft.id, state: "done" });
    expect(await row()).toMatchObject({ state: "done", note: "Bolder only" });
    // And the rev it was first read with is still not it.
    expect(said(draft.id, await call("complete_comment", { id: draft.id, rev: read.rev, note: "x" }))).toMatchInlineSnapshot(`"Comment <id> was reworded after it was read: get_comments has it as it is now"`);
  });

  test("a rev is required", async () => {
    view(ws);
    const draft = (await addComment(ws, { componentName: "Card", x: 10, y: 10, text: "No rev", element: null }))._unsafeUnwrap();
    const refused = await client.callTool({ name: "complete_comment", arguments: { id: draft.id, note: "x" } });
    expect(refused.isError).toBe(true);
    expect((await listComments(ws))._unsafeUnwrap().comments.find((c) => c.id === draft.id)).toMatchObject({ state: "draft" });
  });
});

describe("design edits", () => {
  test("pending edits as the panel says them, marked applied all or none", async () => {
    view(ws);
    const base = { radius: 16, corners: [16, 16, 16, 16], gap: 12 } as Style;
    const edit = putEdit(ws, {
      componentName: "Card",
      element: info(LOC),
      name: "button#buy.btn.primary",
      text: false,
      base,
      now: { ...base, radius: 24 },
      seen: null,
    })._unsafeUnwrap()!;

    expect(await call("get_design_edits")).toEqual({
      workspaceId: ws,
      edits: [
        {
          id: edit.id,
          rev: expect.any(String),
          component: "Card",
          file: "src/components/user-components/Card.tsx",
          element: "button#buy.btn.primary",
          loc: LOC,
          index: 1,
          tag: "button",
          text: "Buy now",
          changes: ["Corner radius: 16 → 24"],
          previewCss: { "border-radius": "24px" },
          seen: null,
        },
      ],
    });

    const { rev } = (await call("get_design_edits")).edits[0];
    expect((await call("mark_design_edits_applied", { edits: [{ id: edit.id, rev }, { id: 999999, rev: "x" }] })).error).toMatch(
      /already applied or undone/,
    );
    expect(listEdits(ws)._unsafeUnwrap().edits.map((e) => e.id)).toEqual([edit.id]);

    const changed: string[] = [];
    const listen = (id: string) => changed.push(id);
    editEvents.on("changed", listen);
    expect(await call("mark_design_edits_applied", { edits: [{ id: edit.id, rev }] })).toEqual({ applied: [edit.id] });
    editEvents.off("changed", listen);
    expect(changed).toEqual([ws]);
    expect(listEdits(ws)._unsafeUnwrap()).toEqual({ edits: [], applied: [] });
  });

  test("an edit the user changed after it was read stays pending, with the rest", async () => {
    view(ws);
    const base = { radius: 16, corners: [16, 16, 16, 16], gap: 12 } as Style;
    const put = (loc: string, now: Partial<Style>) =>
      putEdit(ws, { componentName: "Card", element: info(loc), name: "button", text: false, base, now: { ...base, ...now } as Style, seen: null })._unsafeUnwrap()!;
    const OTHER_LOC = "src/components/user-components/Card.tsx:20:7";
    const radius = put(LOC, { radius: 24 });
    const gap = put(OTHER_LOC, { gap: 8 });

    // What the agent reads, by element rather than id (ids differ run to run).
    const reading = async () =>
      (await call("get_design_edits")).edits.map((e: { loc: string; rev: string; changes: string[] }) => ({ loc: e.loc, rev: e.rev, changes: e.changes }));
    const read = (await call("get_design_edits")).edits.map((e: { id: number; rev: string }) => ({ id: e.id, rev: e.rev }));
    expect(await reading()).toMatchInlineSnapshot(`
      [
        {
          "changes": [
            "Corner radius: 16 → 24",
          ],
          "loc": "src/components/user-components/Card.tsx:12:5",
          "rev": "c68d9b36",
        },
        {
          "changes": [
            "Gap: 12 → 8",
          ],
          "loc": "src/components/user-components/Card.tsx:20:7",
          "rev": "d478173e",
        },
      ]
    `);

    // The user drags the radius on: the same edit, by its id, with new styles.
    expect(put(LOC, { radius: 32 }).id).toBe(radius.id);
    const changed: string[] = [];
    const listen = (id: string) => changed.push(id);
    editEvents.on("changed", listen);
    expect(await call("mark_design_edits_applied", { edits: read })).toMatchInlineSnapshot(`
      {
        "error": "Some of these edits were changed after they were read: get_design_edits has them as they are now",
      }
    `);
    // Its own, unchanged, doesn't go without it: all or none.
    editEvents.off("changed", listen);
    expect(changed).toEqual([]);
    expect(listEdits(ws)._unsafeUnwrap().edits.map((e) => e.id)).toEqual([radius.id, gap.id]);

    // Read again, it has what the edit is now, and both go.
    expect(await reading()).toMatchInlineSnapshot(`
      [
        {
          "changes": [
            "Corner radius: 16 → 32",
          ],
          "loc": "src/components/user-components/Card.tsx:12:5",
          "rev": "dae40e6b",
        },
        {
          "changes": [
            "Gap: 12 → 8",
          ],
          "loc": "src/components/user-components/Card.tsx:20:7",
          "rev": "d478173e",
        },
      ]
    `);
    const again = (await call("get_design_edits")).edits.map((e: { id: number; rev: string }) => ({ id: e.id, rev: e.rev }));
    expect(await call("mark_design_edits_applied", { edits: again })).toEqual({ applied: [radius.id, gap.id] });
    expect(listEdits(ws)._unsafeUnwrap().edits).toEqual([]);
  });

  test("an edit put back as it was read has the rev it was read with", async () => {
    view(ws);
    const base = { radius: 16, corners: [16, 16, 16, 16], gap: 12 } as Style;
    const put = (radius: number) =>
      putEdit(ws, { componentName: "Hero", element: info(LOC), name: "h1", text: false, base, now: { ...base, radius }, seen: null })._unsafeUnwrap()!;
    const edit = put(24);
    const [read] = (await call("get_design_edits")).edits;
    put(32);
    expect((await call("get_design_edits")).edits[0].rev).not.toBe(read.rev);
    put(24);
    expect(await call("mark_design_edits_applied", { edits: [{ id: edit.id, rev: read.rev }] })).toEqual({ applied: [edit.id] });
  });
});

describe("driving the app", () => {
  test("open_workspace asks the window, and answers once its mirror has switched", async () => {
    view(ws);
    // The renderer's switch, as the mirror reports it.
    onSend = (channel, id) => {
      if (channel === "mcp:open-workspace") setTimeout(() => setMirror({ activeWorkspaceId: id, selection: null, tags: [] }), 20);
    };
    expect(await call("open_workspace", { workspaceId: other })).toEqual({
      id: other,
      name: "Landing",
      sourcePath: getWorkspaceSourcePath(other),
    });
    expect(sent).toEqual([["mcp:open-workspace", other]]);

    expect((await call("open_workspace", { workspaceId: crypto.randomUUID() })).error).toMatch(/^No workspace /);
    windowOpen = false;
    expect((await call("open_workspace", { workspaceId: ws })).error).toMatch(/main window is closed/);
  });

  test("open_workspace gives up when the window never switches", async () => {
    view(ws);
    client = await connect(50);
    expect((await call("open_workspace", { workspaceId: other })).error).toMatch(/didn't switch to workspace .* in time/);
  });

  test("focus_component: a frame of the open workspace", async () => {
    view(ws);
    expect(await call("focus_component", { name: "Hero" })).toEqual({ focused: "Hero" });
    expect(sent).toEqual([["mcp:focus-component", "Hero"]]);
    expect((await call("focus_component", { name: "Nope" })).error).toMatch(/No component Nope/);
    expect((await call("focus_component", { name: "Hero", workspaceId: other })).error).toMatch(/isn't the one open/);
    expect(sent).toHaveLength(1);
  });
});
