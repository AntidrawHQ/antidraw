import { describe, expect, test } from "vitest";
import type { ElementInfo } from "@/agent/protocol";
import type { Style } from "@/shared/design";
import { conversationEvents } from "@/main/lib/conversation-store";
import { editEvents } from "@/main/lib/edit-events";
import {
  describePendingEdits,
  listEdits,
  markEditsApplied,
  putEdit,
  releaseApplied,
  removeEdits,
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
    expect(markEditsApplied(ws, "chat-1", ids)._unsafeUnwrapErr().code).toBe("EDITS_CHANGED");
    expect(list(ws).edits.map((e) => e.id)).toEqual([card.id]);

    markEditsApplied(ws, "chat-1", [card.id])._unsafeUnwrap();
    expect(list(ws)).toEqual({ edits: [], applied: [{ id: expect.any(Number), conversationId: "chat-1", edits: [card] }] });
  });

  test("a set is shown until its chat's turn ends, or it's let go", () => {
    const ws = crypto.randomUUID();
    const seen: string[] = [];
    const on = (id: string) => id === ws && seen.push(id);
    editEvents.on("changed", on);
    try {
      markEditsApplied(ws, "chat-2", [edit(ws, CARD, { radius: 24 })!.id])._unsafeUnwrap();
      markEditsApplied(ws, "chat-3", [edit(ws, TITLE, { gap: 4 })!.id])._unsafeUnwrap();
      conversationEvents.emit("state", "chat-2", { state: "running" });
      expect(list(ws).applied).toHaveLength(2);
      conversationEvents.emit("state", "chat-2", { state: "idle" });
      expect(list(ws).applied.map((s) => s.conversationId)).toEqual(["chat-3"]);
      releaseApplied(ws, list(ws).applied[0]!.id)._unsafeUnwrap();
      expect(list(ws).applied).toEqual([]);
      // Two edits, two Applies, the turn's end, the release.
      expect(seen).toHaveLength(6);

      // A turn that fails never goes idle: its error lets the set go.
      markEditsApplied(ws, "chat-4", [edit(ws, CARD, { radius: 30 })!.id])._unsafeUnwrap();
      conversationEvents.emit("error", "chat-4", { error: "CLI exited" });
      expect(list(ws).applied).toEqual([]);
    } finally {
      editEvents.off("changed", on);
    }
  });
});
