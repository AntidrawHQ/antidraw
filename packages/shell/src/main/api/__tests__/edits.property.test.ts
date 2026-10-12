import fc from "fast-check";
import { expect, test } from "vitest";
import type { ElementInfo } from "@/agent/protocol";
import type { Style } from "@/shared/design";
import { conversationEvents } from "@/main/lib/conversation-store";
import { editEvents } from "@/main/lib/edit-events";
import {
  listEdits,
  markEditsApplied,
  putEdit,
  releaseApplied,
  removeEdits,
} from "@/main/api/services/edit.service";

// The edits a workspace holds, against a model of them: whatever the panel
// does (edit, undo, Reset), whatever Apply takes and whenever a chat's turn
// ends or fails, an element has at most one edit, an edit is pending or in
// one applied set and never both, an edit back where it started is gone,
// Apply takes all it's given or nothing, and every change is announced.

const base = { gap: 0, radius: 8 } as Style;
const ELEMENTS = ["A", "B", "C"];
const CHATS = ["chat-1", "chat-2"];
const element = (loc: string) => ({ ref: { loc, index: 0, path: [0], tag: "div" } }) as ElementInfo;

const step = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("edit" as const), el: fc.constantFrom(...ELEMENTS), gap: fc.nat(2) }) },
  fc.record({ kind: fc.constant("undo" as const), el: fc.constantFrom(...ELEMENTS) }),
  fc.constant({ kind: "reset" as const }),
  // Some of what's pending, maybe with one that isn't any more.
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("apply" as const), take: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }), stale: fc.boolean(), chat: fc.constantFrom(...CHATS) }) },
  fc.record({ kind: fc.constant("release" as const), which: fc.nat(3) }),
  fc.record({ kind: fc.constant("turn" as const), chat: fc.constantFrom(...CHATS), ends: fc.constantFrom("idle", "error", "running") }),
);

let run = 0;

test("holds what the model holds, whatever the panel, Apply and the chats do", () => {
  fc.assert(
    fc.property(fc.array(step, { minLength: 1, maxLength: 30 }), (steps) => {
      const ws = `00000000-0000-4000-8000-${String(run++).padStart(12, "0")}`;
      // The model: each element's pending gap, and the sets being applied.
      const pending = new Map<string, number>();
      let applied: { chat: string; els: string[] }[] = [];
      let announced = 0;
      const on = (id: string) => id === ws && announced++;
      editEvents.on("changed", on);
      const gone: number[] = [];
      try {
        for (const s of steps) {
          const before = announced;
          const list = listEdits(ws)._unsafeUnwrap();
          const idOf = (el: string) => list.edits.find((e) => e.element.ref.loc === el)?.id;
          let changes = true;
          if (s.kind === "edit") {
            putEdit(ws, { componentName: "Card", element: element(s.el), name: "div", text: false, base, now: { ...base, gap: s.gap }, seen: null });
            if (s.gap === base.gap) pending.delete(s.el);
            else pending.set(s.el, s.gap);
          } else if (s.kind === "undo") {
            const id = idOf(s.el);
            const r = id === undefined ? removeEdits(ws, -1) : removeEdits(ws, id);
            expect(r.isOk()).toBe(id !== undefined);
            changes = id !== undefined;
            pending.delete(s.el);
          } else if (s.kind === "reset") {
            removeEdits(ws)._unsafeUnwrap();
            pending.clear();
          } else if (s.kind === "apply") {
            const els = ELEMENTS.filter((el, i) => s.take[i] && pending.has(el));
            const ids = els.map((el) => idOf(el)!);
            if (s.stale && gone.length) ids.push(gone[0]!);
            if (!ids.length) continue;
            const r = markEditsApplied(ws, s.chat, ids);
            const all = !(s.stale && gone.length);
            expect(r.isOk(), "all or nothing").toBe(all);
            changes = all;
            if (all) {
              for (const el of els) {
                gone.push(idOf(el)!);
                pending.delete(el);
              }
              applied.push({ chat: s.chat, els });
            }
          } else if (s.kind === "release") {
            const set = list.applied[s.which];
            if (!set) continue;
            releaseApplied(ws, set.id)._unsafeUnwrap();
            applied = applied.filter((_, i) => i !== s.which);
          } else {
            if (s.ends === "error") conversationEvents.emit("error", s.chat, { error: "the CLI exited" });
            else conversationEvents.emit("state", s.chat, { state: s.ends });
            const ends = s.ends !== "running" && applied.some((a) => a.chat === s.chat);
            if (s.ends !== "running") applied = applied.filter((a) => a.chat !== s.chat);
            changes = ends;
          }

          const now = listEdits(ws)._unsafeUnwrap();
          expect(Object.fromEntries(now.edits.map((e) => [e.element.ref.loc, e.now.gap])), "pending").toEqual(Object.fromEntries(pending));
          expect(
            now.applied.map((a) => ({ chat: a.conversationId, els: a.edits.map((e) => e.element.ref.loc!).sort() })),
            "applied",
          ).toEqual(applied.map((a) => ({ ...a, els: [...a.els].sort() })));
          // One edit an element; pending or applied, never both; ids unique.
          const ids = [...now.edits, ...now.applied.flatMap((a) => a.edits)].map((e) => e.id);
          expect(new Set(ids).size, "ids").toBe(ids.length);
          expect(new Set(now.edits.map((e) => e.element.ref.loc)).size).toBe(now.edits.length);
          if (changes) expect(announced, `${s.kind} announced`).toBeGreaterThan(before);
        }
      } finally {
        editEvents.off("changed", on);
      }
    }),
    { numRuns: 500 },
  );
});

test("generates the cases that matter", () => {
  const runs = fc.sample(fc.array(step, { minLength: 1, maxLength: 30 }), { numRuns: 300, seed: 1 });
  const seen = (pred: (steps: (typeof runs)[number]) => boolean) => runs.filter(pred).length;
  // An Apply, then the same chat's turn ending or failing.
  expect(
    seen((steps) =>
      steps.some((s, k) => s.kind === "apply" && steps.slice(k + 1).some((t) => t.kind === "turn" && t.chat === s.chat && t.ends !== "running")),
    ),
  ).toBeGreaterThan(25);
  expect(seen((steps) => steps.filter((s) => s.kind === "apply").length >= 2)).toBeGreaterThan(25);
  expect(seen((steps) => steps.some((s) => s.kind === "apply" && s.stale))).toBeGreaterThan(25);
  expect(seen((steps) => steps.some((s) => s.kind === "edit" && s.gap === 0))).toBeGreaterThan(25);
});
