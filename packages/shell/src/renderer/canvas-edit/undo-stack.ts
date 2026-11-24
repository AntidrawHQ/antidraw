// What the user did to the canvas's frames (a move, a paste, a delete), each
// with its undo and its redo. One workspace's, in memory: it's gone with the
// app, though a deleted frame is still in the trash.
//
// Every change runs in turn: an undo pressed while a paste is still writing
// its files waits for it, and so undoes the paste.

export type UndoEntry = {
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
};

export class UndoStack {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  // An entry that failed (its frame changed since, or the write did) is
  // dropped, and onError told: there's no going past it any other way.
  constructor(
    private readonly onError: (error: unknown) => void,
    private readonly limit = 100,
  ) {}

  // The user's change, made: what it undoes is the user's to redo no more.
  // In turn too: a move made while an undo is still running comes after it,
  // so the undo can't hand back a redo the move has ended.
  push(entry: UndoEntry) {
    return this.run(async () => this.record(entry));
  }

  // A change to make, in turn, and the entry for it (none: nothing changed).
  perform(change: () => Promise<UndoEntry | null>) {
    return this.run(async () => {
      const entry = await change();
      if (entry) this.record(entry);
    });
  }

  // Each resolves to whether there was one to undo (or redo).
  undo() {
    return this.run(async () => {
      const entry = this.done.pop();
      if (!entry) return false;
      await entry.undo();
      this.undone.push(entry);
      return true;
    });
  }

  redo() {
    return this.run(async () => {
      const entry = this.undone.pop();
      if (!entry) return false;
      await entry.redo();
      this.done.push(entry);
      return true;
    });
  }

  private record(entry: UndoEntry) {
    this.done.push(entry);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
  }

  // A step that throws resolves to undefined, after onError.
  private run<T>(step: () => Promise<T>): Promise<T | undefined> {
    const next = this.queue.then(step).catch((error) => {
      this.onError(error);
      return undefined;
    });
    this.queue = next;
    return next;
  }
}

const stacks = new Map<string, UndoStack>();

// A workspace's, kept across switches to the others.
export const undoStackFor = (workspaceId: string, onError: (error: unknown) => void) => {
  let stack = stacks.get(workspaceId);
  if (!stack) {
    stack = new UndoStack(onError);
    stacks.set(workspaceId, stack);
  }
  return stack;
};
