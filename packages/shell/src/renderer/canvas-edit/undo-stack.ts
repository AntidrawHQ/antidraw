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

const LIMIT = 100;

export class UndoStack {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  // An entry that failed (its frame changed since, or the write did) is
  // dropped, and onError told: there's no going past it any other way.
  constructor(private readonly onError: (error: unknown) => void) {}

  // The user's change, made: what it undoes is the user's to redo no more.
  push(entry: UndoEntry) {
    this.done.push(entry);
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
  }

  // A change to make, in turn, and the entry for it (none: nothing changed).
  perform(change: () => Promise<UndoEntry | null>) {
    return this.run(async () => {
      const entry = await change();
      if (entry) this.push(entry);
    });
  }

  undo() {
    return this.run(async () => {
      const entry = this.done.pop();
      if (!entry) return;
      await entry.undo();
      this.undone.push(entry);
    });
  }

  redo() {
    return this.run(async () => {
      const entry = this.undone.pop();
      if (!entry) return;
      await entry.redo();
      this.done.push(entry);
    });
  }

  get canUndo() {
    return this.done.length > 0;
  }

  get canRedo() {
    return this.undone.length > 0;
  }

  private run(step: () => Promise<void>) {
    const next = this.queue.then(step).catch(this.onError);
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
