import { describe, expect, test } from "vitest";
import type { ElementInfo } from "@/agent/protocol";
import type { Style } from "@/shared/design";
import { addPending, conversationEvents, openHandle, releaseHandle, resolvePending, setCliState } from "@/main/lib/conversation-store";
import type { PromptStream } from "@/main/api/claude-code-ops";
import { editController } from "@/main/api/controllers/edit.controller";
import { editEvents } from "@/main/lib/edit-events";
import {
  describePendingEdits,
  listEdits,
  markEditsApplied,
  putEdit,
  releaseApplied,
  removeEdits,
  restoreApplied,
} from "@/main/api/services/edit.service";

// The Design panel's edits, held in memory per workspace until Apply hands
// them to a chat, and shown as being applied until its turn ends.

const base = { radius: 16, corners: [16, 16, 16, 16], gap: 12 } as Style;
const element = (loc: string, path = [0]) => ({ ref: { loc, index: 0, path, tag: "div" } }) as ElementInfo;
const CARD = "src/components/user-components/Card.tsx:3:5";
const TITLE = "src/components/user-components/Card.tsx:4:7";

const edit = (workspaceId: string, loc: string, now: Partial<Style>, from = base) =>
  putEdit(workspaceId, {
    componentName: "Card",
    element: element(loc),
    name: "div.card",
    text: false,
    base: from,
    now: { ...from, ...now },
    seen: null,
  })._unsafeUnwrap();
const list = (workspaceId: string) => listEdits(workspaceId)._unsafeUnwrap();
const context = (ids: number[]) => ids.map((id) => ({ id, block: null, preview: null, frame: null }));

