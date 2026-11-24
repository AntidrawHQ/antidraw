import { expect, test, vi } from "vitest";
import { UndoStack } from "../undo-stack";

// A counter's changes, as the canvas's frames would be.
const counter = () => {
  const log: string[] = [];
  const entry = (name: string) => ({
    undo: () => void log.push(`undo ${name}`),
    redo: () => void log.push(`redo ${name}`),
  });
  return { log, entry };
};

test("undoes back, redoes forward, and a new change ends the redo", async () => {
  const { log, entry } = counter();
  const stack = new UndoStack(() => {});
  stack.push(entry("a"));
  stack.push(entry("b"));
  await stack.undo();
  await stack.undo();
  await stack.undo();
  await stack.redo();
  stack.push(entry("c"));
  await stack.redo();
  await stack.undo();
  expect(log).toEqual(["undo b", "undo a", "redo a", "undo c"]);
});

test("an undo pressed while a change is still being made undoes that change", async () => {
  const { log, entry } = counter();
  const stack = new UndoStack(() => {});
  let finish!: () => void;
  const written = new Promise<void>((resolve) => (finish = resolve));
  const paste = stack.perform(async () => {
    await written;
    return entry("paste");
  });
  const undo = stack.undo();
  finish();
  await Promise.all([paste, undo]);
  expect(log).toEqual(["undo paste"]);
});

test("an entry that fails is dropped and reported, and the one before it is next", async () => {
  const { log, entry } = counter();
  const onError = vi.fn();
  const stack = new UndoStack(onError);
  stack.push(entry("a"));
  stack.push({ undo: () => Promise.reject(new Error("changed since")), redo: () => {} });
  await stack.undo();
  await stack.undo();
  await stack.redo();
  expect({ log, errors: onError.mock.calls.map(([e]) => (e as Error).message) }).toEqual({
    log: ["undo a", "redo a"],
    errors: ["changed since"],
  });
});

test("a change that made nothing leaves the stack as it was", async () => {
  const { log, entry } = counter();
  const stack = new UndoStack(() => {});
  stack.push(entry("a"));
  await stack.undo();
  await stack.perform(async () => null);
  await stack.redo();
  expect(log).toEqual(["undo a", "redo a"]);
});
