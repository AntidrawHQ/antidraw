import fc from "fast-check";
import { expect, test } from "vitest";
import { UndoStack } from "../undo-stack";

// The undo stack against a model of it: two lists (done, undone) and the
// changes in effect. Every step is pressed at once, without waiting for the
// last (keys pressed while a paste writes its files, or an undo deletes
// one), and each change takes its own while: however they interleave, the
// stack ends as the model does running them one by one, in the order
// pressed. A change that fails is dropped and reported, and the stack never
// holds more than its limit.

const LIMIT = 5;

// A change's while: some turns of the microtask queue.
const pause = async (turns: number) => {
  for (let i = 0; i < turns; i++) await Promise.resolve();
};

const turns = fc.nat(4);
const step = fc.oneof(
  // A change already made (a move): pushed.
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("push" as const), failUndo: fc.boolean(), failRedo: fc.boolean(), undoTurns: turns, redoTurns: turns }) },
  // A change to make (a paste): made, then its entry, or none, or it fails.
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("perform" as const),
      outcome: fc.constantFrom("entry", "none", "throws"),
      turns,
      failUndo: fc.boolean(),
      failRedo: fc.boolean(),
      undoTurns: turns,
      redoTurns: turns,
    }),
  },
  { weight: 3, arbitrary: fc.constant({ kind: "undo" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "redo" as const }) },
);

type Spec = { id: number; failUndo: boolean; failRedo: boolean; undoTurns: number; redoTurns: number };

test("ends as the model does, however its changes interleave", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 40 }), async (steps) => {
      // What's in effect, as the entries' own undo and redo leave it.
      const world = new Set<number>();
      let errors = 0;
      const stack = new UndoStack<{ spec: Spec }>(() => errors++, LIMIT);
      const entry = (spec: Spec) => ({ spec });
      // An entry is what it was: undoing it is whoever asks.
      const apply = async (e: { spec: Spec }, direction: "undo" | "redo") => {
        const { spec } = e;
        if (direction === "undo") {
          await pause(spec.undoTurns);
          if (spec.failUndo) throw new Error(`undo ${spec.id}`);
          world.delete(spec.id);
        } else {
          await pause(spec.redoTurns);
          if (spec.failRedo) throw new Error(`redo ${spec.id}`);
          world.add(spec.id);
        }
        return e;
      };

      // The model, one step after another.
      const model = { done: [] as Spec[], undone: [] as Spec[], world: new Set<number>(), errors: 0 };
      const record = (spec: Spec) => {
        model.done.push(spec);
        if (model.done.length > LIMIT) model.done.shift();
        model.undone = [];
      };

      const pressed: Promise<unknown>[] = [];
      steps.forEach((s, id) => {
        if (s.kind === "push") {
          const spec = { id, ...s };
          // Made as it's pressed (a move is), recorded in turn.
          world.add(id);
          pressed.push(stack.push(entry(spec)));
          model.world.add(id);
          record(spec);
        } else if (s.kind === "perform") {
          const spec = { id, ...s };
          pressed.push(
            stack.perform(async () => {
              await pause(s.turns);
              if (s.outcome === "throws") throw new Error(`perform ${id}`);
              if (s.outcome === "none") return null;
              world.add(id);
              return entry(spec);
            }),
          );
          if (s.outcome === "throws") model.errors++;
          if (s.outcome === "entry") {
            model.world.add(id);
            record(spec);
          }
        } else if (s.kind === "undo") {
          pressed.push(stack.undo(apply));
          const spec = model.done.pop();
          if (spec?.failUndo) model.errors++;
          else if (spec) {
            model.world.delete(spec.id);
            model.undone.push(spec);
          }
        } else {
          pressed.push(stack.redo(apply));
          const spec = model.undone.pop();
          if (spec?.failRedo) model.errors++;
          else if (spec) {
            model.world.add(spec.id);
            model.done.push(spec);
          }
        }
      });
      await Promise.all(pressed);

      // Its lists are private: read here, as the model's.
      const lists = stack as unknown as { done: { spec: Spec }[]; undone: { spec: Spec }[] };
      const ids = (list: { spec: Spec }[] | Spec[]) => list.map((e) => ("spec" in e ? e.spec : e).id);
      expect({
        done: ids(lists.done),
        undone: ids(lists.undone),
        world: [...world].sort((a, b) => a - b),
        errors,
      }).toEqual({
        done: ids(model.done),
        undone: ids(model.undone),
        world: [...model.world].sort((a, b) => a - b),
        errors: model.errors,
      });
    }),
    { numRuns: 300 },
  );
});