describe("edits", () => {
  test("one edit per element: it keeps where it started, and goes once back there", () => {
    const ws = crypto.randomUUID();
    const first = edit(ws, CARD, { radius: 24 })!;
    // A later edit of the same element, from wherever the panel read it then.
    const again = edit(ws, CARD, { radius: 24, gap: 16 }, { ...base, radius: 20 })!;
    expect(again.id).toBe(first.id);
    expect(list(ws).edits).toEqual([{ ...first, now: { ...base, radius: 24, gap: 16 } }]);
    expect(edit(ws, CARD, {})).toBeNull();
    expect(list(ws).edits).toEqual([]);
  });

  test("Reset undoes every one; one element's undo, only its own", () => {
    const ws = crypto.randomUUID();
    const card = edit(ws, CARD, { radius: 24 })!;
    const title = edit(ws, TITLE, { gap: 4 })!;
    removeEdits(ws, card.id)._unsafeUnwrap();
    expect(list(ws).edits.map((e) => e.id)).toEqual([title.id]);
    expect(removeEdits(ws, card.id).isErr()).toBe(true);
    removeEdits(ws)._unsafeUnwrap();
    expect(list(ws).edits).toEqual([]);
  });

  test("Apply hands them to the chat at once, and all or none", () => {
    const ws = crypto.randomUUID();
    const card = edit(ws, CARD, { radius: 24 })!;
    const title = edit(ws, TITLE, { gap: 4 })!;
    const { ids, prompt } = describePendingEdits(ws, context([card.id, title.id]))._unsafeUnwrap();
    expect(ids).toEqual([card.id, title.id]);
    expect(prompt).toContain("Corner radius: 16 → 24");

    // One of them already gone: nothing is taken.
    removeEdits(ws, title.id)._unsafeUnwrap();
    expect(markEditsApplied(ws, "chat-1", ids, "m-1")._unsafeUnwrapErr().code).toBe("EDITS_CHANGED");
    expect(list(ws).edits.map((e) => e.id)).toEqual([card.id]);

    markEditsApplied(ws, "chat-1", [card.id], "m-1")._unsafeUnwrap();
    expect(list(ws)).toEqual({ edits: [], applied: [{ id: expect.any(Number), conversationId: "chat-1", messageId: "m-1", edits: [card] }] });
  });

  test("a set is shown until its chat's turn ends, or it's let go", () => {
    const ws = crypto.randomUUID();
    const seen: string[] = [];
    const on = (id: string) => id === ws && seen.push(id);
    editEvents.on("changed", on);
    try {
      markEditsApplied(ws, "chat-2", [edit(ws, CARD, { radius: 24 })!.id], "m-2")._unsafeUnwrap();
      markEditsApplied(ws, "chat-3", [edit(ws, TITLE, { gap: 4 })!.id], "m-3")._unsafeUnwrap();
      conversationEvents.emit("state", "chat-2", { state: "running" });
      expect(list(ws).applied).toHaveLength(2);
      conversationEvents.emit("state", "chat-2", { state: "idle" });
      expect(list(ws).applied.map((s) => s.conversationId)).toEqual(["chat-3"]);
      releaseApplied(ws, list(ws).applied[0]!.id)._unsafeUnwrap();
      expect(list(ws).applied).toEqual([]);
      // Two edits, two Applies, the turn's end, the release.
      expect(seen).toHaveLength(6);

      // A turn that fails never goes idle: its error lets the set go.
      markEditsApplied(ws, "chat-4", [edit(ws, CARD, { radius: 30 })!.id], "m-4")._unsafeUnwrap();
      conversationEvents.emit("error", "chat-4", { error: "CLI exited" });
      expect(list(ws).applied).toEqual([]);
    } finally {
      editEvents.off("changed", on);
    }
  });

  test("a set applied mid-turn outlasts that turn's idle, and goes after its own", () => {
    const ws = crypto.randomUUID();
    const chat = crypto.randomUUID();
    openHandle(chat, {} as PromptStream);
    try {
      setCliState(chat, "running");
      addPending(chat, "apply");
      markEditsApplied(ws, chat, [edit(ws, CARD, { radius: 24 })!.id], "apply")._unsafeUnwrap();
      // The earlier turn ends with the Apply still queued.
      setCliState(chat, "idle");
      expect(list(ws).applied).toHaveLength(1);
      // The CLI takes it, runs it, and goes idle.
      resolvePending(chat, "apply");
      setCliState(chat, "running");
      setCliState(chat, "idle");
      expect(list(ws).applied).toEqual([]);
    } finally {
      releaseHandle(chat);
    }
  });

  test("a queued Apply withdrawn puts its edits back; a later edit of the element keeps going from the set's start", () => {
    const ws = crypto.randomUUID();
    const card = edit(ws, CARD, { radius: 24 })!;
    const title = edit(ws, TITLE, { gap: 4 })!;
    markEditsApplied(ws, "chat-5", [card.id, title.id], "withdrawn")._unsafeUnwrap();
    // Edited again while queued: from 24, as the preview showed it.
    const later = edit(ws, TITLE, { gap: 8 }, { ...base, gap: 4 })!;
    restoreApplied("withdrawn");
    expect(list(ws).applied).toEqual([]);
    expect(list(ws).edits).toEqual([{ ...later, base }, card]);
  });

  test("a set whose queued message dies with its CLI goes", async () => {
    const ws = crypto.randomUUID();
    const chat = crypto.randomUUID();
    openHandle(chat, {} as PromptStream);
    setCliState(chat, "running");
    addPending(chat, "queued");
    markEditsApplied(ws, chat, [edit(ws, CARD, { radius: 24 })!.id], "queued")._unsafeUnwrap();
    setCliState(chat, "idle");
    expect(list(ws).applied).toHaveLength(1);
    // The CLI exits: its queue is cleared, then its handle released.
    resolvePending(chat, "queued");
    releaseHandle(chat);
    await Promise.resolve();
    expect(list(ws).applied).toEqual([]);
  });

  test("PUT keeps the element's text, which a frame finds it by", async () => {
    const ws = crypto.randomUUID();
    const res = await editController.request(`/${ws}/edits`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        componentName: "Card",
        element: { ref: { loc: CARD, index: 1, path: [0, 1], tag: "li", text: "Banana" } },
        name: "li",
        text: false,
        base,
        now: { ...base, gap: 16 },
        seen: null,
      }),
    });
    expect(res.status).toBe(200);
    expect(list(ws).edits[0]?.element.ref.text).toBe("Banana");
  });
});
