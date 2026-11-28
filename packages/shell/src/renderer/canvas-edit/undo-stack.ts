// What the user did to the canvas's frames (a move, a paste, a delete), as
// entries: what each was, not how to undo it. Whoever asks for an undo says
// how (`apply`), so an entry made on one canvas undoes on the one that's up
// now. One workspace's, in memory: it's gone with the app, though a deleted
// frame is still in the trash.
//
// Every change runs in turn: an undo pressed while a paste is still writing
// its files waits for it, and so undoes the paste.

// Undoes (or redoes) an entry, and gives it back as it is now: what a redo
// (or the next undo) starts from.
export type Apply<Entry> = (entry: Entry, direction: "undo" | "redo") => Promise<Entry> | Entry;

export class UndoStack<Entry> {
  private done: Entry[] = [];
  private undone: Entry[] = [];
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
  push(entry: Entry) {
    return this.run(async () => this.record(entry));
  }

  // A change to make, in turn, and the entry for it (none: nothing changed).
  perform(change: () => Promise<Entry | null>) {
    return this.run(async () => {
      const entry = await change();
      if (entry) this.record(entry);
    });
  }

  // Each resolves to whether there was one to undo (or redo).
  undo(apply: Apply<Entry>) {
    return this.run(async () => {
      const entry = this.done.pop();
      if (entry === undefined) return false;
      this.undone.push(await apply(entry, "undo"));
      return true;
    });
  }

  redo(apply: Apply<Entry>) {
    return this.run(async () => {
      const entry = this.undone.pop();
      if (entry === undefined) return false;
      this.done.push(await apply(entry, "redo"));
      return true;
    });
  }

  private record(entry: Entry) {
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
