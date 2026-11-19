// A semaphore whose free permits go to the waiter that needs one most: the
// one whose `priority()` is lowest when a permit comes free. For the canvas's
// frames, that is the one nearest the middle of the view.
export class PrioritySemaphore {
  private waiting: { priority: () => number; grant: (release: () => void) => void }[] = [];
  private draining = false;

  constructor(private permits: number) {}

  // Resolves with the permit's release, which may be called more than once.
  acquire(priority: () => number): Promise<() => void> {
    return new Promise((grant) => {
      this.waiting.push({ priority, grant });
      this.drainSoon();
    });
  }

  // Not at once: the frames of a canvas all ask in the same tick, and the
  // first to ask is not the nearest.
  private drainSoon() {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      this.drain();
    });
  }

  private drain() {
    while (this.permits > 0 && this.waiting.length > 0) {
      let best = 0;
      let bestPriority = Infinity;
      for (let i = 0; i < this.waiting.length; i++) {
        const priority = this.waiting[i]!.priority();
        if (priority < bestPriority) {
          bestPriority = priority;
          best = i;
        }
      }
      const [next] = this.waiting.splice(best, 1);
      this.permits--;
      let released = false;
      next!.grant(() => {
        if (released) return;
        released = true;
        this.permits++;
        this.drain();
      });
    }
  }
}
