import { expect, test, vi } from "vitest";
import { UndoStack } from "../undo-stack";

// A stack of names, and a log of what undoing and redoing each was asked.
const named = (onError: (error: unknown) => void = () => {}) => {
  const log: string[] = [];
  const stack = new UndoStack<string>(onError);
  const apply = (name: string, direction: "undo" | "redo") => {
    if (name === "fails") throw new Error("changed since");
    log.push(`${direction} ${name}`);
    return name;
  };
  return { log, stack, undo: () => stack.undo(apply), redo: () => stack.redo(apply) };
};

test("undoes back, redoes forward, and a new change ends the redo", async () => {
  const { log, stack, undo, redo } = named();
  stack.push("a");
  stack.push("b");
  await undo();
  await undo();
  await undo();
  await redo();
  stack.push("c");
  await redo();
  await undo();
  expect(log).toEqual(["undo b", "undo a", "redo a", "undo c"]);
});

test("an undo pressed while a change is still being made undoes that change", async () => {
  const { log, stack, undo } = named();
  let finish!: () => void;
  const written = new Promise<void>((resolve) => (finish = resolve));
  const paste = stack.perform(async () => {
    await written;
    return "paste";
  });
  const undone = undo();
  finish();
  await Promise.all([paste, undone]);
  expect(log).toEqual(["undo paste"]);
});

test("an entry that fails is dropped and reported, and the one before it is next", async () => {
  const onError = vi.fn();
  const { log, stack, undo, redo } = named(onError);
  stack.push("a");
  stack.push("fails");
  await undo();
  await undo();
  await redo();
  expect({ log, errors: onError.mock.calls.map(([e]) => (e as Error).message) }).toEqual({
    log: ["undo a", "redo a"],
    errors: ["changed since"],
  });
});

test("a change that made nothing leaves the stack as it was", async () => {
  const { log, stack, undo, redo } = named();
  stack.push("a");
  await undo();
  await stack.perform(async () => null);
  await redo();
  expect(log).toEqual(["undo a", "redo a"]);
});

test("an entry is redone as its undo left it, by whoever asks", async () => {
  // Frames made, of which the undo could only take some: the redo is of those.
  const stack = new UndoStack<string[]>(() => {});
  stack.push(["a", "b"]);
  await stack.undo((frames) => frames.slice(0, 1));
  const redone: string[][] = [];
  await stack.redo((frames) => (redone.push(frames), frames));
  expect(redone).toEqual([["a"]]);
});
