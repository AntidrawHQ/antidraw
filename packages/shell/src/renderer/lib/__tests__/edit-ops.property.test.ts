import fc from "fast-check";
import { err, ok } from "neverthrow";
import { QueryClient } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import type { Style } from "@/shared/design";
import type { EditedElement, EditList } from "@/shared/utils/canvas-edits";
import type { ElementInfo } from "@/agent/protocol";

// The Design panel's writes: each lands in the cache at once and goes to the
// API after, one request at a time per element. However the user drags
// (several elements, back and forth, back to where it started) and however
// the API answers (late, out of order across elements, failing), the cache
// always shows the latest of each element, an element never has two
// requests out, its requests carry its values in the order they were made,
// the last one sent is its latest, and "settled" means nothing is out.

type Request = { key: string; gap: number; answer: (okay: boolean) => void };
let requests: Request[] = [];

vi.mock("../api", () => ({
  putEdit: vi.fn(
    (_ws: string, edit: Omit<EditedElement, "id">) =>
      new Promise((resolve) => {
        requests.push({
          key: edit.element.ref.loc!,
          gap: edit.now.gap,
          answer: (okay) =>
            resolve(
              okay
                ? ok(edit.now.gap === edit.base.gap ? null : { ...edit, id: 1 + Number(edit.element.ref.loc!.slice(1)) })
                : err({ message: "offline" }),
            ),
        });
      }),
  ),
  removeEdits: vi.fn(async () => ok({ ok: true })),
  releaseApplied: vi.fn(async () => ok({ ok: true })),
  listEdits: vi.fn(),
  watchEdits: vi.fn(() => () => {}),
}));

const { editsSettled, saveEdit } = await import("../edit-ops");
const { queryKeys } = await import("../query-keys");

const base = { gap: 0 } as Style;
const ELEMENTS = ["L0", "L1", "L2"];
const input = (key: string, gap: number): Omit<EditedElement, "id"> => ({
  componentName: "Card",
  element: { ref: { loc: key, index: 0, path: [0], tag: "div" } } as ElementInfo,
  name: "div",
  text: false,
  base,
  now: { ...base, gap },
  seen: null,
});

const step = fc.oneof(
  // A slider moved (0: back where it started).
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("save" as const), key: fc.constantFrom(...ELEMENTS), gap: fc.nat(3) }) },
  // The API answers one element's request.
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("answer" as const), key: fc.constantFrom(...ELEMENTS), okay: fc.boolean() }) },
);

// The promise hops a write takes to land and start the next.
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let run = 0;

test("the cache shows the latest, one request per element at a time, in order, the last one the latest", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 25 }), async (steps) => {
      const ws = `ws-${run++}`;
      const queryClient = new QueryClient();
      requests = [];
      const answered = new Set<Request>();
      const saved: Record<string, number[]> = {};
      // Waiting for the writes, now: done in a moment exactly when none is out.
      const settles = async () => {
        let done = false;
        void editsSettled(ws).then(() => (done = true));
        await flush();
        return done;
      };

      const out = (key: string) => requests.filter((r) => r.key === key && !answered.has(r));
      const check = () => {
        const list = queryClient.getQueryData<EditList>(queryKeys.edits.byWorkspace(ws));
        for (const key of ELEMENTS) {
          expect(out(key).length, `${key} in flight`).toBeLessThanOrEqual(1);
          const values = saved[key] ?? [];
          // Its requests: its values, in the order made (a later one may be
          // skipped over while one is out, never an earlier one sent again).
          const sent = requests.filter((r) => r.key === key).map((r) => r.gap);
          let at = -1;
          for (const g of sent) {
            const next = values.indexOf(g, at + 1);
            expect(next, `${key} sent ${sent} of ${values}`).toBeGreaterThan(at);
            at = next;
          }
          const last = values.at(-1);
          const edit = list?.edits.find((e) => e.element.ref.loc === key);
          if (last === undefined) expect(edit).toBeUndefined();
          else if (last === base.gap) expect(edit, `${key} back where it started`).toBeUndefined();
          else expect(edit?.now.gap, `${key} in the cache`).toBe(last);
        }
      };

      for (const s of steps) {
        if (s.kind === "save") {
          saveEdit(queryClient, ws, input(s.key, s.gap));
          (saved[s.key] ??= []).push(s.gap);
        } else {
          const r = out(s.key)[0];
          if (!r) continue;
          answered.add(r);
          r.answer(s.okay);
        }
        await flush();
        check();
        expect(await settles(), "settled when nothing is out").toBe(requests.every((r) => answered.has(r)));
      }

      // The API answers the rest.
      for (let r = requests.find((x) => !answered.has(x)); r; r = requests.find((x) => !answered.has(x))) {
        answered.add(r);
        r.answer(true);
        await flush();
        check();
      }
      expect(await settles(), "settled once nothing is out").toBe(true);
      for (const key of ELEMENTS) {
        const values = saved[key];
        if (!values) continue;
        const sent = requests.filter((r) => r.key === key);
        expect(sent.at(-1)?.gap, `${key}'s last request is its latest`).toBe(values.at(-1));
      }
    }),
    { numRuns: 300 },
  );
});

test("generates the cases that matter", () => {
  const runs = fc.sample(fc.array(step, { minLength: 1, maxLength: 25 }), { numRuns: 300, seed: 1 });
  const seen = (pred: (steps: (typeof runs)[number]) => boolean) => runs.filter(pred).length;
  // Saves piling up behind one that's out: three or more on one element
  // before it's answered.
  expect(
    seen((steps) => {
      let pending = 0;
      for (const s of steps) {
        if (s.kind === "save" && s.key === "L0") pending++;
        if (s.kind === "answer" && s.key === "L0") pending = 0;
        if (pending >= 3) return true;
      }
      return false;
    }),
  ).toBeGreaterThan(25);
  expect(seen((steps) => steps.some((s) => s.kind === "answer" && !s.okay))).toBeGreaterThan(25);
  expect(seen((steps) => steps.some((s) => s.kind === "save" && s.gap === 0))).toBeGreaterThan(25);
  expect(seen((steps) => new Set(steps.filter((s) => s.kind === "save").map((s) => s.key)).size >= 2)).toBeGreaterThan(25);
});
