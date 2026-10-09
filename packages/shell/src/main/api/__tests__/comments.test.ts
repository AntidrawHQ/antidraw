import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { db } from "@/main/db";
import { comments, workspaces } from "@/main/api/schema";
import {
  addComment,
  clearCompleted,
  completeComment,
  editComment,
  listComments,
  removeComment,
  sendComments,
} from "@/main/api/services/comment.service";
import { commentEvents } from "@/main/lib/comment-events";
import { splitComments } from "@/shared/utils/canvas-comments";
import { app } from "@/main/api";

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const workspaceId = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values({ id: workspaceId, name: "comments" });
});

const add = async (text: string, element: Record<string, unknown> | null = null) =>
  (await addComment(workspaceId, { componentName: "PricingCard", x: 132, y: 64, text, element }))._unsafeUnwrap();

const send = async (ids: number[], element: string | null = null) =>
  (
    await sendComments(
      workspaceId,
      ids.map((id) => ({ id, element, preview: "https://localhost:5173/preview?componentName=PricingCard", frame: "1280×800" })),
    )
  )._unsafeUnwrap();

const list = async () => (await listComments(workspaceId))._unsafeUnwrap();

describe("comments", () => {
  test("a set goes out, Claude marks it, and the next chat gets it as history", async () => {
    const c1 = await add("Tighten the gap between the price and the button");
    const c2 = await add("Make the whole thing pop more");
    expect((await editComment(workspaceId, c2.id, "  Make it pop  "))._unsafeUnwrap().text).toBe("Make it pop");

    const first = await send([c1.id, c2.id], "<element>\nelement: button\n</element>");
    expect(first.comments.map((c) => c.state)).toEqual(["sent", "sent"]);
    expect(first.prompt).toContain(`<comment id="${c1.id}" component="PricingCard"`);
    expect(first.prompt).toContain('frame="1280×800" at="132,64"');
    expect(first.prompt).not.toContain("<earlier>");
    expect(splitComments(first.prompt)?.comments).toEqual([
      { component: "PricingCard", text: "Tighten the gap between the price and the button" },
      { component: "PricingCard", text: "Make it pop" },
    ]);

    // Sent: no more editing.
    expect((await editComment(workspaceId, c1.id, "x")).isErr()).toBe(true);

    // Only this chat's comments are its to mark, and marking says so.
    expect((await completeComment(crypto.randomUUID(), c1.id, "nope")).isErr()).toBe(true);
    const changed: string[] = [];
    commentEvents.on("changed", (id) => changed.push(id));
    expect((await completeComment(first.conversationId, c1.id, "Gap 24 → 12px")).isOk()).toBe(true);
    expect(changed).toEqual([workspaceId]);

    const now = await list();
    expect(now.chats).toEqual([{ conversationId: first.conversationId, n: 1, phase: "ended" }]);
    expect(now.comments.find((c) => c.id === c1.id)).toMatchObject({ state: "done", note: "Gap 24 → 12px" });

    // Clear completed takes c1 off the list; the chat keeps it as history.
    await clearCompleted(workspaceId);
    expect((await list()).comments.map((c) => c.id)).toEqual([c2.id]);

    const c3 = await add("Make Upgrade full width");
    const second = await send([c3.id]);
    expect(second.prompt).toContain("<earlier>");
    expect(second.prompt).toContain(
      `<comment id="${c1.id}" status="completed" note="Gap 24 → 12px">Tighten the gap between the price and the button</comment>`,
    );
    expect(second.prompt).toContain(`<comment id="${c2.id}" status="not marked done">Make it pop</comment>`);
    expect(splitComments(second.prompt)?.comments.map((c) => c.text)).toEqual(["Make Upgrade full width"]);
    expect((await list()).chats.map((c) => c.n)).toEqual([1, 2]);
  });

  test("nothing left to send opens no chat", async () => {
    const c = await add("Swap the bullets for checkmarks");
    await send([c.id]);
    const again = await sendComments(workspaceId, [{ id: c.id, element: null, preview: null }]);
    expect(again.isErr()).toBe(true);
  });

  test("a removed draft is gone; a removed sent one is only off the list", async () => {
    const draft = await add("draft");
    await removeComment(workspaceId, draft.id);
    expect(await db.select().from(comments).where(eq(comments.id, draft.id))).toEqual([]);

    const sent = await add("sent");
    await send([sent.id]);
    await removeComment(workspaceId, sent.id);
    const [row] = await db.select().from(comments).where(eq(comments.id, sent.id));
    expect(row?.clearedAt).toBeInstanceOf(Date);
    expect((await list()).comments.some((c) => c.id === sent.id)).toBe(false);
  });

  test("text spanning lines, and markup in it, reads back as written", async () => {
    const c = await add("first <b>line</b>\nsecond");
    const { prompt } = await send([c.id], "<element>\nelement: div\n</element>");
    expect(prompt).not.toContain("<b>");
    expect(splitComments(prompt)?.comments).toEqual([{ component: "PricingCard", text: "first <b>line</b>\nsecond" }]);
  });

  test("the events stream says changed on open, and on every write", async () => {
    const abort = new AbortController();
    const res = await app.request(`/api/workspaces/${workspaceId}/comments/events`, { signal: abort.signal });
    const reader = res.body!.getReader();
    const next = async () => new TextDecoder().decode((await reader.read()).value);

    expect(await next()).toContain('{"type":"changed"}');
    await add("one more");
    expect(await next()).toContain('{"type":"changed"}');

    abort.abort();
    await reader.cancel().catch(() => {});
    expect(commentEvents.listenerCount("changed")).toBe(1); // the first test's own
  });
});
